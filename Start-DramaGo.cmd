@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo DramaGo development preview requires Node.js. The future installer will include its own runtime.
  pause
  exit /b 1
)
node scripts\build.mjs || (
  echo Failed to prepare DramaGo.
  pause
  exit /b 1
)
node local\server.mjs --open
endlocal
