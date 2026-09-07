package site.woogongsil.app.web

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Dialog
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.net.http.SslError
import android.os.Message
import android.print.PrintAttributes
import android.print.PrintManager
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.net.toUri
import site.woogongsil.app.AppConfig
import site.woogongsil.app.BuildConfig

/** WebView의 main-frame 로딩 실패를 네이티브 오류 화면으로 전달하는 값 객체입니다. */
data class WebLoadError(
    val title: String,
    val detail: String,
)

/**
 * Activity에 딸린 보조 Dialog를 추적해 회전·종료 시 한꺼번에 닫습니다.
 * WebView가 파기된 Activity window를 붙잡아 WindowLeaked를 만드는 것을 막습니다.
 */
class WebPopupRegistry {
    private val dialogs = linkedSetOf<Dialog>()

    fun register(dialog: Dialog) {
        dialogs += dialog
    }

    fun unregister(dialog: Dialog) {
        dialogs -= dialog
    }

    fun closeAll() {
        val snapshot = dialogs.toList()
        dialogs.clear()
        snapshot.forEach { dialog -> runCatching { dialog.dismiss() } }
    }
}

/**
 * 모든 우공실 WebView에 공통으로 적용되는 최소권한 설정입니다.
 * JavaScript·DOM Storage는 현재 웹 로그인에 필수지만 파일 URL과 혼합 콘텐츠는 차단합니다.
 */
@SuppressLint("SetJavaScriptEnabled")
fun configureSecureWebView(webView: WebView, allowPopups: Boolean) {
    WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
    webView.setBackgroundColor(Color.TRANSPARENT)

    webView.settings.apply {
        javaScriptEnabled = true
        domStorageEnabled = true
        allowFileAccess = false
        allowContentAccess = false
        mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        cacheMode = WebSettings.LOAD_DEFAULT
        mediaPlaybackRequiresUserGesture = true
        setGeolocationEnabled(false)
        setSupportZoom(true)
        builtInZoomControls = true
        displayZoomControls = false
        useWideViewPort = true
        loadWithOverviewMode = false
        safeBrowsingEnabled = true
        setSupportMultipleWindows(allowPopups)
        javaScriptCanOpenWindowsAutomatically = allowPopups
        userAgentString = userAgentString + AppConfig.USER_AGENT_SUFFIX

        // [로컬 파일 격리] 하위 API 호환용 속성도 명시적으로 비활성화합니다.
        @Suppress("DEPRECATION")
        allowFileAccessFromFileURLs = false
        @Suppress("DEPRECATION")
        allowUniversalAccessFromFileURLs = false
    }

    CookieManager.getInstance().apply {
        setAcceptCookie(true)
        // hCaptcha 로딩 여부를 실기기에서 먼저 검증한 뒤 꼭 필요한 경우에만 변경합니다.
        setAcceptThirdPartyCookies(webView, false)
    }
}

