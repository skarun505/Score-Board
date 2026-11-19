@echo off
title 108" TV Kiosk Display
echo ========================================================
echo   Launching 108" TV Display in Fullscreen Kiosk Mode
echo ========================================================

set TV_URL=http://localhost:4000/tv?key=tv_sec_7a9f8b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a^&autosound=1

:: Try Google Chrome first
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --autoplay-policy=no-user-gesture-required --noerrdialogs --disable-infobars "%TV_URL%"
    exit /b
)
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" --kiosk --autoplay-policy=no-user-gesture-required --noerrdialogs --disable-infobars "%TV_URL%"
    exit /b
)

:: Fallback to Microsoft Edge
start "" msedge.exe --kiosk "%TV_URL%" --edge-kiosk-type=fullscreen --no-first-run
