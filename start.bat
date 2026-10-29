@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js n'est pas installe.
  echo   Telechargez-le sur https://nodejs.org puis relancez ce fichier.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installation des dependances, une seule fois...
  call npm install --no-audit --no-fund
)

if not exist dist (
  echo Compilation de l'interface...
  call npm run build
)

echo.
echo   Arbre de famille demarre sur http://localhost:4321
echo   Fermez cette fenetre pour arreter.
echo.
start "" http://localhost:4321
call npm start
