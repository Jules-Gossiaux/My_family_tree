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

rem Le moteur SQLite est un binaire compile pour une version de Node : la
rem restauration en a besoin pour lire et ecrire la base.
node -e "require('better-sqlite3')" >nul 2>nul
if errorlevel 1 (
  echo Reconciliation du moteur de base de donnees avec cette version de Node...
  call npm rebuild better-sqlite3
  if errorlevel 1 goto echec
)

echo.
echo   Restauration d'une sauvegarde de l'arbre de famille.
echo   Fermez d'abord l'application : la fenetre ouverte par start.bat.
echo.

rem Les arguments de ce fichier sont transmis au script de restauration,
rem pour que « restore.bat --list » fonctionne comme la ligne de commande.
call npm run restore -- %*
if errorlevel 1 goto echec

echo  Appuyez sur une touche pour fermer cette fenetre.
pause >nul
exit /b 0

:echec
echo.
echo   La restauration n'est pas alle au bout : rien n'a ete change, ou la base
echo   a ete remise telle qu'elle etait. Relisez le message ci-dessus, puis
echo   appuyez sur une touche pour fermer cette fenetre.
pause >nul
exit /b 1
