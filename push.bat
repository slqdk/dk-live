@echo off
setlocal enabledelayedexpansion
title dk-live - send til GitHub
cd /d "%~dp0"

where git >nul 2>&1
if errorlevel 1 (
  echo Git blev ikke fundet. Installer fra https://git-scm.com/download/win
  echo.
  pause & exit /b 1
)

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo Denne mappe er ikke et git-repository.
  echo.
  pause & exit /b 1
)

echo.
echo ================ AENDRINGER ================
git status --short
echo ============================================
echo.

set CHANGED=0
git diff --quiet --exit-code || set CHANGED=1
git diff --cached --quiet --exit-code || set CHANGED=1
for /f "delims=" %%A in ('git ls-files --others --exclude-standard') do set CHANGED=1

if !CHANGED!==0 (
  echo Ingen aendringer. Sender eventuelle ventende commits...
  goto push
)

:ask
set "MSG="
set /p "MSG=Hvad blev der lavet om?  "
if "!MSG!"=="" (
  echo Skriv en kort tekst - eller luk vinduet for at annullere.
  goto ask
)

git add -A || goto fail
git commit -m "!MSG!" || goto fail

:push
echo.
echo ================ SENDER ====================
git push || goto fail

echo.
echo Sendt til GitHub.
echo Opdater containeren: kor  ./update.sh  i /opt/dk-live paa dklive.
echo.
pause
exit /b 0

:fail
echo.
echo *** Noget gik galt - se beskeden ovenfor. ***
echo.
pause
exit /b 1
