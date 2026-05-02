#!/bin/bash

RESTART_DELAY=10

while true; do
  echo "[watchdog] $(date '+%Y-%m-%d %H:%M:%S') — Starting Discord bot..."
  pnpm --filter @workspace/discord-bot run start
  EXIT_CODE=$?
  echo "[watchdog] $(date '+%Y-%m-%d %H:%M:%S') — Bot stopped (exit code: $EXIT_CODE). Restarting in ${RESTART_DELAY}s..."
  sleep $RESTART_DELAY
done
