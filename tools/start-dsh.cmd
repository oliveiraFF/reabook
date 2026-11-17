@echo off
rem 双击启动 DSH Web UI（调用同目录下的 start-dsh.ps1）
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-dsh.ps1"
pause
