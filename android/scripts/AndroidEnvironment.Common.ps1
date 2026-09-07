#requires -Version 5.1

<#
.SYNOPSIS
    우공실 Android 검증 스크립트가 공통으로 사용하는 안전한 환경 설정 함수입니다.

.DESCRIPTION
    JDK 17과 Android SDK를 현재 PowerShell 프로세스에만 설정합니다.
    사용자/시스템 환경 변수, Android Studio 설정, 다른 Android 프로젝트는 변경하지 않습니다.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# =============================================================================
# [프로젝트 경계] scripts 폴더의 부모만 우공실 프로젝트로 인정합니다.
# 다른 Android 프로젝트 경로를 잘못 넘겨 실행하는 상황을 초기에 차단합니다.
# =============================================================================
function Get-WgsProjectRoot {
    [CmdletBinding()]
    param()

    $projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
    $requiredFiles = @(
        "settings.gradle.kts",
        "build.gradle.kts",
        "gradlew.bat",
        "app\build.gradle.kts",
        "app\src\main\AndroidManifest.xml"
    )

    foreach ($relativePath in $requiredFiles) {
        $candidate = Join-Path $projectRoot $relativePath
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            throw "우공실 프로젝트 필수 파일이 없습니다: $relativePath"
        }
    }

    $settingsText = Get-Content -LiteralPath (Join-Path $projectRoot "settings.gradle.kts") -Raw
    if ($settingsText -notmatch 'rootProject\.name\s*=\s*"WoogongsilAndroid"') {
        throw "프로젝트명이 WoogongsilAndroid가 아니므로 안전을 위해 중단합니다."
    }

    return $projectRoot
}

