#!/usr/bin/env node

/**
 * DOIP Unified Runner
 * Starts both the FastAPI backend (port 8000) and the Vite frontend (port 8080)
 * in a single command with unified logs and graceful shutdown.
 */

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const backendDir = resolve(rootDir, "backend");

const isWin = process.platform === "win32";
const pythonCmd = isWin ? "python" : "python3";
const npxCmd = isWin ? "npx.cmd" : "npx";

console.log("\x1b[36m%s\x1b[0m", "============================================================");
console.log("\x1b[1m\x1b[32m%s\x1b[0m", "  DOIP — Defense Operations Intelligence Platform");
console.log("\x1b[36m%s\x1b[0m", "============================================================");
console.log("\x1b[33m%s\x1b[0m", "  [Backend API]   http://127.0.0.1:8000 (FastAPI + WebSocket)");
console.log("\x1b[32m%s\x1b[0m", "  [Frontend Web]  http://localhost:8080 (Command Center UI)");
console.log("\x1b[36m%s\x1b[0m", "============================================================");
console.log("\x1b[90m%s\x1b[0m\n", "  Press Ctrl+C at any time to stop all services.\n");

function prefixStream(stream, prefix, colorCode) {
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.trim()) {
        console.log(`\x1b[${colorCode}m[${prefix}]\x1b[0m ${line}`);
      }
    }
  });
}

// 1. Spawn Backend
const backend = spawn(pythonCmd, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"], {
  cwd: backendDir,
  shell: isWin,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PYTHONUNBUFFERED: "1" },
});

prefixStream(backend.stdout, "BACKEND", "36"); // Cyan
prefixStream(backend.stderr, "BACKEND", "36");

backend.on("error", (err) => {
  console.error("\x1b[31m[BACKEND ERROR]\x1b[0m Failed to start backend:", err.message);
});

// 2. Spawn Frontend
const frontend = spawn(npxCmd, ["vite", "dev", "--port", "8080", "--host"], {
  cwd: rootDir,
  shell: isWin,
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
});

prefixStream(frontend.stdout, "FRONTEND", "32"); // Green
prefixStream(frontend.stderr, "FRONTEND", "32");

frontend.on("error", (err) => {
  console.error("\x1b[31m[FRONTEND ERROR]\x1b[0m Failed to start frontend:", err.message);
});

// Clean shutdown handler
let isShuttingDown = false;
function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log("\n\x1b[33m%s\x1b[0m", "Shutting down all DOIP services...");

  if (backend && !backend.killed) {
    if (isWin) {
      spawn("taskkill", ["/pid", String(backend.pid), "/f", "/t"], { stdio: "ignore" });
    } else {
      backend.kill("SIGTERM");
    }
  }

  if (frontend && !frontend.killed) {
    if (isWin) {
      spawn("taskkill", ["/pid", String(frontend.pid), "/f", "/t"], { stdio: "ignore" });
    } else {
      frontend.kill("SIGTERM");
    }
  }

  setTimeout(() => {
    console.log("\x1b[32m%s\x1b[0m", "All services stopped.");
    process.exit(0);
  }, 1000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", shutdown);
