import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { getOrCreateUser } from "../lib/db.js";
import { formatCoins, parseAmount } from "../lib/format.js";
import { requireVerified } from "../lib/guards.js";
import { createTicketChannel } from "../lib/tickets.js";
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

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Withdrawal Request")
      .setDescription(
        `Welcome <@${interaction.user.id}>!\n\nA staff member will pay you in-game on **DonutSMP**.`,
      )
      .addFields(
        {
          name: "Amount",
          value: `$${Number(amount).toLocaleString("en-US")} DonutSMP`,
          inline: true,
        },
        {
          name: "Current Balance",
          value: formatCoins(BigInt(user.balance)),
          inline: true,
        },
        {
          name: "How it works",
          value:
            "1. Confirm here that you're the verified linked player.\n" +
            "2. A staff member will get on DonutSMP and `/pay` you the amount.\n" +
            "3. Once you receive it, a moderator will run `/admin payout` here to deduct your bot balance.\n" +
            "4. Once payout is confirmed only **staff** can close this ticket.",
        },
      )
      .setFooter({ text: "Stay in this channel until payout is confirmed." });

    const mention = ticket.modRoleId
      ? `<@${interaction.user.id}> · <@&${ticket.modRoleId}>`
      : `<@${interaction.user.id}>`;
    await ticket.channel.send({ content: mention, embeds: [embed] });

    await interaction.editReply({
      content: `Ticket created: <#${ticket.channel.id}>`,
    });
  },
};

export default command;
