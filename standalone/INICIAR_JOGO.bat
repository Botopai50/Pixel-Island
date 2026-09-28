@echo off
chcp 65001 >nul
title Pixel Island
cd /d "%~dp0"

echo.
echo ==========================================
echo          PIXEL ISLAND - INICIADOR
echo ==========================================
echo.
echo Iniciando o jogo...
echo Nao feche esta janela enquanto estiver jogando.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0SERVIDOR_LOCAL.ps1"

if errorlevel 1 (
  echo.
  echo Nao foi possivel iniciar o jogo.
  echo Pressione qualquer tecla para fechar.
  pause >nul
)
