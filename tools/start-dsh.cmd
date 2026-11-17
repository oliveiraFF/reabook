@echo off
rem Double-click to start DSH Web UI (runs start-dsh.ps1 in this folder)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-dsh.ps1"
pause
