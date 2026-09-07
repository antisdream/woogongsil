package site.woogongsil.app.ui.web

import android.app.Activity
import android.content.ContentResolver
import android.content.Context
import android.content.ContextWrapper
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import site.woogongsil.app.AppConfig
import site.woogongsil.app.web.WebDownloadSupport
import site.woogongsil.app.web.WebLoadError
import site.woogongsil.app.web.NavigationDecision
import site.woogongsil.app.web.WebPopupRegistry
import site.woogongsil.app.web.WebNavigationPolicy
import site.woogongsil.app.web.WoogongsilChromeClient
import site.woogongsil.app.web.WoogongsilWebViewClient
import site.woogongsil.app.web.configureSecureWebView
import site.woogongsil.app.web.openExternalLink
import site.woogongsil.app.web.releaseWebView

/** 자동화 테스트와 수동 UI 확인에서 사용하는 안정적인 식별자입니다. */
object WebScreenTestTags {
    const val WEB_VIEW = "woogongsil_webview"
    const val ERROR = "web_error"
    const val RETRY = "web_retry"
}

/**
 * 운영 우공실 사이트를 표시하는 네이티브 컨테이너입니다.
 * WebView 인스턴스 수명, 파일 선택, 뒤로가기, 오류 복구를 한 화면에서 조정합니다.
 */
@Composable
fun WoogongsilWebScreen(
    initialWebViewState: Bundle?,
    onWebViewChanged: (WebView?) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val activity = context.findActivity()
        ?: error("WoogongsilWebScreen은 Activity 안에서 실행해야 합니다.")

    var webView by remember { mutableStateOf<WebView?>(null) }
    var generation by remember { mutableIntStateOf(0) }
    var isLoading by remember { mutableStateOf(true) }
    var progress by remember { mutableIntStateOf(0) }
    var loadError by remember { mutableStateOf<WebLoadError?>(null) }
    var showExitDialog by remember { mutableStateOf(false) }
    var pendingFileCallback by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }
    var pendingAcceptedMimeTypes by remember { mutableStateOf<List<String>>(emptyList()) }
    var lastInternalUrl by remember { mutableStateOf(AppConfig.START_URL) }
    val popupRegistry = remember(activity) { WebPopupRegistry() }

    // [파일 선택 결과] 시스템 선택기가 반환한 content:// URI만 WebView 입력요소에 전달합니다.
    val fileChooserLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val callback = pendingFileCallback
        pendingFileCallback = null
        val parsedUris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        val validatedUris = validateChosenFiles(context, parsedUris, pendingAcceptedMimeTypes)
        pendingAcceptedMimeTypes = emptyList()
        if (parsedUris != null && validatedUris == null) {
            Toast.makeText(context, "읽을 수 있는 문서 파일만 선택할 수 있습니다.", Toast.LENGTH_LONG).show()
        }
        callback?.onReceiveValue(validatedUris)
    }

    fun retry() {
        loadError = null
        isLoading = true
        val current = webView
        if (current != null) {
            current.loadUrl(lastInternalUrl)
        } else {
            generation += 1
        }
    }

    // [Android 뒤로가기] 웹 이력이 있으면 이전 페이지, 없으면 앱 종료 확인을 표시합니다.
    BackHandler(enabled = true) {
        val current = webView
        if (current?.canGoBack() == true) current.goBack() else showExitDialog = true
    }

    // [수명 정리] 파일 콜백과 WebView를 Activity 종료·화면 해제 때 확실히 반환합니다.
    DisposableEffect(Unit) {
        onDispose {
            pendingFileCallback?.onReceiveValue(null)
            pendingFileCallback = null
            pendingAcceptedMimeTypes = emptyList()
            popupRegistry.closeAll()
            webView?.let(::releaseWebView)
            webView = null
            onWebViewChanged(null)
        }
    }

    Box(modifier = modifier.fillMaxSize().safeDrawingPadding()) {
        key(generation) {
            AndroidView(
                modifier = Modifier
                    .fillMaxSize()
                    .testTag(WebScreenTestTags.WEB_VIEW),
                factory = { factoryContext ->
                    WebView(factoryContext).also { created ->
                        // WebView는 WRAP_CONTENT이면 CSS viewport 높이를 0으로 취급할 수 있습니다.
                        // Compose의 fillMaxSize와 네이티브 크기 정책을 함께 맞춥니다.
                        created.layoutParams = ViewGroup.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT,
                        )
                        configureSecureWebView(created, allowPopups = true)
                        WebDownloadSupport.installBlobMessageBridge(created)

                        created.webViewClient = WoogongsilWebViewClient(
                            onLoadingChanged = { loading ->
                                isLoading = loading
                                if (loading) loadError = null
                            },
                            onMainFrameError = { loadError = it },
                            onInternalPageFinished = { finishedView ->
                                finishedView.url?.takeIf { url ->
                                    WebNavigationPolicy.decide(url) == NavigationDecision.Internal
                                }?.let { url -> lastInternalUrl = url }
                                WebDownloadSupport.injectBlobDownloadHook(finishedView)
                            },
                            onExternalLink = { openExternalLink(activity, it) },
                            onRendererGone = { crashed ->
                                if (webView === crashed) {
                                    releaseWebView(crashed)
                                    webView = null
                                    onWebViewChanged(null)
                                }
                            },
                        )
                        created.webChromeClient = WoogongsilChromeClient(
                            activity = activity,
                            onFileChooser = { callback, params ->
                                pendingFileCallback?.onReceiveValue(null)
                                pendingFileCallback = callback
                                pendingAcceptedMimeTypes = params.acceptTypes
                                    .flatMap { value -> value.split(',') }
                                    .map { value -> value.trim().lowercase() }
                                    .filter { value -> value.isNotBlank() }
                                runCatching {
                                    fileChooserLauncher.launch(params.createIntent())
                                    true
                                }.getOrElse {
                                    pendingFileCallback = null
                                    pendingAcceptedMimeTypes = emptyList()
                                    callback.onReceiveValue(null)
                                    false
                                }
                            },
                            onProgressChanged = { progress = it },
                            onExternalLink = { openExternalLink(activity, it) },
                            popupRegistry = popupRegistry,
                        )
                        created.setDownloadListener { url, userAgent, disposition, mimeType, _ ->
                            WebDownloadSupport.enqueueHttpDownload(
                                context = factoryContext.applicationContext,
                                url = url,
                                userAgent = userAgent,
                                contentDisposition = disposition,
                                mimeType = mimeType,
                            )
                        }

                        webView = created
                        onWebViewChanged(created)

                        // [상태 복구] 회전이면 웹 이력·폼을 복원하고, 콜드 스타트면 운영 URL을 엽니다.
                        val restored = generation == 0 &&
                            initialWebViewState != null &&
                            created.restoreState(initialWebViewState) != null
                        if (!restored) created.loadUrl(lastInternalUrl)
                    }
                },
            )
        }

        if (isLoading && loadError == null) {
            LinearProgressIndicator(
                progress = { progress.coerceIn(0, 100) / 100f },
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .fillMaxWidth(),
            )
        }

        loadError?.let { error ->
            WebErrorOverlay(error = error, onRetry = ::retry)
        }
    }

    if (showExitDialog) {
        AlertDialog(
            onDismissRequest = { showExitDialog = false },
            title = { Text("우공실 앱을 종료할까요?") },
            text = { Text("현재 웹 화면의 입력 내용이 저장되지 않았을 수 있습니다.") },
            confirmButton = {
                TextButton(onClick = activity::finish) { Text("종료") }
            },
            dismissButton = {
                TextButton(onClick = { showExitDialog = false }) { Text("계속 사용") }
            },
        )
    }
}

