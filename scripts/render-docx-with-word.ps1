param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $resolvedOutput
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$document = $null

try {
  $document = $word.Documents.Open($resolvedInput, $false, $true)
  $document.ExportAsFixedFormat($resolvedOutput, 17)
  $document.Close($false)
} finally {
  if ($null -ne $document) {
    [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($document)
  }
  $word.Quit()
  [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($word)
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}

Get-Item -LiteralPath $resolvedOutput | Select-Object FullName, Length, LastWriteTime
