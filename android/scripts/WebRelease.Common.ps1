#requires -Version 5.1

# 이미 빌드한 웹 파일의 릴리즈 식별자를 읽습니다. 배포 성공 여부는 호출자가
# 별도로 확인해야 하며, 이 함수는 입력 dist와 요청 버전/커밋의 일치만 검사합니다.
function Get-WgsWebReleaseMetadata {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$WebRoot,
        [Parameter(Mandatory = $true)][string]$ExpectedVersion,
        [string]$ExpectedCommit,
        [switch]$RequireManifest
    )

    $manifestPath = Join-Path $WebRoot 'version.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        if ($RequireManifest -or $ExpectedCommit) { throw '웹 dist에 version.json이 없습니다.' }
        return $null
    }
    $metadata = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($null -eq $metadata -or 'version' -notin $metadata.PSObject.Properties.Name) {
        throw '웹 version.json에 version이 없습니다.'
    }
    if ([string]$metadata.version -cne $ExpectedVersion) {
        throw "웹 버전이 저장소/요청 버전과 다릅니다: $($metadata.version), expected $ExpectedVersion"
    }
    $commit = if ('commit' -in $metadata.PSObject.Properties.Name) { [string]$metadata.commit } else { $null }
    if ($RequireManifest -and $commit -notmatch '^[0-9a-fA-F]{40}$') {
        throw '이미 빌드한 웹 dist의 version.json에는 전체 40자리 Git commit이 필요합니다.'
    }
    if ($ExpectedCommit -and $commit -ine $ExpectedCommit) {
        throw '웹 version.json의 commit이 요청한 릴리즈 commit과 다릅니다.'
    }
    $tag = if ('tag' -in $metadata.PSObject.Properties.Name) { [string]$metadata.tag } else { $null }
    if ($tag -and $tag -cne ('v' + $ExpectedVersion)) {
        throw '웹 version.json의 tag가 요청한 릴리즈 버전과 다릅니다.'
    }
    return [pscustomobject]@{
        version = [string]$metadata.version
        commit = $commit
        tag = $tag
        builtAt = if ('builtAt' -in $metadata.PSObject.Properties.Name) { [string]$metadata.builtAt } else { $null }
        manifestSha256 = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}
