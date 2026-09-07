package site.woogongsil.app

import android.webkit.CookieManager
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.matcher.ViewMatchers.isAssignableFrom
import androidx.webkit.WebViewFeature
import org.hamcrest.CoreMatchers.startsWith
import org.hamcrest.MatcherAssert.assertThat
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import site.woogongsil.app.ui.web.WebScreenTestTags
import site.woogongsil.app.ui.opening.OpeningTestTags

/**
 * 실제 Android WebView 엔진에서만 확인할 수 있는 보안 설정과 첫 화면 전환을 검증합니다.
 * 네트워크 인증번호나 회원 계정은 입력하지 않아 사용자·운영 데이터에 영향을 주지 않습니다.
 */
class MainActivityDeviceTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun coldStart_opensSecuredProductionWebView() {
        // WebView는 오프닝 뒤에서 미리 구성됩니다. 본문 준비와 약 3초 오프닝 종료를 따로 확인합니다.
        composeRule.waitUntil(timeoutMillis = 8_000) {
            // 시스템 Splash 직후에는 Compose 계층이 아직 없을 수 있으므로 준비 전 상태는 false로 처리합니다.
            runCatching {
                composeRule
                    .onAllNodesWithTag(WebScreenTestTags.WEB_VIEW)
                    .fetchSemanticsNodes()
                    .isNotEmpty()
            }.getOrDefault(false)
        }
        assertTrue(
            composeRule
                .onAllNodesWithTag(WebScreenTestTags.WEB_VIEW)
                .fetchSemanticsNodes()
                .isNotEmpty(),
        )
        waitForOpeningToFinish(timeoutMillis = 8_000)

        // [실제 WebView 설정] JVM mock이 아닌 갤럭시탭의 WebView 객체를 직접 검사합니다.
        onView(isAssignableFrom(WebView::class.java)).check { view, _ ->
            val webView = view as WebView
            assertTrue(webView.settings.javaScriptEnabled)
            assertTrue(webView.settings.domStorageEnabled)
            assertFalse(webView.settings.allowFileAccess)
            assertFalse(webView.settings.allowContentAccess)
            assertFalse(CookieManager.getInstance().acceptThirdPartyCookies(webView))
            assertThat(webView.settings.mixedContentMode, org.hamcrest.CoreMatchers.`is`(WebSettings.MIXED_CONTENT_NEVER_ALLOW))
            assertTrue(WebViewFeature.isFeatureSupported(WebViewFeature.SAVE_STATE))
            webView.url?.let { assertThat(it, startsWith("https://woogongsil.site")) }
        }
    }

    @Test
    fun activityRecreation_restoresWebContainerWithoutRepeatingOpening() {
        // [최초 본문 진입] 오프닝 뒤 실제 WebView가 만들어진 상태에서 Activity를 재생성합니다.
        waitForWebView(timeoutMillis = 8_000)
        waitForOpeningToFinish(timeoutMillis = 8_000)
        var urlBeforeRecreation: String? = null
        onView(isAssignableFrom(WebView::class.java)).check { view, _ ->
            urlBeforeRecreation = (view as WebView).url
        }
        composeRule.activityRule.scenario.recreate()

        // [회전 상당 재생성] rememberSaveable/제한된 WebView state가 적용되어 네이티브
        // 오프닝이 실제로 다시 나타나지 않고 보안 WebView가 복구되는지 확인합니다.
        composeRule.waitForIdle()
        composeRule
            .onAllNodesWithTag(OpeningTestTags.ROOT)
            .assertCountEquals(0)
        waitForWebView(timeoutMillis = 4_000)
        assertTrue(
            composeRule
                .onAllNodesWithTag(WebScreenTestTags.WEB_VIEW)
                .fetchSemanticsNodes()
                .isNotEmpty(),
        )
        onView(isAssignableFrom(WebView::class.java)).check { view, _ ->
            val webView = view as WebView
            assertFalse(webView.settings.allowFileAccess)
            assertFalse(webView.settings.allowContentAccess)
            if (urlBeforeRecreation != null) {
                assertThat(webView.url, org.hamcrest.CoreMatchers.`is`(urlBeforeRecreation))
            }
        }
    }

    /** Compose 계층이 준비되기 전 조회 예외를 실패가 아닌 대기 상태로 처리합니다. */
    private fun waitForWebView(timeoutMillis: Long) {
        composeRule.waitUntil(timeoutMillis = timeoutMillis) {
            runCatching {
                composeRule
                    .onAllNodesWithTag(WebScreenTestTags.WEB_VIEW)
                    .fetchSemanticsNodes()
                    .isNotEmpty()
            }.getOrDefault(false)
        }
    }

    private fun waitForOpeningToFinish(timeoutMillis: Long) {
        composeRule.waitUntil(timeoutMillis = timeoutMillis) {
            runCatching {
                composeRule
                    .onAllNodesWithTag(OpeningTestTags.ROOT)
                    .fetchSemanticsNodes()
                    .isEmpty()
            }.getOrDefault(false)
        }
    }
}
