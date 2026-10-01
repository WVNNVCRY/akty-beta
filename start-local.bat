@echo off
chcp 65001 >nul
rem Локальный стенд «Акты скрытых работ» в Docker Desktop (Windows).
rem   start-local.bat          — собрать и запустить; при первом запуске заполнить БД
rem   start-local.bat --demo   — пересоздать БД с тестовыми объектами
rem   start-local.bat --reset  — пересоздать БД без объектов
rem   start-local.bat --stop   — остановить
cd /d "%~dp0"
set DC=docker compose -f local\docker-compose.yml

where docker >nul 2>nul || (echo Нужен Docker Desktop: https://docs.docker.com/desktop/install/windows-install/ & pause & exit /b 1)

if "%1"=="--stop" (%DC% down & echo Стенд остановлен. & exit /b 0)

echo -^> Сборка и запуск (первый раз 3-5 минут)...
%DC% up -d --build || (pause & exit /b 1)

echo -^> Ожидание готовности сервера...
set /a N=0
:wait
curl -fsS http://localhost:8080/api/health >nul 2>nul && goto ready
set /a N+=1
if %N% geq 90 (echo Сервер не ответил. Журнал: %DC% logs app & pause & exit /b 1)
timeout /t 2 /nobreak >nul
goto wait
:ready

set USERS=0
for /f %%c in ('%DC% exec -T db psql -U akty -d akty -tAc "SELECT count(*) FROM users" 2^>nul') do set USERS=%%c
set SEEDDEMO=
if "%1"=="--demo" set SEEDDEMO=1
if "%1"=="--reset" set SEEDDEMO=0
if "%SEEDDEMO%"=="" if "%USERS%"=="0" set SEEDDEMO=0
if not "%SEEDDEMO%"=="" (
  %DC% exec -T -e SEED_RESET=1 -e SEED_DEMO_OBJECTS=%SEEDDEMO% app npx tsx prisma/seed.ts >nul && echo -^> База заполнена
)

echo.
echo   Готово:  http://localhost:8080
echo   Вход: gc / manager / mech / hand / thermo / client / client2, пароль 123
echo   Остановить: start-local.bat --stop
start "" http://localhost:8080
pause