# =============================================================================
# [JDK 17 탐색] 명시 경로, 현재 JAVA_HOME, 사용자 Microsoft JDK 순으로 찾고
# 실제 java -version의 주 버전이 정확히 17인 경우에만 선택합니다.
# =============================================================================
function Resolve-WgsJdk17 {
    [CmdletBinding()]
    param(
        [string]$PreferredRoot
    )

    $candidateRoots = @()
    if (-not [string]::IsNullOrWhiteSpace($PreferredRoot)) {
        $candidateRoots += $PreferredRoot
    }
    if (-not [string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
        $candidateRoots += $env:JAVA_HOME
    }


    $microsoftProgramsRoot = Join-Path $env:LOCALAPPDATA "Programs\Microsoft"
    if (Test-Path -LiteralPath $microsoftProgramsRoot -PathType Container) {
        $candidateRoots += Get-ChildItem -LiteralPath $microsoftProgramsRoot -Directory -Filter "jdk-17*" -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            Select-Object -ExpandProperty FullName
    }

    foreach ($candidateRoot in ($candidateRoots | Where-Object { $_ } | Select-Object -Unique)) {
        $normalizedRoot = [System.IO.Path]::GetFullPath($candidateRoot)
        $javaExe = Join-Path $normalizedRoot "bin\java.exe"
        if (-not (Test-Path -LiteralPath $javaExe -PathType Leaf)) {
            continue
        }

        # Windows PowerShell 5.1은 정상적인 java -version의 stderr도 예외처럼 취급할 수 있어
        # 이 네이티브 호출 구간에서만 비종료 오류로 수집하고 실제 종료 코드를 판정합니다.
        $previousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            $versionOutput = @(& $javaExe -version 2>&1)
            $versionExitCode = $LASTEXITCODE
        }
        finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        $versionText = ($versionOutput | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
        if ($versionExitCode -eq 0 -and $versionText -match '(?m)^(?:openjdk|java) version "?17(?:\.|"|\s)') {
            return [pscustomobject]@{
                Root        = $normalizedRoot
                JavaExe     = $javaExe
                VersionLine = ($versionText -split "`r?`n")[0]
            }
        }
    }

    throw "사용 가능한 JDK 17을 찾지 못했습니다. -JdkRoot 매개변수로 JDK 17 경로를 지정하세요."
}

# =============================================================================
# [Android SDK 탐색] 명시 경로와 표준 사용자 SDK 경로만 검사합니다.
# adb와 SDK 디렉터리가 모두 있어야 유효한 SDK로 인정합니다.
# =============================================================================
function Resolve-WgsAndroidSdk {
    [CmdletBinding()]
    param(
        [string]$PreferredRoot
    )

    $candidateRoots = @()
    if (-not [string]::IsNullOrWhiteSpace($PreferredRoot)) {
        $candidateRoots += $PreferredRoot
    }
    if (-not [string]::IsNullOrWhiteSpace($env:ANDROID_SDK_ROOT)) {
        $candidateRoots += $env:ANDROID_SDK_ROOT
    }
    if (-not [string]::IsNullOrWhiteSpace($env:ANDROID_HOME)) {
        $candidateRoots += $env:ANDROID_HOME
    }
    $candidateRoots += (Join-Path $env:LOCALAPPDATA "Android\Sdk")

    foreach ($candidateRoot in ($candidateRoots | Where-Object { $_ } | Select-Object -Unique)) {
        $normalizedRoot = [System.IO.Path]::GetFullPath($candidateRoot)
        $adbExe = Join-Path $normalizedRoot "platform-tools\adb.exe"
        $platformsRoot = Join-Path $normalizedRoot "platforms"
        $buildToolsRoot = Join-Path $normalizedRoot "build-tools"

        if (
            (Test-Path -LiteralPath $adbExe -PathType Leaf) -and
            (Test-Path -LiteralPath $platformsRoot -PathType Container) -and
            (Test-Path -LiteralPath $buildToolsRoot -PathType Container)
        ) {
            return [pscustomobject]@{
                Root           = $normalizedRoot
                AdbExe         = $adbExe
                PlatformsRoot  = $platformsRoot
                BuildToolsRoot = $buildToolsRoot
            }
        }
    }

    throw "사용 가능한 Android SDK를 찾지 못했습니다. -AndroidSdkRoot 매개변수로 SDK 경로를 지정하세요."
}

# =============================================================================
# [프로세스 전용 환경 설정] 영구 환경 변수는 수정하지 않습니다.
# 비밀값이나 전체 PATH는 출력하지 않고 검증에 필요한 도구 경로만 반환합니다.
# =============================================================================
function Set-WgsAndroidEnvironment {
    [CmdletBinding()]
    param(
        [string]$JdkRoot,
        [string]$AndroidSdkRoot
    )

    $jdk = Resolve-WgsJdk17 -PreferredRoot $JdkRoot
    $sdk = Resolve-WgsAndroidSdk -PreferredRoot $AndroidSdkRoot

    $env:JAVA_HOME = $jdk.Root
    $env:ANDROID_HOME = $sdk.Root
    $env:ANDROID_SDK_ROOT = $sdk.Root

    $requiredPathEntries = @(
        (Join-Path $jdk.Root "bin"),
        (Join-Path $sdk.Root "platform-tools"),
        (Join-Path $sdk.Root "cmdline-tools\latest\bin")
    )
    $currentPathEntries = @([Environment]::GetEnvironmentVariable("Path", "Process") -split ";")
    $env:Path = (($requiredPathEntries + $currentPathEntries) |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        Select-Object -Unique) -join ";"

    Write-Host "[환경] JDK: $($jdk.VersionLine)"
    Write-Host "[환경] JAVA_HOME: $($jdk.Root)"
    Write-Host "[환경] ANDROID_SDK_ROOT: $($sdk.Root)"

    return [pscustomobject]@{
        JdkRoot         = $jdk.Root
        JavaExe        = $jdk.JavaExe
        JavaVersion    = $jdk.VersionLine
        AndroidSdkRoot = $sdk.Root
        AdbExe         = $sdk.AdbExe
        PlatformsRoot  = $sdk.PlatformsRoot
        BuildToolsRoot = $sdk.BuildToolsRoot
    }
}

# =============================================================================
# [앱 구성 해석] applicationId, debug 접미사, compileSdk, 런처 Activity를
# Gradle/Manifest 원본에서 읽어 하드코딩 불일치로 인한 오설치를 방지합니다.
# =============================================================================
function Get-WgsAppConfiguration {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$ProjectRoot
    )

    $appBuildPath = Join-Path $ProjectRoot "app\build.gradle.kts"
    $manifestPath = Join-Path $ProjectRoot "app\src\main\AndroidManifest.xml"
    $appBuildText = Get-Content -LiteralPath $appBuildPath -Raw

    if ($appBuildText -notmatch 'namespace\s*=\s*"([^"]+)"') {
        throw "app namespace를 읽을 수 없습니다."
    }
    $namespace = $Matches[1]

    if ($appBuildText -notmatch 'applicationId\s*=\s*"([^"]+)"') {
        throw "applicationId를 읽을 수 없습니다."
    }
    $applicationId = $Matches[1]

    if ($appBuildText -notmatch 'compileSdk\s*=\s*(\d+)') {
        throw "compileSdk를 읽을 수 없습니다."
    }
    $compileSdk = [int]$Matches[1]

    $debugSuffix = ""
    if ($appBuildText -match 'applicationIdSuffix\s*=\s*"([^"]+)"') {
        $debugSuffix = $Matches[1]
    }

    [xml]$manifest = Get-Content -LiteralPath $manifestPath -Raw
    $namespaceManager = [System.Xml.XmlNamespaceManager]::new($manifest.NameTable)
    $namespaceManager.AddNamespace("android", "http://schemas.android.com/apk/res/android")
    $launcherNode = $manifest.SelectSingleNode(
        '/manifest/application/activity[intent-filter/action[@android:name="android.intent.action.MAIN"]]',
        $namespaceManager
    )
    if ($null -eq $launcherNode) {
        throw "MAIN 런처 Activity를 찾을 수 없습니다."
    }

    $manifestActivityName = $launcherNode.GetAttribute(
        "name",
        "http://schemas.android.com/apk/res/android"
    )
    if ([string]::IsNullOrWhiteSpace($manifestActivityName)) {
        throw "런처 Activity 이름이 비어 있습니다."
    }

    if ($manifestActivityName.StartsWith(".")) {
        $activityClass = "$namespace$manifestActivityName"
    }
    elseif ($manifestActivityName.Contains(".")) {
        $activityClass = $manifestActivityName
    }
    else {
        $activityClass = "$namespace.$manifestActivityName"
    }

    return [pscustomobject]@{
        Namespace          = $namespace
        ApplicationId      = $applicationId
        DebugApplicationId = "$applicationId$debugSuffix"
        InternalApplicationId = "$applicationId.internal"
        CompileSdk         = $compileSdk
        LauncherActivity   = $activityClass
        DebugComponent     = "$applicationId$debugSuffix/$activityClass"
        InternalComponent  = "$applicationId.internal/$activityClass"
    }
}

