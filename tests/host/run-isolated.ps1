param(
  [switch]$Loop,
  [switch]$Wake,
  [string]$Exe = $(if ($env:DSH_DESKTOP_EXE) { $env:DSH_DESKTOP_EXE } else { 'D:\deepseek-harness\desktop\DeepSeek Harness.exe' })
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path -LiteralPath $Exe)) { throw "DSH executable not found: $Exe" }
$env:ELECTRON_RUN_AS_NODE = '1'
$env:DSH_HOME = Join-Path $root '.harness-isolated\home'
if ($Wake) {
  $env:SCHEDULER_PROBE_MODE = 'wake'
  $env:SCHEDULER_PROBE_STATE = Join-Path $root '.harness-isolated\state-wake.json'
} elseif ($Loop) {
  $env:SCHEDULER_PROBE_MODE = 'loop'
  $env:SCHEDULER_PROBE_STATE = Join-Path $root '.harness-isolated\state-loop.json'
} else {
  Remove-Item Env:SCHEDULER_PROBE_MODE -ErrorAction SilentlyContinue
  $env:SCHEDULER_PROBE_STATE = Join-Path $root '.harness-isolated\state.json'
}
$runId = [guid]::NewGuid().ToString()
$reportDir = Join-Path $root ('.scheduler/host-reports/' + $runId)
New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
$env:SCHEDULER_HOST_RUN_ID = $runId
$env:SCHEDULER_HOST_REPORT = Join-Path $reportDir 'report.json'
$scriptPath = Join-Path $PSScriptRoot 'run-isolated.mjs'
# Keep quotes inside the expression so Start-Process preserves a path containing spaces.
$process = Start-Process -FilePath $Exe -ArgumentList ('"{0}"' -f $scriptPath) -Wait -PassThru -RedirectStandardOutput (Join-Path $reportDir 'stdout.log') -RedirectStandardError (Join-Path $reportDir 'stderr.log')
if ($null -eq $process) { throw "Host process did not start; see $reportDir" }
$process.Refresh()
$nativeExit = $process.ExitCode
if (-not (Test-Path -LiteralPath $env:SCHEDULER_HOST_REPORT)) { throw "No report for this run; see $reportDir" }
$raw = Get-Content -LiteralPath $env:SCHEDULER_HOST_REPORT -Raw
$report = $raw | ConvertFrom-Json
$raw | Write-Output
$nativeExit | Set-Content -LiteralPath (Join-Path $reportDir 'native-exit.txt') -Encoding utf8
if ($nativeExit -ne 0 -or $report.runId -ne $runId -or $report.passed -ne $true) { exit 1 }
exit 0
