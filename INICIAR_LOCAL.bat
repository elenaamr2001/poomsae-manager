@echo off
setlocal
if not exist node_modules (
  echo Instalando dependencias...
  call npm install
)
echo.
echo Iniciando Poomsae Manager en http://localhost:8080
call npm start
pause
