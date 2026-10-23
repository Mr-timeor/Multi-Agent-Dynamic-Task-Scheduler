param([string]$Exe = $(if ($env:DSH_DESKTOP_EXE) { $env:DSH_DESKTOP_EXE } else { 'D:\deepseek-harness\desktop\DeepSeek Harness.exe' }))
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Exe)) { throw "找不到DSH桌面可执行文件：$Exe" }
$env:ELECTRON_RUN_AS_NODE = '1'
$projectRoot = Split-Path -Parent $PSScriptRoot
$reportPath = Join-Path $projectRoot ('.scheduler/view-host-report-' + [guid]::NewGuid().ToString() + '.json')
$env:SCHEDULER_VIEW_REPORT = $reportPath
& $Exe (Join-Path $PSScriptRoot 'view-host.mjs') | Out-Host
if (-not (Test-Path -LiteralPath $reportPath)) { throw '宿主探针没有产生结果，不能按退出码视为通过' }
$result = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
Get-Content -LiteralPath $reportPath -Raw | Write-Output
if (-not $result.passed) { exit 1 }
exit 0
