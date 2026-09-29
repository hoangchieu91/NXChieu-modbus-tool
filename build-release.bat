@echo off
title Building NXChieu Modbus Tool (Production Release)
echo ========================================================
echo   NXChieu Modbus Tool - Production Builder
echo   Wails (Go backend + React frontend)
echo ========================================================
echo.
cd /d "%~dp0"
rem npm run build (called by wails build) also rebuilds the mobile page CSS.
wails build -clean || goto :error
echo.
echo Build complete! Check build\bin\
pause
exit /b 0

:error
echo.
echo Build FAILED.
pause
exit /b 1