# =============================================================================
# [SDK 구성 검증] 프로젝트 compileSdk의 android.jar와 APK 검증 도구가
# 모두 존재해야 이후 단계로 진행합니다.
# =============================================================================
function Get-WgsBuildToolsDirectory {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$BuildToolsRoot
    )

    $validDirectories = Get-ChildItem -LiteralPath $BuildToolsRoot -Directory -ErrorAction Stop |
        Where-Object {
            (Test-Path -LiteralPath (Join-Path $_.FullName "aapt2.exe") -PathType Leaf) -and
            (Test-Path -LiteralPath (Join-Path $_.FullName "apksigner.bat") -PathType Leaf) -and
            (Test-Path -LiteralPath (Join-Path $_.FullName "zipalign.exe") -PathType Leaf)
        } |
        Sort-Object { try { [version]$_.Name } catch { [version]"0.0.0" } } -Descending

    $selected = $validDirectories | Select-Object -First 1
    if ($null -eq $selected) {
        throw "aapt2/apksigner/zipalign을 모두 포함한 Android Build Tools가 없습니다."
    }

    return $selected.FullName
}

function Assert-WgsSdkConfiguration {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Environment,
        [Parameter(Mandatory = $true)]
        [pscustomobject]$AppConfiguration
    )

    $platformCandidates = Get-ChildItem -LiteralPath $Environment.PlatformsRoot -Directory -ErrorAction Stop |
        Where-Object { $_.Name -eq "android-$($AppConfiguration.CompileSdk)" -or $_.Name -eq "android-$($AppConfiguration.CompileSdk).0" }
    $platform = $platformCandidates |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "android.jar") -PathType Leaf } |
        Select-Object -First 1
    if ($null -eq $platform) {
        throw "compileSdk $($AppConfiguration.CompileSdk)에 필요한 android.jar가 없습니다."
    }

    $buildToolsDirectory = Get-WgsBuildToolsDirectory -BuildToolsRoot $Environment.BuildToolsRoot
    Write-Host "[SDK] Platform: $($platform.Name)"
    Write-Host "[SDK] Build Tools: $(Split-Path -Leaf $buildToolsDirectory)"

    return [pscustomobject]@{
        PlatformDirectory   = $platform.FullName
        BuildToolsDirectory = $buildToolsDirectory
        Aapt2Exe            = Join-Path $buildToolsDirectory "aapt2.exe"
        ApkSignerBat        = Join-Path $buildToolsDirectory "apksigner.bat"
        ZipAlignExe         = Join-Path $buildToolsDirectory "zipalign.exe"
    }
}

