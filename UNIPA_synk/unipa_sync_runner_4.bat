@echo off
chcp 65001 > nul

set "BASE_DIR=%~dp0"
set "LOGFILE=%BASE_DIR%UNIPA_Sync_Log.txt"

set "CHROME_DATA=%BASE_DIR%AutoChromeData"
set "SIDE_FILE=%BASE_DIR%UNIPA_Auto\unipa-sync.side"

echo ======================================== >> "%LOGFILE%"
echo [%date% %time%] UNIPA同期を開始します(完全バックグラウンド) >> "%LOGFILE%"

selenium-side-runner --timeout 600000 --jest-timeout 600000 -c "browserName=chrome goog:chromeOptions.args=[--user-data-dir=\"%CHROME_DATA%\", --disable-gpu, --window-size=1920,1080]" "%SIDE_FILE%" >> "%LOGFILE%" 2>&1

if %errorlevel% equ 0 (
    echo [%date% %time%] 同期完了 >> "%LOGFILE%"
) else (
    echo [%date% %time%] ⚠️ エラー発生 >> "%LOGFILE%"
)