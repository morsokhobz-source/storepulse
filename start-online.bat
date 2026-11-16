@echo off
echo ========================================
echo   StorePulse Online Tunnel
echo ========================================
echo.
echo Starting StorePulse server...
start /b "" cmd /c "cd /d D:\downloads\storepulse && node server/index.js"
timeout /t 3 /nobreak >nul
echo.
echo Starting Cloudflare Tunnel...
echo.
echo ========================================
echo   YOUR PUBLIC URL WILL APPEAR BELOW
echo ========================================
echo.
"C:\Users\USER\Downloads\cloudflared\cloudflared-windows-amd64.exe" tunnel --url http://localhost:3000
echo.
echo Tunnel stopped.
pause
