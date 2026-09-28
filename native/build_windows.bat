@echo off
setlocal

where cmake >nul 2>nul
if errorlevel 1 (
  echo CMake nao encontrado.
  echo Instale Visual Studio 2022 com Desktop development with C++ e o CMake.
  pause
  exit /b 1
)

if "%VCPKG_ROOT%"=="" (
  echo Defina VCPKG_ROOT apontando para sua instalacao do vcpkg.
  echo Exemplo: set VCPKG_ROOT=C:\vcpkg
  pause
  exit /b 1
)

cmake -S . -B build -A x64 -DCMAKE_TOOLCHAIN_FILE="%VCPKG_ROOT%\scripts\buildsystems\vcpkg.cmake"
if errorlevel 1 exit /b 1

cmake --build build --config Release
if errorlevel 1 exit /b 1

echo.
echo Build concluido:
echo build\Release\PixelIslandNative.exe
pause