/** 사용자용 주 WebView의 탐색·TLS·오류·렌더러 정책을 담당합니다. */
@SuppressLint("MissingOnRenderProcessGone") // 실제 override는 아래에 있으며 AndroidX 1.17 lint 오탐을 한정 억제합니다.
class WoogongsilWebViewClient(
    private val allowAboutBlank: Boolean = false,
    private val onLoadingChanged: (Boolean) -> Unit,
    private val onMainFrameError: (WebLoadError) -> Unit,
    private val onInternalPageFinished: (WebView) -> Unit,
    private val onExternalLink: (String) -> Unit,
    private val onRendererGone: (WebView) -> Unit,
) : WebViewClient() {
    private var bundledWebAssets: BundledWebAssets? = null

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        // 두 debug 조건을 통과하기 전에는 manifest와 assets에 접근하지 않습니다.
        if (!BuildConfig.DEBUG || !BuildConfig.LOCAL_WEB_BUNDLE) return null
        val bundle = synchronized(this) {
            bundledWebAssets ?: BundledWebAssets(view.context.applicationContext.assets).also {
                bundledWebAssets = it
            }
        }
        return bundle.intercept(request.url.toString(), request.method, request.isForMainFrame)
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        if (!request.isForMainFrame) return false
        return handleNavigation(view, request.url.toString())
    }

    @Deprecated("API 24 미만 콜백 호환")
    override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
        handleNavigation(view, url)

    private fun handleNavigation(view: WebView, url: String): Boolean = when (
        val decision = WebNavigationPolicy.decide(url, allowAboutBlank)
    ) {
        NavigationDecision.Internal -> false
        NavigationDecision.External -> {
            onExternalLink(url)
            true
        }
        is NavigationDecision.Blocked -> {
            Toast.makeText(
                view.context,
                decision.reason,
                Toast.LENGTH_SHORT,
            ).show()
            true
        }
    }

    override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
        onLoadingChanged(true)
        super.onPageStarted(view, url, favicon)
    }

    override fun onPageFinished(view: WebView, url: String?) {
        onLoadingChanged(false)
        CookieManager.getInstance().flush()
        if (url != null && WebNavigationPolicy.decide(url, allowAboutBlank) == NavigationDecision.Internal) {
            onInternalPageFinished(view)
        }
        super.onPageFinished(view, url)
    }

    override fun onReceivedError(
        view: WebView,
        request: WebResourceRequest,
        error: WebResourceError,
    ) {
        if (request.isForMainFrame) {
            onLoadingChanged(false)
            onMainFrameError(
                WebLoadError("페이지를 불러오지 못했습니다.", error.description.toString()),
            )
        }
        super.onReceivedError(view, request, error)
    }

    override fun onReceivedHttpError(
        view: WebView,
        request: WebResourceRequest,
        errorResponse: WebResourceResponse,
    ) {
        if (request.isForMainFrame && errorResponse.statusCode >= 400) {
            onLoadingChanged(false)
            onMainFrameError(
                WebLoadError(
                    "서버 응답을 확인해 주세요.",
                    "HTTP ${errorResponse.statusCode}",
                ),
            )
        }
        super.onReceivedHttpError(view, request, errorResponse)
    }

    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
        // [TLS 강제] 인증서 오류에서는 예외 진행 버튼 없이 연결을 즉시 취소합니다.
        handler.cancel()
        onLoadingChanged(false)
        onMainFrameError(WebLoadError("보안 연결을 확인할 수 없습니다.", "인증서 검증 실패"))
    }

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        onLoadingChanged(false)
        onMainFrameError(
            WebLoadError(
                "웹 화면이 일시적으로 종료되었습니다.",
                if (detail.didCrash()) "WebView 렌더러 충돌" else "시스템 메모리 회수",
            ),
        )
        onRendererGone(view)
        return true
    }
}

/** 파일 선택, 진행률, 권한 거부, 제한된 보조 창을 처리하는 ChromeClient입니다. */
class WoogongsilChromeClient(
    private val activity: Activity,
    private val onFileChooser: (
        ValueCallback<Array<Uri>>,
        FileChooserParams,
    ) -> Boolean,
    private val onProgressChanged: (Int) -> Unit,
    private val onExternalLink: (String) -> Unit,
    private val popupRegistry: WebPopupRegistry,
) : WebChromeClient() {

    override fun onProgressChanged(view: WebView, newProgress: Int) {
        onProgressChanged(newProgress.coerceIn(0, 100))
        super.onProgressChanged(view, newProgress)
    }

    override fun onShowFileChooser(
        webView: WebView,
        filePathCallback: ValueCallback<Array<Uri>>,
        fileChooserParams: FileChooserParams,
    ): Boolean = onFileChooser(filePathCallback, fileChooserParams)

    override fun onPermissionRequest(request: PermissionRequest) {
        // 현재 우공실은 카메라·마이크 네이티브 권한이 필요하지 않으므로 전부 거부합니다.
        request.deny()
    }

    override fun onGeolocationPermissionsShowPrompt(
        origin: String?,
        callback: GeolocationPermissions.Callback,
    ) {
        callback.invoke(origin, false, false)
    }

    override fun onCreateWindow(
        view: WebView,
        isDialog: Boolean,
        isUserGesture: Boolean,
        resultMsg: Message,
    ): Boolean {
        if (!isUserGesture || activity.isFinishing || activity.isDestroyed) return false
        val transport = resultMsg.obj as? WebView.WebViewTransport ?: return false
        val popup = runCatching {
            createPopupWebView(activity, onExternalLink, popupRegistry)
        }.getOrNull() ?: return false
        transport.webView = popup
        resultMsg.sendToTarget()
        return true
    }
}

/**
 * document.write 기반 채팅·시험 결과 창을 앱 안에서 보여주는 보조 WebView입니다.
 * 인쇄와 닫기만 제공하고, 관리자·위험 URL 정책은 주 WebView와 동일하게 적용합니다.
 */
