#!/bin/bash
# Production entry point — runs the Discord bot watchdog.
# A minimal HTTP server handles health checks on $PORT so Replit's
# deployment system can verify the process is alive.

PORT="${PORT:-8080}"

# Start a tiny health-check responder in the background
node -e "
const http = require('http');
http.createServer((req, res) => {
  res.writeHead(req.url === '/api/healthz' ? 200 : 404);
  res.end(req.url === '/api/healthz' ? 'ok' : 'not found');
}).listen(${PORT}, () => console.log('[health] listening on ${PORT}'));
" &

# Run the bot watchdog in the foreground (restarts on crash)
exec bash scripts/watchdog-bot.sh
