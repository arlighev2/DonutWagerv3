#!/bin/bash

RESTART_DELAY=180
SHUTTING_DOWN=0
LOG_CHANNEL_ID="1500275139311439942"

send_embed() {
  local title="$1"
  local description="$2"
  local color="$3"
  curl -s -X POST "https://discord.com/api/v10/channels/${LOG_CHANNEL_ID}/messages" \
    -H "Authorization: Bot ${DISCORD_BOT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"embeds\":[{\"title\":\"${title}\",\"description\":\"${description}\",\"color\":${color},\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}]}" \
    > /dev/null 2>&1
}

cleanup() {
  SHUTTING_DOWN=1
  echo "[watchdog] $(date '+%Y-%m-%d %H:%M:%S') — Stopped by signal."
  send_embed "Bot Stopped" "The workflow was stopped manually." "6316128"
  exit 0
}

trap cleanup SIGTERM SIGINT

while true; do
  echo "[watchdog] $(date '+%Y-%m-%d %H:%M:%S') — Starting Discord bot..."

  pnpm --filter @workspace/discord-bot run start
  EXIT_CODE=$?

  # Trap fires before this line if SIGTERM caused the exit — stop cleanly
  if [ $SHUTTING_DOWN -eq 1 ]; then
    exit 0
  fi

  echo "[watchdog] $(date '+%Y-%m-%d %H:%M:%S') — Bot stopped (code: $EXIT_CODE). Restarting in ${RESTART_DELAY}s..."

  if [ $EXIT_CODE -ne 0 ]; then
    send_embed "Bot Crashed" "Exited with code \`${EXIT_CODE}\`. Restarting in ${RESTART_DELAY}s..." "15548997"
  else
    send_embed "Bot Restarting" "Bot exited cleanly. Restarting in ${RESTART_DELAY}s..." "16776960"
  fi

  sleep $RESTART_DELAY
done
