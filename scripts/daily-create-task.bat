@echo off
rem Wrapper for Task Scheduler / double-click. Cron uses .ps1 directly.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0daily-create-task.ps1" %*
exit /b %ERRORLEVEL%
