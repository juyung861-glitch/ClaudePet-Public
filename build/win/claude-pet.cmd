@echo off
rem ClaudePet command line:  claude-pet list / use <pet> / install <link> / signal done ...
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0ClaudePet.exe" "%~dp0resources\app\cli.js" %*
endlocal
