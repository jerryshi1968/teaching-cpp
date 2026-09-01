@echo off
setlocal
chcp 65001 >nul
if exist "D:\Program Files\nodejs\node.exe" (
  "D:\Program Files\nodejs\node.exe" "%~dp0download-gcc-offline-20260831.mjs"
) else (
  node.exe "%~dp0download-gcc-offline-20260831.mjs"
)
set "cpp_download_exit=%ERRORLEVEL%"
echo.
pause
exit /b %cpp_download_exit%
