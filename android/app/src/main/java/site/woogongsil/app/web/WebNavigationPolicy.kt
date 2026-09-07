package site.woogongsil.app.web

import site.woogongsil.app.AppConfig
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.Locale

/** WebView가 요청 URL을 어떻게 처리할지 나타내는 명시적 결과입니다. */
sealed interface NavigationDecision {
    data object Internal : NavigationDecision
    data object External : NavigationDecision
    data class Blocked(val reason: String) : NavigationDecision
}

/**
 * 네트워크 실행과 분리된 URL 판단기입니다.
 * 순수 JVM 코드라 기기 없이도 관리자 경로 우회와 위험 스킴을 단위 테스트할 수 있습니다.
 */
object WebNavigationPolicy {
    private val internalHosts = setOf(AppConfig.PRIMARY_HOST, AppConfig.WWW_HOST)
    private val blockedPathRoots = listOf("/admin", "/manage", "/api/admin")
    private val externalSchemes = setOf("mailto", "tel")

    fun decide(rawUrl: String, allowAboutBlank: Boolean = false): NavigationDecision {
        val trimmed = rawUrl.trim()
        if (trimmed.isEmpty() || trimmed.length > 4_096 || trimmed.contains('\n') || trimmed.contains('\r')) {
            return NavigationDecision.Blocked("비정상 URL")
        }

        if (allowAboutBlank && trimmed.equals("about:blank", ignoreCase = true)) {
            return NavigationDecision.Internal
        }

        val uri = runCatching { URI(trimmed) }.getOrNull()
            ?: return NavigationDecision.Blocked("해석할 수 없는 URL")
        val scheme = uri.scheme?.lowercase(Locale.ROOT)
            ?: return NavigationDecision.Blocked("스킴 없는 URL")

        if (scheme in externalSchemes) {
            return NavigationDecision.External
        }
        if (scheme != "https") {
            return NavigationDecision.Blocked("HTTPS가 아닌 탐색")
        }
        if (uri.userInfo != null) {
            return NavigationDecision.Blocked("사용자 정보가 포함된 URL")
        }

        val host = uri.host?.trimEnd('.')?.lowercase(Locale.ROOT)
            ?: return NavigationDecision.Blocked("호스트 없는 URL")
        if (host !in internalHosts) {
            return NavigationDecision.External
        }
        if (uri.port != -1 && uri.port != 443) {
            return NavigationDecision.Blocked("허용되지 않은 포트")
        }

        val normalizedPath = normalizePath(uri.rawPath)
            ?: return NavigationDecision.Blocked("비정상 경로")
        if (blockedPathRoots.any { root -> normalizedPath == root || normalizedPath.startsWith("$root/") }) {
            return NavigationDecision.Blocked("관리자 전용 경로")
        }

        return NavigationDecision.Internal
    }

    /**
     * 퍼센트 중첩 인코딩, dot-segment, 중복/역슬래시를 canonical path로 바꿉니다.
     * 제어문자나 세 번을 넘는 중첩 인코딩은 서버별 해석 차이가 커서 거부합니다.
     */
    private fun normalizePath(rawPath: String?): String? {
        var candidate = rawPath.orEmpty().ifBlank { "/" }

        repeat(MAX_DECODE_PASSES) {
            val decoded = runCatching {
                @Suppress("DEPRECATION")
                URLDecoder.decode(candidate.replace("+", "%2B"), StandardCharsets.UTF_8.name())
            }.getOrNull() ?: return null
            candidate = decoded
            if (decoded.any { character -> character.code < 0x20 || character.code == 0x7f }) {
                return null
            }
            if (!containsEncodedOctet(decoded)) return canonicalizeSegments(decoded)
        }

        // 세 번 뒤에도 %xx가 남으면 서버/프록시가 추가 해석할 수 있어 차단합니다.
        return if (containsEncodedOctet(candidate)) null else canonicalizeSegments(candidate)
    }

    /** decoded path의 .·.. segment를 제거하고 루트 밖 이동을 루트로 고정합니다. */
    private fun canonicalizeSegments(path: String): String {
        val segments = ArrayDeque<String>()
        path.replace('\\', '/')
            .split('/')
            .forEach { segment ->
                when (segment) {
                    "", "." -> Unit
                    ".." -> if (segments.isNotEmpty()) segments.removeLast()
                    else -> segments.addLast(segment)
                }
            }

        val canonical = "/" + segments.joinToString("/")
        return canonical
            .lowercase(Locale.ROOT)
            .let { if (it.length > 1) it.trimEnd('/') else it }
    }

    private fun containsEncodedOctet(value: String): Boolean = ENCODED_OCTET.containsMatchIn(value)

    private const val MAX_DECODE_PASSES = 3
    private val ENCODED_OCTET = Regex("%[0-9a-fA-F]{2}")
}
