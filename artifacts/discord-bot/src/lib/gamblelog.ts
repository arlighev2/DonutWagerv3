import { ChannelType, EmbedBuilder, type Client } from "discord.js";
import {
  ADMIN_LOG_CHANNEL_ID,
  GAMBLE_LOG_CHANNEL_ID,
  WITHDRAW_LOG_CHANNEL_ID,
} from "./constants.js";
import { formatCoins, formatCoinsShort } from "./format.js";

let cachedClient: Client | null = null;

export function setLogClient(client: Client): void {
  cachedClient = client;
}

/**
 * Append a one-line gamble log entry to the gambling log channel. Failures
 * are swallowed — losing the log must never break a game.
 */
export async function logGamble(params: {
  discordId: string;
  game: string;
  bet: bigint;
  payout: bigint;
  won: boolean;
  detail?: string;
}): Promise<void> {
  if (!cachedClient) return;
  try {
    const ch = await cachedClient.channels.fetch(GAMBLE_LOG_CHANNEL_ID);
    if (!ch || ch.type !== ChannelType.GuildText) return;
    const net = params.won ? params.payout - params.bet : params.bet;
    const verb = params.won ? "won" : "lost";
    const marker = params.won ? "✅" : "❌";
    const detail = params.detail ? ` · ${params.detail}` : "";
    await ch.send({
      content: `${marker} <@${params.discordId}> ${verb} ${formatCoins(net)} on **${params.game}** (bet ${formatCoins(params.bet)})${detail}`,
      // Don't actually ping anyone — the mention is just a clickable reference.
      allowedMentions: { parse: [] },
    });
  } catch {
    /* ignore */
  }
}

/**
 * Post a casino-withdraw vouch line to the public vouches channel.
 * Plain-text format requested by ownership:
 *   `Vouch <@id> — WITHDREW 500m (Casino)`
 * Discord renders the message timestamp ("Yesterday at 12:56 AM") below it
 * automatically — no need to embed it.
 */
export async function postVouch(params: {
  vouchChannelId: string;
  discordId: string;
  amount: bigint;
}): Promise<void> {
  if (!cachedClient) return;
  try {
    const ch = await cachedClient.channels.fetch(params.vouchChannelId);
    if (!ch || ch.type !== ChannelType.GuildText) return;
    await ch.send({
      content: `Vouch <@${params.discordId}> — WITHDREW ${formatCoinsShort(params.amount)} (Casino)`,
      allowedMentions: { parse: [] },
    });
  } catch {
    /* ignore */
  }
}

/**
 * Post an IRL-sale vouch line. Format requested by ownership:
 *   `Vouch <@id> donut auto - SOLD 500m ($16.50)`
 * Used by `/admin irlwithdraw` when a user sells DonutSMP $ for real money
 * at the current sell rate (0.033 USD per million).
 */
export async function postIrlSaleVouch(params: {
  vouchChannelId: string;
  discordId: string;
  amountCoins: bigint;
  usd: number;
}): Promise<void> {
  if (!cachedClient) return;
  try {
    const ch = await cachedClient.channels.fetch(params.vouchChannelId);
    if (!ch || ch.type !== ChannelType.GuildText) return;
    await ch.send({
      content: `Vouch <@${params.discordId}> donut auto - SOLD ${formatCoinsShort(params.amountCoins)} ($${params.usd.toFixed(2)})`,
      allowedMentions: { parse: [] },
    });
  } catch {
    /* ignore */
  }
}

/**
 * Append a one-line entry to the dedicated withdraw-history channel.
 * Logs every casino payout AND every IRL sale so staff have a full
 * record of money leaving the bot.
 */
export async function logWithdraw(params: {
  discordId: string;
  staffId: string;
  staffTag: string;
  amount: bigint;
  kind: "casino" | "irl";
  usd?: number;
  detail?: string;
}): Promise<void> {
  if (!cachedClient) return;
  try {
    const ch = await cachedClient.channels.fetch(WITHDRAW_LOG_CHANNEL_ID);
    if (!ch || ch.type !== ChannelType.GuildText) return;
    const tag =
      params.kind === "irl"
        ? `IRL SALE · $${(params.usd ?? 0).toFixed(2)}`
        : "CASINO WITHDRAW";
    const detail = params.detail ? ` · ${params.detail}` : "";
    await ch.send({
      content:
        `📤 **${tag}** — <@${params.discordId}> · ` +
        `${formatCoinsShort(params.amount)} · ` +
        `staff: ${params.staffTag} (<@${params.staffId}>)${detail}`,
      allowedMentions: { parse: [] },
    });
  } catch {
    /* ignore */
  }
}

/**
 * Audit-log a sensitive admin / economy action (coupon creation, admin
 * payouts, balance edits). Posts a compact embed to the admin log channel.
 */
export async function logAdminAction(params: {
  actorId: string;
  actorTag: string;
  action: string; // e.g. "Coupon Created", "Payout", "Balance Set"
  targetId?: string; // user the action affected, if any
  amount?: bigint; // delta or absolute, in coins
  detail?: string; // free-form extra info (code, reason, etc.)
  good?: boolean; // green if true (default), red otherwise
}): Promise<void> {
  if (!cachedClient) return;
  try {
    const ch = await cachedClient.channels.fetch(ADMIN_LOG_CHANNEL_ID);
    if (!ch || ch.type !== ChannelType.GuildText) return;

    const embed = new EmbedBuilder()
      .setColor(params.good === false ? 0xef4444 : 0x22c55e)
      .setTitle(params.action)
      .setTimestamp(new Date())
      .setFooter({ text: `By ${params.actorTag} (${params.actorId})` });

    const fields: { name: string; value: string; inline?: boolean }[] = [];
    if (params.targetId) {
      fields.push({
        name: "Target",
        value: `<@${params.targetId}>`,
        inline: true,
      });
    }
    if (params.amount !== undefined) {
      fields.push({
        name: "Amount",
        value: `${formatCoins(params.amount)}`,
        inline: true,
      });
    }
    if (params.detail) {
      fields.push({ name: "Detail", value: params.detail, inline: false });
    }
    if (fields.length) embed.addFields(...fields);

    await ch.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch {
    /* ignore */
  }
}
