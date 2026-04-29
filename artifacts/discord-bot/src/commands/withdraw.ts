import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  adjustBalance,
  createPendingWithdrawal,
  getOrCreateUser,
  recordBalanceEvent,
} from "../lib/db.js";
import { formatCoins, parseAmount } from "../lib/format.js";
import { requireVerified } from "../lib/guards.js";
import { createTicketChannel } from "../lib/tickets.js";
import {
  buildWithdrawComponents,
  buildWithdrawEmbed,
} from "../lib/withdraw_flow.js";
import type { SlashCommand } from "../lib/types.js";

const MIN_WITHDRAW = 1_000_000n; // 1 mil

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("withdraw")
    .setDescription("Open a ticket to withdraw DonutSMP money (min 1mil)")
    .addStringOption((o) =>
      o
        .setName("amount")
        .setDescription("e.g. 1mil, 10mil, 100mil, 1bil, 1500000")
        .setRequired(true),
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const verified = await requireVerified(interaction);
    if (!verified) return;
    if (!interaction.guild) {
      await interaction.reply({
        content: "Use this in a server.",
        ephemeral: true,
      });
      return;
    }

    const raw = interaction.options.getString("amount", true);
    const amount = parseAmount(raw);
    if (amount === null) {
      await interaction.reply({
        content:
          "Invalid amount. Try formats like `1mil`, `10mil`, `100mil`, `1bil`, or a plain number.",
        ephemeral: true,
      });
      return;
    }
    if (amount < MIN_WITHDRAW) {
      await interaction.reply({
        content: `Minimum withdraw is **1mil** (1,000,000 DonutSMP $).`,
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const user = await getOrCreateUser(interaction.user.id);

    if (BigInt(user.balance) < amount) {
      await interaction.editReply({
        content: `Insufficient balance. You have ${formatCoins(BigInt(user.balance))}.`,
      });
      return;
    }

    if (!user.minecraft_username) {
      await interaction.editReply({
        content:
          "You aren't linked to a Minecraft account yet. Run `/verify` first.",
      });
      return;
    }

    const ticket = await createTicketChannel({
      guild: interaction.guild,
      ownerId: interaction.user.id,
      ownerUsername: interaction.user.username,
      kind: "withdraw",
      topic: `Withdrawal ticket — ${amount.toString()} DonutSMP $`,
    });

    if (!ticket) {
      await interaction.editReply({
        content:
          "Couldn't create the withdrawal ticket. Make sure I have **Manage Channels** permission and try again.",
      });
      return;
    }

    // Auto-debit immediately. Refunded if the user cancels before payout.
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
      // Roll back the debit if we somehow couldn't create the pending row.
      await adjustBalance(interaction.user.id, amount);
      await interaction.editReply({
        content:
          "Couldn't open the withdrawal request. Your balance was not deducted.",
      });
      return;
    }

    const { embed } = buildWithdrawEmbed({
      amount,
      ign: user.minecraft_username,
      ignConfirmed: false,
    });
    const components = buildWithdrawComponents({
      pendingId: pending.id,
      ignConfirmed: false,
    });

    const mention = ticket.modRoleId
      ? `<@${interaction.user.id}> · <@&${ticket.modRoleId}>`
      : `<@${interaction.user.id}>`;
    await ticket.channel.send({
      content: mention,
      embeds: [embed],
      components,
    });

    await interaction.editReply({
      content: `Ticket created: <#${ticket.channel.id}>\n${formatCoins(amount)} has been deducted from your balance — refunded if you cancel before payout.\nNew balance: ${formatCoins(newBal)}`,
    });
  },
};

export default command;
