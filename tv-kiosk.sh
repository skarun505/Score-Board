#!/bin/bash
while true; do
  chromium-browser --kiosk --autoplay-policy=no-user-gesture-required \
    --noerrdialogs --disable-infobars --disable-session-crashed-bubble \
    "http://localhost:4000/tv?key=tv_sec_7a9f8b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a&autosound=1"
  sleep 5
done
