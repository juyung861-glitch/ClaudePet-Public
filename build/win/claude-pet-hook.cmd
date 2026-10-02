@echo off
rem ClaudePet hook runner: runs hook.js with ClaudePet.exe as Node (no Node.js install needed)
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0ClaudePet.exe" "%~dp0resources\app\hook.js" %*
endlocal
