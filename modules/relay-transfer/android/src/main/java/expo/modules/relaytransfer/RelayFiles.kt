package expo.modules.relaytransfer

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File
import java.io.IOException
import java.net.Inet4Address
import java.net.NetworkInterface

object RelayFiles {
  const val CHUNK_BYTES = 512 * 1024

  /** Strip anything that could escape the target folder or confuse a file manager. */
  fun sanitizeName(raw: String): String {
    val cleaned = raw
      .substringAfterLast('/')
      .substringAfterLast('\\')
      .replace(Regex("[\\u0000-\\u001f\\u007f<>:\"|?*]"), "_")
      .trim()
      .trimStart('.')
      .take(180)
    return cleaned.ifEmpty { "file" }
  }

  fun tempDir(context: Context): File =
    File(context.cacheDir, "relay-incoming").apply { mkdirs() }

  fun clearTemp(context: Context) {
    tempDir(context).listFiles()?.forEach { it.delete() }
  }

  /** Moves a finished transfer into the public Downloads/Relay folder. Returns the saved location. */
  fun saveToDownloads(context: Context, source: File, name: String, mime: String): Uri {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val resolver = context.contentResolver
      val values = ContentValues().apply {
        put(MediaStore.Downloads.DISPLAY_NAME, name)
        put(MediaStore.Downloads.MIME_TYPE, mime.ifEmpty { "application/octet-stream" })
        put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Relay")
        put(MediaStore.Downloads.IS_PENDING, 1)
      }
      val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
        ?: throw IOException("Could not create the file in Downloads.")
      try {
        val out = resolver.openOutputStream(uri) ?: throw IOException("Could not open the file in Downloads.")
        out.use { sink -> source.inputStream().use { it.copyTo(sink, 256 * 1024) } }
        values.clear()
        values.put(MediaStore.Downloads.IS_PENDING, 0)
        resolver.update(uri, values, null, null)
      } catch (e: Exception) {
        resolver.delete(uri, null, null)
        throw e
      }
      source.delete()
      return uri
    }
    // Before Android 10 there is no permission-free public Downloads: keep the file in app storage.
    val dir = File(context.getExternalFilesDir(null) ?: context.filesDir, "Relay").apply { mkdirs() }
    var target = File(dir, name)
    var n = 1
    while (target.exists()) {
      val dot = name.lastIndexOf('.')
      target = if (dot > 0) File(dir, "${name.substring(0, dot)} ($n)${name.substring(dot)}") else File(dir, "$name ($n)")
      n++
    }
    if (!source.renameTo(target)) {
      source.copyTo(target, overwrite = false)
      source.delete()
    }
    return Uri.fromFile(target)
  }

  /** IPv4 addresses other devices on the same network (or this phone's hotspot) can reach. Wi-Fi first. */
  fun localAddresses(): List<String> {
    val found = mutableListOf<Pair<Int, String>>()
    try {
      val interfaces = NetworkInterface.getNetworkInterfaces() ?: return emptyList()
      for (nif in interfaces) {
        if (!nif.isUp || nif.isLoopback) continue
        val name = nif.name.lowercase()
        if (name.startsWith("rmnet") || name.startsWith("dummy") || name.startsWith("tun")) continue
        val rank = when {
          name.startsWith("wlan") -> 0
          name.startsWith("ap") || name.startsWith("swlan") || name.startsWith("softap") -> 1
          name.startsWith("eth") || name.startsWith("usb") || name.startsWith("rndis") -> 2
          else -> 3
        }
        for (address in nif.inetAddresses) {
          if (address is Inet4Address && address.isSiteLocalAddress) {
            address.hostAddress?.let { found.add(rank to it) }
          }
        }
      }
    } catch (e: Exception) {
      return emptyList()
    }
    return found.sortedBy { it.first }.map { it.second }.distinct()
  }
}
