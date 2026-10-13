package app.kabootar

import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * Keeps one long-poll to your server (GET /api/push) so messages arrive as notifications even when
 * the app is closed. No Firebase/Google: it talks only to your own Kabootar server.
 */
class PushService : Service() {
    companion object {
        fun start(c: Context) {
            if (!Store.shouldRunService(c)) return
            try { ContextCompat.startForegroundService(c, Intent(c, PushService::class.java)) } catch (e: Exception) { }
        }
        fun stop(c: Context) {
            try { c.stopService(Intent(c, PushService::class.java)) } catch (e: Exception) { }
        }
    }

    @Volatile private var running = false
    private var worker: Thread? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Notifier.channels(this)
        val n = Notifier.serviceNotification(this)
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(Notifier.SERVICE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            else startForeground(Notifier.SERVICE_ID, n)
        } catch (e: Exception) {
            stopSelf()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!Store.shouldRunService(this)) { stopSelf(); return START_NOT_STICKY }
        if (!running) {
            running = true
            worker = Thread({ loop() }, "kabootar-push").also { it.start() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        worker?.interrupt()
        super.onDestroy()
    }

    private fun loop() {
        var backoff = 2000L
        while (running) {
            if (!Store.shouldRunService(this)) { stopSelf(); return }
            try {
                val r = Api.call(this, "GET", "/api/push?since=" + Store.seq(this), null, 45000)
                if (r.code == 401) { Store.setToken(this, ""); stopSelf(); return }
                if (r.code != 200) throw IllegalStateException("http " + r.code)
                val obj = JSONObject(r.body)
                val items = obj.optJSONArray("items")
                if (items != null) for (i in 0 until items.length()) {
                    val it = items.optJSONObject(i) ?: continue
                    when (it.optString("type")) {
                        "message" -> if (!MainActivity.visible) Notifier.message(this, it)
                        "read" -> Notifier.cancel(this, it.optLong("chat_id").toInt())
                    }
                }
                Store.setSeq(this, obj.optLong("seq", Store.seq(this)))
                backoff = 2000L
            } catch (e: InterruptedException) {
                return
            } catch (e: Exception) {
                try { Thread.sleep(backoff) } catch (ie: InterruptedException) { return }
                backoff = minOf(backoff * 2, 60000L)
            }
        }
    }
}

/** Starts the notification connection again after a reboot or an app update. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        PushService.start(context.applicationContext)
    }
}
