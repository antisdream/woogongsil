plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

// [공통 릴리즈 버전] 웹과 Android는 저장소 VERSION을 함께 사용합니다.
// minor/patch는 0..99로 제한하여 versionCode가 서로 겹치지 않게 합니다.
val releaseVersion = rootProject.file("../VERSION").readText(Charsets.UTF_8).trim()
val versionComponents = Regex("(0|[1-9]\\d*)\\.(0|[1-9]\\d?)\\.(0|[1-9]\\d?)")
    .matchEntire(releaseVersion)?.groupValues?.drop(1)
    ?: error("VERSION은 major.minor.patch 형식이고 minor/patch는 0..99여야 합니다.")
val versionMajor = versionComponents[0].toIntOrNull()
    ?: error("VERSION major가 Android 버전 범위를 벗어났습니다.")
val releaseVersionCode = versionMajor.toLong() * 10000 +
    versionComponents[1].toLong() * 100 + versionComponents[2].toLong()
require(releaseVersionCode in 1..2100000000L) { "Android versionCode 범위를 벗어났습니다." }

// [기기 UI 테스트] 명시적으로 전달한 웹 빌드만 Debug APK에 포함합니다.
// 기본 Debug와 Internal/Release는 계속 운영 웹을 불러옵니다.
val localWebAssetsPath = providers.gradleProperty("wgsLocalWebAssetsDir").orNull
val hasLocalWebBundle = !localWebAssetsPath.isNullOrBlank()
val localWebAssetsDirectory = localWebAssetsPath?.let { file(it) }
if (hasLocalWebBundle) {
    val localWebRoot = requireNotNull(localWebAssetsDirectory)
    require(localWebRoot.resolve("webapp/index.html").isFile) {
        "로컬 웹 번들의 index.html이 없습니다. Build-LocalWebDebug.ps1을 사용하세요."
    }
    require(localWebRoot.resolve("webapp/_wgs-bundle.json").isFile) {
        "로컬 웹 번들의 파일 목록이 없습니다."
    }
}

// =============================================================================
// [내부 배포 서명 입력] 서명 파일과 암호는 소스에 기록하지 않습니다.
// 외부에서 현재 프로세스에 주입한 서명 환경 변수가 모두 있을 때만
// internal APK를 서명하며, Android Studio의 일반 동기화에는 비밀값이 필요 없습니다.
// =============================================================================
val internalKeystorePath = providers.environmentVariable("WGS_INTERNAL_KEYSTORE").orNull
val internalStorePassword = providers.environmentVariable("WGS_INTERNAL_STORE_PASSWORD").orNull
val internalKeyAlias = providers.environmentVariable("WGS_INTERNAL_KEY_ALIAS").orNull
val internalKeyPassword = providers.environmentVariable("WGS_INTERNAL_KEY_PASSWORD").orNull
val hasInternalSigning = listOf(
    internalKeystorePath,
    internalStorePassword,
    internalKeyAlias,
    internalKeyPassword,
).all { !it.isNullOrBlank() }

// =============================================================================
// [Android 앱 식별/호환성] 최신 Compose가 요구하는 API 37로 컴파일하되,
// 런타임 정책은 targetSdk 36으로 고정합니다. debug는 .debug 접미사를
// 붙여 향후 배포 앱과 동시에 설치할 수 있습니다.
// =============================================================================
android {
    namespace = "site.woogongsil.app"
    compileSdk = 37

    defaultConfig {
        applicationId = "site.woogongsil.app"
        minSdk = 26
        targetSdk = 36
        versionCode = releaseVersionCode.toInt()
        versionName = releaseVersion
        manifestPlaceholders["appLabel"] = "우공실"
        buildConfigField("boolean", "LOCAL_WEB_BUNDLE", "false")

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables.useSupportLibrary = true
    }

    // =========================================================================
    // [서명 구성] 네 가지 입력이 모두 있을 때만 internal signingConfig를 만듭니다.
    // 일부만 전달된 상태에서 잘못된 APK가 생성되지 않도록 즉시 중단합니다.
    // =========================================================================
    if (!hasInternalSigning && listOf(
            internalKeystorePath,
            internalStorePassword,
            internalKeyAlias,
            internalKeyPassword,
        ).any { !it.isNullOrBlank() }
    ) {
        error("우공실 internal 서명 환경 변수가 일부만 설정되었습니다.")
    }

    signingConfigs {
        if (hasInternalSigning) {
            create("internal") {
                storeFile = file(requireNotNull(internalKeystorePath))
                storePassword = requireNotNull(internalStorePassword)
                keyAlias = requireNotNull(internalKeyAlias)
                keyPassword = requireNotNull(internalKeyPassword)
            }
        }
    }

    // =========================================================================
    // [빌드 유형] 개발자 확인용 debug, 파일 전달용 internal, 향후 스토어용
    // release를 서로 다른 패키지/서명 경계로 분리합니다.
    // =========================================================================
    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            isDebuggable = true
            manifestPlaceholders["appLabel"] = "우공실 Dev"
            if (hasLocalWebBundle) {
                versionNameSuffix = "-mobile-ui"
                manifestPlaceholders["appLabel"] = "우공실 UI 테스트"
                buildConfigField("boolean", "LOCAL_WEB_BUNDLE", "true")
            }
        }

        create("internal") {
            applicationIdSuffix = ".internal"
            versionNameSuffix = "-internal"
            isDebuggable = false
            isMinifyEnabled = false
            manifestPlaceholders["appLabel"] = "우공실 Internal"
            if (hasInternalSigning) {
                signingConfig = signingConfigs.getByName("internal")
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }

        release {
            isDebuggable = false
            isMinifyEnabled = false
            manifestPlaceholders["appLabel"] = "우공실"
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    // =========================================================================
    // [언어·UI] Java/Kotlin 바이트코드는 17로 맞추고 Compose/BuildConfig를
    // 활성화합니다. Gradle daemon은 별도 기준 파일의 JDK 25를 사용합니다.
    // =========================================================================
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    if (hasLocalWebBundle) {
        sourceSets.getByName("debug").assets.srcDir(localWebAssetsDirectory!!)
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

// =============================================================================
// [앱 의존성] Compose BOM으로 UI 라이브러리 버전을 일치시키며,
// 단위 테스트와 연결 기기 UI 테스트 도구를 함께 구성합니다.
// =============================================================================
dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.08.00")

    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.core:core-ktx:1.18.0")
    implementation("androidx.core:core-splashscreen:1.2.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.10.0")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.webkit:webkit:1.17.0")

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")

    testImplementation("junit:junit:4.13.2")

    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")

    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
