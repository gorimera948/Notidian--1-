@echo off
title Notidian Local Server
cd /d "%~dp0"
echo Starting Notidian Local Server...
echo Please keep this window open while using Notidian.
echo.

:: Automatically open localhost in the default browser
start http://localhost:5173

:: Start the Vite development server
npm run dev

pause
