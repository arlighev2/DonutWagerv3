#!/bin/bash

RESTART_DELAY=10
BOT_PID=""

cleanup() {
  echo "[watchdog] $(date '+%Y-%m-%d %H:%M:%S') — Received stop signal. Shutting down..."
  if [ -n "$BOT_PID" ]; then
    kill "$BOT_PID" 2>/dev/null
    wait "$BOT_PID" 2>/dev/null
  fi
  exit 0
}

trap cleanup SIGTERM SIGINT

while true; do
  echo "[watchdog] $(date '+%Y-%m-%d %H:%M:%S') — Starting Discord bot..."
  pnpm --filter @workspace/discord-bot run start &
  BOT_PID=$!
  wait "$BOT_PID"
  EXIT_CODE=$?

  # Exit cleanly if we were stopped intentionally
  if [ $EXIT_CODE -eq 0 ] || [ $EXIT_CODE -eq 130 ] || [ $EXIT_CODE -eq 143 ]; then
    echo "[watchdog] $(date '+%Y-%m-%d %H:%M:%S') — Bot exited cleanly (code: $EXIT_CODE). Stopping watchdog."
    exit 0
  fi

  echo "[watchdog] $(date '+%Y-%m-%d %H:%M:%S') — Bot crashed (exit code: $EXIT_CODE). Restarting in ${RESTART_DELAY}s..."
  sleep $RESTART_DELAY
done