# =============================================================================
# [네이티브 명령 실행] 종료 코드가 0이 아니면 즉시 예외를 발생시킵니다.
# 인수 전체나 환경 변수는 출력하지 않아 비밀값 노출 가능성을 줄입니다.
# =============================================================================
function Invoke-WgsNativeCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [string[]]$ArgumentList = @(),
        [Parameter(Mandatory = $true)]
        [string]$Description,
        [switch]$SuppressOutput
    )

    if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
        throw "실행 파일이 없습니다: $FilePath"
    }

    Write-Host "[실행] $Description"
    # Windows PowerShell 5.1의 NativeCommandError 오판을 피하고 네이티브 종료 코드로만
    # 성공/실패를 결정합니다. 이 변경은 현재 함수 호출 범위에만 적용됩니다.
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $capturedOutput = @(& $FilePath @ArgumentList 2>&1)
        $nativeExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    $outputLines = @($capturedOutput | ForEach-Object { $_.ToString() })

    if (-not $SuppressOutput) {
        foreach ($line in $outputLines) {
            Write-Host $line
        }
    }

    if ($nativeExitCode -ne 0) {
        throw "$Description 실패 (종료 코드: $nativeExitCode)"
    }

    return [pscustomobject]@{
        ExitCode = $nativeExitCode
        Output   = $outputLines
    }
}

# =============================================================================
# [연결 기기 검증] 호출자가 지정한 Serial의 상태만 조회합니다.
# 모델과 API를 읽기만 하며 설치, 설정 변경, 데이터 삭제는 하지 않습니다.
# =============================================================================
function Assert-WgsDeviceReady {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$AdbExe,
        [Parameter(Mandatory = $true)]
        [string]$DeviceSerial
    )

    if ([string]::IsNullOrWhiteSpace($DeviceSerial)) {
        throw "DeviceSerial이 비어 있습니다."
    }

    $stateResult = Invoke-WgsNativeCommand -FilePath $AdbExe -ArgumentList @(
        "-s", $DeviceSerial, "get-state"
    ) -Description "지정 기기 ADB 상태 확인" -SuppressOutput
    $deviceState = (($stateResult.Output -join "`n").Trim())
    if ($deviceState -ne "device") {
        throw "지정 기기 상태가 device가 아닙니다: $deviceState"
    }

    $modelResult = Invoke-WgsNativeCommand -FilePath $AdbExe -ArgumentList @(
        "-s", $DeviceSerial, "shell", "getprop", "ro.product.model"
    ) -Description "지정 기기 모델 확인" -SuppressOutput
    $apiResult = Invoke-WgsNativeCommand -FilePath $AdbExe -ArgumentList @(
        "-s", $DeviceSerial, "shell", "getprop", "ro.build.version.sdk"
    ) -Description "지정 기기 Android API 확인" -SuppressOutput

    $model = (($modelResult.Output -join "`n").Trim())
    $apiLevel = (($apiResult.Output -join "`n").Trim())
    if ([string]::IsNullOrWhiteSpace($model) -or $apiLevel -notmatch '^\d+$') {
        throw "기기 모델 또는 Android API 값을 확인하지 못했습니다."
    }

    Write-Host "[기기] Serial: $DeviceSerial"
    Write-Host "[기기] Model: $model, API: $apiLevel"

    return [pscustomobject]@{
        Serial   = $DeviceSerial
        State    = $deviceState
        Model    = $model
        ApiLevel = [int]$apiLevel
    }
}

