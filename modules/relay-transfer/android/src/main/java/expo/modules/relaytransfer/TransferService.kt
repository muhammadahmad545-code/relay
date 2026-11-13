package expo.modules.relaytransfer

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * Keeps transfers alive while the screen is off or another app is in front: a foreground service
 * plus Wi-Fi and partial wake locks. Held only while a receive session is open or a send runs.
 */
class TransferService : Service() {
  private var wifiLock: WifiManager.WifiLock? = null
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    if (!goForeground()) {
      stopSelf()
      return
    }
    val wifi = applicationContext.getSystemService(WifiManager::class.java)
    @Suppress("DEPRECATION")
    val mode = if (Build.VERSION.SDK_INT >= 29) WifiManager.WIFI_MODE_FULL_LOW_LATENCY else WifiManager.WIFI_MODE_FULL_HIGH_PERF
    wifiLock = wifi?.createWifiLock(mode, "relay:transfer")?.apply { setReferenceCounted(false); acquire() }
    wakeLock = getSystemService(PowerManager::class.java)?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "relay:transfer")?.apply {
      setReferenceCounted(false)
      // Upper bound so a bug can never drain the battery forever. Sessions are capped well below this.
      acquire(4 * 60 * 60 * 1000L)
    }
  }

  /**
   * Android 15 limits dataSync services to six hours a day. When the limit is reached, end every
   * session cleanly instead of letting the system crash the app.
   */
  override fun onTimeout(startId: Int, fgsType: Int) {
    // Clear holders first so the module's cleanup does not try to restart or stop us again.
    synchronized(Companion) { holders.clear() }
    onTimeoutListener?.invoke()
    stopSelf()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (!goForeground()) {
      stopSelf()
      return START_NOT_STICKY
    }
    if (intent?.action == ACTION_STOP) stopSelf()
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    runCatching { wifiLock?.release() }
    runCatching { wakeLock?.release() }
    super.onDestroy()
  }

  private fun goForeground(): Boolean = try {
    val nm = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
      nm.createNotificationChannel(NotificationChannel(CHANNEL, "Transfers", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Shown while Relay keeps a transfer running in the background"
        setShowBadge(false)
      })
    }
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE)
    }
    val notification = NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(R.drawable.ic_relay_stat)
      .setContentTitle(status)
      .setContentText("Transfers keep running with the screen off. Encrypted end to end.")
      .setOngoing(true)
      .setSilent(true)
      .apply { if (open != null) setContentIntent(open) }
      .build()
    if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    else startForeground(NOTIFICATION_ID, notification)
    true
  } catch (e: Exception) {
    false
  }

  companion object {
    private const val CHANNEL = "relay_transfers"
    private const val NOTIFICATION_ID = 5101
    private const val ACTION_STOP = "expo.modules.relaytransfer.STOP"
    private val holders = mutableMapOf<String, Int>()
    @Volatile private var status = "Relay is active"
    /** Set by the module: called when Android ends the service for running too long. */
    @Volatile var onTimeoutListener: (() -> Unit)? = null

    /** Counted per reason ("session", "send"): the service runs while any holder remains. */
    @Synchronized
    fun acquire(context: Context, reason: String, title: String) {
      holders[reason] = (holders[reason] ?: 0) + 1
      status = title
      try {
        ContextCompat.startForegroundService(context, Intent(context, TransferService::class.java))
      } catch (e: Exception) {
        // Starting from the background can be refused; the transfer still runs while Relay is open.
      }
    }

    @Synchronized
    fun release(context: Context, reason: String) {
      val count = holders[reason] ?: return
      if (count > 1) holders[reason] = count - 1 else holders.remove(reason)
      if (holders.isNotEmpty()) return
      try {
        context.startService(Intent(context, TransferService::class.java).setAction(ACTION_STOP))
      } catch (e: Exception) {
        context.stopService(Intent(context, TransferService::class.java))
      }
    }
  }
}
