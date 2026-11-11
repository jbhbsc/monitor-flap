@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Please install Node.js 22 LTS or later from https://nodejs.org/
  pause
  exit /b 1
)
if not defined WECHAT_PORT set WECHAT_PORT=8787
echo Opening http://127.0.0.1:%WECHAT_PORT%
start "" "http://127.0.0.1:%WECHAT_PORT%"
node src\server.mjs
pause
