package app.kabootar

import android.content.Context
import java.net.HttpURLConnection
import java.net.URL

/** Plain HTTPS calls to your Kabootar server with the account's token (same session as the app). */
object Api {
    class Result(val code: Int, val body: String)

    fun call(c: Context, method: String, path: String, body: String? = null, readTimeoutMs: Int = 20000): Result {
        val token = Store.token(c)
        val conn = URL(BuildConfig.SERVER_URL + path).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = 15000
            conn.readTimeout = readTimeoutMs
            conn.useCaches = false
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.setRequestProperty("Accept", "application/json")
            val ua = Store.ua(c)
            if (ua.isNotEmpty()) conn.setRequestProperty("User-Agent", ua)
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            return Result(code, text)
        } finally {
            conn.disconnect()
        }
    }
}
