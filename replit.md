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
- Games: `/coinflip`, `/roulette`, `/blackjack`, `/mines`, `/towers`, `/dice`
- Moderator: `/admin approve|deny|withdraw|setbalance|setmodrole|config|forceverify|...`
- Help: `/help`

### House edge

All games consult `src/lib/house.ts`. The two tunables are `HOUSE_WIN_RATE`
(default `0.56`) and `BIG_BET_HOUSE_RATE` (default `0.59` for huge bets).
Each round calls `houseShouldWin(bet)` to flag the round for the house.
A second helper, `riggingBias(bet) = max(0, (rate - 0.5) * 2)`, scales how
hard the per-action rigging swings inside individual games (mines tile
relocation, blackjack card cherry-picking, towers survival threshold). At
`HOUSE_WIN_RATE = 0.5` `riggingBias` is exactly `0`, so every game becomes
fully fair.

`/dice` is Stake-style: roll is a decimal `0.01–100.00`, player picks a
target between `1.00–99.00` and Under/Over. Multiplier = `99/winChance`.

### Withdraw flow

`/withdraw <amount>` validates balance, opens a private ticket, **debits the
user immediately**, and inserts a row in `bot_pending_withdrawals` keyed by
the channel id. The ticket embed asks `your IGN is X — is that correct?`
with two buttons: **Yes** (confirms) and **Cancel** (refunds + auto-deletes
the channel after 10s). If the IGN is wrong, the user cancels and tells
staff — no in-bot rename to keep the flow dupe-proof.

`/admin withdraw <user> <amount>` checks for a pending row in the current
channel: if one exists and matches the user/amount, it just marks it `paid`
(no second debit). Otherwise it falls back to the legacy debit-now flow.

**Dupe protection:** `markPendingWithdrawalCancelled` and
`markPendingWithdrawalPaid` use `WHERE status = 'pending'` and return a
`boolean` reporting whether the UPDATE actually flipped the row. The cancel
handler ALSO defers the interaction first, then only calls `adjustBalance`
when the flip returned `true` — so simultaneous button clicks (or Discord
double-fires) can never refund twice.

### Casino panel

A header embed with **⚙️ Settings**, **📥 Deposit**, **📤 Withdraw**,
**💰 Balance** buttons. Auto-posted on bot startup to channel
`1498881450643296400` (configurable via `bot_config.panel_channel_id`); the
posted message id is remembered in `bot_config.panel_message_id` so reboots
don't dupe the panel. Owners can re-post anywhere with `/admin panel`.

Settings opens a verification ticket (same flow as `/verify`). Deposit and
Withdraw open a modal asking for the amount, then create the matching
ticket — withdraw uses the same debit-now flow as the slash command.

### Database tables (auto-created on boot)

- `bot_users` — discord_id, minecraft_username, verified, balance, stats
- `bot_config` — key/value config (mod role, ticket category)
- `bot_balance_ledger` — every balance change with source + detail
- `bot_pending_withdrawals` — open withdrawal tickets (one per channel)
- `bot_coupons` / `bot_coupon_redemptions` — promo codes
- `game_log` — every bet logged for analytics

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/discord-bot run start` — run the bot locally
- `pnpm --filter @workspace/api-server run dev` — run the API server locally
