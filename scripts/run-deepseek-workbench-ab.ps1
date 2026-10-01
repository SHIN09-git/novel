param(
  [string]$Source = 'F:\novel\novel-director-data.sqlite',
  [string]$Spec = 'experiments\low-water-ch1-deepseek-ab.json',
  [ValidateRange(1, 3)][int]$Runs = 1,
  [ValidateRange(0, 2)][double]$Temperature = 0.3,
  [switch]$WorkbenchOnly,
  [switch]$PreflightOnly
)

$arguments = @(
  'scripts\run-deepseek-workbench-ab.mjs',
  '--source', $Source,
  '--spec', $Spec,
  '--runs', [string]$Runs,
  '--temperature', [string]$Temperature
)

if ($WorkbenchOnly) {
  $arguments += '--workbench-only'
}

if ($PreflightOnly) {
  $arguments += '--preflight-only'
  & node @arguments
  exit $LASTEXITCODE
}

$preflightArguments = @($arguments) + '--preflight-only'
& node @preflightArguments
if ($LASTEXITCODE -ne 0) {
  Write-Error 'Local safety preflight failed; the API key was not requested and no DeepSeek network call was made. Inspect the preflight summary.json.'
  exit $LASTEXITCODE
}

$secureKey = Read-Host 'DeepSeek API Key (used only by this PowerShell process; not echoed or written to files)' -AsSecureString
$keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
  $env:NOVEL_DIRECTOR_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
  & node @arguments
  exit $LASTEXITCODE
}
finally {
  $env:NOVEL_DIRECTOR_API_KEY = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
}
