package app.kabootar

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Size
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream

/** The phone gallery for the attach sheet and the story camera (like Telegram's own gallery). */
object Gallery {
    private fun granted(c: Context, p: String) = ContextCompat.checkSelfPermission(c, p) == PackageManager.PERMISSION_GRANTED

    /** "full", "partial" (Android 14: only some photos allowed) or "ask" */
    fun state(c: Context): String {
        if (Build.VERSION.SDK_INT >= 33) {
            if (granted(c, Manifest.permission.READ_MEDIA_IMAGES) || granted(c, Manifest.permission.READ_MEDIA_VIDEO)) return "full"
            if (Build.VERSION.SDK_INT >= 34 && granted(c, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)) return "partial"
            return "ask"
        }
        return if (granted(c, Manifest.permission.READ_EXTERNAL_STORAGE)) "full" else "ask"
    }

    fun permissions(): Array<String> = when {
        Build.VERSION.SDK_INT >= 34 -> arrayOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
        Build.VERSION.SDK_INT >= 33 -> arrayOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO)
        else -> arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
    }

    private class Item(val id: String, val video: Boolean, val date: Long, val durationMs: Long, val name: String, val mime: String)

    fun recent(c: Context, limit: Int): String {
        if (state(c) == "ask") return "[]"
        val max = if (limit <= 0) 150 else minOf(limit, 1000)
        val all = ArrayList<Item>()
        query(c, false, max, all)
        query(c, true, max, all)
        all.sortByDescending { it.date }
        val out = JSONArray()
        for (m in all.take(max)) {
            val o = JSONObject()
            o.put("id", m.id)
            o.put("video", m.video)
            o.put("duration", m.durationMs / 1000.0)
            o.put("name", m.name)
            o.put("mime", m.mime)
            out.put(o)
        }
        return out.toString()
    }

    private fun query(c: Context, video: Boolean, max: Int, into: MutableList<Item>) {
        val uri = if (video) MediaStore.Video.Media.EXTERNAL_CONTENT_URI else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        val cols = if (video) arrayOf(MediaStore.Video.Media._ID, MediaStore.Video.Media.DATE_ADDED, MediaStore.Video.Media.DISPLAY_NAME, MediaStore.Video.Media.MIME_TYPE, MediaStore.Video.Media.DURATION)
        else arrayOf(MediaStore.Images.Media._ID, MediaStore.Images.Media.DATE_ADDED, MediaStore.Images.Media.DISPLAY_NAME, MediaStore.Images.Media.MIME_TYPE)
        try {
            c.contentResolver.query(uri, cols, null, null, MediaStore.Images.Media.DATE_ADDED + " DESC")?.use { cur ->
                var n = 0
                while (n < max && cur.moveToNext()) {
                    val id = cur.getLong(0)
                    into.add(Item((if (video) "v" else "i") + id, video, cur.getLong(1),
                        if (video) cur.getLong(4) else 0L, cur.getString(2) ?: "", cur.getString(3) ?: (if (video) "video/mp4" else "image/jpeg")))
                    n++
                }
            }
        } catch (e: Exception) { }
    }

    fun uri(id: String): Uri? {
        val n = id.drop(1).toLongOrNull() ?: return null
        return when (id.firstOrNull()) {
            'v' -> ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, n)
            'i' -> ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, n)
            else -> null
        }
    }

    @Suppress("DEPRECATION")
    fun thumb(c: Context, id: String): ByteArray? {
        if (state(c) == "ask") return null
        val u = uri(id) ?: return null
        val n = id.drop(1).toLongOrNull() ?: return null
        val bmp: Bitmap? = try {
            if (Build.VERSION.SDK_INT >= 29) c.contentResolver.loadThumbnail(u, Size(320, 320), null)
            else if (id.startsWith("v")) MediaStore.Video.Thumbnails.getThumbnail(c.contentResolver, n, MediaStore.Video.Thumbnails.MINI_KIND, null)
            else MediaStore.Images.Thumbnails.getThumbnail(c.contentResolver, n, MediaStore.Images.Thumbnails.MINI_KIND, null)
        } catch (e: Exception) { null }
        if (bmp == null) return null
        val bos = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, 82, bos)
        return bos.toByteArray()
    }

    fun open(c: Context, id: String): Pair<String, InputStream>? {
        if (state(c) == "ask") return null
        val u = uri(id) ?: return null
        return try {
            val s = c.contentResolver.openInputStream(u) ?: return null
            Pair(c.contentResolver.getType(u) ?: (if (id.startsWith("v")) "video/mp4" else "image/jpeg"), s)
        } catch (e: Exception) { null }
    }
}
