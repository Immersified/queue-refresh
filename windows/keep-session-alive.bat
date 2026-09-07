@echo off
REM ---------------------------------------------------------------------------
REM Run this INSTEAD of closing your RDP window.
REM
REM Disconnecting normally leaves the session with no display, so Edge stops
REM rendering. Redirecting it to the console keeps a real desktop attached, so
REM everything carries on drawing with nobody watching.
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
