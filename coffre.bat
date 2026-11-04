@echo off
setlocal

rem Coffre de l'arbre : le cloud descend sur le disque. Le Planificateur de
rem taches appelle ce fichier chaque dimanche, et il s'execute aussi en
rem double-cliquant dessus.
rem
rem Aucune cle secrete ici : server/coffre.ts relit .env.local lui-meme.
rem Rien n'est supprime, rien n'est remplace : une archive de plus s'empile a
rem cote des autres, dans le dossier des sauvegardes.

cd /d "%~dp0"

rem Le dossier des donnees, comme le resout server/config.ts : FAMILY_DATA_DIR,
rem sinon D:\Genealogie. Sert seulement a ecrire une ligne quand le script
rem n'a pas pu le faire lui-meme.
set DATAS=%FAMILY_DATA_DIR%
if "%DATAS%"=="" set DATAS=D:\Genealogie

where node >nul 2>nul
if not errorlevel 1 goto :coffre

rem Le script n'a meme pas demarre : son journal ne peut rien dire, c'est ici.
if not exist "%DATAS%\sauvegardes" mkdir "%DATAS%\sauvegardes"
echo [%DATE% %TIME%] ECHEC — node est introuvable pour le Planificateur de taches>> "%DATAS%\sauvegardes\coffre.log"
exit /b 1

:coffre
call npm run coffre
if not errorlevel 1 exit /b 0

rem Le script a pu s'arreter avant d'ecrire son journal : cette ligne le
rem signale, la raison se lit juste au-dessus quand elle existe.
echo [%DATE% %TIME%] Arrete ici — la raison est la ligne ci-dessus, ou npm n'a pas pu demarrer>> "%DATAS%\sauvegardes\coffre.log"
echo.
echo   Le coffre n'est pas alle au bout : voir le fichier coffre.log du dossier des sauvegardes.
exit /b 1
