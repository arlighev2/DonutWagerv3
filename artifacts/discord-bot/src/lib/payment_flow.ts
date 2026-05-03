import { EmbedBuilder, type Client, type Message } from "discord.js";
import {
  adjustBalance,
  claimPaymentMessage,
  completePendingDeposit,
  findUserByMinecraftUsername,
  getPendingDepositByDiscordId,
  getOrCreateUser,
  recordBalanceEvent,
} from "./db.js";
import { formatCoins, parseAmount } from "./format.js";

export const PAYMENT_CHANNEL_ID = "1499922045843144875";
const PAYMENT_WEBHOOK_ID = "1499922327771680798";
const DEPOSIT_LOG_CHANNEL_ID = "1498440931026927817";

// Matches: "💰 Payment received: $1 million from player123"
// or      "💰 Payment received: 1 thousand from player123"
// or      "💰 Payment received: $500 from player123"
const PAYMENT_REGEX =
  /payment received:\s*\$?([\d.,]+(?:\s*(?:trillion|billion|million|thousand|tril|bill|bil|mill|mil|thou|k|m|b|t))?)\s+from\s+(\S+)/i;

export async function handlePaymentMessage(
  message: Message,
  client: Client<true>,
): Promise<void> {
  if (message.channelId !== PAYMENT_CHANNEL_ID) return;
  if (message.webhookId !== PAYMENT_WEBHOOK_ID) return;

  // Deduplicate across multiple bot instances (e.g. dev + prod running simultaneously).
  // Only the first instance to claim this message ID will process it.
  const claimed = await claimPaymentMessage(message.id);
  if (!claimed) {
    console.log(`[payment] Message ${message.id} already claimed by another instance — skipping.`);
    return;
  }

  const match = message.content.match(PAYMENT_REGEX);
  if (!match) {
    console.log(
      `[payment] Unrecognised format — skipping: ${message.content}`,
    );
    return;
  }

  const amountStr = match[1]!.trim();
  const mcUsername = match[2]!.trim();

  const coins = parseAmount(amountStr);
  if (!coins || coins <= 0n) {
    console.log(`[payment] Could not parse amount "${amountStr}" — skipping.`);
    return;
  }

  const ch = message.channel;
  const send = async (payload: string | { embeds: EmbedBuilder[] }) => {
    if ("send" in ch) {
      await (ch as { send: (p: typeof payload) => Promise<unknown> }).send(payload);
    }
  };

  const user = await findUserByMinecraftUsername(mcUsername);

  if (!user || !user.verified) {
    await send(
      `❌ No verified account found for **${mcUsername}**. They need to verify their Minecraft account via the casino panel first.`,
    );
    return;
  }

  const pendingDeposit = await getPendingDepositByDiscordId(user.discord_id);
  if (!pendingDeposit) {
    await send(
      `❌ **${mcUsername}** (<@${user.discord_id}>) does not have an open deposit ticket. They need to open one via the casino panel before paying.`,
    );
    return;
  }

  const expectedCoins = BigInt(pendingDeposit.amount);
  if (coins !== expectedCoins) {
    const expected = formatCoins(expectedCoins);
    const got = formatCoins(coins);
    await send(
      `❌ Wrong amount from **${mcUsername}** (<@${user.discord_id}>). ` +
      `Their ticket is for **${expected}** but they paid **${got}**. ` +
      `They need to pay the exact amount stated in their deposit ticket.`,
    );
    return;
  }

  await getOrCreateUser(user.discord_id);
  const newBal = await adjustBalance(user.discord_id, coins);
  await recordBalanceEvent({
    discordId: user.discord_id,
    delta: coins,
    source: "deposit",
    detail: `in-game payment`,
  });
  await completePendingDeposit(pendingDeposit.id);

  console.log(
    `[payment] Credited ${formatCoins(coins)} to ${mcUsername} (<@${user.discord_id}>). New balance: ${formatCoins(newBal)}`,
  );

  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle("💰 Payment Credited")
    .addFields(
      { name: "Player", value: mcUsername, inline: true },
      { name: "Discord", value: `<@${user.discord_id}>`, inline: true },
      { name: "Amount", value: formatCoins(coins), inline: true },
      { name: "New Balance", value: formatCoins(newBal), inline: true },
    )
    .setTimestamp();

  await send({ embeds: [embed] });

  // Close the deposit ticket 5 seconds after crediting.
  try {
    const ticketChannel = await client.channels.fetch(pendingDeposit.channel_id);
    if (ticketChannel && "send" in ticketChannel && "delete" in ticketChannel) {
      const tc = ticketChannel as {
        send: (p: unknown) => Promise<unknown>;
        delete: (reason?: string) => Promise<unknown>;
      };
      await tc.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x22c55e)
            .setTitle("✅ Deposit Received")
            .setDescription(`Payment of ${formatCoins(coins)} has been credited to <@${user.discord_id}>.\nThis ticket will close in **5 seconds**.`),
        ],
      });
      setTimeout(() => {
        void tc.delete("Deposit completed — auto-close").catch(() => {});
      }, 5_000);
    }
  } catch {
    // Ticket channel already deleted or unreachable — no action needed.
  }

  try {
    const logChannel = await client.channels.fetch(DEPOSIT_LOG_CHANNEL_ID);
    if (logChannel?.isTextBased() && "send" in logChannel) {
      await (logChannel as { send: (p: unknown) => Promise<unknown> }).send({
        embeds: [embed],
      });
    }
  } catch {
    // Log channel unreachable — deposit still went through.
  }
}
