package expo.modules.relaytransfer

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * Quick Settings tile: one tap from the notification shade opens Relay's Receive screen.
 * The tile shows as active while a receive session is running.
 */
class ReceiveTileService : TileService() {
  override fun onStartListening() {
    val tile = qsTile ?: return
    tile.state = if (receiving) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
    if (Build.VERSION.SDK_INT >= 29) tile.subtitle = if (receiving) "Receiving" else "Tap to receive"
    tile.updateTile()
  }

  override fun onClick() {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("relay://receive"))
      .setPackage(packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    if (Build.VERSION.SDK_INT >= 34) {
      val pending = PendingIntent.getActivity(this, 1, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      startActivityAndCollapse(pending)
    } else {
      @Suppress("DEPRECATION")
      startActivityAndCollapse(intent)
    }
  }

  companion object {
    @Volatile var receiving = false

    fun refresh(context: Context, isReceiving: Boolean) {
      receiving = isReceiving
      runCatching { requestListeningState(context, ComponentName(context, ReceiveTileService::class.java)) }
    }
  }
}
