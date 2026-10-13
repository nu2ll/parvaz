package app.kabootar

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat
import org.json.JSONObject

/** Message notifications like Telegram: one per chat, the last few messages, reply and "mark as read". */
object Notifier {
    const val CH_MSG = "kb_messages"
    const val CH_SVC = "kb_service"
    const val SERVICE_ID = 7001
    const val TAG = "chat"
    const val KEY_REPLY = "reply_text"
    private const val GROUP = "app.kabootar.MESSAGES"
    private const val SUMMARY_ID = 7002

    private class Line(val sender: String, val text: String, val date: Long)
    private val history = HashMap<Int, MutableList<Line>>()
    private val lastId = HashMap<Int, Long>()

    fun channels(c: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = c.getSystemService(NotificationManager::class.java) ?: return
        val msg = NotificationChannel(CH_MSG, "پیام‌ها", NotificationManager.IMPORTANCE_HIGH)
        msg.enableVibration(true)
        msg.setShowBadge(true)
        msg.description = "پیام‌های تازه از گفتگوها، گروه‌ها و کانال‌ها"
        val svc = NotificationChannel(CH_SVC, "اتصال پس‌زمینه", NotificationManager.IMPORTANCE_MIN)
        svc.setShowBadge(false)
        svc.description = "کبوتر را برای رسیدن پیام‌ها وصل نگه می‌دارد. می‌توانید این اعلان را پنهان کنید."
        nm.createNotificationChannel(msg)
        nm.createNotificationChannel(svc)
    }

    private fun immutable() = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    private fun mutable() = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)

    fun openIntent(c: Context, chatId: Int): PendingIntent {
        val i = Intent(c, MainActivity::class.java)
        i.action = "app.kabootar.OPEN_$chatId"
        i.putExtra("chat_id", chatId)
        i.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        return PendingIntent.getActivity(c, chatId, i, immutable())
    }

    fun serviceNotification(c: Context): android.app.Notification =
        NotificationCompat.Builder(c, CH_SVC)
            .setSmallIcon(R.drawable.ic_stat)
            .setColor(0xFF3390EC.toInt())
            .setContentTitle("کبوتر")
            .setContentText("برای دریافت پیام‌ها وصل است")
            .setOngoing(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(openIntent(c, 0))
            .build()

    private fun allowed(c: Context): Boolean =
        Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    @Synchronized
    fun message(c: Context, it: JSONObject) {
        if (!Store.pref(c, "notify") || !allowed(c)) return
        val type = it.optString("chat_type", "private")
        val key = when (type) { "group" -> "group"; "channel" -> "channel"; else -> "private" }
        if (!Store.pref(c, key)) return
        val chatId = it.optLong("chat_id").toInt()
        if (chatId == 0) return
        val title = it.optString("chat_title", "کبوتر")
        val sender = it.optString("sender_name", title)
        val text = if (Store.pref(c, "preview")) it.optString("text", "پیام جدید") else "پیام جدید"
        val list = history.getOrPut(chatId) { mutableListOf() }
        list.add(Line(if (type == "channel") title else sender, text, it.optLong("date", System.currentTimeMillis())))
        while (list.size > 7) list.removeAt(0)
        lastId[chatId] = it.optLong("message_id")

        val me = Person.Builder().setName("شما").build()
        val style = NotificationCompat.MessagingStyle(me)
        if (type != "private") {
            style.setConversationTitle(title)
            style.setGroupConversation(true)
        }
        for (l in list) style.addMessage(l.text, l.date, Person.Builder().setName(l.sender).build())

        val b = NotificationCompat.Builder(c, CH_MSG)
            .setSmallIcon(R.drawable.ic_stat)
            .setColor(0xFF3390EC.toInt())
            .setStyle(style)
            .setContentTitle(title)
            .setContentText(text)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setGroup(GROUP)
            .setNumber(maxOf(1, it.optInt("unread", list.size)))
            .setSilent(it.optBoolean("silent", false))
            .setContentIntent(openIntent(c, chatId))
            .addAction(readAction(c, chatId))
        if (type != "channel") b.addAction(replyAction(c, chatId))
        try {
            val nm = NotificationManagerCompat.from(c)
            nm.notify(TAG, chatId, b.build())
            summary(c)
        } catch (e: SecurityException) { }
    }

    private fun summary(c: Context) {
        if (history.size < 2) return
        val n = NotificationCompat.Builder(c, CH_MSG)
            .setSmallIcon(R.drawable.ic_stat)
            .setColor(0xFF3390EC.toInt())
            .setContentTitle("کبوتر")
            .setContentText("پیام از ${history.size} گفتگو")
            .setGroup(GROUP)
            .setGroupSummary(true)
            .setAutoCancel(true)
            .setSilent(true)
            .setContentIntent(openIntent(c, 0))
            .build()
        try { NotificationManagerCompat.from(c).notify(SUMMARY_ID, n) } catch (e: SecurityException) { }
    }

    private fun replyAction(c: Context, chatId: Int): NotificationCompat.Action {
        val input = RemoteInput.Builder(KEY_REPLY).setLabel("پاسخ…").build()
        val i = Intent(c, ActionReceiver::class.java)
        i.action = ActionReceiver.REPLY
        i.putExtra("chat_id", chatId)
        val pi = PendingIntent.getBroadcast(c, chatId * 2 + 1, i, mutable())
        return NotificationCompat.Action.Builder(R.drawable.ic_stat, "پاسخ", pi)
            .addRemoteInput(input)
            .setAllowGeneratedReplies(true)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
            .setShowsUserInterface(false)
            .build()
    }

    private fun readAction(c: Context, chatId: Int): NotificationCompat.Action {
        val i = Intent(c, ActionReceiver::class.java)
        i.action = ActionReceiver.READ
        i.putExtra("chat_id", chatId)
        val pi = PendingIntent.getBroadcast(c, chatId * 2, i, immutable())
        return NotificationCompat.Action.Builder(R.drawable.ic_stat, "خوانده شد", pi)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
            .setShowsUserInterface(false)
            .build()
    }

    @Synchronized
    fun lastMessageId(chatId: Int): Long = lastId[chatId] ?: 0L

    @Synchronized
    fun cancel(c: Context, chatId: Int) {
        history.remove(chatId)
        lastId.remove(chatId)
        val nm = NotificationManagerCompat.from(c)
        nm.cancel(TAG, chatId)
        if (history.size < 2) nm.cancel(SUMMARY_ID)
    }

    @Synchronized
    fun cancelAll(c: Context) {
        history.clear()
        lastId.clear()
        val nm = NotificationManagerCompat.from(c)
        nm.cancelAll()
    }
}
