package expo.modules.relaytransfer

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import java.io.File

/**
 * Reads what another app shared to Relay (Android's share sheet): text and/or files.
 * Files arrive as content:// URIs that may stop working once the sharing app is gone, so each is
 * copied into Relay's cache; the app deletes the copies after sending.
 */
object ShareIntake {
  private const val CONSUMED = "relay.share.consumed"

  fun isShare(intent: Intent?): Boolean =
    intent != null && (intent.action == Intent.ACTION_SEND || intent.action == Intent.ACTION_SEND_MULTIPLE) &&
      !intent.getBooleanExtra(CONSUMED, false)

  @Suppress("DEPRECATION")
  private fun streams(intent: Intent): List<Uri> = when (intent.action) {
    Intent.ACTION_SEND -> listOfNotNull(
      if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableExtra(Intent.EXTRA_STREAM)
    )
    Intent.ACTION_SEND_MULTIPLE -> (
      if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
    ) ?: emptyList()
    else -> emptyList()
  }

  private fun displayName(context: Context, uri: Uri): String {
    try {
      context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) c.getString(0)?.let { if (it.isNotBlank()) return it }
      }
    } catch (e: Exception) {
      // Fall back to the path below.
    }
    return uri.lastPathSegment?.substringAfterLast('/') ?: "file"
  }

  /** Returns the shared text and copied files, and marks the intent so it is handled only once. */
  fun take(context: Context, intent: Intent): Map<String, Any?> {
    intent.putExtra(CONSUMED, true)
    val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.takeIf { it.isNotBlank() }
    val dir = File(context.cacheDir, "shared").apply { mkdirs() }
    val files = mutableListOf<Map<String, Any?>>()
    val errors = mutableListOf<String>()
    for ((i, uri) in streams(intent).withIndex()) {
      val name = RelayFiles.sanitizeName(displayName(context, uri))
      try {
        val target = File(dir, "${System.currentTimeMillis()}-$i-$name")
        val input = context.contentResolver.openInputStream(uri) ?: throw IllegalStateException("unreadable")
        input.use { source -> target.outputStream().use { source.copyTo(it, 256 * 1024) } }
        files.add(mapOf(
          "uri" to Uri.fromFile(target).toString(),
          "name" to name,
          "mime" to (context.contentResolver.getType(uri) ?: intent.type ?: ""),
          "size" to target.length().toDouble()
        ))
      } catch (e: Exception) {
        errors.add(name)
      }
    }
    return mapOf("text" to text, "files" to files, "failed" to errors)
  }
}
