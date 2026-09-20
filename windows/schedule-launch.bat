@echo off
setlocal
REM ---------------------------------------------------------------------------
REM Registers a Windows Task Scheduler job that runs start-edge.bat at a set
REM time, so Edge is launched fresh for the join instead of having sat open all
REM day.
REM
REM   schedule-launch.bat 05:45          once, at the next 05:45
REM   schedule-launch.bat 05:45 daily    every day at 05:45
REM   schedule-launch.bat /delete        remove it
REM
REM The time is 24-hour, on this machine's own clock -- the one in the corner
REM of the screen. Same clock the popup's Arm box uses.
REM
REM Tick "Join when the browser starts" in the extension popup, or the browser
REM will launch and then sit there.
REM ---------------------------------------------------------------------------

set "TASK=Queue Refresh launch"
set "LAUNCH=%~dp0start-edge.bat"

if /i "%~1"=="/delete" (
  schtasks /delete /tn "%TASK%" /f
  exit /b %errorlevel%
)

if "%~1"=="" (
  echo Usage: schedule-launch.bat HH:MM [daily^|once]
  echo        schedule-launch.bat /delete
  echo.
  echo Current setting:
  schtasks /query /tn "%TASK%" 2>nul || echo   nothing scheduled.
  exit /b 1
)

set "WHEN=%~1"
set "HOW=%~2"
if "%HOW%"=="" set "HOW=once"

if /i "%HOW%"=="daily" (
  set "SCHEDULE=/sc daily /st %WHEN%"
) else (
  set "SCHEDULE=/sc once /st %WHEN%"
)

REM /f replaces an existing task rather than failing, so re-running this with a
REM new time is how you change it. /rl limited: nothing here needs elevation,
REM and a browser started as admin is a browser with a different profile.
schtasks /create /tn "%TASK%" /tr "\"%LAUNCH%\"" %SCHEDULE% /rl limited /f
if errorlevel 1 (
  echo.
  echo Could not create the task. A "once" task whose time has already passed
  echo today is the usual reason -- try tomorrow's time, or use daily.
  exit /b 1
)

echo.
echo Scheduled. Edge will launch at %WHEN% (%HOW%^).
echo Check the extension popup has "Join when the browser starts" ticked.
