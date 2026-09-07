# 우공실 Android

우공실 웹을 WebView로 연결하는 Android 앱입니다. Compose 양문 오프닝과 웹 화면을 함께 준비하고, 페이드아웃을 포함한 앱 오프닝만 약 2.95초 동안 재생하며 본문으로 전환합니다. 기기의 전역 애니메이션 배율이 0이어도 이 오프닝은 같은 속도로 재생하며 전역 설정은 변경하지 않습니다. 화면 회전 등 Activity 재생성 때는 오프닝을 반복하지 않습니다. 기본 debug 앱은 https://woogongsil.site 를 불러오며, 아래의 선택 빌드로 현재 저장소의 웹 화면을 APK에 포함할 수 있습니다.

## 개발 환경

- Gradle Wrapper 9.5.0을 사용합니다. 배포 ZIP의 SHA-256은 wrapper 설정에 고정되어 있습니다.
- Gradle daemon은 JDK 25를 요구합니다. 기준은 gradle/gradle-daemon-jvm.properties의 toolchainVersion입니다. IDE의 Gradle JDK 또는 로컬 JAVA_HOME을 JDK 25로 준비합니다.
- Java 바이트코드 대상은 17입니다. 이 값과 Gradle을 실행하는 JDK 25는 역할이 다릅니다.
- Android SDK Platform 37과 SDK Build Tools를 준비합니다. compileSdk는 37, targetSdk는 36, minSdk는 26입니다.
- SDK 위치는 자신의 ANDROID_HOME 또는 Android Studio가 만든 로컬 local.properties의 sdk.dir로 지정합니다. 개인 SDK/JDK 절대 경로와 local.properties는 커밋하지 않습니다.
- 플러그인과 라이브러리 버전은 Gradle 파일에 기록되어 있습니다. 첫 빌드는 Gradle과 Maven 저장소의 의존성을 내려받을 네트워크 연결이 필요합니다.

## 기본 debug 빌드

저장소 루트에서 Windows PowerShell로 실행합니다.

~~~powershell
Set-Location android
.\gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
~~~

macOS/Linux에서는 android 디렉터리에서 다음 명령을 사용합니다.

~~~sh
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
~~~

생성 APK는 android/app/build/outputs/apk/debug/app-debug.apk이며 패키지는 site.woogongsil.app.debug입니다. 기본 debug 빌드에는 내부 배포용 서명 키가 필요하지 않습니다. 실행하면 운영 HTTPS 웹과 API에 연결됩니다.

## 현재 웹 화면을 포함한 Windows debug 빌드

PowerShell 5.1 이상과 저장소 frontend의 의존성에 맞는 Node.js/npm이 필요합니다. 저장소 루트의 frontend에서 먼저 의존성을 설치합니다.

~~~powershell
Set-Location frontend
npm ci
Set-Location ..\android
~~~

이 선택 스크립트는 SDK/APK 검사용 JDK 17과 Gradle 실행용 JDK 25를 별도로 사용합니다. 아래의 WGS_JDK17_HOME은 자신이 준비한 JDK 17 위치를 담는 예시 환경 변수 이름이며, JAVA_HOME은 JDK 25, ANDROID_HOME은 자신의 SDK 위치여야 합니다. 이 세 변수의 값은 저장소에 기록하지 않습니다.

~~~powershell
.\scripts\Build-LocalWebDebug.ps1 -JdkRoot $env:WGS_JDK17_HOME -GradleJdkRoot $env:JAVA_HOME -AndroidSdkRoot $env:ANDROID_HOME
~~~

기본 웹 소스 경로는 android의 형제 디렉터리인 frontend입니다. 다른 체크아웃을 사용할 때만 -FrontendRoot로 명시합니다. 스크립트는 새 웹 번들을 android/build/local-web 아래에 생성하고, 해당 번들을 포함한 debug APK의 단위 테스트·Lint·조립을 실행합니다. 결과 디렉터리의 result.json과 APK 옆 .sha256 파일에서 번들 ID와 산출물을 확인할 수 있습니다.

이 빌드는 웹 화면 파일만 APK에 포함합니다. API와 인증은 기존 HTTPS 서버에 연결되므로 모든 기능의 오프라인 동작을 의미하지 않습니다. 스크립트는 기기 설치나 서버 배포를 수행하지 않습니다.

## 기기 검증

빌드와 단위 테스트 통과만으로 실제 기기 동작까지 검증되지는 않습니다. 자신이 선택한 에뮬레이터 또는 테스트 기기를 연결한 뒤, android 디렉터리에서 별도로 실행합니다.

~~~powershell
.\gradlew.bat :app:connectedDebugAndroidTest
~~~

이 명령은 연결된 기기에 테스트 APK를 설치하고 실행합니다. 여러 기기가 연결되어 있다면 실행 대상을 먼저 정리해야 합니다. 웹을 포함한 APK의 사용성은 해당 APK를 테스트 기기에서 실행해 오프닝, 화면 전환, 입력, 뒤로가기 등을 별도로 확인합니다.

## 서명과 로컬 파일

내부 배포 서명 입력은 WGS_INTERNAL_KEYSTORE, WGS_INTERNAL_STORE_PASSWORD, WGS_INTERNAL_KEY_ALIAS, WGS_INTERNAL_KEY_PASSWORD 환경 변수로 외부에서 전달하도록 구성되어 있습니다. 사용할 때는 네 값을 모두 준비해야 하며, 일부만 설정하면 빌드 구성이 중단됩니다. 실제 키 파일, 암호, 기기 식별자, 내부 설치·배포 도구는 이 디렉터리에 포함하지 않습니다. release 배포에 필요한 서명과 스토어 준비도 별도 작업입니다.

.gitignore는 로컬 SDK 설정, IDE/Gradle 캐시, 빌드 결과, APK, 서명 자료, 개인 설정과 테스트 산출물을 제외합니다. 이 소스는 동일한 기능을 다시 빌드하기 위한 구성이며, 서로 다른 환경에서 APK 파일의 해시까지 동일함을 보장하지 않습니다.
