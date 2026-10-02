@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title ClaudePet 설치

where node >nul 2>nul
if errorlevel 1 (
  echo [X] Node.js 를 찾을 수 없어요. https://nodejs.org 에서 LTS 를 설치한 뒤 다시 실행하세요.
  goto :end
)

echo [1/3] Electron 내려받는 중... ^(처음 한 번, 1~2분^)
call npm.cmd install --no-audit --no-fund
if errorlevel 1 (
  echo [X] npm install 실패. 위 오류를 확인하세요.
  goto :end
)

rem 일부 환경에서 Electron 실행 파일 다운로드가 빠지는 경우 복구
node -e "require('electron')" >nul 2>nul
if errorlevel 1 node node_modules\electron\install.js

echo.
echo [2/3] Claude Code 에 훅과 /pet 명령 등록 중...
node scripts\install.js
if errorlevel 1 goto :end

echo.
echo [3/3] 펫 띄우는 중...
node cli.js start

echo.
echo 완료! 이제 Claude Code 를 시작하면 펫이 자동으로 나타나요.
echo 이 폴더를 다른 곳으로 옮기면 이 파일을 한 번 더 실행하세요.

:end
echo.
pause
