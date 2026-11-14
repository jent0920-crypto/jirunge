@echo off
title Jirunge GitHub Push
cls
echo ========================================================
echo   Uploading Jirunge to GitHub (jent0920-crypto/jirunge)
echo ========================================================
echo.
"C:\Users\juyoung\AppData\Local\Programs\Git\cmd\git.exe" push -u origin main
echo.
if %ERRORLEVEL% equ 0 (
    echo ========================================================
    echo   [SUCCESS] Upload completed successfully!
    echo   Vercel will now deploy automatically.
    echo ========================================================
) else (
    echo ========================================================
    echo   [ERROR] Push failed.
    echo ========================================================
)
echo.
pause
