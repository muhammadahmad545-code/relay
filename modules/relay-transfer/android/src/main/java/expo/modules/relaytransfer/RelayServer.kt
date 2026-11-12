package expo.modules.relaytransfer

import android.content.Context
import fi.iki.elonen.NanoHTTPD
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.io.RandomAccessFile
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.AEADBadTagException

typealias RelayEmitter = (name: String, body: Map<String, Any?>) -> Unit

private class HttpError(val status: NanoHTTPD.Response.Status, message: String, val extra: JSONObject? = null) : Exception(message)

private class Incoming(
  val id: String,
  val name: String,
  val mime: String,
  val size: Long,
  val totalChunks: Int,
  val temp: File,
  val peer: String
) {
  val stream = FileOutputStream(temp)
  var nextIndex = 0
  var received = 0L
  var finished = false
}

class OutboxItem(
  val id: String,
  val kind: String,
  val name: String,
  val mime: String,
  val size: Long,
  val path: String?,
  val text: String?
) {
  val totalChunks: Int
    get() = if (size == 0L) 0 else ((size + RelayFiles.CHUNK_BYTES - 1) / RelayFiles.CHUNK_BYTES).toInt()
}

/**
 * The HTTP server that runs on the phone while a session is open.
 * Serves the browser client, accepts encrypted uploads and offers the phone's shared items.
 */
