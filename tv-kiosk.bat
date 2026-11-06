@echo off
:loop
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --autoplay-policy=no-user-gesture-required --noerrdialogs --disable-infobars --disable-session-crashed-bubble --check-for-update-interval=31536000 "http://localhost:4000/tv?key=tv_sec_7a9f8b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a&autosound=1"
timeout /t 5 /nobreak >nul
goto loop
