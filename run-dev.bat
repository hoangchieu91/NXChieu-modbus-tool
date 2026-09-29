@echo off
title Launching NXChieu Modbus Tool (Dev Mode)
echo ========================================================
echo   NXChieu Modbus Tool - Development Launcher
echo   Cross-Platform Modbus Master (Tauri v2 + Rust)
echo ========================================================
echo.
cd /d "%~dp0"
npm run tauri dev
pause
