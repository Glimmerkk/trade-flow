@echo off
setlocal
cd /d "%~dp0"
echo Starting TradeFlow on http://localhost:3000/admin
start "" "http://localhost:3000/admin"
node server.js
if errorlevel 1 echo Make sure you ran FIRST_TIME_SETUP_WINDOWS.bat first.
pause
