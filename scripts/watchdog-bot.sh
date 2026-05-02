#!/bin/bash

RESTART_DELAY=10
BOT_PID=""
SHUTTING_DOWN=0
LOG_CHANNEL_ID="1500275139311439942"

send_embed() {
  local title="$1"
  local description="$2"
  local color="$3"

  curl -s -X POST "https://discord.com/api/v10/channels/${LOG_CHANNEL_ID}/messages" \
    -H "Authorization: Bot ${DISCORD_BOT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{
      \"embeds\": [{
        \"title\": \"${title}\",
        \"description\": \"${description}\",
        \"color\": ${color},
        \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
      }]
    }" > /dev/null 2>&1
}

cleanup() {
  SHUTTING_DOWN=1
  echo "[watchdog] $(date '+%Y-%m-%d %H:%M:%S') — Stop signal received. Shutting down..."
  if [ -n "$BOT_PID" ]; then
    kill "$BOT_PID" 2>/dev/null
    wait "$BOT_PID" 2>/dev/null
  fi
  send_embed "Bot Stopped" "The workflow was stopped manually." "6316128"
  exit 0
}

trap cleanup SIGTERM SIGINT

BOOT_SENT=0

while true; do
  echo "[watchdog] $(date '+%Y-%m-%d %H:%M:%S') — Starting Discord bot..."
  pnpm --filter @workspace/discord-bot run start &
  BOT_PID=$!

  # Send online embed once after confirming the process is still alive
  if [ $BOOT_SENT -eq 0 ]; then
    sleep 8
    if [ $SHUTTING_DOWN -eq 0 ] && kill -0 "$BOT_PID" 2>/dev/null; then
      send_embed "Bot Online" "Donut Wager started and is ready." "2277872"
      BOOT_SENT=1
    fi
  fi

  wait "$BOT_PID"
  EXIT_CODE=$?

  # If we're shutting down intentionally, stop here
  if [ $SHUTTING_DOWN -eq 1 ]; then
    exit 0
  fi

  # Any exit (crash or clean) — always restart
  echo "[watchdog] $(date '+%Y-%m-%d %H:%M:%S') — Bot stopped (exit code: $EXIT_CODE). Restarting in ${RESTART_DELAY}s..."

  if [ $EXIT_CODE -ne 0 ]; then
    send_embed "Bot Crashed" "Exited with code \`${EXIT_CODE}\`. Restarting in ${RESTART_DELAY}s..." "15548997"
  else
    send_embed "Bot Restarting" "Bot exited cleanly (code \`0\`) — may have lost connection. Restarting in ${RESTART_DELAY}s..." "16776960"
  fi

  BOOT_SENT=0
  sleep $RESTART_DELAY
done
