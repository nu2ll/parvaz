package app.kabootar

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput
import org.json.JSONObject

/** "Reply" and "Mark as read" buttons on a message notification. */
class ActionReceiver : BroadcastReceiver() {
    companion object {
        const val REPLY = "app.kabootar.REPLY"
        const val READ = "app.kabootar.READ"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val c = context.applicationContext
        val chatId = intent.getIntExtra("chat_id", 0)
        if (chatId == 0 || Store.token(c).isEmpty()) return
        val action = intent.action
        val replyText = if (action == REPLY) RemoteInput.getResultsFromIntent(intent)?.getCharSequence(Notifier.KEY_REPLY)?.toString()?.trim() ?: "" else ""
        val lastSeen = Notifier.lastMessageId(chatId)
        val pending = goAsync()
        Thread {
            try {
                var readUpTo = lastSeen
                if (replyText.isNotEmpty()) {
                    val r = Api.call(c, "POST", "/api/chats/$chatId/messages", JSONObject().put("text", replyText).toString())
                    if (r.code in 200..299) {
                        val id = try { JSONObject(r.body).optJSONObject("message")?.optLong("id") ?: 0L } catch (e: Exception) { 0L }
                        if (id > readUpTo) readUpTo = id
                    }
                }
                if (readUpTo > 0) Api.call(c, "POST", "/api/chats/$chatId/read", JSONObject().put("message_id", readUpTo).toString())
            } catch (e: Exception) {
            } finally {
                Notifier.cancel(c, chatId)
                pending.finish()
            }
        }.start()
    }
}
