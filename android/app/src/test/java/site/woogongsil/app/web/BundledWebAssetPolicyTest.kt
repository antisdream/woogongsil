package site.woogongsil.app.web

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 로컬 번들이 API·관리자·외부 요청과 섞이거나 경로를 벗어나지 않는지 검증합니다. */
class BundledWebAssetPolicyTest {
    private val files = setOf(
        "index.html", "assets/main-ui.js", "assets/main-ui.css", "assets/icon.svg", "assets/code.wasm",
        "favicon2.ico", "wgs-rank-guest-hide-safe.js", "AppleSDGothicNeo_Font/Regular.ttf",
    )
    private val policy = BundledWebAssetPolicy(files)

    @Test
    fun `두 운영 HTTPS 호스트의 manifest 파일과 query는 로컬 파일로 매핑한다`() {
        listOf("woogongsil.site", "www.woogongsil.site").forEach { host ->
            assertEquals(
                BundledWebAssetDecision.Asset("assets/main-ui.js"),
                policy.decide("https://$host/assets/main-ui.js?v=2&next=/api/test", "GET", false),
            )
            assertEquals(
                BundledWebAssetDecision.Asset("index.html"),
                policy.decide("https://$host:443/index.html", "GET", true),
            )
        }
    }

    @Test
    fun `favicon 보조 스크립트 공개 폰트도 정확한 manifest 경로만 매핑한다`() {
        listOf("favicon2.ico", "wgs-rank-guest-hide-safe.js", "AppleSDGothicNeo_Font/Regular.ttf").forEach { path ->
            assertEquals(
                BundledWebAssetDecision.Asset(path),
                policy.decide("https://woogongsil.site/$path", "GET", false),
            )
        }
    }

    @Test
    fun `API와 socket 업로드 원격 이미지는 query나 manifest 이름과 무관하게 통과한다`() {
        val withNetworkFiles = BundledWebAssetPolicy(files + setOf("api/config.json", "uploads/photo.png"))
        listOf(
            "/api", "/api/gatekeeper/status", "/api/gatekeeper/verify?asset=/assets/main-ui.js",
            "/api/config.json", "/api/study/upload-file", "/socket.io/?EIO=4&transport=polling",
            "/uploads/photo.png", "/upload/document.pdf", "/ipep-img/q.png", "/question_image/q.png",
        ).forEach { path ->
            assertEquals(path, BundledWebAssetDecision.PassThrough, withNetworkFiles.decide("https://woogongsil.site$path", "GET", true))
        }
    }

    @Test
    fun `외부호스트와 유사호스트 비표준 origin은 로컬 파일을 받지 않는다`() {
        listOf(
            "https://js.hcaptcha.com/1/api.js", "https://api.qrserver.com/assets/main-ui.js",
            "https://woogongsil.site.evil.example/assets/main-ui.js", "https://woogongsil.site./assets/main-ui.js",
            "http://woogongsil.site/assets/main-ui.js", "https://woogongsil.site:444/assets/main-ui.js",
            "https://user@woogongsil.site/assets/main-ui.js", "file:///assets/main-ui.js", "about:blank",
        ).forEach { url ->
            assertEquals(url, BundledWebAssetDecision.PassThrough, policy.decide(url, "GET", true))
        }
    }

    @Test
    fun `GET 이외 요청은 HTML과 정적 파일도 가로채지 않는다`() {
        listOf("POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS").forEach { method ->
            listOf("/", "/login", "/assets/main-ui.js").forEach { path ->
                assertEquals(BundledWebAssetDecision.PassThrough, policy.decide("https://woogongsil.site$path", method, true))
            }
        }
    }

    @Test
    fun `고객 SPA의 깊은 문서 경로와 query는 index로 복원한다`() {
        listOf(
            "/", "/login?returnTo=/wrong/written-bank", "/cert/ipe/written-bank",
            "/cert/ipe/practical-three-week", "/multiplayer/records", "/wrong/written-bank",
            "/study?scope=mine&doc=123&folder=4", "/study/folder/123", "/board/post/123",
            "/board/notice/write", "/board/", "/terms", "/privacy", "/account-consent",
        ).forEach { path ->
            assertEquals(path, BundledWebAssetDecision.Asset("index.html"), policy.decide("https://woogongsil.site$path", "GET", true))
        }
    }

    @Test
    fun `SPA 경로를 요청하는 fetch나 하위 리소스에 index를 주지 않는다`() {
        listOf("/", "/login", "/study?doc=1", "/board/post/3", "/wrong/written-bank").forEach { path ->
            assertEquals(BundledWebAssetDecision.PassThrough, policy.decide("https://woogongsil.site$path", "GET", false))
        }
    }

    @Test
    fun `없는 번들 청크는 명시적 누락 처리하며 운영 청크로 대체하지 않는다`() {
        listOf("/assets/old.js", "/assets/old.css?ver=1", "/assets/", "/assets").forEach { path ->
            assertEquals(BundledWebAssetDecision.MissingAsset, policy.decide("https://woogongsil.site$path", "GET", false))
            assertEquals(BundledWebAssetDecision.MissingAsset, policy.decide("https://woogongsil.site$path", "GET", true))
        }
        assertEquals(BundledWebAssetDecision.MissingAsset, BundledWebAssetPolicy(emptySet()).decide("https://woogongsil.site/", "GET", true))
    }

    @Test
    fun `알 수 없는 경로와 관리자 문서는 고객 index로 바꾸지 않는다`() {
        listOf(
            "/manage", "/manage/index.html", "/admin", "/api/admin/users", "/%6danage/users",
            "/downloads/result.pdf", "/unknown-route", "/unknown.css", "/wrong/a/b", "/multiplayer/a/b",
            "/_wgs-bundle.json",
        ).forEach { path ->
            assertEquals(path, BundledWebAssetDecision.PassThrough, policy.decide("https://woogongsil.site$path", "GET", true))
        }
    }

    @Test
    fun `dot 경로와 중첩 인코딩 구분자 우회로 로컬 파일을 열지 않는다`() {
        listOf(
            "/assets/../index.html", "/assets/%2e%2e/index.html", "/assets/%252e%252e/index.html",
            "/assets%2fmain-ui.js", "/assets/%2fmain-ui.js", "/assets/%5cmain-ui.js",
            "//assets/main-ui.js", "/assets/./main-ui.js", "/assets/main-ui.js%00",
            "/study/../index.html", "/study/%252e%252e/index.html",
        ).forEach { path ->
            assertFalse(path, policy.decide("https://woogongsil.site$path", "GET", true) is BundledWebAssetDecision.Asset)
        }
    }

    @Test
    fun `manifest의 파일 경로는 asset root를 벗어나거나 URL 문법을 포함할 수 없다`() {
        listOf("../secret", "/absolute", "assets/../secret", "assets//file", "assets/./file", "assets\\file", "assets/%2e", "index.html?x=1", "a#b", "C:/file").forEach { path ->
            assertFalse(path, BundledWebAssetPolicy.isSafeRelativeAssetPath(path))
        }
        assertTrue(BundledWebAssetPolicy.isSafeRelativeAssetPath("AppleSDGothicNeo_Font/Regular.ttf"))
        assertTrue(BundledWebAssetPolicy.isSafeRelativeAssetPath("assets/main-ui.css"))
    }
}
