import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type TextChannel,
} from "discord.js";
import {
  adjustBalance,
  getOrCreateUser,
  recordBalanceEvent,
  resetUserStats,
  setBalance,
  setConfig,
} from "../lib/db.js";
import { formatCoins, formatCoinsShort, parseAmount } from "../lib/format.js";
import type { SlashCommand } from "../lib/types.js";
import { getConfig } from "../lib/db.js";
import { isOwner, isWithdrawStaff } from "../lib/permissions.js";
import {
  PAID_TICKET_PREFIX,
  VOUCH_CHANNEL_ID,
  WITHDRAW_LOG_CHANNEL_ID,
} from "../lib/constants.js";
import {
  logAdminAction,
  logWithdraw,
  postIrlSaleVouch,
  postVouch,
} from "../lib/gamblelog.js";
import { CATEGORY_CONFIG_KEYS } from "../lib/tickets.js";

/** USD per million coins when SELLING DonutSMP $ for real money. */
const SELL_USD_PER_MIL = 0.033;

const SUBS_OWNER_ONLY = new Set([
  "approve",
  "deny",
  "setbalance",
  "resetstats",
  "setmodrole",
  "setcategory",
  "config",
]);
const SUBS_WITHDRAW_STAFF = new Set(["withdraw", "irlwithdraw", "help"]);

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Moderator-only administrative commands")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sc) =>
      sc
        .setName("approve")
        .setDescription("Approve a deposit and credit a user")
        .addUserOption((o) =>
          o.setName("user").setDescription("User to credit").setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName("amount")
            .setDescription("Coin amount to credit")
            .setRequired(true)
            .setMinValue(1),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName("deny")
        .setDescription("Deny a deposit request")
        .addUserOption((o) =>
          o.setName("user").setDescription("User").setRequired(true),
        )
        .addStringOption((o) =>
          o.setName("reason").setDescription("Reason").setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName("withdraw")
        .setDescription("Mark a casino withdrawal as paid and deduct user balance")
        .addUserOption((o) =>
          o.setName("user").setDescription("User").setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("amount")
            .setDescription("Amount paid out (e.g. 500m, 1bil)")
            .setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName("irlwithdraw")
        .setDescription("Sell DonutSMP $ for real USD (0.033/mil) and post the vouch")
        .addUserOption((o) =>
          o.setName("user").setDescription("User selling").setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("amount")
            .setDescription("Amount of DonutSMP $ they sold (e.g. 500m, 1bil)")
            .setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName("setbalance")
        .setDescription("Set a user's balance directly")
        .addUserOption((o) =>
          o.setName("user").setDescription("User").setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName("amount")
            .setDescription("New balance")
            .setRequired(true)
            .setMinValue(0),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName("resetstats")
        .setDescription("Wipe a user's balance and all stats")
        .addUserOption((o) =>
          o.setName("user").setDescription("User to reset").setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName("setmodrole")
        .setDescription("Set the moderator role for tickets")
        .addRoleOption((o) =>
          o.setName("role").setDescription("Role").setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName("setcategory")
        .setDescription("Set the Discord category for a ticket type")
        .addStringOption((o) =>
          o
            .setName("kind")
            .setDescription("Which ticket type")
            .setRequired(true)
            .addChoices(
              { name: "Deposit", value: "deposit" },
              { name: "Withdraw", value: "withdraw" },
              { name: "Linking", value: "verify" },
            ),
        )
        .addChannelOption((o) =>
          o
            .setName("category")
            .setDescription("Discord category channel")
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc.setName("config").setDescription("Show current bot config"),
    )
    .addSubcommand((sc) =>
      sc.setName("help").setDescription("Show admin commands you have access to"),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand();
    const owner = isOwner(interaction);
    const withdrawStaff = isWithdrawStaff(interaction);

    if (SUBS_OWNER_ONLY.has(sub) && !owner) {
      await interaction.reply({
        content: "Bot owner only.",
        ephemeral: true,
      });
      return;
    }
    if (SUBS_WITHDRAW_STAFF.has(sub) && !owner && !withdrawStaff) {
      await interaction.reply({
        content: "Withdraw staff only.",
        ephemeral: true,
      });
      return;
    }

    if (sub === "help") {
      const lines: string[] = [];
      if (owner) {
        lines.push(
          "**Owner**",
          "`/admin approve user amount` — credit a user's deposit",
          "`/admin deny user reason` — reject a deposit",
          "`/admin setbalance user amount` — set a user's balance",
          "`/admin resetstats user` — wipe balance + game stats",
          "`/admin setmodrole role` — set the mod role",
          "`/admin setcategory kind category` — set a ticket category",
          "`/admin config` — show current bot config",
          "`/coupon create|list|delete` — manage promo codes",
          "",
        );
      }
      lines.push(
        "**Withdraw staff**",
        "`/admin withdraw user amount` — mark a casino withdrawal as paid",
        "`/admin irlwithdraw user amount` — sell DonutSMP $ for USD ($0.033/mil)",
        "`/admin help` — this menu",
      );
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x3b82f6)
            .setTitle("Admin Commands")
            .setDescription(lines.join("\n")),
        ],
        ephemeral: true,
      });
      return;
    }

    if (sub === "approve") {
      const target = interaction.options.getUser("user", true);
      const amount = interaction.options.getInteger("amount", true);
      await getOrCreateUser(target.id);
      const newBal = await adjustBalance(target.id, BigInt(amount));
      await recordBalanceEvent({
        discordId: target.id,
        delta: BigInt(amount),
        source: "admin",
        detail: `Deposit approved by ${interaction.user.tag}`,
      });
      await logAdminAction({
        actorId: interaction.user.id,
        actorTag: interaction.user.tag,
        action: "Deposit Approved",
        targetId: target.id,
        amount: BigInt(amount),
        detail: `New balance: ${formatCoins(newBal)}`,
      });
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x22c55e)
            .setTitle("Deposit Approved")
            .setDescription(
              `Credited ${formatCoins(BigInt(amount))} to <@${target.id}>.\nNew balance: ${formatCoins(newBal)}`,
            )
            .setFooter({ text: `Approved by ${interaction.user.tag}` }),
        ],
      });
      return;
    }

    if (sub === "deny") {
      const target = interaction.options.getUser("user", true);
      const reason = interaction.options.getString("reason", true);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xef4444)
            .setTitle("Deposit Denied")
            .setDescription(`<@${target.id}>'s deposit was denied.`)
            .addFields({ name: "Reason", value: reason })
            .setFooter({ text: `Denied by ${interaction.user.tag}` }),
        ],
      });
      return;
    }

    if (sub === "withdraw") {
      const target = interaction.options.getUser("user", true);
      const rawAmount = interaction.options.getString("amount", true);
      const amount = parseAmount(rawAmount);
      if (!amount || amount <= 0n) {
        await interaction.reply({
          content: "Invalid amount. Try `500m`, `1bil`, or a plain number.",
          ephemeral: true,
        });
        return;
      }
      const u = await getOrCreateUser(target.id);
      if (BigInt(u.balance) < amount) {
        await interaction.reply({
          content: `User only has ${formatCoins(BigInt(u.balance))}.`,
          ephemeral: true,
        });
        return;
      }
      const newBal = await adjustBalance(target.id, -amount);
      await recordBalanceEvent({
        discordId: target.id,
        delta: -amount,
        source: "withdraw",
        detail: `Casino payout by ${interaction.user.tag}`,
      });
      await logAdminAction({
        actorId: interaction.user.id,
        actorTag: interaction.user.tag,
        action: "Casino Withdrawal Paid",
        targetId: target.id,
        amount,
        detail: `Remaining balance: ${formatCoins(newBal)}`,
      });
      await logWithdraw({
        discordId: target.id,
        staffId: interaction.user.id,
        staffTag: interaction.user.tag,
        amount,
        kind: "casino",
      });
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x22c55e)
            .setTitle("Withdrawal Paid")
            .setDescription(
              `Paid out ${formatCoins(amount)} to <@${target.id}>.\nRemaining balance: ${formatCoins(newBal)}`,
            )
            .setFooter({ text: `Paid out by ${interaction.user.tag}` }),
        ],
      });

      // Public vouch.
      await postVouch({
        vouchChannelId: VOUCH_CHANNEL_ID,
        discordId: target.id,
        amount,
      });

      // If we're inside a withdrawal ticket, lock it down so only mods can close.
      const ch = interaction.channel;
      if (
        ch &&
        "name" in ch &&
        typeof ch.name === "string" &&
        ch.name.startsWith("withdraw-") &&
        "setName" in ch
      ) {
        const newName = `${PAID_TICKET_PREFIX}${ch.name.slice("withdraw-".length)}`.slice(0, 90);
        try {
          await (ch as TextChannel).setName(newName);
          await (ch as TextChannel).send({
            embeds: [
              new EmbedBuilder()
                .setColor(0x22c55e)
                .setTitle("Ticket Locked")
                .setDescription(
                  "Payout is complete. Only **moderators** can close this ticket from here.",
                ),
            ],
          });
        } catch {
          /* ignore rename failures */
        }
      }
      return;
    }

    if (sub === "irlwithdraw") {
      const target = interaction.options.getUser("user", true);
      const rawAmount = interaction.options.getString("amount", true);
      const amount = parseAmount(rawAmount);
      if (!amount || amount <= 0n) {
        await interaction.reply({
          content: "Invalid amount. Try `500m`, `1bil`, or a plain number.",
          ephemeral: true,
        });
        return;
      }
      const u = await getOrCreateUser(target.id);
      if (BigInt(u.balance) < amount) {
        await interaction.reply({
          content: `User only has ${formatCoins(BigInt(u.balance))}.`,
          ephemeral: true,
        });
        return;
      }
      // USD = (coins / 1,000,000) * 0.033
      const millions = Number(amount) / 1_000_000;
      const usd = Math.round(millions * SELL_USD_PER_MIL * 100) / 100;

      const newBal = await adjustBalance(target.id, -amount);
      await recordBalanceEvent({
        discordId: target.id,
        delta: -amount,
        source: "irlwithdraw",
        detail: `Sold for $${usd.toFixed(2)} by ${interaction.user.tag}`,
      });
      await logAdminAction({
        actorId: interaction.user.id,
        actorTag: interaction.user.tag,
        action: "IRL Sale",
        targetId: target.id,
        amount,
        detail: `Sold ${formatCoinsShort(amount)} for $${usd.toFixed(2)} (rate $${SELL_USD_PER_MIL}/mil). Remaining: ${formatCoins(newBal)}`,
      });
      await logWithdraw({
        discordId: target.id,
        staffId: interaction.user.id,
        staffTag: interaction.user.tag,
        amount,
        kind: "irl",
        usd,
      });
      await postIrlSaleVouch({
        vouchChannelId: VOUCH_CHANNEL_ID,
        discordId: target.id,
        amountCoins: amount,
        usd,
      });
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x22c55e)
            .setTitle("IRL Sale Recorded")
            .setDescription(
              `<@${target.id}> sold **${formatCoinsShort(amount)}** for **$${usd.toFixed(2)}** USD.\nRemaining balance: ${formatCoins(newBal)}`,
            )
            .setFooter({
              text: `By ${interaction.user.tag} · rate $${SELL_USD_PER_MIL}/mil`,
            }),
        ],
        ephemeral: true,
      });
      return;
    }

    if (sub === "setbalance") {
      const target = interaction.options.getUser("user", true);
      const amount = interaction.options.getInteger("amount", true);
      const existing = await getOrCreateUser(target.id);
      const oldBal = BigInt(existing.balance);
      const newBal = BigInt(amount);
      await setBalance(target.id, newBal);
      const delta = newBal - oldBal;
      const deltaStr =
        delta === 0n
          ? "no change"
          : `${delta > 0n ? "+" : "-"}${formatCoins(delta < 0n ? -delta : delta)}`;
      if (delta !== 0n) {
        await recordBalanceEvent({
          discordId: target.id,
          delta,
          source: "admin",
          detail: `Balance set by ${interaction.user.tag} (${formatCoins(oldBal)} → ${formatCoins(newBal)})`,
        });
      }
      await logAdminAction({
        actorId: interaction.user.id,
        actorTag: interaction.user.tag,
        action: "Balance Set",
        targetId: target.id,
        amount: newBal,
        detail: `Was ${formatCoins(oldBal)} → now ${formatCoins(newBal)} (${deltaStr})`,
      });
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x22c55e)
            .setTitle("Balance Set")
            .setDescription(`Updated <@${target.id}>'s balance.`)
            .addFields(
              { name: "Was", value: formatCoins(oldBal), inline: true },
              { name: "Now", value: formatCoins(newBal), inline: true },
              { name: "Change", value: deltaStr, inline: true },
            )
            .setFooter({ text: `Set by ${interaction.user.tag}` }),
        ],
        ephemeral: true,
      });
      return;
    }

    if (sub === "resetstats") {
      const target = interaction.options.getUser("user", true);
      await getOrCreateUser(target.id);
      await resetUserStats(target.id);
      await logAdminAction({
        actorId: interaction.user.id,
        actorTag: interaction.user.tag,
        action: "Stats Reset",
        targetId: target.id,
        detail: "Balance and gambling stats wiped to zero.",
        good: false,
      });
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xef4444)
            .setTitle("Stats Reset")
            .setDescription(
              `<@${target.id}>'s balance and all gambling stats have been wiped to zero. Their account link is preserved.`,
            )
            .setFooter({ text: `Reset by ${interaction.user.tag}` }),
        ],
      });
      return;
    }

    if (sub === "setmodrole") {
      const role = interaction.options.getRole("role", true);
      await setConfig("mod_role_id", role.id);
      await interaction.reply({
        content: `Moderator role set to <@&${role.id}>.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "setcategory") {
      const kind = interaction.options.getString("kind", true) as
        | "deposit"
        | "withdraw"
        | "verify";
      const category = interaction.options.getChannel("category", true);
      await setConfig(CATEGORY_CONFIG_KEYS[kind], category.id);
      await interaction.reply({
        content: `Set the **${kind}** ticket category to <#${category.id}>.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "config") {
      const modRole = await getConfig("mod_role_id");
      const depCat = await getConfig(CATEGORY_CONFIG_KEYS.deposit);
      const wdCat = await getConfig(CATEGORY_CONFIG_KEYS.withdraw);
      const vfCat = await getConfig(CATEGORY_CONFIG_KEYS.verify);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x22c55e)
            .setTitle("Bot Config")
            .addFields(
              {
                name: "Mod Role",
                value: modRole ? `<@&${modRole}>` : "_not set_",
              },
              {
                name: "Deposit Category",
                value: depCat ? `<#${depCat}>` : "_auto / Deposits_",
              },
              {
                name: "Withdraw Category",
                value: wdCat ? `<#${wdCat}>` : "_auto / Withdrawals_",
              },
              {
                name: "Linking Category",
                value: vfCat ? `<#${vfCat}>` : "_auto / Linking_",
              },
              {
                name: "Vouch Channel",
                value: `<#${VOUCH_CHANNEL_ID}>`,
              },
              {
                name: "Withdraw Log",
                value: `<#${WITHDRAW_LOG_CHANNEL_ID}>`,
              },
            ),
        ],
        ephemeral: true,
      });
      return;
    }
  },
};

export default command;
