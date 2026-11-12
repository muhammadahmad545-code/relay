package expo.modules.relaytransfer

import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import javax.crypto.AEADBadTagException

class RelayCancelled : Exception("Cancelled.")

/** Raised with a message that is safe to show to the user. */
class RelayFailure(message: String, cause: Throwable? = null) : Exception(message, cause)

private class HttpResult(val status: Int, val body: ByteArray)

/** Phone-to-phone sender: talks to another phone's RelayServer using the same encrypted protocol. */
class RelayClient(baseUrl: String, private val key: ByteArray) {
  private val base = baseUrl.trimEnd('/')
  private val token = RelayCrypto.token(key)

  @Volatile var cancelled = false

  fun hello(): String {
    val result = request("GET", "/api/hello", null)
    if (result.status == 401) throw RelayFailure("That code has expired. Ask the receiver to show a new QR code.")
    if (result.status != 200) throw RelayFailure("The other device answered unexpectedly (HTTP ${result.status}).")
    val json = try {
      JSONObject(String(RelayCrypto.open(key, "hello", result.body), Charsets.UTF_8))
    } catch (e: AEADBadTagException) {
      throw RelayFailure("The pairing code does not match. Scan the QR code again.")
    }
    return json.optString("name", "Device")
  }

  fun sendText(text: String) {
    val body = RelayCrypto.seal(key, "text", JSONObject().put("text", text).toString().toByteArray(Charsets.UTF_8))
    val result = request("POST", "/api/text", body)
    if (result.status != 200) throw RelayFailure(errorOf(result, "The other device did not accept the text."))
  }

  fun sendFile(path: String, name: String, mime: String, onProgress: (sent: Long, total: Long) -> Unit) {
    val file = File(path)
    if (!file.isFile) throw RelayFailure("\"$name\" could not be read.")
    val size = file.length()
    val chunk = RelayFiles.CHUNK_BYTES
    val totalChunks = if (size == 0L) 0 else ((size + chunk - 1) / chunk).toInt()

    val meta = JSONObject().put("name", name).put("size", size).put("mime", mime)
    val created = request("POST", "/api/transfers", RelayCrypto.seal(key, "meta", meta.toString().toByteArray(Charsets.UTF_8)))
    if (created.status != 200) throw RelayFailure(errorOf(created, "The other device refused the file."))
    val id = JSONObject(String(RelayCrypto.open(key, "meta-res", created.body), Charsets.UTF_8)).getString("id")

    try {
      RandomAccessFile(file, "r").use { source ->
        val buffer = ByteArray(chunk)
        var index = 0
        var attempts = 0
        while (index < totalChunks) {
          if (cancelled) throw RelayCancelled()
          val offset = index.toLong() * chunk
          val length = minOf(chunk.toLong(), size - offset).toInt()
          source.seek(offset)
          source.readFully(buffer, 0, length)
          val sealed = RelayCrypto.seal(key, "chunk:$id:$index", buffer, 0, length)
          try {
            val result = request("PUT", "/api/transfers/$id/chunks/$index", sealed)
            when (result.status) {
              200 -> {
                index++
                attempts = 0
                onProgress(minOf(size, index.toLong() * chunk), size)
              }
              // The receiver already has this chunk (our earlier attempt landed): resume where it says.
              409 -> {
                index = nextIndexOf(result) ?: throw RelayFailure(errorOf(result, "The transfer went out of sync."))
              }
              else -> {
                throw RelayFailure(errorOf(result, "The other device rejected the data."))
              }
            }
          } catch (e: IOException) {
            attempts++
            if (attempts > MAX_RETRIES) throw RelayFailure("Connection lost. Make sure both devices are still on the same network.", e)
            Thread.sleep(400L * attempts * attempts)
            index = resumeIndex(id) ?: index
          }
        }
      }
      val done = request("POST", "/api/transfers/$id/complete", ByteArray(0))
      if (done.status != 200) throw RelayFailure(errorOf(done, "The other device could not save the file."))
      onProgress(size, size)
    } catch (e: Exception) {
      // Best effort: let the receiver discard the partial file.
      runCatching { request("POST", "/api/transfers/$id/cancel", ByteArray(0)) }
      throw e
    }
  }

  private fun resumeIndex(id: String): Int? = try {
    val result = request("GET", "/api/transfers/$id", null)
    if (result.status == 200) nextIndexOf(result) else null
  } catch (e: IOException) {
    null
  }

  private fun nextIndexOf(result: HttpResult): Int? = try {
    JSONObject(String(result.body, Charsets.UTF_8)).optInt("next", -1).takeIf { it >= 0 }
  } catch (e: Exception) {
    null
  }

  private fun errorOf(result: HttpResult, fallback: String): String = try {
    JSONObject(String(result.body, Charsets.UTF_8)).optString("error", "").ifEmpty { fallback }
  } catch (e: Exception) {
    fallback
  }

  private fun request(method: String, path: String, body: ByteArray?): HttpResult {
    val connection = URL(base + path).openConnection() as HttpURLConnection
    try {
      connection.requestMethod = method
      connection.connectTimeout = 6_000
      connection.readTimeout = 30_000
      connection.useCaches = false
      connection.setRequestProperty("X-Relay-Token", token)
      if (body != null) {
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/octet-stream")
        connection.setFixedLengthStreamingMode(body.size)
        connection.outputStream.use { it.write(body) }
      }
      val status = connection.responseCode
      val stream = if (status in 200..299) connection.inputStream else connection.errorStream
      val bytes = stream?.use { it.readBytes() } ?: ByteArray(0)
      return HttpResult(status, bytes)
    } finally {
      connection.disconnect()
    }
  }

  companion object {
    private const val MAX_RETRIES = 5
  }
}
