@echo off
REM ---------------------------------------------------------------------------
REM Launches Edge in a state that survives an RDP disconnect.
REM
REM Pass the campaign URL as the first argument, or edit QUEUE_URL below:
REM   start-edge.bat "https://feather.openai.com/campaigns/<id>?tab=tasks"
REM ---------------------------------------------------------------------------

set "QUEUE_URL=%~1"
if "%QUEUE_URL%"=="" set "QUEUE_URL=https://REPLACE-ME.example.com/"

set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"

REM CalculateNativeWinOcclusion is the one that matters. Without it Windows
REM tells Edge the window is hidden the moment the RDP session detaches, and
REM Edge suspends the renderer: the tab stops loading, timers freeze, and
REM screenshots come back blank. The rest stop a background tab being throttled
REM to one timer tick a minute.
start "" "%EDGE%" ^
  --disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling ^
  --disable-backgrounding-occluded-windows ^
  --disable-background-timer-throttling ^
  --disable-renderer-backgrounding ^
  --start-maximized ^
  "%QUEUE_URL%"
