@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   人物图谱启动中... 启动后请访问 http://localhost:3210
echo   按 Ctrl+C 可停止服务
echo ============================================
node server.js
pause