package site.woogongsil.app.web

import android.app.DownloadManager
import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.MediaStore
import android.util.Base64
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.widget.Toast
import androidx.annotation.RequiresApi
import androidx.core.net.toUri
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import site.woogongsil.app.AppConfig
import java.io.File
import java.io.FileOutputStream
import java.net.URI
import java.util.Locale
import java.util.concurrent.Executors

/**
 * HTTP 다운로드와 웹의 blob 다운로드를 Android 저장소로 안전하게 전달합니다.
 * 저장소 전체 접근 권한은 요청하지 않고, Android 10+에서는 MediaStore를 사용합니다.
 */
object WebDownloadSupport {
    private const val BRIDGE_NAME = "WgsAndroidDownloads"
    private const val BLOB_SAVE_COOLDOWN_MILLIS = 1_500L
    private const val MAX_BLOB_MESSAGE_CHARACTERS = 720 * 1024
    private val ioExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "wgs-download-writer").apply { isDaemon = true }
    }
    private val mainHandler = Handler(Looper.getMainLooper())
    private var lastBlobSaveStartedAt = 0L
    private val allowedOrigins = setOf(
        "https://${AppConfig.PRIMARY_HOST}",
        "https://${AppConfig.WWW_HOST}",
    )

    /** 서버가 직접 제공하는 HTTPS 파일을 시스템 DownloadManager에 위임합니다. */
    fun enqueueHttpDownload(
        context: Context,
        url: String,
        userAgent: String?,
        contentDisposition: String?,
        mimeType: String?,
    ) {
        val uri = runCatching { url.toUri() }.getOrNull()
        if (uri == null || WebNavigationPolicy.decide(url) != NavigationDecision.Internal) {
            notify(context, "허용된 우공실 주소의 파일만 다운로드할 수 있습니다.")
            return
        }

        val fileName = sanitizeFileName(
            URLUtil.guessFileName(url, contentDisposition, mimeType),
        )
        val request = DownloadManager.Request(uri)
            .setTitle(fileName)
            .setDescription("우공실 파일 다운로드")
            .setMimeType(mimeType)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setAllowedOverMetered(true)
            .setAllowedOverRoaming(false)

        // [저장 위치] Android 10+는 사용자가 찾을 수 있는 공용 Downloads를 쓰고,
        // 구형 Android는 별도 저장소 권한 없이 앱 전용 폴더로 제한합니다.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            request.setDestinationInExternalPublicDir(
                Environment.DIRECTORY_DOWNLOADS,
                "Woogongsil/$fileName",
            )
        } else {
            request.setDestinationInExternalFilesDir(
                context,
                Environment.DIRECTORY_DOWNLOADS,
                "Woogongsil/$fileName",
            )
        }

        // [인증 연속성] HttpOnly 쿠키를 노출하지 않고 DownloadManager 요청 헤더로만 전달합니다.
        CookieManager.getInstance().getCookie(url)?.takeIf { it.isNotBlank() }?.let {
            request.addRequestHeader("Cookie", it)
        }
        userAgent?.takeIf { it.isNotBlank() }?.let {
            request.addRequestHeader("User-Agent", it)
        }

        runCatching {
            val manager = context.getSystemService(DownloadManager::class.java)
            manager.enqueue(request)
        }.onSuccess {
            notify(context, "다운로드를 시작했습니다: $fileName")
        }.onFailure {
            notify(context, "다운로드를 시작하지 못했습니다.")
        }
    }

    /**
     * same-origin 메인 프레임에만 노출되는 WebMessage 채널을 설치합니다.
     * addJavascriptInterface를 사용하지 않아 임의 하위 프레임의 네이티브 호출을 방지합니다.
     */
    fun installBlobMessageBridge(webView: android.webkit.WebView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return

        WebViewCompat.addWebMessageListener(
            webView,
            BRIDGE_NAME,
            allowedOrigins,
        ) { _, message, _, isMainFrame, _ ->
            if (!isMainFrame || message.type != WebMessageCompat.TYPE_STRING) return@addWebMessageListener
            if (!isStudyPage(webView.url)) return@addWebMessageListener
            handleBlobMessage(webView.context.applicationContext, message.data.orEmpty())
        }
    }

    /** 학습노트의 임시 blob 링크 클릭을 감지해 제한된 크기의 Markdown을 전달합니다. */
    fun injectBlobDownloadHook(webView: android.webkit.WebView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return

        webView.evaluateJavascript(blobHookScript, null)
    }

    private fun handleBlobMessage(context: Context, rawMessage: String) {
        // [선검사/빈도 제한] 거대한 JSON/Base64를 파싱하기 전에 문자 수와 사용자
        // 연속 호출을 차단해 UI thread와 공용 Downloads 남용을 줄입니다.
        if (rawMessage.length > MAX_BLOB_MESSAGE_CHARACTERS) {
            notify(context, "앱에서 저장하기에는 파일이 너무 큽니다.")
            return
        }
        val payload = runCatching { JSONObject(rawMessage) }.getOrNull() ?: return
        when (payload.optString("type")) {
            "blob-download" -> {
                if (!payload.optBoolean("userGesture", false)) {
                    notify(context, "다운로드 버튼을 직접 눌러 주세요.")
                    return
                }
                if (!acquireBlobSaveSlot()) {
                    notify(context, "잠시 후 다시 다운로드해 주세요.")
                    return
                }
                ioExecutor.execute { saveBlobPayload(context, payload) }
            }
            "blob-too-large" -> notify(context, "앱에서 저장하기에는 파일이 너무 큽니다.")
            "blob-user-gesture-required" -> notify(context, "다운로드 버튼을 직접 눌러 주세요.")
            "blob-download-failed" -> notify(context, "다운로드 데이터를 읽지 못했습니다.")
        }
    }

    private fun saveBlobPayload(context: Context, payload: JSONObject) {
        val fileName = sanitizeFileName(payload.optString("name", "woogongsil-note.md"))
        if (!fileName.lowercase(Locale.ROOT).endsWith(".md")) {
            notify(context, "Markdown(.md) 파일만 저장할 수 있습니다.")
            return
        }
        val mimeType = payload.optString("mime", "text/markdown")
            .substringBefore(';')
            .trim()
            .lowercase(Locale.ROOT)
            .ifBlank { "text/markdown" }
        if (mimeType !in setOf("text/markdown", "text/plain", "application/octet-stream")) {
            notify(context, "Markdown 형식이 아닌 다운로드를 차단했습니다.")
            return
        }
        val dataUrl = payload.optString("dataUrl")
        val dataHeader = dataUrl.substringBefore(',', missingDelimiterValue = "")
        val headerMimeType = dataHeader
            .substringAfter("data:", missingDelimiterValue = "")
            .substringBefore(';')
            .lowercase(Locale.ROOT)
        if (!dataHeader.startsWith("data:", ignoreCase = true) ||
            !dataHeader.endsWith(";base64", ignoreCase = true) ||
            headerMimeType !in setOf("text/markdown", "text/plain", "application/octet-stream")
        ) {
            notify(context, "다운로드 데이터 형식을 검증하지 못했습니다.")
            return
        }
        val encoded = dataUrl.substringAfter(',', missingDelimiterValue = "")
        val maxEncodedLength = ((AppConfig.MAX_BLOB_DOWNLOAD_BYTES + 2) / 3) * 4 + 8
        if (encoded.isBlank() || encoded.length > maxEncodedLength) {
            notify(context, "다운로드 데이터가 비어 있습니다.")
            return
        }

        val bytes = runCatching { Base64.decode(encoded, Base64.DEFAULT) }.getOrNull()
        if (bytes == null || bytes.size > AppConfig.MAX_BLOB_DOWNLOAD_BYTES) {
            notify(context, "다운로드 데이터를 검증하지 못했습니다.")
            return
        }

        val saved = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            saveWithMediaStore(context, fileName, mimeType, bytes)
        } else {
            saveToAppDownloads(context, fileName, bytes)
        }
        notify(
            context,
            if (saved) "다운로드 폴더에 저장했습니다: $fileName" else "파일 저장에 실패했습니다.",
        )
    }

    /** Android 10+ 공용 Downloads/Woogongsil 폴더에 권한 없이 저장합니다. */
    @RequiresApi(Build.VERSION_CODES.Q)
    private fun saveWithMediaStore(
        context: Context,
        fileName: String,
        mimeType: String,
        bytes: ByteArray,
    ): Boolean {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, fileName)
            put(MediaStore.Downloads.MIME_TYPE, mimeType)
            put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/Woogongsil")
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return false

        return runCatching {
            resolver.openOutputStream(uri, "w")!!.use { it.write(bytes) }
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            true
        }.getOrElse {
            resolver.delete(uri, null, null)
            false
        }
    }

    /** Android 8~9에서는 별도 저장소 권한 없이 앱 전용 Download 폴더에 저장합니다. */
    private fun saveToAppDownloads(context: Context, fileName: String, bytes: ByteArray): Boolean {
        val base = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: return false
        val directory = File(base, "Woogongsil")
        if (!directory.exists() && !directory.mkdirs()) return false

        return runCatching {
            FileOutputStream(File(directory, fileName)).use { it.write(bytes) }
            true
        }.getOrDefault(false)
    }

    /** 경로문자·제어문자를 제거해 다운로드 폴더 밖으로 벗어나는 이름을 차단합니다. */
    private fun sanitizeFileName(rawName: String): String = rawName
        .replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_")
        .trim()
        .take(120)
        .ifBlank { "woogongsil-download" }

    private fun notify(context: Context, message: String) {
        mainHandler.post { Toast.makeText(context, message, Toast.LENGTH_LONG).show() }
    }

    /** WebMessage는 현재 main-frame이 실제 /study 화면일 때만 파일 저장을 허용합니다. */
    private fun isStudyPage(rawUrl: String?): Boolean {
        val url = rawUrl ?: return false
        if (WebNavigationPolicy.decide(url) != NavigationDecision.Internal) return false
        val path = runCatching { URI(url).path.orEmpty() }.getOrDefault("")
        return path == "/study" || path.startsWith("/study/")
    }

    @Synchronized
    private fun acquireBlobSaveSlot(): Boolean {
        val now = SystemClock.elapsedRealtime()
        if (now - lastBlobSaveStartedAt < BLOB_SAVE_COOLDOWN_MILLIS) return false
        lastBlobSaveStartedAt = now
        return true
    }

    private val blobHookScript = """
        (() => {
          if (window.__wgsAndroidBlobDownloadInstalled || !window.$BRIDGE_NAME) return;
          window.__wgsAndroidBlobDownloadInstalled = true;
          const originalClick = HTMLAnchorElement.prototype.click;
          HTMLAnchorElement.prototype.click = function(...args) {
            const href = String(this.href || '');
            if (!href.startsWith('blob:')) return originalClick.apply(this, args);
            const userGesture = Boolean(navigator.userActivation && navigator.userActivation.isActive);
            if (!userGesture) {
              window.$BRIDGE_NAME.postMessage(JSON.stringify({ type: 'blob-user-gesture-required' }));
              return;
            }
            fetch(href)
              .then(response => response.blob())
              .then(blob => {
                if (blob.size > ${AppConfig.MAX_BLOB_DOWNLOAD_BYTES}) {
                  window.$BRIDGE_NAME.postMessage(JSON.stringify({ type: 'blob-too-large' }));
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => window.$BRIDGE_NAME.postMessage(JSON.stringify({
                  type: 'blob-download',
                  userGesture: true,
                  name: this.download || 'woogongsil-note.md',
                  mime: blob.type || 'text/markdown',
                  dataUrl: String(reader.result || '')
                }));
                reader.readAsDataURL(blob);
              })
              .catch(() => window.$BRIDGE_NAME.postMessage(JSON.stringify({ type: 'blob-download-failed' })));
          };
        })();
    """.trimIndent()
}
