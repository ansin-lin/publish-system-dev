@echo off
rem 17:00 JST: create daily-YYYYMMDD-r03 (skip if task.json already exists)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0daily-create-task.ps1" -RunId r03 -Trigger daily_cron_1700
exit /b %ERRORLEVEL%
