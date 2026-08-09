@echo off
:: VibeDownloader Native Messaging Host
:: This script launches VibeDownloader when called from the browser extension

set APP_NAME=VibeDownloader
set APP_EXE=%LOCALAPPDATA%\Programs\vibe-downloader\VibeDownloader.exe

:: Try common install locations
if exist "%APP_EXE%" goto :launch

set APP_EXE=%ProgramFiles%\VibeDownloader\VibeDownloader.exe
if exist "%APP_EXE%" goto :launch

set APP_EXE=%ProgramFiles(x86)%\VibeDownloader\VibeDownloader.exe
if exist "%APP_EXE%" goto :launch

:: Try user data location (dev/portable)
set APP_EXE=%APPDATA%\vibe-downloader\VibeDownloader.exe
if exist "%APP_EXE%" goto :launch

:: App not found - try to find it via PATH
where VibeDownloader.exe >nul 2>&1
if %errorlevel% equ 0 (
    set APP_EXE=VibeDownloader.exe
    goto :launch
)

echo VibeDownloader not found >&2
exit /b 1

:launch
:: Native messaging reads JSON from stdin, we just need to launch the app
:: The extension will handle URL passing via WebSocket
start "" "%APP_EXE%"
exit /b 0
