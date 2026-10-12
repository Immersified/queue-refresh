@echo off
setlocal
REM ---------------------------------------------------------------------------
REM Launches Edge in a state that survives an RDP disconnect.
REM
REM   start-edge.bat                 launch, leaving any running Edge alone
REM   start-edge.bat /restart        close Edge first, then launch fresh
REM   start-edge.bat "<url>"         one-off on a different page
REM
REM With no URL Edge restores its pinned tabs, and the pinned Mercor tab is the
REM campaign page. That tab is the only place the campaign URL lives, so a
REM campaign that changes needs nothing changed here: open the new link in the
REM pinned tab and that is the whole update.
REM
REM A restored pinned tab is an empty placeholder until something activates it.
REM The extension does that on browser start -- tick "Wake the queue tab when
REM the browser starts" in the popup -- so there is no need to click it by hand.
REM It only wakes the tab while an arm is ahead; the arm decides when to join.
REM
REM WHY /restart EXISTS
REM   The extension joins on chrome.runtime.onStartup, which only fires when
REM   Edge actually starts. Launching it while it is already running just adds
REM   a window to the existing process: no startup event, nothing joins. The
REM   scheduled task registered by schedule-launch.bat passes /restart for
REM   exactly this reason, since a browser left open overnight is the normal
REM   state on a machine that does this every day.
REM ---------------------------------------------------------------------------

set "RESTART="
set "QUEUE_URL="

if /i "%~1"=="/restart" (
  set "RESTART=1"
  set "QUEUE_URL=%~2"
) else (
  set "QUEUE_URL=%~1"
)

set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"

if not exist "%EDGE%" (
  echo Could not find msedge.exe in either Program Files folder.
  exit /b 1
)

if defined RESTART call :restart

REM CalculateNativeWinOcclusion is the one that matters. Without it Windows
REM tells Edge the window is hidden the moment the RDP session detaches, and
REM Edge suspends the renderer: the tab stops loading, timers freeze, and
REM screenshots come back blank. The rest stop a background tab being throttled
REM to one timer tick a minute.
set "FLAGS=--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling"
set "FLAGS=%FLAGS% --disable-backgrounding-occluded-windows"
set "FLAGS=%FLAGS% --disable-background-timer-throttling"
set "FLAGS=%FLAGS% --disable-renderer-backgrounding"
set "FLAGS=%FLAGS% --start-maximized"

REM No URL: Edge restores the pinned tabs and nothing else is opened. Passing a
REM placeholder here would put a dead tab in front of the one that matters.
if "%QUEUE_URL%"=="" (
  start "" "%EDGE%" %FLAGS%
) else (
  start "" "%EDGE%" %FLAGS% "%QUEUE_URL%"
)
exit /b 0

REM ---------------------------------------------------------------------------
:restart
tasklist /fi "imagename eq msedge.exe" 2>nul | find /i "msedge.exe" >nul
if errorlevel 1 (
  echo Edge is not running. Launching.
  exit /b 0
)

REM Ask first, without /f. A graceful close is what writes the session file, so
REM the pinned tabs are there to restore afterwards. Force-killing can lose
REM them, which would take the campaign URL with it.
echo Closing Edge so the extension sees a real browser start...
taskkill /im msedge.exe >nul 2>&1

REM Edge takes a moment to flush the session and let go of the profile lock.
REM Launching into a half-closed profile is how you get a second profile.
for /l %%i in (1,1,15) do (
  timeout /t 1 /nobreak >nul
  tasklist /fi "imagename eq msedge.exe" 2>nul | find /i "msedge.exe" >nul
  if errorlevel 1 goto :closed
)

echo Edge did not close on its own after 15s. Forcing it.
echo Pinned tabs may not be restored -- check the tab before the next run.
taskkill /f /im msedge.exe >nul 2>&1
timeout /t 3 /nobreak >nul

:closed
exit /b 0
