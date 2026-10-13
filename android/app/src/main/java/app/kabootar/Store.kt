package app.kabootar

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

/** Small on-device storage shared by the app, the notification service and the notification buttons. */
object Store {
    private fun sp(c: Context): SharedPreferences = c.applicationContext.getSharedPreferences("kabootar", Context.MODE_PRIVATE)

    fun token(c: Context): String = sp(c).getString("token", "") ?: ""
    fun setToken(c: Context, t: String) {
        if (t == token(c)) return
        sp(c).edit().putString("token", t).putLong("seq", 0L).apply()
    }

    fun seq(c: Context): Long = sp(c).getLong("seq", 0L)
    fun setSeq(c: Context, s: Long) { sp(c).edit().putLong("seq", s).apply() }

    fun ua(c: Context): String = sp(c).getString("ua", "") ?: ""
    fun setUa(c: Context, ua: String) { sp(c).edit().putString("ua", ua).apply() }

    fun prefs(c: Context): JSONObject = try { JSONObject(sp(c).getString("prefs", "{}") ?: "{}") } catch (e: Exception) { JSONObject() }
    fun setPrefs(c: Context, json: String) { sp(c).edit().putString("prefs", json).apply() }
    fun pref(c: Context, key: String, def: Boolean = true): Boolean = prefs(c).optBoolean(key, def)

    /** last status / navigation bar colours, so the next start (splash) already has the right theme */
    fun bars(c: Context): IntArray? {
        val p = sp(c)
        if (!p.contains("barTop")) return null
        return intArrayOf(p.getInt("barTop", 0), p.getInt("barBottom", 0), if (p.getBoolean("lightTop", false)) 1 else 0, if (p.getBoolean("lightBottom", false)) 1 else 0)
    }
    fun setBars(c: Context, top: Int, bottom: Int, lightTop: Boolean, lightBottom: Boolean) {
        sp(c).edit().putInt("barTop", top).putInt("barBottom", bottom).putBoolean("lightTop", lightTop).putBoolean("lightBottom", lightBottom).apply()
    }

    fun shouldRunService(c: Context): Boolean = token(c).isNotEmpty() && pref(c, "notify") && pref(c, "background")
}
