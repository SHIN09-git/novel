# This entry point runs actual NSIS programs. Never use the developer's login.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (!$IsWindows -or $env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
    $env:RUNNER_OS -cne 'Windows' -or $env:RUNNER_ARCH -cne 'X64' -or $env:GITHUB_EVENT_NAME -cne 'push' -or
    $env:GITHUB_REPOSITORY -cne 'SHIN09-git/novel' -or $env:GITHUB_REF -cne 'refs/heads/codex/library-s2-installer-qa') {
    throw 'Refusing Setup outside the dedicated GitHub-hosted Windows QA job'
}
$route = $env:ROUTE
if ($route -cnotin @('clean','upgrade')) { throw 'Unknown route' }
$old = '0.1.6-preview.20'
$oldHash = 'aa38b6dbcba629591113d928617f4ea82ee9c9dcfdfd199e67a7a9ce4c0d50ce'
$oldUrl = 'https://github.com/SHIN09-git/novel/releases/download/v0.1.6-preview.20/Novel.Director.Setup.0.1.6-preview.20.exe'
$candidate = (Get-Content -Raw ./package.json | ConvertFrom-Json).version
$inputDir = Join-Path $env:RUNNER_TEMP 's2-input'
$work = Join-Path $env:RUNNER_TEMP 's2-work'
$ev = Join-Path $env:RUNNER_TEMP 's2-evidence'
$install = Join-Path $work 'Installed Novel Director'
$exe = Join-Path $install 'Novel Director.exe'
$uninstaller = Join-Path $install 'Uninstall Novel Director.exe'
$evidence = [ordered]@{ route=$route; commit=$env:GITHUB_SHA; run=$env:GITHUB_RUN_ID; attempt=$env:GITHUB_RUN_ATTEMPT
    artifact=$env:SETUP_ARTIFACT; candidate=$candidate; image=$env:ImageVersion; status='running'; steps=@() }
