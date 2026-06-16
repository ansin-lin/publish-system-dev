@echo off
rem 13:00 JST: create daily-YYYYMMDD-r02 (skip if task.json already exists)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0daily-create-task.ps1" -RunId r02 -Trigger daily_cron_1300
exit /b %ERRORLEVEL%
