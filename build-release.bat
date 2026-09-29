@echo off
title Building NXChieu Modbus Tool (Production Release)
echo ========================================================
echo   NXChieu Modbus Tool - Production Builder
echo   Generating Standalone Executable and Installer
echo ========================================================
echo.
cd /d "%~dp0"
npm run tauri build
echo.
echo Build complete! Check src-tauri/target/release/bundle/
pause
