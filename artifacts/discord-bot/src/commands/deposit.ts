import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { getOrCreateUser } from "../lib/db.js";
import { parseAmount } from "../lib/format.js";
import { requireVerified } from "../lib/guards.js";
import { createTicketChannel } from "../lib/tickets.js";
import type { SlashCommand } from "../lib/types.js";

const MIN_DEPOSIT = 1_000_000n; // 1 mil

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("deposit")
    .setDescription("Open a ticket to deposit DonutSMP money (min 1mil)")
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
    if (amount < MIN_DEPOSIT) {
      await interaction.reply({
        content: `Minimum deposit is **1mil** (1,000,000 DonutSMP $).`,
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    await getOrCreateUser(interaction.user.id);

    const ticket = await createTicketChannel({
      guild: interaction.guild,
      ownerId: interaction.user.id,
      ownerUsername: interaction.user.username,
      kind: "deposit",
      topic: `Deposit ticket — ${amount.toString()} DonutSMP $`,
      allowAttachments: true,
    });

    if (!ticket) {
      await interaction.editReply({
        content:
          "Couldn't create the deposit ticket. Make sure I have **Manage Channels** permission and try again.",
      });
      return;
    }

    const embed = new EmbedBuilder()
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
            "2. Once you have their IGN, log in to DonutSMP and run `/pay <staff-ign> <amount>` in-game.\n" +
            "3. **Take a screenshot** of the in-game payment confirmation.\n" +
            "4. Send the screenshot here in this ticket using `/pay screenshot:<image>`.\n" +
            "5. Staff will verify and credit your bot balance.",
        },
      )
      .setFooter({
        text: "Do not pay anyone until staff sends you the IGN here. (Heads up: /deposit will be fully automatic one day.)",
      });

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
