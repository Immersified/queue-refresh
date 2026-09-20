@echo off
REM ---------------------------------------------------------------------------
REM Launches Edge in a state that survives an RDP disconnect.
REM
REM Normally run with no arguments:
REM   start-edge.bat
REM
REM With nothing on the command line Edge restores its pinned tabs, and the
REM pinned Mercor tab is the campaign page. That tab is the only place the
REM campaign URL lives, so a campaign that changes needs nothing changed here:
REM open the new link in the pinned tab and that is the whole update.
REM
REM A restored pinned tab is an empty placeholder until something activates it.
REM The extension does that on browser start -- tick "Join when the browser
REM starts" in the popup -- so there is no need to click it by hand.
REM
REM Pass a URL to override, for a one-off on a different page:
REM   start-edge.bat "https://feather.openai.com/campaigns/<id>?tab=tasks"
REM ---------------------------------------------------------------------------

set "QUEUE_URL=%~1"

set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"

if not exist "%EDGE%" (
  echo Could not find msedge.exe in either Program Files folder.
  exit /b 1
)

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
