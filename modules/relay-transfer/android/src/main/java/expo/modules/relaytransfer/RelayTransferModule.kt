package expo.modules.relaytransfer

import android.content.Context
import android.net.Uri
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.util.concurrent.Executors

class OutgoingFile : Record {
  @Field var uri: String = ""
  @Field var name: String = ""
  @Field var mime: String = ""
}

class RelayTransferModule : Module() {
  private var server: RelayServer? = null
  private var sessionKey: ByteArray? = null
  private var activeClient: RelayClient? = null
  private val worker = Executors.newSingleThreadExecutor()

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun localPath(uri: String): String =
    if (uri.startsWith("file:")) Uri.parse(uri).path ?: uri else uri

  private fun emit(name: String, body: Map<String, Any?>) {
    runCatching { sendEvent(name, body) }
  }

  @Synchronized
  private fun stopServer() {
    server?.shutdown()
    server = null
    sessionKey = null
    runCatching { RelayFiles.clearTemp(context) }
  }

  override fun definition() = ModuleDefinition {
    Name("RelayTransfer")

    Events("onTransfer", "onText", "onPeer")

    Constant("chunkBytes") { RelayFiles.CHUNK_BYTES }

    Function("getLocalAddresses") { RelayFiles.localAddresses() }

    Function("isRunning") { server != null }

    /** Opens a receiving session. Returns everything the UI needs to build the QR code. */
    AsyncFunction("start") { deviceName: String ->
      stopServer()
      val key = RelayCrypto.newKey()
      var started: RelayServer? = null
      var lastError: Exception? = null
      // Prefer a stable port so a bookmarked address keeps working, but never fail just because it is taken.
      for (port in intArrayOf(8765, 8766, 8767, 0)) {
        try {
          val candidate = RelayServer(context, port, key, deviceName, ::emit)
          candidate.start(30_000, true)
          started = candidate
          break
        } catch (e: Exception) {
          lastError = e
        }
      }
      val running = started ?: throw RelayFailure("Could not start receiving: ${lastError?.message ?: "no free port"}")
      server = running
      sessionKey = key
      mapOf(
        "port" to running.listeningPort,
        "addresses" to RelayFiles.localAddresses(),
        "key" to RelayCrypto.encodeKey(key)
      )
    }

    Function("stop") { stopServer() }

    Function("shareFile") { file: OutgoingFile ->
      val running = server ?: throw RelayFailure("Start a session first.")
      val path = localPath(file.uri)
      val source = File(path)
      if (!source.isFile) throw RelayFailure("\"${file.name}\" could not be read.")
      val item = OutboxItem(
        id = RelayCrypto.newId(),
        kind = "file",
        name = RelayFiles.sanitizeName(file.name),
        mime = file.mime.ifEmpty { "application/octet-stream" },
        size = source.length(),
        path = path,
        text = null
      )
      running.addOutbox(item)
      item.id
    }

    Function("shareText") { text: String ->
      val running = server ?: throw RelayFailure("Start a session first.")
      val item = OutboxItem(RelayCrypto.newId(), "text", "Text", "text/plain", 0, null, text)
      running.addOutbox(item)
      item.id
    }

    /** Hand the session key to a browser whose link code (shown on its screen) was just scanned. */
    Function("linkBrowser") { id: String, publicKey: String ->
      val running = server ?: throw RelayFailure("Start a session first.")
      try {
        running.link(id, publicKey)
      } catch (e: Exception) {
        throw RelayFailure(e.message ?: "That is not a Relay link code.")
      }
    }

    Function("unshare") { id: String -> server?.removeOutbox(id) }

    Function("clearShared") { server?.clearOutbox() }

    /** Checks that the other phone is reachable and the scanned key is right. Resolves with its name. */
    AsyncFunction("connect") { baseUrl: String, key: String, promise: Promise ->
      worker.execute {
        try {
          promise.resolve(RelayClient(baseUrl, RelayCrypto.decodeKey(key)).hello())
        } catch (e: RelayFailure) {
          promise.reject("ERR_RELAY", e.message, e)
        } catch (e: IllegalArgumentException) {
          promise.reject("ERR_RELAY", e.message, e)
        } catch (e: Exception) {
          promise.reject("ERR_RELAY_UNREACHABLE", "Could not reach the other device. Make sure both are on the same Wi-Fi or hotspot.", e)
        }
      }
    }

    AsyncFunction("sendFiles") { baseUrl: String, key: String, files: List<OutgoingFile>, promise: Promise ->
      worker.execute {
        val client = try {
          RelayClient(baseUrl, RelayCrypto.decodeKey(key))
        } catch (e: Exception) {
          promise.reject("ERR_RELAY", e.message, e)
          return@execute
        }
        activeClient = client
        var failures = 0
        files.forEachIndexed { position, file ->
          val id = "send-${System.currentTimeMillis()}-$position"
          val size = File(localPath(file.uri)).length()
          fun report(status: String, bytes: Long, error: String?) = emit("onTransfer", mapOf(
            "id" to id,
            "direction" to "out",
            "name" to file.name,
            "size" to size.toDouble(),
            "bytes" to bytes.toDouble(),
            "status" to status,
            "error" to error,
            "savedUri" to null
          ))
          if (client.cancelled) {
            report("failed", 0, "Cancelled.")
            failures++
            return@forEachIndexed
          }
          report("active", 0, null)
          try {
            client.sendFile(localPath(file.uri), file.name, file.mime) { sent, _ -> report("active", sent, null) }
            report("done", size, null)
          } catch (e: RelayCancelled) {
            failures++
            report("failed", 0, "Cancelled.")
          } catch (e: RelayFailure) {
            failures++
            report("failed", 0, e.message)
          } catch (e: Exception) {
            failures++
            report("failed", 0, "Could not reach the other device.")
          }
        }
        activeClient = null
        promise.resolve(mapOf("sent" to files.size - failures, "failed" to failures))
      }
    }

    AsyncFunction("sendText") { baseUrl: String, key: String, text: String, promise: Promise ->
      worker.execute {
        try {
          RelayClient(baseUrl, RelayCrypto.decodeKey(key)).sendText(text)
          promise.resolve(null)
        } catch (e: RelayFailure) {
          promise.reject("ERR_RELAY", e.message, e)
        } catch (e: Exception) {
          promise.reject("ERR_RELAY_UNREACHABLE", "Could not reach the other device.", e)
        }
      }
    }

    Function("cancelSend") { activeClient?.cancelled = true }

    OnDestroy {
      stopServer()
      worker.shutdownNow()
    }
  }
}