function Record($name, $details) {
    $evidence.steps += [ordered]@{ at=[datetime]::UtcNow.ToString('o'); name=$name; details=$details }
    $evidence | ConvertTo-Json -Depth 9 | Set-Content -LiteralPath (Join-Path $ev 'qualification.json') -Encoding utf8NoBOM
}
function Hash($path) { (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Check-Hash($path, $expected) {
    $actual = Hash $path
    if ($expected -notmatch '^[0-9a-f]{64}$' -or $actual -ne $expected) { throw "SHA-256 mismatch: $path" }
    return $actual
}
function Registration($hive) {
    $branch = "${hive}:\Software\Microsoft\Windows\CurrentVersion\Uninstall"
    if (!(Test-Path -LiteralPath $branch)) { return }
    Get-ItemProperty "$branch\*" |
        Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -match '^Novel Director(?: |$)' }
}
function Assert-Absent {
    if (@(Registration HKCU).Count -or @(Registration HKLM).Count -or (Test-Path -LiteralPath $exe) -or
        (Test-Path -LiteralPath $uninstaller)) { throw 'Expected no installed program or uninstall registration' }
}
function Run-NSIS($file, $arguments) {
    $p = Start-Process -FilePath $file -ArgumentList $arguments -PassThru -Wait -WindowStyle Hidden
    Record 'NSIS exit' @{ file=[IO.Path]::GetFileName($file); arguments=$arguments; exitCode=$p.ExitCode }
    if ($p.ExitCode -ne 0) { throw "NSIS exit $($p.ExitCode): $file" }
}
function Install-Setup($file, $version, $expected, [switch]$InPlace) {
    $hash = Check-Hash $file $expected
    $arguments = '/S /currentuser'
    if (!$InPlace) { Assert-Absent; $arguments += " /D=$install" }
    Run-NSIS $file $arguments
    $entries = @(Registration HKCU)
    if ($entries.Count -ne 1 -or @(Registration HKLM).Count -ne 0 -or
        $entries[0].QuietUninstallString -ine ('"' + $uninstaller + '" /currentuser /S') -or
        !(Test-Path -LiteralPath $exe -PathType Leaf) -or !(Test-Path -LiteralPath $uninstaller -PathType Leaf)) {
        throw "Installed files or per-user uninstall entry did not match $version"
    }
    $archive = Join-Path $install 'resources/app.asar'
    $asarHash = if ($version -eq $old) { Hash $archive } else { Check-Hash $archive $meta.appAsarSha256 }
    Record 'installed' @{ expectedVersion=$version; displayVersion=$entries[0].DisplayVersion; setupSha256=$hash
        inPlace=[bool]$InPlace; executable=$exe; registration=$entries[0].PSChildName
        exeSha256=(Hash $exe); asarSha256=$asarHash }
}
function Uninstall-Setup {
    Run-NSIS $uninstaller '/currentuser /S'
    Assert-Absent
    Record 'uninstalled' @{ executableAbsent=$true; uninstallerAbsent=$true; registrationAbsent=$true }
}
function Probe($stage, $version) {
    Record 'starting probe' $stage
    node ./scripts/s2-windows/installed.mjs $stage $version
    if ($LASTEXITCODE -ne 0) { throw "Installed product probe failed: $stage" }
    Record 'passed probe' $stage
}

New-Item -ItemType Directory -Path $ev -Force | Out-Null
try {
    Record 'start' $route
    if ((git rev-parse HEAD) -cne $env:GITHUB_SHA -or $LASTEXITCODE) { throw 'Checkout does not match push' }
    New-Item -ItemType Directory -Path $work -ErrorAction Stop | Out-Null
    Assert-Absent
    foreach ($name in @('Novel Director','novel-director')) {
        if (Test-Path -LiteralPath (Join-Path $env:APPDATA $name)) { throw "Not a clean guest profile: $name" }
    }
    $name = "Novel Director Setup $candidate.exe"
    $setup = Join-Path $inputDir $name
    $meta = Get-Content -Raw -LiteralPath (Join-Path $inputDir 'BUILD_INFO.json') | ConvertFrom-Json
    $sum = (Get-Content -Raw -LiteralPath (Join-Path $inputDir 'SHA256SUMS.txt')).TrimEnd()
    $hash = Check-Hash $setup $meta.installerSha256
    if ($meta.installer -cne $name -or $meta.sourceCommit -cne $env:GITHUB_SHA -or
        $meta.version -cne $candidate -or $meta.packagedSmokeTest -cne 'passed' -or
        $sum -ine "$hash  $name" -or $hash -eq $oldHash -or $candidate -eq $old) { throw 'Candidate build record mismatch' }
    Record 'candidate input verified' @{ sha256=$hash; name=$name; buildInfo=$meta }
    if ($route -eq 'clean') {
        Install-Setup $setup $candidate $hash
        Probe clean-seed $candidate
    } else {
        $previous = Join-Path $work 'published-preview20.exe'
        Invoke-WebRequest -Uri $oldUrl -OutFile $previous
        Install-Setup $previous $old $oldHash
        Probe old-seed $old
        Probe old-reopen $old
        Install-Setup $setup $candidate $hash -InPlace
    }
    Probe candidate-edit $candidate
    Probe candidate-reopen $candidate
    Uninstall-Setup
    if ($route -eq 'clean') {
        Install-Setup $setup $candidate $hash
        Probe reinstall-reopen $candidate
        Uninstall-Setup
    } else {
        Install-Setup $previous $old $oldHash
        # Even if edited-copy compatibility fails, still exercise backup recovery.
        try { Probe rollback-edited $old }
        finally { Probe rollback-backup $old }
        Uninstall-Setup
    }
    $evidence.status = 'passed'
} catch {
    $evidence.status = 'failed'
    $evidence.error = $_.Exception.Message
    throw
} finally {
    Record 'finish' $evidence.status
}
