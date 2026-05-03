@echo off
cd /d C:\Project\NexaPos

echo ============================================
echo   DEPLOY SCRIPT - emoji
echo ============================================
echo.
echo Choose an option:
echo [1] Normal Push
echo [2] Reset Git and Push
echo [3] Pull from GitHub
echo.

set /p choice=Enter your choice (1, 2, or 3): 

if "%choice%"=="1" goto normal
if "%choice%"=="2" goto reset
if "%choice%"=="3" goto pull
goto end

:normal
echo --------------------------------------------
echo Performing Normal Push...
git add .
git commit -m "update code"
git push -u origin main --force
goto end

:reset
echo --------------------------------------------
echo Resetting Git and Pushing Fresh Repo...
rmdir .git /s /q
git init
git branch -M main
git remote add origin https://github.com/shayetet13/nexapos.git
git add .
git commit -m "Initial commit - all files"
git push -u origin main --force
goto end

:pull
echo --------------------------------------------
echo Pulling Latest Code from GitHub...
git pull origin main
goto end

:end
echo --------------------------------------------
echo Finished 
pause
