package app.kabootar

import android.Manifest
import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.webkit.*
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import java.io.ByteArrayInputStream
import java.io.IOException

/**
 * Kabootar for Android. The whole interface (HTML, JS, CSS, icons, stickers) is packed inside
 * the APK (assets/web) and served locally; the app only talks to your server for data:
 * /api (messages, chats…), /files (photos, voice…) and /ws (live updates).
 * Native parts: Telegram-like launch animation, status / navigation bar colours, the phone gallery,
 * background notifications with reply, haptics.
 */
class MainActivity : ComponentActivity() {
    companion object {
        @Volatile var visible = false
        private const val OFFLINE_PAGE = """<!doctype html><html dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1">
<body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#212121;color:#fff;font-family:sans-serif;text-align:center">
<div style="font-size:56px">🕊</div><h3>به سرور کبوتر وصل نشدیم</h3><p style="color:#aaa">اینترنت یا VPN را بررسی کنید</p>
<button onclick="history.back();location.reload()" style="margin-top:12px;background:#8774e1;color:#fff;border:0;border-radius:22px;padding:12px 28px;font-size:16px">تلاش دوباره</button></body></html>"""
    }

    private lateinit var web: WebView
    private lateinit var root: FrameLayout
    private var splash: FrameLayout? = null
    private var splashHiding = false
    private var splashStart = 0L
    private var launchChat = 0
    private val server: Uri by lazy { Uri.parse(BuildConfig.SERVER_URL) }
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermission: PermissionRequest? = null

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val cb = filePathCallback ?: return@registerForActivityResult
        filePathCallback = null
        cb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data) ?: emptyArray())
    }

    private val askPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        val req = pendingPermission ?: return@registerForActivityResult
        pendingPermission = null
        val allowed = req.resources.filter { res ->
            when (res) {
                PermissionRequest.RESOURCE_VIDEO_CAPTURE -> granted[Manifest.permission.CAMERA] == true || has(Manifest.permission.CAMERA)
                PermissionRequest.RESOURCE_AUDIO_CAPTURE -> granted[Manifest.permission.RECORD_AUDIO] == true || has(Manifest.permission.RECORD_AUDIO)
                else -> false
            }
        }
        if (allowed.isEmpty()) req.deny() else req.grant(allowed.toTypedArray())
    }

    private val askMedia = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { _ ->
        js("window.KabootarOnMedia && window.KabootarOnMedia('" + Gallery.state(this) + "')")
    }

    private val askNotify = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) PushService.start(applicationContext)
    }

    private fun has(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED
    private fun js(code: String) { runOnUiThread { if (::web.isInitialized) web.evaluateJavascript(code, null) } }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Notifier.channels(this)
        launchChat = intent?.getIntExtra("chat_id", 0) ?: 0

        // same colours as last time (light / dark theme) from the very first frame
        val saved = Store.bars(this)
        val dark = (resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES
        val bg = saved?.get(0) ?: if (dark) Color.parseColor("#212121") else Color.WHITE
        window.setBackgroundDrawable(ColorDrawable(bg))
        if (saved != null) applyBars(saved[0], saved[1], saved[2] == 1, saved[3] == 1)
        else applyBars(bg, bg, !dark, !dark)

        root = FrameLayout(this)
        web = WebView(this)
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)
        web.setBackgroundColor(bg)
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        web.overScrollMode = View.OVER_SCROLL_NEVER
        web.isVerticalScrollBarEnabled = false
        web.isHorizontalScrollBarEnabled = false
        if (savedInstanceState == null) showSplash(bg, saved?.get(2) == 1 || (saved == null && !dark))

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = true
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString = "$userAgentString KabootarAndroid/${BuildConfig.VERSION_NAME} (${Build.MANUFACTURER.replace(";", "")}; ${Build.MODEL.replace(";", "")}; Android ${Build.VERSION.RELEASE})"
            offscreenPreRaster = true
        }
        Store.setUa(this, web.settings.userAgentString)
        CookieManager.getInstance().setAcceptCookie(true)
        web.addJavascriptInterface(Bridge(), "KabootarNative")

        web.webViewClient = object : WebViewClient() {
            // the UI comes from the APK; only /api, /files and /ws go to the server
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? = intercept(request)
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.host == server.host && url.scheme == "https") return false // stay in the app
                return try { startActivity(Intent(Intent.ACTION_VIEW, url)); true } catch (e: ActivityNotFoundException) { true }
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) { view.loadData(OFFLINE_PAGE, "text/html; charset=utf-8", "UTF-8"); hideSplash() }
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    if (Uri.parse(request.origin.toString()).host != server.host) { request.deny(); return@runOnUiThread }
                    val need = mutableListOf<String>()
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE in request.resources && !has(Manifest.permission.CAMERA)) need += Manifest.permission.CAMERA
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE in request.resources && !has(Manifest.permission.RECORD_AUDIO)) need += Manifest.permission.RECORD_AUDIO
                    if (need.isEmpty()) {
                        request.grant(request.resources.filter { it == PermissionRequest.RESOURCE_VIDEO_CAPTURE || it == PermissionRequest.RESOURCE_AUDIO_CAPTURE }.toTypedArray())
                    } else { pendingPermission = request; askPermissions.launch(need.toTypedArray()) }
                }
            }
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                return try { pickFiles.launch(params.createIntent()); true } catch (e: Exception) { filePathCallback = null; false }
            }
        }

        web.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            try {
                val req = DownloadManager.Request(Uri.parse(url))
                    .setMimeType(mimeType)
                    .addRequestHeader("User-Agent", userAgent)
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, URLUtil.guessFileName(url, contentDisposition, mimeType))
                (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
                Toast.makeText(this, "در حال دانلود…", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) { try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } catch (e2: Exception) { } }
        }

        // back: close menus / chat / pages inside the web app first, like the native Telegram
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("(window.KabootarBack && window.KabootarBack()) ? 1 : 0") { handled ->
                    if (handled != "1") { if (web.canGoBack()) web.goBack() else moveTaskToBack(true) }
                }
            }
        })

        if (Build.VERSION.SDK_INT >= 33 && !has(Manifest.permission.POST_NOTIFICATIONS)) askNotify.launch(Manifest.permission.POST_NOTIFICATIONS)
        PushService.start(applicationContext)

        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else web.loadUrl(startUrl(intent))
    }

    /* ---------- launch animation: the round icon glides into the middle, then hands over to the app ---------- */
    private fun showSplash(bg: Int, light: Boolean) {
        val s = FrameLayout(this)
        s.setBackgroundColor(bg)
        s.isClickable = true
        val size = (104 * resources.displayMetrics.density).toInt()
        val logo = ImageView(this)
        logo.setImageResource(R.drawable.splash_logo)
        logo.elevation = 6 * resources.displayMetrics.density
        s.addView(logo, FrameLayout.LayoutParams(size, size, Gravity.CENTER))
        root.addView(s, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        splash = s
        splashStart = SystemClock.uptimeMillis()
        logo.alpha = 0f
        logo.scaleX = 0.45f
        logo.scaleY = 0.45f
        logo.translationY = 40 * resources.displayMetrics.density
        logo.animate().alpha(1f).scaleX(1f).scaleY(1f).translationY(0f)
            .setDuration(560).setInterpolator(OvershootInterpolator(1.2f)).start()
        // never keep the splash forever (slow network: the app shows its own "connecting…")
        s.postDelayed({ hideSplash() }, 6000)
    }

    private fun hideSplash() {
        runOnUiThread {
            val s = splash ?: return@runOnUiThread
            if (splashHiding) return@runOnUiThread
            splashHiding = true
            val wait = maxOf(0L, 520L - (SystemClock.uptimeMillis() - splashStart))
            s.postDelayed({
                val logo = s.getChildAt(0)
                logo?.animate()?.scaleX(1.18f)?.scaleY(1.18f)?.alpha(0f)?.setDuration(240)?.setInterpolator(DecelerateInterpolator())?.start()
                s.animate().alpha(0f).setStartDelay(60).setDuration(260).withEndAction {
                    (s.parent as? ViewGroup)?.removeView(s)
                    splash = null
                }.start()
            }, wait)
        }
    }

    /* ---------- status + navigation bars follow the screen behind them ---------- */
    private fun applyBars(top: Int, bottom: Int, lightTop: Boolean, lightBottom: Boolean) {
        @Suppress("DEPRECATION")
        window.statusBarColor = top
        @Suppress("DEPRECATION")
        window.navigationBarColor = bottom
        val ctl = WindowCompat.getInsetsController(window, window.decorView)
        ctl.isAppearanceLightStatusBars = lightTop
        ctl.isAppearanceLightNavigationBars = lightBottom
    }

    private fun color(s: String?, def: Int): Int = try { if (s.isNullOrBlank()) def else Color.parseColor(s.trim()) } catch (e: Exception) { def }

    /* ---------- what the web interface can ask the phone for (window.KabootarNative) ---------- */
    inner class Bridge {
        @JavascriptInterface fun ready() { hideSplash() }

        @JavascriptInterface fun setSession(token: String?) {
            val t = token ?: ""
            Store.setToken(applicationContext, t)
            if (t.isEmpty()) { PushService.stop(applicationContext); Notifier.cancelAll(applicationContext) }
            else PushService.start(applicationContext)
        }

        @JavascriptInterface fun setPrefs(json: String?) {
            Store.setPrefs(applicationContext, json ?: "{}")
            if (Store.shouldRunService(applicationContext)) PushService.start(applicationContext) else PushService.stop(applicationContext)
        }

        @JavascriptInterface fun setBars(top: String?, bottom: String?, lightTop: Boolean, lightBottom: Boolean) {
            runOnUiThread {
                val t = color(top, Color.BLACK)
                val b = color(bottom, t)
                applyBars(t, b, lightTop, lightBottom)
                window.setBackgroundDrawable(ColorDrawable(t))
                if (t != Color.BLACK) Store.setBars(applicationContext, t, b, lightTop, lightBottom)
            }
        }

        @JavascriptInterface fun haptic(kind: String?) {
            runOnUiThread {
                val k = when (kind) {
                    "long" -> HapticFeedbackConstants.LONG_PRESS
                    "tick" -> HapticFeedbackConstants.CLOCK_TICK
                    else -> HapticFeedbackConstants.KEYBOARD_TAP
                }
                web.performHapticFeedback(k)
            }
        }

        @JavascriptInterface fun mediaPermission(): String = Gallery.state(applicationContext)
        @JavascriptInterface fun requestMedia() { runOnUiThread { try { askMedia.launch(Gallery.permissions()) } catch (e: Exception) { js("window.KabootarOnMedia && window.KabootarOnMedia('ask')") } } }
        @JavascriptInterface fun recentMedia(limit: Int): String = Gallery.recent(applicationContext, limit)

        @JavascriptInterface fun hasPermission(p: String?): Boolean = when (p) {
            "camera" -> has(Manifest.permission.CAMERA)
            "mic", "microphone" -> has(Manifest.permission.RECORD_AUDIO)
            "notifications" -> Build.VERSION.SDK_INT < 33 || has(Manifest.permission.POST_NOTIFICATIONS)
            "media" -> Gallery.state(applicationContext) != "ask"
            else -> false
        }

        @JavascriptInterface fun isIgnoringBattery(): Boolean =
            (getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(packageName)

        @SuppressLint("BatteryLife")
        @JavascriptInterface fun openBatterySettings() {
            runOnUiThread {
                try { startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))) }
                catch (e: Exception) { try { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) } catch (e2: Exception) { } }
            }
        }

        @JavascriptInterface fun openNotificationSettings() {
            runOnUiThread {
                if (Build.VERSION.SDK_INT >= 33 && !has(Manifest.permission.POST_NOTIFICATIONS)) { askNotify.launch(Manifest.permission.POST_NOTIFICATIONS); return@runOnUiThread }
                try { startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName)) } catch (e: Exception) { }
            }
        }

        @JavascriptInterface fun clearChat(id: Int) { if (id != 0) Notifier.cancel(applicationContext, id) }
        @JavascriptInterface fun takeLaunchChat(): Int { val v = launchChat; launchChat = 0; return v }
    }

    /* ---------- local files: the UI from the APK, the gallery from the phone ---------- */
    private val mimeTypes = mapOf(
        "html" to "text/html", "js" to "text/javascript", "css" to "text/css", "svg" to "image/svg+xml",
        "png" to "image/png", "webp" to "image/webp", "jpg" to "image/jpeg", "ico" to "image/x-icon",
        "json" to "application/json", "webmanifest" to "application/manifest+json", "woff2" to "font/woff2",
        "mp3" to "audio/mpeg", "ogg" to "audio/ogg", "wav" to "audio/wav"
    )
    private val textTypes = setOf("html", "js", "css", "svg", "json", "webmanifest")

    private fun notFound() = WebResourceResponse("text/plain", "utf-8", 404, "Not Found", mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(ByteArray(0)))

    private fun intercept(request: WebResourceRequest): WebResourceResponse? {
        val url = request.url
        if (url.host != server.host || request.method != "GET") return null
        val path = url.path ?: "/"
        if (path.startsWith("/__media/thumb/")) {
            val bytes = Gallery.thumb(applicationContext, path.substringAfterLast('/')) ?: return notFound()
            return WebResourceResponse("image/jpeg", null, 200, "OK", mapOf("Cache-Control" to "max-age=600"), ByteArrayInputStream(bytes))
        }
        if (path.startsWith("/__media/file/")) {
            val f = Gallery.open(applicationContext, path.substringAfterLast('/')) ?: return notFound()
            return WebResourceResponse(f.first, null, 200, "OK", mapOf("Cache-Control" to "no-store"), f.second)
        }
        if (path.startsWith("/api/") || path.startsWith("/files/") || path == "/ws") return null
        val rel = if (path == "/" || path.isEmpty()) "index.html" else path.trimStart('/')
        if (rel.contains("..")) return null
        return try {
            val stream = assets.open("web/$rel")
            val ext = rel.substringAfterLast('.', "")
            WebResourceResponse(
                mimeTypes[ext] ?: "application/octet-stream",
                if (ext in textTypes) "utf-8" else null,
                200, "OK", mapOf("Cache-Control" to "no-cache"), stream
            )
        } catch (e: IOException) { null }
    }

    private fun startUrl(intent: Intent?): String {
        val data = intent?.data
        return if (data != null && data.host == server.host) data.toString() else BuildConfig.SERVER_URL + "/"
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val chat = intent.getIntExtra("chat_id", 0)
        if (chat != 0) { Notifier.cancel(applicationContext, chat); js("window.KabootarOpenChat && window.KabootarOpenChat($chat)"); return }
        intent.data?.let { if (it.host == server.host) web.loadUrl(it.toString()) }
    }

    override fun onResume() {
        super.onResume()
        visible = true
        web.onResume()
        web.evaluateJavascript("window.App && App.ensureConnected && App.ensureConnected()", null)
    }
    override fun onPause() { visible = false; web.onPause(); super.onPause() }
    override fun onSaveInstanceState(outState: Bundle) { super.onSaveInstanceState(outState); web.saveState(outState) }
    override fun onDestroy() { visible = false; (web.parent as? ViewGroup)?.removeView(web); web.destroy(); super.onDestroy() }
}
