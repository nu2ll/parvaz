package app.kabootar

import android.Manifest
import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.webkit.*
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat

/**
 * Kabootar for Android: a full-screen WebView that only talks to your Kabootar server
 * (BuildConfig.SERVER_URL). Camera / mic for calls, voice & video messages, file picking,
 * downloads, back button and links to the server open inside the app; everything else
 * opens in the browser.
 */
class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
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

    private fun has(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.TRANSPARENT
        web = WebView(this)
        setContentView(web)
        web.setBackgroundColor(Color.parseColor("#212121"))

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
            userAgentString = "$userAgentString KabootarAndroid/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().setAcceptCookie(true)

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.host == server.host && url.scheme == "https") return false // stay in the app
                return try { startActivity(Intent(Intent.ACTION_VIEW, url)); true } catch (e: ActivityNotFoundException) { true }
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) view.loadData(OFFLINE_PAGE, "text/html; charset=utf-8", "UTF-8")
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
            } catch (e: Exception) { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
        }

        // back: close menus / chat / pages inside the web app first, like the native Telegram
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("(window.KabootarBack && window.KabootarBack()) ? 1 : 0") { handled ->
                    if (handled != "1") { if (web.canGoBack()) web.goBack() else finish() }
                }
            }
        })

        if (Build.VERSION.SDK_INT >= 33 && !has(Manifest.permission.POST_NOTIFICATIONS)) {
            registerForActivityResult(ActivityResultContracts.RequestPermission()) {}.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else web.loadUrl(startUrl(intent))
    }

    private fun startUrl(intent: Intent?): String {
        val data = intent?.data
        return if (data != null && data.host == server.host) data.toString() else BuildConfig.SERVER_URL + "/"
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.data?.let { if (it.host == server.host) web.loadUrl(it.toString()) }
    }

    override fun onResume() { super.onResume(); web.onResume(); web.evaluateJavascript("window.App && App.ensureConnected && App.ensureConnected()", null) }
    override fun onPause() { web.onPause(); super.onPause() }
    override fun onSaveInstanceState(outState: Bundle) { super.onSaveInstanceState(outState); web.saveState(outState) }
    override fun onDestroy() { (web.parent as? android.view.ViewGroup)?.removeView(web); web.destroy(); super.onDestroy() }

    companion object {
        private const val OFFLINE_PAGE = """<!doctype html><html dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1">
<body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#212121;color:#fff;font-family:sans-serif;text-align:center">
<div style="font-size:56px">🕊</div><h3>به سرور کبوتر وصل نشدیم</h3><p style="color:#aaa">اینترنت یا VPN را بررسی کنید</p>
<button onclick="history.back();location.reload()" style="margin-top:12px;background:#8774e1;color:#fff;border:0;border-radius:22px;padding:12px 28px;font-size:16px">تلاش دوباره</button></body></html>"""
    }
}
