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
REM Launch at the ready time minus two hours minus a few minutes: that is when
REM the extension starts checking the queue's time estimate.
REM
REM Tick "Wake the queue tab when the browser starts" in the extension popup,
REM and arm the ready time, or the browser will launch and then sit there.
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

REM /restart matters. The extension joins on chrome.runtime.onStartup, which
REM only fires when Edge really starts; launching it while it is already
REM running adds a window and nothing else. A browser left open overnight is
REM the normal state here, so the task always closes it first.
REM
REM /f replaces an existing task rather than failing, so re-running this with a
REM new time is how you change it. /rl limited: nothing here needs elevation,
REM and a browser started as admin is a browser with a different profile.
schtasks /create /tn "%TASK%" /tr "\"%LAUNCH%\" /restart" %SCHEDULE% /rl limited /f
if errorlevel 1 (
  echo.
  echo Could not create the task. A "once" task whose time has already passed
  echo today is the usual reason -- try tomorrow's time, or use daily.
  exit /b 1
)

echo.
echo Scheduled. At %WHEN% (%HOW%^) Edge will be closed and relaunched, and the
echo pinned queue tab woken about a minute later.
echo.
echo Check the extension popup has "Wake the queue tab when the browser starts"
echo ticked, the ready time armed, and the campaign tab pinned.
