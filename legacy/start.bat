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
  if errorlevel 1 goto echec
)

rem Le moteur SQLite est un binaire compile pour une version de Node : il ne
rem survit pas a une mise a jour de Node. On le recompile ici plutot que de
rem laisser apparaitre une erreur technique illisible pour un debutant.
node -e "require('better-sqlite3')" >nul 2>nul
if errorlevel 1 (
  echo Reconciliation du moteur de base de donnees avec cette version de Node...
  call npm rebuild better-sqlite3
  if errorlevel 1 goto echec
)

if not exist dist (
  echo Compilation de l'interface...
  call npm run build
  if errorlevel 1 goto echec
)

echo.
echo   Arbre de famille demarre sur http://localhost:4321
echo   La page s'ouvrira des que le serveur est pret.
echo   Fermez cette fenetre pour arreter.
echo.

rem Le serveur ouvre le navigateur quand il ecoute vraiment : ouvrir la page
rem trop tot afficherait une erreur de connexion.
set OPEN_BROWSER=1
call npm start
if errorlevel 1 goto echec
exit /b 0

:echec
echo.
echo   Le demarrage a echoue. Relisez le message ci-dessus, puis appuyez
echo   sur une touche pour fermer cette fenetre.
pause >nul
exit /b 1
