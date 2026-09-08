#requires -Version 5.1
<#
.SYNOPSIS
    현재 React 화면을 포함한 우공실 UI 테스트 APK를 생성합니다.
.DESCRIPTION
    웹 파일은 APK에 포함하고 API 및 인증은 기존 HTTPS 서버에 연결합니다.
    운영 배포와 기기 설치는 수행하지 않습니다. 기존 frontend/dist를 덮지 않습니다.
#>
[CmdletBinding(DefaultParameterSetName = 'Source')]
param(
    [Parameter(ParameterSetName = 'Source')]
    [string]$FrontendRoot,
    [Parameter(Mandatory = $true, ParameterSetName = 'Prebuilt')]
    [ValidateNotNullOrEmpty()]
    [string]$WebDistRoot,
    [ValidatePattern('^(0|[1-9][0-9]*)\.(0|[1-9][0-9]?)\.(0|[1-9][0-9]?)$')]
    [string]$ReleaseVersion,
    [ValidatePattern('^[0-9a-fA-F]{40}$')]
    [string]$ReleaseCommit,
    [string]$JdkRoot,
    [string]$AndroidSdkRoot,
    [string]$GradleJdkRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'AndroidEnvironment.Common.ps1')
. (Join-Path $PSScriptRoot 'WebRelease.Common.ps1')
$projectRoot = Get-WgsProjectRoot
$repositoryVersion = (Get-Content -LiteralPath (Join-Path (Split-Path $projectRoot -Parent) 'VERSION') -Raw -Encoding UTF8).Trim()
if ($ReleaseVersion -and $ReleaseVersion -cne $repositoryVersion) {
    throw 'ReleaseVersion과 저장소 VERSION이 다릅니다.'
}
$ReleaseVersion = $repositoryVersion
$isPrebuilt = $PSCmdlet.ParameterSetName -eq 'Prebuilt'
$webRelease = $null
if ($isPrebuilt) {
    $webBuildDirectory = [IO.Path]::GetFullPath($WebDistRoot)
    if ($webBuildDirectory -ne [IO.Path]::GetPathRoot($webBuildDirectory)) {
        $webBuildDirectory = $webBuildDirectory.TrimEnd([char[]]@('\', '/'))
    }
    if (-not (Test-Path -LiteralPath (Join-Path $webBuildDirectory 'index.html') -PathType Leaf)) {
        throw 'WebDistRoot에서 index.html을 찾지 못했습니다.'
    }
    $webRelease = Get-WgsWebReleaseMetadata -WebRoot $webBuildDirectory -ExpectedVersion $ReleaseVersion -ExpectedCommit $ReleaseCommit -RequireManifest
}
$environment = Set-WgsAndroidEnvironment -JdkRoot $JdkRoot -AndroidSdkRoot $AndroidSdkRoot
$appConfiguration = Get-WgsAppConfiguration -ProjectRoot $projectRoot
$sdkConfiguration = Assert-WgsSdkConfiguration -Environment $environment -AppConfiguration $appConfiguration
# [Gradle JVM] 프로젝트의 daemon 기준을 충족하는 설치된 JBR을 먼저 사용합니다.
# Android SDK 도구용 JDK 17과 구분하며 영구 환경 설정은 변경하지 않습니다.
$daemonCriteria = Join-Path $projectRoot 'gradle\gradle-daemon-jvm.properties'
$requiredGradleMajor = $null
if (Test-Path -LiteralPath $daemonCriteria) {
    $criteriaText = Get-Content -LiteralPath $daemonCriteria -Raw -Encoding UTF8
    if ($criteriaText -match '(?m)^toolchainVersion=(\d+)') { $requiredGradleMajor = $Matches[1] }
}
if ([string]::IsNullOrWhiteSpace($GradleJdkRoot)) {
    $studioJbr = Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'
    if ($requiredGradleMajor -and (Test-Path -LiteralPath (Join-Path $studioJbr 'release'))) {
        $releaseText = Get-Content -LiteralPath (Join-Path $studioJbr 'release') -Raw -Encoding UTF8
        if ($releaseText -match ('(?m)^JAVA_VERSION="' + [regex]::Escape($requiredGradleMajor) + '[."]')) {
            $GradleJdkRoot = $studioJbr
        }
    }
}
if ($GradleJdkRoot -and -not (Test-Path -LiteralPath (Join-Path $GradleJdkRoot 'bin\java.exe'))) {
    throw '지정한 Gradle JVM을 찾지 못했습니다.'
}
if (-not $isPrebuilt) {
    if ([string]::IsNullOrWhiteSpace($FrontendRoot)) {
        $FrontendRoot = Join-Path (Split-Path $projectRoot -Parent) 'frontend'
    }
    $frontendDirectory = [IO.Path]::GetFullPath($FrontendRoot)
    if (-not (Test-Path -LiteralPath (Join-Path $frontendDirectory 'src\App.jsx') -PathType Leaf)) {
        throw '우공실 프런트엔드 src/App.jsx를 찾지 못했습니다.'
    }
    $npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
}
$bundleId = 'mobile-ui-' + (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')
$outputDirectory = Join-Path $projectRoot ('build\local-web\' + $bundleId)
if (-not $isPrebuilt) { $webBuildDirectory = Join-Path $outputDirectory 'frontend' }
$assetsDirectory = Join-Path $outputDirectory 'apk-assets'
$webappDirectory = Join-Path $assetsDirectory 'webapp'
New-Item -ItemType Directory -Path $webappDirectory -Force | Out-Null

# [웹 빌드] 매번 새 폴더에 생성하여 이전 빌드와 파일이 섞이지 않도록 합니다.
if (-not $isPrebuilt) {
    Push-Location -LiteralPath $frontendDirectory
    try {
        $null = Invoke-WgsNativeCommand -FilePath $npmCommand -ArgumentList @(
            'run', 'build', '--', '--outDir', $webBuildDirectory
        ) -Description '현재 모바일 화면 웹 빌드'
    }
    finally { Pop-Location }
    $webRelease = Get-WgsWebReleaseMetadata -WebRoot $webBuildDirectory -ExpectedVersion $ReleaseVersion -ExpectedCommit $ReleaseCommit
}

# [번들 목록] 관리자 진입 문서와 소스맵은 포함하지 않습니다.
# 목록에 있는 파일만 네이티브 WebView 응답기로 제공됩니다.
$sourcePrefix = $webBuildDirectory.TrimEnd([char[]]@('\', '/')) + [IO.Path]::DirectorySeparatorChar
foreach ($buildFile in (Get-ChildItem -LiteralPath $webBuildDirectory -Recurse -File)) {
    $relativePath = $buildFile.FullName.Substring($sourcePrefix.Length)
    $webPath = $relativePath.Replace('\', '/')
    if ($webPath -eq '_wgs-bundle.json' -or $webPath.StartsWith('manage/') -or $webPath.EndsWith('.map') -or $webPath -match '(^|/)\.') { continue }
    $destination = Join-Path $webappDirectory $relativePath
    New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $buildFile.FullName -Destination $destination
}
[string[]]$bundleFiles = @(Get-ChildItem -LiteralPath $webappDirectory -Recurse -File | ForEach-Object {
    $_.FullName.Substring($webappDirectory.Length + 1).Replace('\', '/')
})
[Array]::Sort($bundleFiles, [StringComparer]::Ordinal)
if ('index.html' -notin $bundleFiles -or -not ($bundleFiles | Where-Object { $_.StartsWith('assets/') })) {
    throw '웹 번들의 index 또는 assets가 없습니다.'
}
$utf8 = [Text.UTF8Encoding]::new($false)
$fileHashes = [ordered]@{}
foreach ($bundleFile in $bundleFiles) {
    $fileHashes[$bundleFile] = (Get-FileHash -LiteralPath (Join-Path $webappDirectory $bundleFile) -Algorithm SHA256).Hash.ToLowerInvariant()
}
$hashInventory = ($bundleFiles | ForEach-Object { $fileHashes[$_] + '  ' + $_ }) -join "`n"
$sha256 = [Security.Cryptography.SHA256]::Create()
try { $webContentSha256 = ([BitConverter]::ToString($sha256.ComputeHash($utf8.GetBytes($hashInventory)))).Replace('-', '').ToLowerInvariant() }
finally { $sha256.Dispose() }
# 원본 version.json과 복사된 파일이 같은지 확인한 뒤 공급 근거를 기록합니다.
if ($webRelease -and $fileHashes['version.json'] -cne $webRelease.manifestSha256) {
    throw '웹 파일을 복사하는 동안 version.json이 바뀌었습니다.'
}
$webSource = if ($isPrebuilt) { 'prebuilt-dist' } else { 'local-build' }
$manifestPath = Join-Path $webappDirectory '_wgs-bundle.json'
$manifest = [ordered]@{ id = $bundleId; origin = 'https://woogongsil.site'; files = $bundleFiles; source = $webSource; release = $webRelease; contentSha256 = $webContentSha256; fileHashes = $fileHashes }
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 5), $utf8)

# [검증 빌드] Local bundle은 Debug source set에만 연결합니다.
Push-Location -LiteralPath $projectRoot
$sdkJavaHome = $env:JAVA_HOME
try {
    if ($GradleJdkRoot) {
        $env:JAVA_HOME = [IO.Path]::GetFullPath($GradleJdkRoot)
        Write-Host ('[Gradle JVM] ' + $env:JAVA_HOME)
    }
    $null = Invoke-WgsNativeCommand -FilePath (Join-Path $projectRoot 'gradlew.bat') -ArgumentList @(
        '--no-daemon', '--console=plain',
        ('-PwgsLocalWebAssetsDir=' + $assetsDirectory),
        ':app:testDebugUnitTest', ':app:lintDebug', ':app:assembleDebug'
    ) -Description '모바일 UI 테스트 APK 검증·생성'
}
finally { $env:JAVA_HOME = $sdkJavaHome; Pop-Location }
$apk = Assert-WgsDebugApk -ApkPath (Join-Path $projectRoot 'app\build\outputs\apk\debug\app-debug.apk') -AppConfiguration $appConfiguration -SdkConfiguration $sdkConfiguration
$deliveryApk = Join-Path $outputDirectory ('Woogongsil-' + $bundleId + '.apk')
Copy-Item -LiteralPath $apk.Path -Destination $deliveryApk
$apkHash = (Get-FileHash -LiteralPath $deliveryApk -Algorithm SHA256).Hash
[IO.File]::WriteAllText(($deliveryApk + '.sha256'), ($apkHash + '  ' + (Split-Path $deliveryApk -Leaf) + [Environment]::NewLine), $utf8)
$result = [ordered]@{ bundleId = $bundleId; apk = $deliveryApk; sha256 = $apkHash; package = $appConfiguration.DebugApplicationId; version = $ReleaseVersion; assetsDirectory = $assetsDirectory; fileCount = $bundleFiles.Count; webSource = $webSource; webRelease = $webRelease; webContentSha256 = $webContentSha256 }
[IO.File]::WriteAllText((Join-Path $outputDirectory 'result.json'), ($result | ConvertTo-Json -Depth 5), $utf8)
Write-Host ('[완료] ' + $deliveryApk)
Write-Host ('[번들] ' + $bundleId + ', ' + $bundleFiles.Count + ' files')
