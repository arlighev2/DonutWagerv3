#!/bin/bash

RESTART_DELAY=10
BOT_PID=""
LOG_CHANNEL_ID="1500275139311439942"

send_embed() {
  local title="$1"
  local description="$2"
  local color="$3"  # decimal int

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
    }" > /dev/null
}

cleanup() {
  echo "[watchdog] $(date '+%Y-%m-%d %H:%M:%S') — Received stop signal. Shutting down..."
  if [ -n "$BOT_PID" ]; then
    kill "$BOT_PID" 2>/dev/null
    wait "$BOT_PID" 2>/dev/null
  fi
  send_embed "Bot Stopped" "The bot was manually stopped or the workflow was restarted." "6316128"
  exit 0
}

trap cleanup SIGTERM SIGINT

BOOT_SENT=0

while true; do
  echo "[watchdog] $(date '+%Y-%m-%d %H:%M:%S') — Starting Discord bot..."
  pnpm --filter @workspace/discord-bot run start &
  BOT_PID=$!

  # Send online embed once after first successful-looking start
  if [ $BOOT_SENT -eq 0 ]; then
    sleep 8
    if kill -0 "$BOT_PID" 2>/dev/null; then
      send_embed "Bot Online" "Donut Wager started successfully and is ready." "2277872"
      BOOT_SENT=1
    fi
  fi

  wait "$BOT_PID"
  EXIT_CODE=$?

  # Clean stop — don't restart
  if [ $EXIT_CODE -eq 0 ] || [ $EXIT_CODE -eq 130 ] || [ $EXIT_CODE -eq 143 ]; then
    echo "[watchdog] $(date '+%Y-%m-%d %H:%M:%S') — Bot exited cleanly (code: $EXIT_CODE). Stopping watchdog."
    send_embed "Bot Stopped" "The bot exited cleanly (code: \`${EXIT_CODE}\`)." "6316128"
    exit 0
  fi

  echo "[watchdog] $(date '+%Y-%m-%d %H:%M:%S') — Bot crashed (exit code: $EXIT_CODE). Restarting in ${RESTART_DELAY}s..."
  send_embed "Bot Crashed" "The bot crashed with exit code \`${EXIT_CODE}\`. Restarting in ${RESTART_DELAY}s..." "15548997"
  BOOT_SENT=0
  sleep $RESTART_DELAY
done
