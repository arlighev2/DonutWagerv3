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
  findUserByMinecraftUsername,
  getOrCreateUser,
  getPendingWithdrawalByChannel,
  markPendingWithdrawalPaid,
  recordBalanceEvent,
  resetUserStats,
  setBalance,
  setConfig,
  setVerified,
} from "../lib/db.js";
import { formatCoins, parseAmount } from "../lib/format.js";
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
  postVouch,
} from "../lib/gamblelog.js";
import { CATEGORY_CONFIG_KEYS } from "../lib/tickets.js";
import { buildPanelMessage } from "../lib/panel_flow.js";
import {
  getInviteStats,
  processInviteClaim,
  COINS_PER_INVITE,
} from "../lib/invite_flow.js";

const DEPOSIT_LOG_CHANNEL_IDS = ["1498419875021066240", "1498440931026927817"];

const SUBS_OWNER_ONLY = new Set([
  "approve",
  "deny",
  "deposit",
  "setbalance",
  "resetstats",
  "setmodrole",
  "setcategory",
  "config",
  "forceverify",
]);
const SUBS_WITHDRAW_STAFF = new Set(["withdraw", "help", "panel"]);

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
        .setName("deposit")
        .setDescription("Deposit coins directly into a user's balance")
        .addUserOption((o) =>
          o.setName("user").setDescription("User to deposit to").setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("amount")
            .setDescription("Amount to deposit (e.g. 10m, 500k, 1bil)")
            .setRequired(true),
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
      sc
        .setName("forceverify")
        .setDescription("Force-link a Discord user to a Minecraft username")
        .addUserOption((o) =>
          o
            .setName("user")
            .setDescription("Discord user to verify")
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("minecraft")
            .setDescription("Minecraft username to link")
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(32),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName("panel")
        .setDescription(
          "Post the casino panel (Settings/Deposit/Withdraw/Balance) in this channel",
        ),
    )
    .addSubcommand((sc) =>
      sc.setName("help").setDescription("Show admin commands you have access to"),
    )
    .addSubcommandGroup((sg) =>
      sg
        .setName("invite")
        .setDescription("Invite reward management")
        .addSubcommand((sc) =>
          sc
            .setName("pay")
            .setDescription("Review and pay out a user's pending invite reward")
            .addUserOption((o) =>
              o.setName("user").setDescription("User to pay").setRequired(true),
            ),
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const subGroup = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand(false) ?? "";
    const owner = isOwner(interaction);
    const withdrawStaff = isWithdrawStaff(interaction);

    // ── /admin invite pay ──────────────────────────────────────────────────
    if (subGroup === "invite") {
      if (!owner) {
        await interaction.reply({ content: "Bot owner only.", ephemeral: true });
        return;
      }
      if (sub === "pay") {
        const target = interaction.options.getUser("user", true);
        await interaction.deferReply({ ephemeral: true });

        const stats = await getInviteStats(target.id);
        const result = await processInviteClaim(target.id);

        if (!result.ok) {
          await interaction.editReply({
            content: [
              `Cannot pay **${target.tag}**'s invite reward.`,
              `> ${result.reason}`,
              ``,
              `**Current stats:**`,
              `• Valid unclaimed: **${stats.validUnclaimed}**`,
              `• Left server: **${stats.leftServer}**`,
              `• Past claims: **${stats.claimCount}**`,
            ].join("\n"),
          });
          return;
        }

        const embed = new EmbedBuilder()
          .setColor(0xfacc15)
          .setTitle("🎟️ Invite Reward Paid")
          .addFields(
            { name: "User", value: `<@${target.id}>`, inline: true },
            { name: "Invites Claimed", value: `${result.invitesUsed}`, inline: true },
            { name: "Rate", value: `${formatCoins(COINS_PER_INVITE)} / invite`, inline: true },
            { name: "Total Awarded", value: formatCoins(result.coinsAwarded), inline: true },
            { name: "Claim #", value: `${result.claimNumber}`, inline: true },
            { name: "Paid By", value: `<@${interaction.user.id}>`, inline: true },
          )
          .setTimestamp()
          .setFooter({ text: `Paid by ${interaction.user.tag}` });

        await interaction.editReply({ embeds: [embed] });

        for (const channelId of DEPOSIT_LOG_CHANNEL_IDS) {
          try {
            const logChannel = await interaction.client.channels.fetch(channelId);
            if (logChannel?.isTextBased() && "send" in logChannel) {
              await (logChannel as { send: (opts: unknown) => Promise<unknown> }).send({ embeds: [embed] });
            }
          } catch {
            // channel unreachable — payout still went through
          }
        }
      }
      return;
    }

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

    if (sub === "panel") {
      const ch = interaction.channel;
      if (!ch || !("send" in ch)) {
        await interaction.reply({
          content: "Run this in a regular text channel.",
          ephemeral: true,
        });
        return;
      }
      const { embed, components } = buildPanelMessage();
      await (ch as TextChannel).send({ embeds: [embed], components });
      await interaction.reply({
        content: "Casino panel posted.",
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
          "`/admin deposit user amount` — directly deposit coins into a user's balance",
          "`/admin setbalance user amount` — set a user's balance",
          "`/admin resetstats user` — wipe balance + game stats",
          "`/admin forceverify user minecraft` — force-link a Discord user to a Minecraft name",
          "`/admin invite pay user` — pay out a user's pending invite reward",
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

    if (sub === "deposit") {
      const target = interaction.options.getUser("user", true);
      const rawAmount = interaction.options.getString("amount", true);
      const amount = parseAmount(rawAmount);
      if (!amount || amount <= 0n) {
        await interaction.reply({
          content: "Invalid amount. Try `10m`, `500k`, `1bil`, or a plain number.",
          ephemeral: true,
        });
        return;
      }

      await getOrCreateUser(target.id);
      const newBal = await adjustBalance(target.id, amount);
      await recordBalanceEvent({
        discordId: target.id,
        delta: amount,
        source: "deposit",
        detail: `deposit`,
      });

      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("💰 Deposit")
        .addFields(
          { name: "User", value: `<@${target.id}>`, inline: true },
          { name: "Amount", value: formatCoins(amount), inline: true },
          { name: "New Balance", value: formatCoins(newBal), inline: true },
          { name: "By", value: `<@${interaction.user.id}>`, inline: true },
          { name: "Note", value: "deposit", inline: true },
        )
        .setTimestamp()
        .setFooter({ text: `Deposited by ${interaction.user.tag}` });

      await interaction.reply({ embeds: [embed], ephemeral: true });

      // Log to payment channels only.
      for (const channelId of DEPOSIT_LOG_CHANNEL_IDS) {
        try {
          const logChannel = await interaction.client.channels.fetch(channelId);
          if (logChannel?.isTextBased() && "send" in logChannel) {
            await (logChannel as { send: (opts: unknown) => Promise<unknown> }).send({ embeds: [embed] });
          }
        } catch {
          // Channel unreachable — deposit still went through.
        }
      }
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

      const pending = interaction.channelId
        ? await getPendingWithdrawalByChannel(interaction.channelId)
        : null;
      const pendingMatches =
        pending &&
        pending.status === "pending" &&
        pending.discord_id === target.id &&
        BigInt(pending.amount) === amount;

      let newBal: bigint;
      if (pendingMatches && pending) {
        await markPendingWithdrawalPaid(pending.id);
        const u = await getOrCreateUser(target.id);
        newBal = BigInt(u.balance);
      } else {
        const u = await getOrCreateUser(target.id);
        if (BigInt(u.balance) < amount) {
          await interaction.reply({
            content: `User only has ${formatCoins(BigInt(u.balance))}.`,
            ephemeral: true,
          });
          return;
        }
        newBal = await adjustBalance(target.id, -amount);
        await recordBalanceEvent({
          discordId: target.id,
          delta: -amount,
          source: "withdraw",
          detail: `Casino payout by ${interaction.user.tag}`,
        });
      }
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

      await postVouch({
        vouchChannelId: VOUCH_CHANNEL_ID,
        discordId: target.id,
        amount,
      });

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

    if (sub === "forceverify") {
      const target = interaction.options.getUser("user", true);
      const mcName = interaction.options.getString("minecraft", true).trim();

      const conflict = await findUserByMinecraftUsername(mcName);
      if (conflict && conflict.discord_id !== target.id) {
        await interaction.reply({
          content: `\`${mcName}\` is already linked to <@${conflict.discord_id}>. Run \`/reset\` on them first.`,
          ephemeral: true,
        });
        return;
      }

      await getOrCreateUser(target.id);
      await setVerified(target.id, mcName);
      await logAdminAction({
        actorId: interaction.user.id,
        actorTag: interaction.user.tag,
        action: "Force Verify",
        targetId: target.id,
        detail: `Linked Minecraft \`${mcName}\``,
      });
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x22c55e)
            .setTitle("Verification Forced")
            .setDescription(
              `<@${target.id}> is now linked to **${mcName}**.`,
            )
            .setFooter({ text: `Forced by ${interaction.user.tag}` }),
        ],
        ephemeral: true,
      });
      return;
    }
  },
};

export default command;