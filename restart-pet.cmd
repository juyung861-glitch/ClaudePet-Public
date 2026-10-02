@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ClaudePet 다시 시작하는 중...
node cli.js stop >nul 2>nul
timeout /t 2 /nobreak >nul
node cli.js start
timeout /t 3 >nul
