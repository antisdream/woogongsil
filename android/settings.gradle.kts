// =============================================================================
// [프로젝트 구성] 우공실 Android 앱에서 사용할 플러그인·라이브러리 저장소와
// 단일 app 모듈을 선언합니다. 기존 WaterCare/WaterBridge 프로젝트와 무관합니다.
// =============================================================================
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "WoogongsilAndroid"
include(":app")
