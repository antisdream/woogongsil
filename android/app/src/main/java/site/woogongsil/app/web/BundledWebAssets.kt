package site.woogongsil.app.web

import android.content.res.AssetManager
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.IOException
import java.util.Locale
import org.json.JSONObject
import site.woogongsil.app.AppConfig

/** debug 전용 assets를 원래 HTTPS 주소의 응답으로 제공하며 API 요청은 그대로 둡니다. */
class BundledWebAssets(private val assets: AssetManager) {
    private data class Manifest(val id: String, val files: Set<String>)

    private val manifest = runCatching {
        val json = assets.open("$ASSET_ROOT/${BundledWebAssetPolicy.MANIFEST_NAME}")
            .bufferedReader(Charsets.UTF_8).use { JSONObject(it.readText()) }
        val id = json.getString("id")
        require(id.matches(Regex("[A-Za-z0-9._-]{1,128}"))) { "번들 ID가 올바르지 않습니다." }
        require(json.getString("origin").trimEnd('/') == AppConfig.START_URL.trimEnd('/')) {
            "번들 origin이 운영 주소와 일치하지 않습니다."
        }
        val list = json.getJSONArray("files")
        val paths = (0 until list.length()).map { list.getString(it) }.toSet()
        require("index.html" in paths && paths.all(BundledWebAssetPolicy::isSafeRelativeAssetPath)) {
            "번들 파일 목록이 올바르지 않습니다."
        }
        Manifest(id, paths)
    }.getOrNull()
    private val policy = BundledWebAssetPolicy(manifest?.files.orEmpty())

    fun intercept(rawUrl: String, method: String, isMainFrame: Boolean): WebResourceResponse? {
        val decision = policy.decide(rawUrl, method, isMainFrame)
        if (decision == BundledWebAssetDecision.PassThrough) return null
        // 활성화된 번들이 파손된 경우 운영 UI로 조용히 바꾸지 않고 오류를 표시합니다.
        if (manifest == null) return errorResponse(503, "Service Unavailable", "앱의 화면 번들을 불러오지 못했습니다.")
        if (decision == BundledWebAssetDecision.MissingAsset) {
            return errorResponse(404, "Not Found", "앱에 포함되지 않은 화면 파일입니다.")
        }
        val path = (decision as BundledWebAssetDecision.Asset).relativePath
        val stream = try {
            assets.open("$ASSET_ROOT/$path", AssetManager.ACCESS_STREAMING)
        } catch (_: IOException) {
            return errorResponse(404, "Not Found", "앱의 화면 파일을 찾지 못했습니다.")
        }
        val (mimeType, encoding) = contentType(path)
        return WebResourceResponse(mimeType, encoding, 200, "OK", responseHeaders(), stream)
    }

    private fun responseHeaders(): Map<String, String> = mapOf(
        "X-Wgs-Web-Bundle" to (manifest?.id ?: "unavailable"),
        "Cache-Control" to "no-store",
        "X-Content-Type-Options" to "nosniff",
        // Bundled pages bypass the HTTP response, so carry the production policy here too.
        "Content-Security-Policy" to listOf(
            "default-src 'self'", "script-src 'self'", "script-src-attr 'none'",
            "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
            "font-src 'self' data:", "media-src 'self' blob:",
            "connect-src 'self' https://woogongsil.site wss://woogongsil.site https://www.woogongsil.site wss://www.woogongsil.site",
            "frame-src 'self'", "object-src 'none'", "base-uri 'self'",
            "form-action 'self'", "frame-ancestors 'none'",
        ).joinToString("; "),
        "X-Frame-Options" to "DENY",
        "Referrer-Policy" to "strict-origin-when-cross-origin",
        "Strict-Transport-Security" to "max-age=300",
    )

    private fun errorResponse(status: Int, reason: String, message: String): WebResourceResponse =
        WebResourceResponse(
            "text/plain", "UTF-8", status, reason, responseHeaders(),
            ByteArrayInputStream(message.toByteArray(Charsets.UTF_8)),
        )

    private fun contentType(path: String): Pair<String, String?> =
        when (path.substringAfterLast('.', "").lowercase(Locale.ROOT)) {
            "html", "htm" -> "text/html" to "UTF-8"
            "js", "mjs" -> "text/javascript" to "UTF-8"
            "css" -> "text/css" to "UTF-8"
            "svg" -> "image/svg+xml" to "UTF-8"
            "json", "map" -> "application/json" to "UTF-8"
            "txt" -> "text/plain" to "UTF-8"
            "wasm" -> "application/wasm" to null
            "png" -> "image/png" to null
            "jpg", "jpeg" -> "image/jpeg" to null
            "gif" -> "image/gif" to null
            "webp" -> "image/webp" to null
            "avif" -> "image/avif" to null
            "ico" -> "image/x-icon" to null
            "woff" -> "font/woff" to null
            "woff2" -> "font/woff2" to null
            "ttf" -> "font/ttf" to null
            "otf" -> "font/otf" to null
            "pdf" -> "application/pdf" to null
            else -> "application/octet-stream" to null
        }

    companion object {
        private const val ASSET_ROOT = "webapp"
    }
}
