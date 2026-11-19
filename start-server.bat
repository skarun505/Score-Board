@echo off
title Sales Command Center - Server
echo ========================================================
echo    Starting Sales Command Center Server on Port 4000
echo ========================================================
cd /d "%~dp0"
node server/src/index.js
pause
