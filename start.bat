@echo off
setlocal EnableDelayedExpansion

rem Always resolve paths relative to this script so the project can be moved anywhere.
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

pushd "%SCRIPT_DIR%" >nul 2>nul
if errorlevel 1 (
  echo Failed to enter project directory:
  echo %SCRIPT_DIR%
  pause
  exit /b 1
)

if not exist "package.json" (
  echo package.json not found in:
  echo %SCRIPT_DIR%
  pause
  popd
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found in PATH.
  echo Install Node.js and make sure npm is available, then run this file again.
  pause
  popd
  exit /b 1
)

if not exist "node_modules" (
  echo Dependencies not found. Running npm install...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed.
    pause
    popd
    exit /b 1
  )
)

set "FRONTEND_PORT=5173"
:find_frontend_port
netstat -ano | findstr /r /c:":!FRONTEND_PORT! .*LISTENING" >nul
if not errorlevel 1 (
  set /a FRONTEND_PORT+=1
  goto find_frontend_port
)

echo Starting dev server in:
echo %SCRIPT_DIR%
echo Frontend will use: http://localhost:!FRONTEND_PORT!

set "LAUNCHER_FILE=%TEMP%\claude-history-viewer-dev.cmd"
(
  echo @echo off
  echo setlocal
  echo pushd "%SCRIPT_DIR%"
  echo npm run dev -- --port !FRONTEND_PORT!
) > "!LAUNCHER_FILE!"

start "Claude History Viewer Dev Server" cmd /k ""!LAUNCHER_FILE!""
timeout /t 4 /nobreak >nul
start "" "http://localhost:!FRONTEND_PORT!"

popd
exit /b 0
