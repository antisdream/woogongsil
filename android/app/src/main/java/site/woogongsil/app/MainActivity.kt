package site.woogongsil.app

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import site.woogongsil.app.ui.opening.OpeningDoorContainer
import site.woogongsil.app.ui.theme.WoogongsilTheme
import site.woogongsil.app.ui.web.WoogongsilWebScreen

/**
 * 우공실 Android 앱의 단일 실행 진입점입니다.
 *
 * 시스템 Splash → Compose 오프닝 → 보안 WebView 순서로 화면을 연결합니다.
 */
class MainActivity : ComponentActivity() {
    private var activeWebView: WebView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        // [시스템 Splash] Android 12 이상과 하위 버전의 시작 화면을 통일합니다.
        installSplashScreen()
        super.onCreate(savedInstanceState)

        // [Compose 루트] 앱의 모든 네이티브 UI는 이 블록 아래에서 구성합니다.
        setContent {
            WoogongsilTheme {
                WoogongsilAppRoot(
                    initialWebViewState = savedInstanceState?.getBundle(WEB_VIEW_STATE_KEY),
                    isColdStart = savedInstanceState == null,
                    onOpeningBack = ::finish,
                    onWebViewChanged = { activeWebView = it },
                )
            }
        }
    }

    /** 화면 회전·다중 창 전환 때 제한된 웹 이력과 입력 상태를 Bundle에 보존합니다. */
    override fun onSaveInstanceState(outState: Bundle) {
        activeWebView?.let { webView ->
            Bundle().also { webState ->
                // [상태 크기 제한] 긴 탐색 이력을 무제한 Bundle에 넣으면 Android의
                // Binder 1MB 한도를 넘을 수 있어 AndroidX의 bounded 저장만 사용합니다.
                if (WebViewFeature.isFeatureSupported(WebViewFeature.SAVE_STATE)) {
                    runCatching {
                        WebViewCompat.saveState(
                            webView,
                            webState,
                            AppConfig.MAX_WEBVIEW_STATE_BYTES,
                            false,
                        )
                    }.onSuccess {
                        outState.putBundle(WEB_VIEW_STATE_KEY, webState)
                    }
                }
            }
        }
        super.onSaveInstanceState(outState)
    }

    companion object {
        private const val WEB_VIEW_STATE_KEY = "woogongsil.webview.state"
    }
}

/**
 * [화면 전환 루트] 콜드 스타트에서는 오프닝을 한 번 보여주고 본문으로 전환합니다.
 * 웹 화면은 처음부터 준비하고 오프닝만 걷어내므로 전환 때 WebView를 다시 만들지 않습니다.
 * 오프닝 도중의 회전·Activity 재생성도 콜드 스타트와 구분해 반복을 막습니다.
 */
@Composable
private fun WoogongsilAppRoot(
    initialWebViewState: Bundle?,
    isColdStart: Boolean,
    onOpeningBack: () -> Unit,
    onWebViewChanged: (WebView?) -> Unit,
) {
    OpeningDoorContainer(
        playOpening = isColdStart,
        onOpeningBack = onOpeningBack,
    ) {
        WoogongsilWebScreen(
            initialWebViewState = initialWebViewState,
            onWebViewChanged = onWebViewChanged,
        )
    }
}
