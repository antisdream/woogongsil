package site.woogongsil.app

/**
 * 앱과 운영 웹 사이의 변경 가능한 연결값을 한곳에서 관리합니다.
 * 실행 코드에 URL 문자열이 흩어지지 않게 해 향후 도메인 변경 검증을 단순화합니다.
 */
object AppConfig {
    const val START_URL = "https://woogongsil.site/"
    const val PRIMARY_HOST = "woogongsil.site"
    const val WWW_HOST = "www.woogongsil.site"
    const val USER_AGENT_SUFFIX = " WoogongsilAndroid/0.1"

    /** Blob 기반 Markdown 노트가 WebView/앱 메모리를 과도하게 사용하지 않도록 제한합니다. */
    const val MAX_BLOB_DOWNLOAD_BYTES = 512 * 1024

    /** Activity 상태 Bundle 전체의 1MB Binder 한도에 여유를 두는 WebView 이력 상한입니다. */
    const val MAX_WEBVIEW_STATE_BYTES = 256 * 1024

    /** 외부 문서 선택기가 한 번에 앱으로 넘길 수 있는 파일 개수입니다. */
    const val MAX_UPLOAD_FILES = 10

    /** 크기가 알려진 업로드 파일 하나의 최대 허용값입니다. */
    const val MAX_UPLOAD_FILE_BYTES = 25L * 1024 * 1024
}
