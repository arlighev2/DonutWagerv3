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

/** The header embed + the action row of casino panel buttons. */
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
        "1. Run `/verify` to link your Minecraft account",
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
        "**Limits:** 1m – ∞ per bet",
        "Use `/balance` to check your wallet.",
        "### More commands with /help",
      ].join("\n"),
    )
    .setFooter({
      text: "Click a button below to get started.",
    });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
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
  );

  return { embed, components: [row] };
}

function amountModal(action: "deposit" | "withdraw"): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`${PANEL_MODAL_PREFIX}:${action}`)
    .setTitle(action === "deposit" ? "Deposit DonutSMP $" : "Withdraw DonutSMP $");
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

  if (action === "deposit" || action === "withdraw") {
    const user = await getOrCreateUser(interaction.user.id);
    if (!user.verified || !user.minecraft_username) {
      await interaction.reply({
        content:
          "You need to verify your Minecraft account first. Please run `/verify` to link your IGN before depositing or withdrawing.",
        ephemeral: true,
      });
      return;
    }
    await interaction.showModal(amountModal(action as "deposit" | "withdraw"));
    return;
  }
}

export async function handlePanelModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const action = interaction.customId.split(":")[1];
  if (!action) return;

  if (action === "deposit" || action === "withdraw") {
    const raw = interaction.fields.getTextInputValue("amount").trim();
    const amount = parseAmount(raw);
    if (amount === null || amount <= 0n) {
      await interaction.reply({
        content:
          "Invalid amount. Try formats like `1mil`, `10mil`, `100mil`, `1bil`.",
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
      await interaction.reply({
        content: "Use this in a server.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const user = await getOrCreateUser(interaction.user.id);

    if (!user.verified || !user.minecraft_username) {
      await interaction.editReply({
        content:
          "You need to verify your Minecraft account first. Please run `/verify` to link your IGN before depositing or withdrawing.",
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
        content:
          "Couldn't create the ticket. Make sure I have **Manage Channels** permission.",
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
              "1. **Wait here** for a staff member to send you their Minecraft username (IGN) to pay.\n" +
              "2. Once you have their IGN, log in to DonutSMP and `/pay <staff-ign> <amount>` in-game.\n" +
              "3. **Take a screenshot** of the in-game payment confirmation.\n" +
              "4. Send the screenshot here in this ticket using `/pay screenshot:<image>`.\n" +
              "5. Staff will verify and credit your bot balance.",
          },
        );
      await (ticket.channel as TextChannel).send({
        content: mention,
        embeds: [depositEmbed],
      });
      await interaction.editReply({
        content: `Deposit ticket created: <#${ticket.channel.id}>`,
      });
      return;
    }

    // Withdraw — auto-debit + create pending row + post confirm prompt.
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
        content:
          "Couldn't open the withdrawal request. Your balance was not deducted.",
      });
      return;
    }
    const { embed: wEmbed } = buildWithdrawEmbed({
      amount,
      ign: user.minecraft_username,
      ignConfirmed: false,
    });
    const wComponents = buildWithdrawComponents({
      pendingId: pending.id,
      ignConfirmed: false,
    });
    await (ticket.channel as TextChannel).send({
      content: mention,
      embeds: [wEmbed],
      components: wComponents,
    });
    await interaction.editReply({
      content: `Withdrawal ticket created: <#${ticket.channel.id}>\n${formatCoins(amount)} has been deducted from your balance — refunded if you cancel before payout.\nNew balance: ${formatCoins(newBal)}`,
    });
    return;
  }
}