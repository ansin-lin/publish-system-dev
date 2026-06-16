@echo off
rem Wrapper for Task Scheduler / double-click. Cron uses .ps1 every 5 minutes.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0dispatch-run-once.ps1" %*
exit /b %ERRORLEVEL%