# =============================================================================
# [APK 무결성 공통 검사] 서명, 패키지 ID, 런처 Activity를 실제 APK에서 읽어
# 호출자가 지정한 variant의 정체성과 일치하는 경우에만 결과물로 인정합니다.
# =============================================================================
function Assert-WgsApk {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$ApkPath,
        [Parameter(Mandatory = $true)]
        [string]$ExpectedApplicationId,
        [Parameter(Mandatory = $true)]
        [string]$ExpectedLauncherActivity,
        [Parameter(Mandatory = $true)]
        [pscustomobject]$SdkConfiguration
    )

    $normalizedApkPath = [System.IO.Path]::GetFullPath($ApkPath)
    if (-not (Test-Path -LiteralPath $normalizedApkPath -PathType Leaf)) {
        throw "검증할 APK가 없습니다: $normalizedApkPath"
    }

    $apkFile = Get-Item -LiteralPath $normalizedApkPath
    if ($apkFile.Length -le 0) {
        throw "APK 크기가 0바이트입니다."
    }

    $null = Invoke-WgsNativeCommand -FilePath $SdkConfiguration.ApkSignerBat -ArgumentList @(
        "verify", "--verbose", $normalizedApkPath
    ) -Description "APK 서명 검증"

    $badgingResult = Invoke-WgsNativeCommand -FilePath $SdkConfiguration.Aapt2Exe -ArgumentList @(
        "dump", "badging", $normalizedApkPath
    ) -Description "APK 패키지/런처 분석" -SuppressOutput
    $badgingText = $badgingResult.Output -join "`n"

    $escapedApplicationId = [regex]::Escape($ExpectedApplicationId)
    $escapedLauncherActivity = [regex]::Escape($ExpectedLauncherActivity)
    if ($badgingText -notmatch "(?m)^package: name='$escapedApplicationId'") {
        throw "APK 패키지가 예상값과 다릅니다: $ExpectedApplicationId"
    }
    if ($badgingText -notmatch "(?m)^launchable-activity: name='$escapedLauncherActivity'") {
        throw "APK 런처 Activity가 예상값과 다릅니다: $ExpectedLauncherActivity"
    }

    $sha256 = (Get-FileHash -LiteralPath $normalizedApkPath -Algorithm SHA256).Hash
    Write-Host "[APK] Path: $normalizedApkPath"
    Write-Host "[APK] Size: $($apkFile.Length) bytes"
    Write-Host "[APK] Package: $ExpectedApplicationId"
    Write-Host "[APK] SHA-256: $sha256"

    return [pscustomobject]@{
        Path             = $normalizedApkPath
        Size             = $apkFile.Length
        Sha256           = $sha256
        ApplicationId    = $ExpectedApplicationId
        LauncherActivity = $ExpectedLauncherActivity
    }
}

# =============================================================================
# [Variant별 검사 래퍼] 기존 Debug 스크립트와 내부 배포 스크립트가 같은
# 서명·정체성 검사를 사용하되 예상 package만 명시적으로 분리합니다.
# =============================================================================
function Assert-WgsDebugApk {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$ApkPath,
        [Parameter(Mandatory = $true)]
        [pscustomobject]$AppConfiguration,
        [Parameter(Mandatory = $true)]
        [pscustomobject]$SdkConfiguration
    )

    return Assert-WgsApk `
        -ApkPath $ApkPath `
        -ExpectedApplicationId $AppConfiguration.DebugApplicationId `
        -ExpectedLauncherActivity $AppConfiguration.LauncherActivity `
        -SdkConfiguration $SdkConfiguration
}

function Assert-WgsInternalApk {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$ApkPath,
        [Parameter(Mandatory = $true)]
        [pscustomobject]$AppConfiguration,
        [Parameter(Mandatory = $true)]
        [pscustomobject]$SdkConfiguration
    )

    return Assert-WgsApk `
        -ApkPath $ApkPath `
        -ExpectedApplicationId $AppConfiguration.InternalApplicationId `
        -ExpectedLauncherActivity $AppConfiguration.LauncherActivity `
        -SdkConfiguration $SdkConfiguration
}
