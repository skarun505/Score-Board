@echo off
title Live Sales Dashboard Server
cd /d "%~dp0"
echo ========================================================
echo Starting Live Sales Dashboard Server (Without Docker)...
echo ========================================================
echo Server URL: http://localhost:4000
echo TV Screen:  http://localhost:4000/tv?key=tv_sec_7a9f8b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a^&autosound=1
echo TL Kiosk:   http://localhost:4000/tl
echo Admin:      http://localhost:4000/admin
echo ========================================================
node server/src/index.js
pause
