@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
    echo Node.js 20 or newer is required. Install it from https://nodejs.org/.
    pause
    exit /b 1
)
echo.
echo TRADEFLOW - FIRST TIME SETUP
echo ============================
node setup.js
if errorlevel 1 goto :fail
echo.
echo Now create your first administrator account.
echo You can leave Telegram fields blank and configure them later.
node add-admin.js
if errorlevel 1 goto :fail
echo.
echo Opening TradeFlow at http://localhost:3000/admin
start "" "http://localhost:3000/admin"
node server.js
pause
exit /b 0
:fail
echo Setup was not completed. Please review the error above.
pause
exit /b 1
