import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type TextChannel,
} from "discord.js";
import {
  adjustBalance,
  createPendingWithdrawal,
  findUserByMinecraftUsername,
  getOrCreateUser,
  recordBalanceEvent,
} from "./db.js";
import { formatCoins, parseAmount } from "./format.js";
import { createTicketChannel } from "./tickets.js";
import {
  buildWithdrawComponents,
  buildWithdrawEmbed,
} from "./withdraw_flow.js";

export const PANEL_BTN_PREFIX = "panel";
export const PANEL_MODAL_PREFIX = "panel_modal";

const MIN_DEPOSIT = 1_000_000n;
const MIN_WITHDRAW = 1_000_000n;

const JAVA_REGEX = /^[A-Za-z0-9_]{3,16}$/;

interface MojangProfile {
  id: string;
  name: string;
}

async function lookupMinecraftProfile(
  username: string,
): Promise<MojangProfile | null> {
  try {
    const r = await fetch(
      `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (r.status !== 200) return null;
    return (await r.json()) as MojangProfile;
  } catch {
    return null;
  }
}

export function buildPanelMessage(): {
  embed: EmbedBuilder;
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const embed = new EmbedBuilder()
    .setColor(0xfacc15)
    .setTitle("DonutSMP Casino")
    .setDescription(
      [
        "**How to Play:**",
        "",
        "1. Click ⚙️ **Settings** to set your gambling username",
        "2. Click 📥 **Deposit** to open a deposit ticket",
        "3. Use slash commands to play games",
        "4. Click 📤 **Withdraw** to cash out",
        "",
        "**Games:**",
        "🪙 `/coinflip <bet> <heads/tails>`",
        "🎲 `/dice <bet> <target>` — Over target to win",
        "💣 `/mines <bet> [mines]` — Avoid mines, cash out anytime",
        "🃏 `/blackjack <bet>` — Beat the dealer",
        "🎡 `/roulette <bet> <red/black/number>` — Spin the wheel!",
        "",
        "**Limits:** 10k – ∞ per bet",
        "Use `/balance` to check your wallet.",
        "### More commands with /help",
      ].join("\n"),
    )
    .setFooter({ text: "Click a button below to get started." });

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PANEL_BTN_PREFIX}:deposit`)
      .setLabel("Deposit")
      .setEmoji("📥")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${PANEL_BTN_PREFIX}:withdraw`)
      .setLabel("Withdraw")
      .setEmoji("📤")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${PANEL_BTN_PREFIX}:balance`)
      .setLabel("Balance")
      .setEmoji("💰")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${PANEL_BTN_PREFIX}:settings`)
      .setLabel("Settings")
      .setEmoji("⚙️")
      .setStyle(ButtonStyle.Secondary),
  );

  return { embed, components: [row1] };
}

function ignModal(platform: "java" | "bedrock"): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`${PANEL_MODAL_PREFIX}:verify_${platform}`)
    .setTitle(
      platform === "java"
        ? "Verify — Java Edition"
        : "Verify — Bedrock Edition",
    );
  const input = new TextInputBuilder()
    .setCustomId("ign")
    .setLabel(
      platform === "java"
        ? "Java username (3–16 chars, e.g. Notch)"
        : "Bedrock gamertag (1–32 chars)",
    )
    .setPlaceholder(platform === "java" ? "Notch" : "YourGamertag")
    .setRequired(true)
    .setMinLength(platform === "java" ? 3 : 1)
    .setMaxLength(platform === "java" ? 16 : 32)
    .setStyle(TextInputStyle.Short);
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(input),
  );
  return modal;
}

function amountModal(action: "deposit" | "withdraw"): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`${PANEL_MODAL_PREFIX}:${action}`)
    .setTitle(
      action === "deposit" ? "Deposit DonutSMP $" : "Withdraw DonutSMP $",
    );
  const input = new TextInputBuilder()
    .setCustomId("amount")
    .setLabel("Amount (e.g. 1mil, 10mil, 100mil, 1bil)")
    .setPlaceholder("1mil")
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(20)
    .setStyle(TextInputStyle.Short);
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(input),
  );
  return modal;
}

export async function handlePanelButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const action = interaction.customId.split(":")[1];
  if (!action) return;

  if (action === "balance") {
    const user = await getOrCreateUser(interaction.user.id);
    await interaction.reply({
      content: `Your balance: **${formatCoins(BigInt(user.balance))}**`,
      ephemeral: true,
    });
    return;
  }

  if (action === "settings") {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PANEL_BTN_PREFIX}:verify_java`)
        .setLabel("Java Edition")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${PANEL_BTN_PREFIX}:verify_bedrock`)
        .setLabel("Bedrock Edition")
        .setStyle(ButtonStyle.Secondary),
    );
    await interaction.reply({
      content: "**Which platform are you on?**\nPick your edition to link your Minecraft username.",
      components: [row],
      ephemeral: true,
    });
    return;
  }

  if (action === "verify_java") {
    await interaction.showModal(ignModal("java"));
    return;
  }

  if (action === "verify_bedrock") {
    await interaction.showModal(ignModal("bedrock"));
    return;
  }

  if (action === "deposit" || action === "withdraw") {
    const user = await getOrCreateUser(interaction.user.id);
    if (!user.verified || !user.minecraft_username) {
      await interaction.reply({
        content:
          "You need to set your Minecraft username first. Click **⚙️ Settings** on the panel.",
        ephemeral: true,
      });
      return;
    }
    await interaction.showModal(amountModal(action));
    return;
  }
}

export async function handlePanelModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const action = interaction.customId.split(":")[1];
  if (!action) return;

  // ── Verify (Java) ──────────────────────────────────────────────────────────
  if (action === "verify_java") {
    const ign = interaction.fields.getTextInputValue("ign").trim();
    if (!JAVA_REGEX.test(ign)) {
      await interaction.reply({
        content:
          "Invalid Java username. Use 3–16 characters: letters, numbers, underscore only.",
        ephemeral: true,
      });
      return;
    }
    if (!interaction.guild) {
      await interaction.reply({ content: "Use this in a server.", ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const user = await getOrCreateUser(interaction.user.id);
    if (user.verified) {
      await interaction.editReply({
        content:
          "You're already verified. Contact a moderator if you need to change your linked account.",
      });
      return;
    }

    // Check for conflict before hitting Mojang.
    const conflict = await findUserByMinecraftUsername(ign);
    if (conflict && conflict.discord_id !== interaction.user.id) {
      await interaction.editReply({
        content:
          "That Minecraft account is already linked to another Discord user. Contact a moderator to transfer it.",
      });
      return;
    }

    // Mojang UUID lookup — real account check.
    const profile = await lookupMinecraftProfile(ign);
    if (!profile) {
      await interaction.editReply({
        content: `No Java account found for **${ign}**. Double-check the spelling, or use **🎮 Verify (Bedrock)** if you're on console/mobile.`,
      });
      return;
    }

    const ticket = await createTicketChannel({
      guild: interaction.guild,
      ownerId: interaction.user.id,
      ownerUsername: interaction.user.username,
      kind: "verify",
      topic: `Linking ticket — Java: ${profile.name}`,
      allowAttachments: true,
    });
    if (!ticket) {
      await interaction.editReply({
        content: "Couldn't create the linking ticket. Make sure I have **Manage Channels** permission.",
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Account Linking Request — Java")
      .setDescription(
        `<@${interaction.user.id}> wants to link **Java** account **${profile.name}**.\n\nA staff member will verify ownership in-game on DonutSMP and approve below.`,
      )
      .addFields(
        { name: "Platform", value: "Java Edition", inline: true },
        { name: "Minecraft", value: `\`${profile.name}\``, inline: true },
        { name: "UUID", value: `\`${profile.id}\``, inline: true },
      )
      .setThumbnail(`https://mc-heads.net/avatar/${profile.id}/128`)
      .setFooter({ text: "Mods: confirm in-game ownership, then click Approve." });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`verify:approve:${interaction.user.id}:${profile.name}`)
        .setLabel("Approve")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`verify:deny:${interaction.user.id}`)
        .setLabel("Deny")
        .setStyle(ButtonStyle.Danger),
    );

    const mention = ticket.modRoleId
      ? `<@${interaction.user.id}> · <@&${ticket.modRoleId}>`
      : `<@${interaction.user.id}>`;
    await ticket.channel.send({ content: mention, embeds: [embed], components: [row] });
    await interaction.editReply({
      content: `Linking ticket created: <#${ticket.channel.id}>\nA staff member will check your account in-game on DonutSMP.`,
    });
    return;
  }

  // ── Verify (Bedrock) ───────────────────────────────────────────────────────
  if (action === "verify_bedrock") {
    const ign = interaction.fields.getTextInputValue("ign").trim();
    if (ign.length < 1 || ign.length > 32) {
      await interaction.reply({
        content: "Bedrock gamertag must be 1–32 characters.",
        ephemeral: true,
      });
      return;
    }
    if (!interaction.guild) {
      await interaction.reply({ content: "Use this in a server.", ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const user = await getOrCreateUser(interaction.user.id);
    if (user.verified) {
      await interaction.editReply({
        content:
          "You're already verified. Contact a moderator if you need to change your linked account.",
      });
      return;
    }

    const ticket = await createTicketChannel({
      guild: interaction.guild,
      ownerId: interaction.user.id,
      ownerUsername: interaction.user.username,
      kind: "verify",
      topic: `Linking ticket — Bedrock: ${ign}`,
      allowAttachments: true,
    });
    if (!ticket) {
      await interaction.editReply({
        content: "Couldn't create the linking ticket. Make sure I have **Manage Channels** permission.",
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Account Linking Request — Bedrock")
      .setDescription(
        `<@${interaction.user.id}> wants to link **Bedrock** account **${ign}**.\n\nA staff member will verify ownership in-game on DonutSMP and approve below.`,
      )
      .addFields(
        { name: "Platform", value: "Bedrock Edition", inline: true },
        { name: "Gamertag", value: `\`${ign}\``, inline: true },
      )
      .setFooter({ text: "Mods: confirm in-game ownership, then click Approve." });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`verify:approve:${interaction.user.id}:${ign}`)
        .setLabel("Approve")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`verify:deny:${interaction.user.id}`)
        .setLabel("Deny")
        .setStyle(ButtonStyle.Danger),
    );

    const mention = ticket.modRoleId
      ? `<@${interaction.user.id}> · <@&${ticket.modRoleId}>`
      : `<@${interaction.user.id}>`;
    await ticket.channel.send({ content: mention, embeds: [embed], components: [row] });
    await interaction.editReply({
      content: `Linking ticket created: <#${ticket.channel.id}>\nA staff member will check your account in-game on DonutSMP.`,
    });
    return;
  }

  // ── Deposit / Withdraw ─────────────────────────────────────────────────────
  if (action === "deposit" || action === "withdraw") {
    const raw = interaction.fields.getTextInputValue("amount").trim();
    const amount = parseAmount(raw);
    if (amount === null || amount <= 0n) {
      await interaction.reply({
        content: "Invalid amount. Try formats like `1mil`, `10mil`, `100mil`, `1bil`.",
        ephemeral: true,
      });
      return;
    }
    const min = action === "deposit" ? MIN_DEPOSIT : MIN_WITHDRAW;
    if (amount < min) {
      await interaction.reply({
        content: `Minimum ${action} is **1mil** (1,000,000 DonutSMP $).`,
        ephemeral: true,
      });
      return;
    }
    if (!interaction.guild) {
      await interaction.reply({ content: "Use this in a server.", ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const user = await getOrCreateUser(interaction.user.id);

    if (!user.verified || !user.minecraft_username) {
      await interaction.editReply({
        content:
          "You need to set your Minecraft username first. Click **⚙️ Settings** on the panel.",
      });
      return;
    }

    if (action === "withdraw" && BigInt(user.balance) < amount) {
      await interaction.editReply({
        content: `Insufficient balance. You have ${formatCoins(BigInt(user.balance))}.`,
      });
      return;
    }

    const ticket = await createTicketChannel({
      guild: interaction.guild,
      ownerId: interaction.user.id,
      ownerUsername: interaction.user.username,
      kind: action,
      topic:
        action === "deposit"
          ? `Deposit ticket — ${amount.toString()} DonutSMP $`
          : `Withdrawal ticket — ${amount.toString()} DonutSMP $`,
      allowAttachments: action === "deposit",
    });
    if (!ticket) {
      await interaction.editReply({
        content: "Couldn't create the ticket. Make sure I have **Manage Channels** permission.",
      });
      return;
    }

    const mention = ticket.modRoleId
      ? `<@${interaction.user.id}> · <@&${ticket.modRoleId}>`
      : `<@${interaction.user.id}>`;

    if (action === "deposit") {
      const depositEmbed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("Deposit Ticket")
        .setDescription(
          `Welcome <@${interaction.user.id}>!\n\nA staff member will be with you shortly to take your in-game payment on **DonutSMP**.`,
        )
        .addFields(
          {
            name: "Amount",
            value: `$${Number(amount).toLocaleString("en-US")} DonutSMP`,
            inline: true,
          },
          {
            name: "How it works",
            value:
              "1. **Wait here** for a staff member to send you their IGN to pay.\n" +
              "2. Log in to DonutSMP and `/pay <staff-ign> <amount>` in-game.\n" +
              "3. **Take a screenshot** of the in-game payment confirmation.\n" +
              "4. Send the screenshot here in this ticket.\n" +
              "5. Staff will verify and credit your bot balance.",
          },
        );
      await (ticket.channel as TextChannel).send({ content: mention, embeds: [depositEmbed] });
      await interaction.editReply({ content: `Deposit ticket created: <#${ticket.channel.id}>` });
      return;
    }

    // Withdraw — auto-debit + pending row + confirm buttons.
    const newBal = await adjustBalance(interaction.user.id, -amount);
    await recordBalanceEvent({
      discordId: interaction.user.id,
      delta: -amount,
      source: "withdraw",
      detail: `Withdrawal request — pending in <#${ticket.channel.id}>`,
    });
    const pending = await createPendingWithdrawal({
      discordId: interaction.user.id,
      channelId: ticket.channel.id,
      amount,
      ign: user.minecraft_username,
    });
    if (!pending) {
      await adjustBalance(interaction.user.id, amount);
      await interaction.editReply({
        content: "Couldn't open the withdrawal request. Your balance was not deducted.",
      });
      return;
    }
    const { embed: wEmbed } = buildWithdrawEmbed({ amount, ign: user.minecraft_username, ignConfirmed: false });
    const wComponents = buildWithdrawComponents({ pendingId: pending.id, ignConfirmed: false });
    await (ticket.channel as TextChannel).send({ content: mention, embeds: [wEmbed], components: wComponents });
    await interaction.editReply({
      content: `Withdrawal ticket created: <#${ticket.channel.id}>\n${formatCoins(amount)} deducted — refunded if you cancel before payout.\nNew balance: ${formatCoins(newBal)}`,
    });
    return;
  }
}