class RelayServer(
  private val context: Context,
  port: Int,
  private val key: ByteArray,
  private val deviceName: String,
  private val emit: RelayEmitter
) : NanoHTTPD(port) {

  private val token = RelayCrypto.token(key)
  private val incoming = ConcurrentHashMap<String, Incoming>()
  private val outbox = java.util.Collections.synchronizedList(mutableListOf<OutboxItem>())
  private val knownPeers = ConcurrentHashMap.newKeySet<String>()
  private val pairings = ConcurrentHashMap<String, Pair<Long, RelayCrypto.LinkResponse>>()

  /** Called after the phone scans a browser's link code. The browser collects the result from /pair/<id>. */
  fun link(id: String, browserPublicKey: String) {
    val now = System.currentTimeMillis()
    pairings.entries.removeIf { now - it.value.first > PAIRING_TTL_MS }
    if (pairings.size >= MAX_PAIRINGS) throw IllegalStateException("Too many devices are being linked at once. Try again in a minute.")
    pairings[id] = now to RelayCrypto.linkResponse(key, id, browserPublicKey)
  }

  fun addOutbox(item: OutboxItem) {
    outbox.add(item)
  }

  fun removeOutbox(id: String) {
    outbox.removeAll { it.id == id }
  }

  fun clearOutbox() {
    outbox.clear()
  }

  fun shutdown() {
    stop()
    incoming.values.forEach { transfer ->
      synchronized(transfer) {
        if (!transfer.finished) {
          runCatching { transfer.stream.close() }
          transfer.temp.delete()
          emitTransfer(transfer, "failed", "The session was closed before the transfer finished.")
        }
      }
    }
    incoming.clear()
  }

  override fun serve(session: IHTTPSession): Response {
    return try {
      route(session)
    } catch (e: HttpError) {
      val body = (e.extra ?: JSONObject()).put("error", e.message)
      plainJson(e.status, body).also { it.closeConnection(true) }
    } catch (e: AEADBadTagException) {
      plainJson(Response.Status.BAD_REQUEST, JSONObject().put("error", "Decryption failed. Scan the QR code again."))
        .also { it.closeConnection(true) }
    } catch (e: Exception) {
      plainJson(Response.Status.INTERNAL_ERROR, JSONObject().put("error", "The phone could not process the request."))
        .also { it.closeConnection(true) }
    }
  }

  private fun route(session: IHTTPSession): Response {
    val path = session.uri.trimEnd('/')
    val method = session.method

    if (method == Method.GET && (path == "" || path == "/index.html")) return page()
    if (method == Method.GET && path == "/favicon.ico") return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "")
    if (method == Method.GET && path.startsWith("/pair/")) return collectPairing(path.removePrefix("/pair/"))
    if (!path.startsWith("/api/")) throw HttpError(Response.Status.NOT_FOUND, "Not found.")

    val supplied = session.headers["x-relay-token"]
    if (supplied == null || !constantTimeEquals(supplied, token)) {
      throw HttpError(Response.Status.UNAUTHORIZED, "This link is no longer valid. Scan the QR code again.")
    }
    val peer = session.remoteIpAddress ?: "unknown"
    if (knownPeers.add(peer)) emit("onPeer", mapOf("address" to peer))

    val parts = path.removePrefix("/api/").split('/')
    return when {
      method == Method.GET && parts == listOf("hello") -> sealedJson("hello", JSONObject()
        .put("name", deviceName)
        .put("protocol", 1)
        .put("chunkBytes", RelayFiles.CHUNK_BYTES))

      method == Method.POST && parts == listOf("transfers") -> createTransfer(session, peer)
      method == Method.GET && parts.size == 2 && parts[0] == "transfers" -> transferStatus(parts[1])
      method == Method.PUT && parts.size == 4 && parts[0] == "transfers" && parts[2] == "chunks" ->
        receiveChunk(session, parts[1], parts[3].toIntOrNull() ?: throw HttpError(Response.Status.BAD_REQUEST, "Bad chunk index."))
      method == Method.POST && parts.size == 3 && parts[0] == "transfers" && parts[2] == "complete" -> completeTransfer(parts[1])
      method == Method.POST && parts.size == 3 && parts[0] == "transfers" && parts[2] == "cancel" -> cancelTransfer(parts[1])

      method == Method.POST && parts == listOf("text") -> receiveText(session, peer)

      method == Method.GET && parts == listOf("outbox") -> listOutbox()
      method == Method.GET && parts.size == 4 && parts[0] == "outbox" && parts[2] == "chunks" ->
        sendChunk(parts[1], parts[3].toIntOrNull() ?: throw HttpError(Response.Status.BAD_REQUEST, "Bad chunk index."))

      else -> throw HttpError(Response.Status.NOT_FOUND, "Not found.")
    }
  }

  // ---- browser page ------------------------------------------------------------------------

  private fun page(): Response {
    val bytes = context.assets.open("relay-web/index.html").use { it.readBytes() }
    return newFixedLengthResponse(Response.Status.OK, "text/html; charset=utf-8", ByteArrayInputStream(bytes), bytes.size.toLong()).apply {
      addHeader("Cache-Control", "no-store")
      addHeader("X-Content-Type-Options", "nosniff")
      addHeader("Referrer-Policy", "no-referrer")
      addHeader("X-Frame-Options", "DENY")
      addHeader(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'self'; base-uri 'none'; form-action 'none'"
      )
    }
  }

  /** One-time pickup: the wrapped key is removed as soon as it is collected. */
  private fun collectPairing(id: String): Response {
    val entry = pairings.remove(id) ?: throw HttpError(Response.Status.NOT_FOUND, "Not linked yet.")
    if (System.currentTimeMillis() - entry.first > PAIRING_TTL_MS) throw HttpError(Response.Status.NOT_FOUND, "Not linked yet.")
    return plainJson(Response.Status.OK, JSONObject().put("pub", entry.second.publicKey).put("sealed", entry.second.sealedKey))
  }

  // ---- receiving ---------------------------------------------------------------------------

  private fun createTransfer(session: IHTTPSession, peer: String): Response {
    val meta = JSONObject(String(RelayCrypto.open(key, "meta", readBody(session, 64 * 1024)), Charsets.UTF_8))
    val size = meta.getLong("size")
    if (size < 0) throw HttpError(Response.Status.BAD_REQUEST, "Bad file size.")
    val expectedChunks = if (size == 0L) 0 else ((size + RelayFiles.CHUNK_BYTES - 1) / RelayFiles.CHUNK_BYTES).toInt()

    val dir = RelayFiles.tempDir(context)
    if (dir.usableSpace < size * 2 + 32L * 1024 * 1024) {
      throw HttpError(Response.Status.BAD_REQUEST, "The phone does not have enough free storage for this file.")
    }
    val id = RelayCrypto.newId()
    val transfer = Incoming(
      id = id,
      name = RelayFiles.sanitizeName(meta.optString("name", "file")),
      mime = meta.optString("mime", "application/octet-stream"),
      size = size,
      totalChunks = expectedChunks,
      temp = File(dir, "$id.part"),
      peer = peer
    )
    incoming[id] = transfer
    emitTransfer(transfer, "active", null)
    return sealedJson("meta-res", JSONObject().put("id", id).put("chunkBytes", RelayFiles.CHUNK_BYTES))
  }

  private fun transferStatus(id: String): Response {
    val transfer = incoming[id] ?: throw HttpError(Response.Status.NOT_FOUND, "Transfer not found.")
    return plainJson(Response.Status.OK, JSONObject().put("next", transfer.nextIndex))
  }

  private fun receiveChunk(session: IHTTPSession, id: String, index: Int): Response {
    val transfer = incoming[id] ?: throw HttpError(Response.Status.NOT_FOUND, "Transfer not found.")
    val sealed = readBody(session, RelayFiles.CHUNK_BYTES + RelayCrypto.OVERHEAD)
    synchronized(transfer) {
      if (transfer.finished) throw HttpError(Response.Status.CONFLICT, "Transfer already finished.")
      if (index != transfer.nextIndex) {
        // Tell the sender where to resume from instead of failing the whole transfer.
        throw HttpError(Response.Status.CONFLICT, "Out of order chunk.", JSONObject().put("next", transfer.nextIndex))
      }
      val plain = RelayCrypto.open(key, "chunk:$id:$index", sealed)
      if (transfer.received + plain.size > transfer.size) {
        throw HttpError(Response.Status.BAD_REQUEST, "More data than announced.")
      }
      transfer.stream.write(plain)
      transfer.received += plain.size
      transfer.nextIndex = index + 1
    }
    emitTransfer(transfer, "active", null)
    return plainJson(Response.Status.OK, JSONObject().put("next", transfer.nextIndex))
  }

  private fun completeTransfer(id: String): Response {
    val transfer = incoming[id] ?: throw HttpError(Response.Status.NOT_FOUND, "Transfer not found.")
    synchronized(transfer) {
      if (transfer.finished) return plainJson(Response.Status.OK, JSONObject().put("ok", true))
      if (transfer.received != transfer.size || transfer.nextIndex != transfer.totalChunks) {
        throw HttpError(Response.Status.CONFLICT, "Transfer is incomplete.", JSONObject().put("next", transfer.nextIndex))
      }
      transfer.stream.fd.sync()
      transfer.stream.close()
      try {
        val saved = RelayFiles.saveToDownloads(context, transfer.temp, transfer.name, transfer.mime)
        transfer.finished = true
        emitTransfer(transfer, "done", null, saved.toString())
      } catch (e: Exception) {
        transfer.finished = true
        transfer.temp.delete()
        emitTransfer(transfer, "failed", "Could not save the file: ${e.message ?: "storage error"}")
        incoming.remove(id)
        throw HttpError(Response.Status.INTERNAL_ERROR, "The phone could not save the file.")
      }
    }
    incoming.remove(id)
    return plainJson(Response.Status.OK, JSONObject().put("ok", true))
  }

  private fun cancelTransfer(id: String): Response {
    val transfer = incoming.remove(id) ?: return plainJson(Response.Status.OK, JSONObject().put("ok", true))
    synchronized(transfer) {
      if (!transfer.finished) {
        transfer.finished = true
        runCatching { transfer.stream.close() }
        transfer.temp.delete()
        emitTransfer(transfer, "failed", "Cancelled by the sender.")
      }
    }
    return plainJson(Response.Status.OK, JSONObject().put("ok", true))
  }

  private fun receiveText(session: IHTTPSession, peer: String): Response {
    val body = JSONObject(String(RelayCrypto.open(key, "text", readBody(session, 1024 * 1024)), Charsets.UTF_8))
    emit("onText", mapOf("text" to body.getString("text"), "peer" to peer))
    return plainJson(Response.Status.OK, JSONObject().put("ok", true))
  }

  // ---- sharing from the phone ----------------------------------------------------------------

  private fun listOutbox(): Response {
    val items = JSONArray()
    synchronized(outbox) {
      for (item in outbox) {
        items.put(JSONObject()
          .put("id", item.id)
          .put("kind", item.kind)
          .put("name", item.name)
          .put("mime", item.mime)
          .put("size", item.size)
          .put("totalChunks", item.totalChunks)
          .put("text", item.text ?: JSONObject.NULL))
      }
    }
    return sealedJson("outbox", JSONObject().put("items", items))
  }

  private fun sendChunk(id: String, index: Int): Response {
    val item = synchronized(outbox) { outbox.firstOrNull { it.id == id } }
      ?: throw HttpError(Response.Status.NOT_FOUND, "This item is no longer shared.")
    val path = item.path ?: throw HttpError(Response.Status.BAD_REQUEST, "Not a file.")
    if (index < 0 || index >= item.totalChunks) throw HttpError(Response.Status.BAD_REQUEST, "Bad chunk index.")

    val offset = index.toLong() * RelayFiles.CHUNK_BYTES
    val length = minOf(RelayFiles.CHUNK_BYTES.toLong(), item.size - offset).toInt()
    val buffer = ByteArray(length)
    RandomAccessFile(path, "r").use { file ->
      file.seek(offset)
      file.readFully(buffer)
    }
    val sealed = RelayCrypto.seal(key, "out:$id:$index", buffer)
    val sent = offset + length
    emit("onTransfer", mapOf(
      "id" to "out-$id",
      "direction" to "out",
      "name" to item.name,
      "size" to item.size.toDouble(),
      "bytes" to sent.toDouble(),
      "status" to (if (sent >= item.size) "done" else "active"),
      "error" to null,
      "savedUri" to null
    ))
    return newFixedLengthResponse(Response.Status.OK, "application/octet-stream", ByteArrayInputStream(sealed), sealed.size.toLong())
      .apply { addHeader("Cache-Control", "no-store") }
  }

  // ---- helpers -------------------------------------------------------------------------------

  private fun emitTransfer(transfer: Incoming, status: String, error: String?, savedUri: String? = null) {
    emit("onTransfer", mapOf(
      "id" to transfer.id,
      "direction" to "in",
      "name" to transfer.name,
      "size" to transfer.size.toDouble(),
      "bytes" to transfer.received.toDouble(),
      "status" to status,
      "error" to error,
      "savedUri" to savedUri
    ))
  }

  /** Reads exactly Content-Length bytes. The body must always be consumed or keep-alive breaks. */
  private fun readBody(session: IHTTPSession, maxBytes: Int): ByteArray {
    val length = session.headers["content-length"]?.toIntOrNull()
      ?: throw HttpError(Response.Status.BAD_REQUEST, "Missing Content-Length.")
    if (length < 0 || length > maxBytes) throw HttpError(Response.Status.BAD_REQUEST, "Request body is too large.")
    val buffer = ByteArray(length)
    val input: InputStream = session.inputStream
    var read = 0
    while (read < length) {
      val n = input.read(buffer, read, length - read)
      if (n < 0) throw HttpError(Response.Status.BAD_REQUEST, "Connection closed mid-request.")
      read += n
    }
    return buffer
  }

  private fun sealedJson(aad: String, body: JSONObject): Response {
    val sealed = RelayCrypto.seal(key, aad, body.toString().toByteArray(Charsets.UTF_8))
    return newFixedLengthResponse(Response.Status.OK, "application/octet-stream", ByteArrayInputStream(sealed), sealed.size.toLong())
      .apply { addHeader("Cache-Control", "no-store") }
  }

  private fun plainJson(status: Response.Status, body: JSONObject): Response =
    newFixedLengthResponse(status, "application/json", body.toString()).apply { addHeader("Cache-Control", "no-store") }

  private fun constantTimeEquals(a: String, b: String): Boolean {
    if (a.length != b.length) return false
    var diff = 0
    for (i in a.indices) diff = diff or (a[i].code xor b[i].code)
    return diff == 0
  }

  companion object {
    private const val PAIRING_TTL_MS = 3 * 60 * 1000L
    private const val MAX_PAIRINGS = 16
  }
}
