#!/usr/bin/env python3
"""
DOIP Unified Launcher (Python)
Starts both the FastAPI backend (port 8000) and the Vite frontend (port 8080)
in a single command.
"""

import os
import sys
import time
import signal
import subprocess
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = ROOT_DIR / "backend"
IS_WIN = sys.platform.startswith("win")

print("\033[36m" + "=" * 60 + "\033[0m")
print("\033[1m\033[32m  DOIP — Defense Operations Intelligence Platform\033[0m")
print("\033[36m" + "=" * 60 + "\033[0m")
print("\033[33m  [Backend API]   http://127.0.0.1:8000 (FastAPI + WebSocket)\033[0m")
print("\033[32m  [Frontend Web]  http://localhost:8080 (Command Center UI)\033[0m")
print("\033[36m" + "=" * 60 + "\033[0m")
print("\033[90m  Press Ctrl+C at any time to stop all services.\n\033[0m")

python_exe = sys.executable
npx_cmd = "npx.cmd" if IS_WIN else "npx"

# 1. Start Backend
backend_env = os.environ.copy()
backend_env["PYTHONUNBUFFERED"] = "1"
backend_proc = subprocess.Popen(
    [python_exe, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
    cwd=str(BACKEND_DIR),
    env=backend_env,
    shell=IS_WIN,
)

# 2. Start Frontend
frontend_proc = subprocess.Popen(
    [npx_cmd, "vite", "dev", "--port", "8080", "--host"],
    cwd=str(ROOT_DIR),
    shell=IS_WIN,
)

def cleanup(*_):
    print("\n\033[33mShutting down all DOIP services...\033[0m")
    if IS_WIN:
        subprocess.run(["taskkill", "/pid", str(backend_proc.pid), "/f", "/t"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["taskkill", "/pid", str(frontend_proc.pid), "/f", "/t"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        backend_proc.terminate()
        frontend_proc.terminate()
    print("\033[32mAll services stopped.\033[0m")
    sys.exit(0)

signal.signal(signal.SIGINT, cleanup)
signal.signal(signal.SIGTERM, cleanup)

try:
    while True:
        if backend_proc.poll() is not None or frontend_proc.poll() is not None:
            cleanup()
        time.sleep(1)
except KeyboardInterrupt:
    cleanup()