/**
 * [외부 선택 결과 검증] 제3자 DocumentsProvider 결과를 신뢰하지 않고 content URI,
 * authority, 중복/개수, 실제 읽기 가능성을 모두 확인한 뒤 WebView에 전달합니다.
 */
private fun validateChosenFiles(
    context: Context,
    rawUris: Array<Uri>?,
    acceptedMimeTypes: List<String>,
): Array<Uri>? {
    if (rawUris == null) return null
    val uniqueUris = rawUris.distinct()
    if (uniqueUris.isEmpty() || uniqueUris.size > AppConfig.MAX_UPLOAD_FILES) return null

    val resolver = context.contentResolver
    val allReadable = uniqueUris.all { uri ->
        uri.scheme.equals(ContentResolver.SCHEME_CONTENT, ignoreCase = true) &&
            !uri.authority.isNullOrBlank() &&
            runCatching {
                val actualMimeType = resolver.getType(uri)?.lowercase()
                if (!matchesAcceptedMimeType(actualMimeType, acceptedMimeTypes)) return@runCatching false
                resolver.openAssetFileDescriptor(uri, "r")?.use { descriptor ->
                    descriptor.fileDescriptor.valid() &&
                        (descriptor.length < 0L || descriptor.length <= AppConfig.MAX_UPLOAD_FILE_BYTES)
                } == true
            }.getOrDefault(false)
    }
    return if (allReadable) uniqueUris.toTypedArray() else null
}

/** HTML input accept 값이 비어 있으면 모든 MIME을, 아니면 정확/와일드카드 일치만 허용합니다. */
private fun matchesAcceptedMimeType(actualMimeType: String?, acceptedMimeTypes: List<String>): Boolean {
    val mimeConstraints = acceptedMimeTypes.filter { it.contains('/') }
    if (mimeConstraints.isEmpty() || mimeConstraints.any { it == "*/*" }) return true
    val actual = actualMimeType ?: return false
    return mimeConstraints.any { accepted ->
        accepted == actual ||
            (accepted.endsWith("/*") && actual.startsWith(accepted.substringBefore('/') + "/"))
    }
}

/** 사이트·네트워크 오류 때 빈 화면 대신 원인과 재시도 동작을 제공합니다. */
@Composable
private fun WebErrorOverlay(error: WebLoadError, onRetry: () -> Unit) {
    Surface(
        modifier = Modifier
            .fillMaxSize()
            .testTag(WebScreenTestTags.ERROR),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier = Modifier.padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                text = error.title,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = error.detail,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(top = 12.dp, bottom = 24.dp),
            )
            Button(
                onClick = onRetry,
                modifier = Modifier.testTag(WebScreenTestTags.RETRY),
            ) {
                Text("다시 시도")
            }
        }
    }
}

/** Compose LocalContext에서 실제 Activity를 안전하게 찾습니다. */
private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
