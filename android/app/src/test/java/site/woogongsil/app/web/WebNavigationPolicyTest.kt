package site.woogongsil.app.web

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** 사용자 화면·외부 링크·관리자 경로의 보안 경계를 회귀 검증합니다. */
class WebNavigationPolicyTest {
    @Test
    fun `운영 사용자 경로는 WebView 내부에서 연다`() {
        val urls = listOf(
            "https://woogongsil.site/",
            "https://woogongsil.site/login",
            "https://woogongsil.site/multiplayer/play?room=1234",
            "https://www.woogongsil.site/fortune",
        )

        urls.forEach { url ->
            assertEquals(url, NavigationDecision.Internal, WebNavigationPolicy.decide(url))
        }
    }

    @Test
    fun `관리자 경로와 인코딩 우회는 차단한다`() {
        val urls = listOf(
            "https://woogongsil.site/manage",
            "https://woogongsil.site/manage/users",
            "https://woogongsil.site/admin/",
            "https://woogongsil.site/api/admin/users",
            "https://woogongsil.site/%6danage/users",
            "https://woogongsil.site//manage//users",
            "https://woogongsil.site/x/../manage",
            "https://woogongsil.site/%256danage",
            "https://woogongsil.site/%25256danage",
            "https://woogongsil.site/manage%00",
            "https://woogongsil.site/x/%2e%2e/admin",
            "https://woogongsil.site/api/%2e%2e/api/admin/users",
        )

        urls.forEach { url ->
            assertTrue(url, WebNavigationPolicy.decide(url) is NavigationDecision.Blocked)
        }
    }

    @Test
    fun `외부 HTTPS 전화 메일은 외부 앱으로 분리한다`() {
        assertEquals(NavigationDecision.External, WebNavigationPolicy.decide("https://www.q-net.or.kr/"))
        assertEquals(NavigationDecision.External, WebNavigationPolicy.decide("mailto:help@example.com"))
        assertEquals(NavigationDecision.External, WebNavigationPolicy.decide("tel:0212345678"))
    }

    @Test
    fun `위험 스킴 비표준 포트 사용자정보는 차단한다`() {
        val urls = listOf(
            "http://woogongsil.site/",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "content://settings/system",
            "intent://example/#Intent;scheme=https;end",
            "https://woogongsil.site:444/",
            "https://user@woogongsil.site/",
        )

        urls.forEach { url ->
            assertTrue(url, WebNavigationPolicy.decide(url) is NavigationDecision.Blocked)
        }
    }

    @Test
    fun `about blank는 보조 팝업에서만 허용한다`() {
        assertTrue(WebNavigationPolicy.decide("about:blank") is NavigationDecision.Blocked)
        assertEquals(
            NavigationDecision.Internal,
            WebNavigationPolicy.decide("about:blank", allowAboutBlank = true),
        )
    }
}
