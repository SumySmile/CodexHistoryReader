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

set "STATE_DIR=%TEMP%\claude-history-viewer"
if not exist "%STATE_DIR%" mkdir "%STATE_DIR%" >nul 2>nul

set "PORT_FILE=%STATE_DIR%\frontend.port"
set "LOG_FILE=%STATE_DIR%\dev.log"
set "ERR_LOG_FILE=%STATE_DIR%\dev.err.log"

if exist "!PORT_FILE!" (
  set /p EXISTING_FRONTEND_PORT=<"!PORT_FILE!"
  if defined EXISTING_FRONTEND_PORT (
    netstat -ano | findstr /r /c:":!EXISTING_FRONTEND_PORT! .*LISTENING" >nul
    if not errorlevel 1 (
      echo Dev server is already running:
      echo http://localhost:!EXISTING_FRONTEND_PORT!
      start "" "http://localhost:!EXISTING_FRONTEND_PORT!"
      popd
      exit /b 0
    )
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
echo Logs:
echo !LOG_FILE!
echo !ERR_LOG_FILE!

set "LAUNCHER_FILE=%TEMP%\claude-history-viewer-dev.cmd"
set "LAUNCHER_VBS=%TEMP%\claude-history-viewer-dev.vbs"
(
  echo @echo off
  echo setlocal
  echo cd /d "%SCRIPT_DIR%"
  echo ^> "!PORT_FILE!" echo !FRONTEND_PORT!
  echo npm run dev -- --port !FRONTEND_PORT! 1^>"!LOG_FILE!" 2^>"!ERR_LOG_FILE!"
) > "!LAUNCHER_FILE!"

(
  echo Set WshShell = CreateObject("WScript.Shell"^)
  echo WshShell.Run Chr(34^) ^& "!LAUNCHER_FILE!" ^& Chr(34^), 0, False
) > "!LAUNCHER_VBS!"

wscript //nologo "!LAUNCHER_VBS!"

set /a WAIT_SECONDS=0
:wait_frontend
netstat -ano | findstr /r /c:":!FRONTEND_PORT! .*LISTENING" >nul
if not errorlevel 1 goto open_browser
if !WAIT_SECONDS! GEQ 20 goto open_browser
timeout /t 1 /nobreak >nul
set /a WAIT_SECONDS+=1
goto wait_frontend

:open_browser
start "" "http://localhost:!FRONTEND_PORT!"

popd
exit /b 0
