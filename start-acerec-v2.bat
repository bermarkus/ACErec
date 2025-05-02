@echo off
echo Starting ACErec application with FreeEEG32 optimizations...

:: Set environment variables for FreeEEG32
set ACEREC_DEFAULT_RATE=512
set ACEREC_DEVICE_TYPE=FreeEEG32
set ACEREC_CHANNEL_COUNT=32
set ACEREC_FORCE_DATA=true

:: Change to the application directory
cd /d %~dp0

:: Start the application
npm start
