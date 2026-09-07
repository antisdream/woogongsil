package site.woogongsil.app.web

import java.net.URI
import java.util.Locale
import site.woogongsil.app.AppConfig

/** 번들에서 읽을 파일과 원래 네트워크 요청을 구분하는 순수 JVM 정책입니다. */
sealed interface BundledWebAssetDecision {
    data object PassThrough : BundledWebAssetDecision
    data class Asset(val relativePath: String) : BundledWebAssetDecision
    data object MissingAsset : BundledWebAssetDecision
}

class BundledWebAssetPolicy(private val files: Set<String>) {
    init {
        require(files.all(::isSafeRelativeAssetPath)) { "번들 파일 경로가 올바르지 않습니다." }
    }

    fun decide(rawUrl: String, method: String, isMainFrame: Boolean): BundledWebAssetDecision {
        if (!method.equals("GET", ignoreCase = true)) return BundledWebAssetDecision.PassThrough
        if (WebNavigationPolicy.decide(rawUrl) != NavigationDecision.Internal) {
            return BundledWebAssetDecision.PassThrough
        }
        val uri = runCatching { URI(rawUrl) }.getOrNull()
            ?: return BundledWebAssetDecision.PassThrough
        val host = uri.host?.lowercase(Locale.ROOT)
        if (!uri.scheme.equals("https", ignoreCase = true) ||
            host !in INTERNAL_HOSTS || uri.userInfo != null || uri.port !in listOf(-1, 443)
        ) {
            return BundledWebAssetDecision.PassThrough
        }

        val path = uri.path.orEmpty().ifEmpty { "/" }
        val lowerPath = path.lowercase(Locale.ROOT)
        // API·통신·서버 이미지·업로드는 manifest에 이름이 있더라도 가로채지 않습니다.
        if (NETWORK_ROOTS.any { lowerPath == it || lowerPath.startsWith("$it/") }) {
            return BundledWebAssetDecision.PassThrough
        }
        val assetNamespace = path == "/assets" || path.startsWith("/assets/")
        val relativePath = path.removePrefix("/")
        val safePath = path == "/" ||
            (path.startsWith("/") && isSafeRelativeAssetPath(relativePath.removeSuffix("/")))
        if (!safePath || ENCODED_SEPARATOR.containsMatchIn(uri.rawPath.orEmpty())) {
            return if (assetNamespace) BundledWebAssetDecision.MissingAsset
            else BundledWebAssetDecision.PassThrough
        }
        if (relativePath == MANIFEST_NAME) return BundledWebAssetDecision.PassThrough

        if (relativePath in files) return BundledWebAssetDecision.Asset(relativePath)
        // 누락된 번들 청크를 운영 서버에서 가져와 서로 다른 빌드가 섞이지 않게 합니다.
        if (assetNamespace) return BundledWebAssetDecision.MissingAsset

        if (isMainFrame && isSpaRoute(path)) {
            return if ("index.html" in files) BundledWebAssetDecision.Asset("index.html")
            else BundledWebAssetDecision.MissingAsset
        }
        return BundledWebAssetDecision.PassThrough
    }

    private fun isSpaRoute(path: String): Boolean {
        val route = path.trimEnd('/').ifEmpty { "/" }.lowercase(Locale.ROOT)
        if (route in SPA_ROUTES) return true
        if (route.startsWith("/study/") || route.startsWith("/board/")) return true
        return SINGLE_SEGMENT_ROUTES.any { root ->
            route.startsWith("$root/") && route.removePrefix("$root/").let { suffix ->
                suffix.isNotEmpty() && '/' !in suffix
            }
        }
    }

    companion object {
        const val MANIFEST_NAME = "_wgs-bundle.json"
        private val INTERNAL_HOSTS = setOf(AppConfig.PRIMARY_HOST, AppConfig.WWW_HOST)
        private val NETWORK_ROOTS = setOf(
            "/api", "/socket.io", "/uploads", "/upload", "/ipep-img", "/question_image",
        )
        private val ENCODED_SEPARATOR = Regex("%(?:2f|5c|25)", RegexOption.IGNORE_CASE)
        private val SINGLE_SEGMENT_ROUTES = setOf("/multiplayer", "/wrong")
        private val SPA_ROUTES = setOf(
            "/", "/login", "/signup", "/find", "/written", "/practice", "/exam", "/ipep",
            "/cert/ipe", "/cert/ipe/written", "/cert/ipe/written-bank", "/cert/ipe/written-past",
            "/cert/ipe/practical", "/cert/ipe/practical-bank", "/cert/ipe/practical-past",
            "/cert/ipe/practical-three-week", "/multiplayer", "/mypage", "/study", "/wrong",
            "/fortune", "/faq", "/change-pw", "/board", "/terms", "/privacy", "/account-consent",
        )

        /** assets.open의 상대 경로가 지정된 webapp 폴더 밖을 가리키지 못하게 합니다. */
        fun isSafeRelativeAssetPath(path: String): Boolean =
            path.isNotBlank() && !path.startsWith('/') &&
                path.none { it == '\\' || it == '%' || it == '?' || it == '#' || it == ':' || it.code < 0x20 || it.code == 0x7f } &&
                path.split('/').all { it.isNotEmpty() && it != "." && it != ".." }
    }
}
