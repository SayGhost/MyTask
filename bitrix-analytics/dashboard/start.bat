@echo off
chcp 65001 >nul
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 server.py
  goto end
)
where python >nul 2>nul
if %errorlevel%==0 (
  python server.py
  goto end
)
echo Python не найден. Установите его с https://www.python.org/downloads/
echo При установке отметьте галочку "Add python.exe to PATH", затем запустите этот файл снова.
:end
pause
