@echo off
REM ---------------------------------------------------------------------------
REM NOT NEEDED ANY MORE. Kept for reference. Just close the RDP window.
REM
REM This redirects the session to the console so a real desktop stays attached
REM after you disconnect. That was to stop Edge suspending the renderer -- but
REM --disable-features=CalculateNativeWinOcclusion in start-edge.bat already
REM does that job. Tested on 20 September 2026: a plain disconnect with no
REM tscon left log.csv growing normally.
REM
REM It is worth avoiding, not just skipping. tscon swaps the display
REM mid-session, so screen.width, screen.height and devicePixelRatio all change
REM at once in a live page. That reads as a headless browser and is the most
REM likely reason Cloudflare was asking for verification.
REM
REM Reach for this only if a disconnect ever does freeze the page again, and
REM expect the challenge to come back with it.
REM
REM Your remote view will drop. That is the point. Reconnect any time.
REM Needs an elevated prompt.
REM ---------------------------------------------------------------------------

for /f "tokens=3" %%s in ('query session ^| findstr /r /c:"^>"') do set SESSION=%%s

if "%SESSION%"=="" (
  echo Could not work out the session id. Run: query session
  pause
  exit /b 1
)

echo Redirecting session %SESSION% to the console...
tscon %SESSION% /dest:console
