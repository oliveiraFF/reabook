# D5 启动脚本：启用 Node 24，再用 web profile 启动 DSH Web UI。
# 请在你自己的终端里运行（不要在 Claude 应用里运行：那里启动的 dsh web 没法给 workspace 授写权限）。
#   双击 tools\start-dsh.cmd，或：powershell -ExecutionPolicy Bypass -File tools\start-dsh.ps1
# 启动后终端会打印带访问令牌的网址，令牌等同登录凭据，不要外发。

$ErrorActionPreference = 'Stop'
$env:FNM_DIR = 'C:\Users\25370\.fnm'

if (-not (Get-Command fnm -ErrorAction SilentlyContinue)) {
  Write-Host '找不到 fnm。请先确认 fnm 已安装并在 PATH 里。' -ForegroundColor Red
  exit 1
}
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
fnm use 24 | Out-Null

$major = [int]((node --version).TrimStart('v').Split('.')[0])
if ($major -lt 24) {
  Write-Host "当前 Node 是 $(node --version)，需要 24 及以上。请运行 fnm install 24 后再试。" -ForegroundColor Red
  exit 1
}

if (-not (Get-Command dsh -ErrorAction SilentlyContinue)) {
  Write-Host '找不到 dsh 命令。DSH 装在 Node 24 的全局目录里，请确认安装没有丢失。' -ForegroundColor Red
  exit 1
}

$busy = Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue
if ($busy) {
  Write-Host '端口 3080 已被占用：可能已经有一个 dsh web 在运行。请先关掉它，或直接用已经打开的那个。' -ForegroundColor Yellow
  exit 1
}

# D6：启动前刷新成本看板（失败不影响启动）
node "$PSScriptRoot\cost-report.mjs"
if ($LASTEXITCODE -ne 0) { Write-Host '成本看板没有刷新成功（不影响启动）。' -ForegroundColor Yellow }

Write-Host "Node $(node --version)；用 profile web 启动 DSH Web UI …" -ForegroundColor Green
dsh web   # 等同于 dsh --profile web