private fun createPopupWebView(
    activity: Activity,
    onExternalLink: (String) -> Unit,
    popupRegistry: WebPopupRegistry,
): WebView {
    val dialog = Dialog(activity)
    val title = TextView(activity).apply {
        text = "우공실 보조 창"
        textSize = 16f
        setPadding(24, 18, 12, 18)
        layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
    }
    val popup = WebView(activity)
    configureSecureWebView(popup, allowPopups = false)

    var destroyed = false
    fun dismissAndDestroy() {
        if (!dialog.isShowing) {
            if (!destroyed) {
                destroyed = true
                releaseWebView(popup)
            }
            return
        }
        dialog.dismiss()
    }

    popup.webViewClient = WoogongsilWebViewClient(
        allowAboutBlank = true,
        onLoadingChanged = {},
        onMainFrameError = { Toast.makeText(activity, it.title, Toast.LENGTH_LONG).show() },
        onInternalPageFinished = {},
        onExternalLink = {
            onExternalLink(it)
            dismissAndDestroy()
        },
        onRendererGone = { dismissAndDestroy() },
    )
    popup.webChromeClient = object : WebChromeClient() {
        override fun onReceivedTitle(view: WebView, pageTitle: String?) {
            title.text = pageTitle?.takeIf { it.isNotBlank() } ?: "우공실 보조 창"
        }

        override fun onCloseWindow(window: WebView) {
            dismissAndDestroy()
        }

        override fun onPermissionRequest(request: PermissionRequest) {
            request.deny()
        }
    }

    val printButton = Button(activity).apply {
        text = "인쇄"
        setOnClickListener {
            val jobName = popup.title?.takeIf { it.isNotBlank() } ?: "우공실 문서"
            val printManager = activity.getSystemService(PrintManager::class.java)
            printManager.print(
                jobName,
                popup.createPrintDocumentAdapter(jobName),
                PrintAttributes.Builder().build(),
            )
        }
    }
    val closeButton = Button(activity).apply {
        text = "닫기"
        setOnClickListener { dismissAndDestroy() }
    }
    val toolbar = LinearLayout(activity).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = android.view.Gravity.CENTER_VERTICAL
        addView(title)
        addView(printButton)
        addView(closeButton)
    }
    val root = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        addView(toolbar, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        addView(
            popup,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f,
            ),
        )
    }

    dialog.setContentView(root)
    dialog.setOnDismissListener {
        popupRegistry.unregister(dialog)
        if (!destroyed) {
            destroyed = true
            releaseWebView(popup)
        }
    }
    dialog.setOnShowListener {
        dialog.window?.setLayout(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        )
    }
    // [Activity 수명 연결] 화면에 올리기 전에 등록해 회전 직전 생성 경합도 정리합니다.
    popupRegistry.register(dialog)
    runCatching { dialog.show() }.onFailure {
        popupRegistry.unregister(dialog)
        if (!destroyed) {
            destroyed = true
            releaseWebView(popup)
        }
    }.getOrThrow()
    return popup
}

/** 외부 HTTPS·전화·메일만 Android의 외부 앱으로 전달합니다. */
fun openExternalLink(context: Context, url: String): Boolean {
    if (WebNavigationPolicy.decide(url, allowAboutBlank = false) != NavigationDecision.External) {
        Toast.makeText(context, "허용되지 않은 외부 주소입니다.", Toast.LENGTH_SHORT).show()
        return false
    }
    val intent = Intent(Intent.ACTION_VIEW, url.toUri()).apply {
        addCategory(Intent.CATEGORY_BROWSABLE)
        if (context !is Activity) addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    return runCatching {
        context.startActivity(intent)
        true
    }.getOrElse {
        Toast.makeText(context, "주소를 열 수 있는 앱이 없습니다.", Toast.LENGTH_LONG).show()
        false
    }
}

/** WebView가 Activity를 붙잡지 않도록 종료 순서를 한곳에서 보장합니다. */
fun releaseWebView(webView: WebView) {
    runCatching { webView.stopLoading() }
    // [부모 분리] 렌더러 종료 시 destroyed WebView가 AndroidView 계층에 남지 않게 합니다.
    runCatching { (webView.parent as? ViewGroup)?.removeView(webView) }
    runCatching { webView.clearHistory() }
    runCatching { webView.removeAllViews() }
    webView.webChromeClient = null
    runCatching { webView.destroy() }
}
