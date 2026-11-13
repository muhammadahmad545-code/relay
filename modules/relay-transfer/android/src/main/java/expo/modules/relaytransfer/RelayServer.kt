package expo.modules.relaytransfer

import android.content.Context
import fi.iki.elonen.NanoHTTPD
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.RandomAccessFile
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
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
  /** Opened on the first chunk, so abandoned transfers never hold a file handle. */
  var stream: FileOutputStream? = null
  var nextIndex = 0
  var received = 0L
  var finished = false
  var lastActivity = System.currentTimeMillis()
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

/** One browser download of a shared file, tracked so the phone can show progress, done or stopped. */
private class Download(val eventId: String, val item: OutboxItem) {
  val startedAt = System.currentTimeMillis()
  var lastActivity = startedAt
  var sent = 0L
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
  private val downloads = ConcurrentHashMap<String, Download>()
  private val knownPeers = ConcurrentHashMap.newKeySet<String>()
  private val pairings = ConcurrentHashMap<String, Pair<Long, RelayCrypto.LinkResponse>>()
  /** Nonces of every message accepted this session: a captured message can never be replayed. */
  private val seenNonces = java.util.Collections.synchronizedSet(HashSet<String>())
  private val reaper: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()
  private var downloadCounter = 0

  init {
    reaper.scheduleWithFixedDelay({ runCatching { reap() } }, 15, 15, TimeUnit.SECONDS)
  }

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
    reaper.shutdownNow()
    incoming.values.forEach { transfer ->
      synchronized(transfer) {
        if (!transfer.finished) {
          transfer.finished = true
          runCatching { transfer.stream?.close() }
          transfer.temp.delete()
          emitTransfer(transfer, "failed", "The session was closed before the transfer finished.")
        }
      }
    }
    incoming.clear()
    downloads.values.forEach { emitDownload(it, "failed", "The session was closed.") }
    downloads.clear()
  }

  /** Fails transfers that went quiet (closed laptop tab, lost Wi-Fi) so nothing stays "active" forever. */
  private fun reap() {
    val now = System.currentTimeMillis()
    incoming.values.filter { now - it.lastActivity > IDLE_MS }.forEach { transfer ->
      synchronized(transfer) {
        if (transfer.finished) return@synchronized
        transfer.finished = true
        runCatching { transfer.stream?.close() }
        transfer.temp.delete()
        emitTransfer(transfer, "failed", "The other device stopped sending.")
      }
      incoming.remove(transfer.id)
    }
    downloads.entries.filter { now - it.value.lastActivity > IDLE_MS }.forEach { (k, d) ->
      downloads.remove(k)
      emitDownload(d, "failed", "The download stopped.")
    }
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

  /** Decrypts a request body and rejects any nonce already used in this session. */
  private fun openOnce(aad: String, sealed: ByteArray): ByteArray {
    val plain = RelayCrypto.open(key, aad, sealed)
    val nonce = sealed.copyOfRange(0, RelayCrypto.NONCE_BYTES).joinToString("") { "%02x".format(it) }
    if (!seenNonces.add(nonce)) throw HttpError(Response.Status.BAD_REQUEST, "This request was already used.")
    return plain
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
        .put("protocol", 2)
        .put("chunkBytes", RelayFiles.CHUNK_BYTES))

      method == Method.POST && parts == listOf("transfers") -> createTransfer(session, peer)
      method == Method.GET && parts.size == 2 && parts[0] == "transfers" -> transferStatus(parts[1])
      method == Method.PUT && parts.size == 4 && parts[0] == "transfers" && parts[2] == "chunks" ->
        receiveChunk(session, parts[1], parts[3].toIntOrNull() ?: throw HttpError(Response.Status.BAD_REQUEST, "Bad chunk index."))
      method == Method.POST && parts.size == 3 && parts[0] == "transfers" && parts[2] == "complete" -> completeTransfer(session, parts[1])
      method == Method.POST && parts.size == 3 && parts[0] == "transfers" && parts[2] == "cancel" -> cancelTransfer(session, parts[1])

      method == Method.POST && parts == listOf("text") -> receiveText(session, peer)

      method == Method.GET && parts == listOf("outbox") -> listOutbox()
      method == Method.GET && parts.size == 4 && parts[0] == "outbox" && parts[2] == "chunks" ->
        sendChunk(parts[1], parts[3].toIntOrNull() ?: throw HttpError(Response.Status.BAD_REQUEST, "Bad chunk index."))
      method == Method.POST && parts.size == 3 && parts[0] == "outbox" && parts[2] == "ack" -> ackDownload(session, parts[1])

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

  /**
   * The wrapped key stays collectable until it expires: it is useless without the browser's private
   * key, and deleting it on first pickup let a lost response leave the browser waiting forever.
   */
  private fun collectPairing(id: String): Response {
    val entry = pairings[id] ?: throw HttpError(Response.Status.NOT_FOUND, "Not linked yet.")
    if (System.currentTimeMillis() - entry.first > PAIRING_TTL_MS) {
      pairings.remove(id)
      throw HttpError(Response.Status.NOT_FOUND, "Not linked yet.")
    }
    return plainJson(Response.Status.OK, JSONObject().put("pub", entry.second.publicKey).put("sealed", entry.second.sealedKey))
  }

  // ---- receiving ---------------------------------------------------------------------------

  private fun reservedBytes(): Long = incoming.values.filter { !it.finished }.sumOf { it.size - it.received }

  private fun createTransfer(session: IHTTPSession, peer: String): Response {
    val meta = JSONObject(String(openOnce("meta", readBody(session, 64 * 1024)), Charsets.UTF_8))
    val size = meta.getLong("size")
    if (size < 0) throw HttpError(Response.Status.BAD_REQUEST, "Bad file size.")
    if (incoming.values.count { !it.finished } >= MAX_ACTIVE_INCOMING) {
      throw HttpError(Response.Status.SERVICE_UNAVAILABLE, "The phone is already receiving $MAX_ACTIVE_INCOMING files. Try again when one finishes.")
    }
    val expectedChunks = if (size == 0L) 0 else ((size + RelayFiles.CHUNK_BYTES - 1) / RelayFiles.CHUNK_BYTES).toInt()

    val dir = RelayFiles.tempDir(context)
    // The temp copy plus the copy in Downloads, plus everything other transfers still need.
    if (dir.usableSpace < reservedBytes() + size * 2 + 32L * 1024 * 1024) {
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
    return plainJson(Response.Status.OK, JSONObject().put("next", transfer.nextIndex).put("finished", transfer.finished))
  }

  private fun receiveChunk(session: IHTTPSession, id: String, index: Int): Response {
    val transfer = incoming[id] ?: throw HttpError(Response.Status.NOT_FOUND, "Transfer not found.")
    val sealed = readBody(session, RelayFiles.CHUNK_BYTES + RelayCrypto.OVERHEAD)
    synchronized(transfer) {
      if (transfer.finished) throw HttpError(Response.Status.CONFLICT, "Transfer already finished.")
      transfer.lastActivity = System.currentTimeMillis()
      if (index != transfer.nextIndex) {
        // Tell the sender where to resume from instead of failing the whole transfer.
        throw HttpError(Response.Status.CONFLICT, "Out of order chunk.", JSONObject().put("next", transfer.nextIndex))
      }
      val plain = RelayCrypto.open(key, "chunk:$id:$index", sealed)
      if (transfer.received + plain.size > transfer.size) {
        throw HttpError(Response.Status.BAD_REQUEST, "More data than announced.")
      }
      try {
        val stream = transfer.stream ?: FileOutputStream(transfer.temp).also { transfer.stream = it }
        stream.write(plain)
      } catch (e: IOException) {
        transfer.finished = true
        runCatching { transfer.stream?.close() }
        transfer.temp.delete()
        incoming.remove(id)
        emitTransfer(transfer, "failed", "Phone storage is full.")
        throw HttpError(Response.Status.INTERNAL_ERROR, "Phone storage is full.")
      }
      transfer.received += plain.size
      transfer.nextIndex = index + 1
    }
    emitTransfer(transfer, "active", null)
    return plainJson(Response.Status.OK, JSONObject().put("next", transfer.nextIndex))
  }

  private fun completeTransfer(session: IHTTPSession, id: String): Response {
    openOnce("complete:$id", readBody(session, 1024))
    val transfer = incoming[id] ?: throw HttpError(Response.Status.NOT_FOUND, "Transfer not found.")
    synchronized(transfer) {
      if (transfer.finished) return plainJson(Response.Status.OK, JSONObject().put("ok", true))
      if (transfer.received != transfer.size || transfer.nextIndex != transfer.totalChunks) {
        throw HttpError(Response.Status.CONFLICT, "Transfer is incomplete.", JSONObject().put("next", transfer.nextIndex))
      }
      try {
        val stream = transfer.stream ?: FileOutputStream(transfer.temp).also { transfer.stream = it }
        stream.fd.sync()
        stream.close()
        val saved = RelayFiles.saveToDownloads(context, transfer.temp, transfer.name, transfer.mime)
        transfer.finished = true
        emitTransfer(transfer, "done", null, saved.toString())
      } catch (e: Exception) {
        transfer.finished = true
        transfer.temp.delete()
        incoming.remove(id)
        val full = e is IOException && (e.message?.contains("ENOSPC") == true || e.message?.contains("No space") == true)
        val message = if (full) "Phone storage is full." else "Could not save the file: ${e.message ?: "storage error"}"
        emitTransfer(transfer, "failed", message)
        throw HttpError(Response.Status.INTERNAL_ERROR, message)
      }
    }
    incoming.remove(id)
    return plainJson(Response.Status.OK, JSONObject().put("ok", true))
  }

  /** Cancelling needs a sealed body, so someone who only saw the token cannot kill other uploads. */
  private fun cancelTransfer(session: IHTTPSession, id: String): Response {
    openOnce("cancel:$id", readBody(session, 1024))
    val transfer = incoming.remove(id) ?: return plainJson(Response.Status.OK, JSONObject().put("ok", true))
    synchronized(transfer) {
      if (!transfer.finished) {
        transfer.finished = true
        runCatching { transfer.stream?.close() }
        transfer.temp.delete()
        emitTransfer(transfer, "failed", "Cancelled by the sender.")
      }
    }
    return plainJson(Response.Status.OK, JSONObject().put("ok", true))
  }

  private fun receiveText(session: IHTTPSession, peer: String): Response {
    val body = JSONObject(String(openOnce("text", readBody(session, 1024 * 1024)), Charsets.UTF_8))
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

    // Chunk 0 starts a new download session with its own progress row.
    val download = synchronized(downloads) {
      if (index == 0 || downloads[id] == null) Download("out-$id-${++downloadCounter}", item).also { downloads[id] = it } else downloads.getValue(id)
    }
    val offset = index.toLong() * RelayFiles.CHUNK_BYTES
    val length = minOf(RelayFiles.CHUNK_BYTES.toLong(), item.size - offset).toInt()
    val buffer = ByteArray(length)
    RandomAccessFile(path, "r").use { file ->
      file.seek(offset)
      file.readFully(buffer)
    }
    val sealed = RelayCrypto.seal(key, "out:$id:$index", buffer)
    download.lastActivity = System.currentTimeMillis()
    download.sent = offset + length
    emitDownload(download, "active", null)
    return newFixedLengthResponse(Response.Status.OK, "application/octet-stream", ByteArrayInputStream(sealed), sealed.size.toLong())
      .apply { addHeader("Cache-Control", "no-store") }
  }

  /** The browser reports when a download finished or stopped, so the phone never guesses. */
  private fun ackDownload(session: IHTTPSession, id: String): Response {
    val body = JSONObject(String(openOnce("ack:$id", readBody(session, 4096)), Charsets.UTF_8))
    val download = downloads.remove(id) ?: return plainJson(Response.Status.OK, JSONObject().put("ok", true))
    if (body.optBoolean("ok")) {
      download.sent = download.item.size
      emitDownload(download, "done", null)
    } else {
      emitDownload(download, "failed", body.optString("error", "Stopped on the other device."))
    }
    return plainJson(Response.Status.OK, JSONObject().put("ok", true))
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

  private fun emitDownload(download: Download, status: String, error: String?) {
    emit("onTransfer", mapOf(
      "id" to download.eventId,
      "direction" to "out",
      "name" to download.item.name,
      "size" to download.item.size.toDouble(),
      "bytes" to download.sent.toDouble(),
      "status" to status,
      "error" to error,
      "savedUri" to null
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
    private const val MAX_ACTIVE_INCOMING = 4
    private const val IDLE_MS = 60 * 1000L
  }
}
