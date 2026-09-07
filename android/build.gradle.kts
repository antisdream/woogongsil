// =============================================================================
// [빌드 도구 버전] 2026-08 기준 Android Studio/SDK 환경과 호환되는 버전을
// 고정합니다. 동적 버전(+)을 사용하지 않아 재현 가능한 빌드를 유지합니다.
// =============================================================================
plugins {
    id("com.android.application") version "9.3.0" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.3.21" apply false
}
