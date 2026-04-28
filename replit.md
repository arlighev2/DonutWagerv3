# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Houses a Discord casino/gambling bot
plus the standard API server scaffold.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Database**: PostgreSQL (Replit-managed) via `pg`
- **Discord bot**: discord.js v14 (`artifacts/discord-bot/`)
- **API framework**: Express 5 (`artifacts/api-server/`)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`

## Discord Bot (`artifacts/discord-bot`)

Long-running Node.js process registered as the **Discord Bot** workflow.
Uses two secrets: `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`.

### Commands
- Account: `/verify`, `/balance`, `/daily`, `/leaderboard`
- Banking (creates private staff tickets): `/deposit`, `/withdraw`, `/pay`, `/close`
- Games: `/coinflip`, `/roulette`, `/blackjack`, `/mines`, `/towers`
- Moderator: `/admin approve|deny|payout|setbalance|setmodrole|config`
- Help: `/help`

### House edge

All games consult `src/lib/house.ts`. The single tunable is `HOUSE_WIN_RATE`
(currently `0.65`). Each round calls `houseShouldWin()` which biases the random
outcome generator so the house wins ~65% of bets long-term.

### Database tables (auto-created on boot)

- `bot_users` — discord_id, minecraft_username, verified, balance, stats
- `bot_config` — key/value config (mod role, ticket category)
- `game_log` — every bet logged for analytics

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/discord-bot run start` — run the bot locally
- `pnpm --filter @workspace/api-server run dev` — run the API server locally
