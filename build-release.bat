@echo off
title Building NXChieu Modbus Tool (Production Release)
echo ========================================================
echo   NXChieu Modbus Tool - Production Builder
echo   Wails (Go backend + React frontend)
echo ========================================================
echo.
cd /d "%~dp0"
call npm run build:mobile-css || goto :error
wails build -clean || goto :error
echo.
echo Build complete! Check buildinpause
exit /b 0

:error
echo.
echo Build FAILED.
pause
exit /b 1
