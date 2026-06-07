import {
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { getRigRow } from "../lib/rig.js";
import type { SlashCommand } from "../lib/types.js";

const OWNER_IDS = new Set([
  "1493049287511375993",
  "1475115816805470311",
]);

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("admincheck")
    .setDescription(".")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((o) =>
      o.setName("user").setDescription(".").setRequired(true),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!OWNER_IDS.has(interaction.user.id)) {
      await interaction.reply({ content: "Unknown command.", ephemeral: true });
      return;
    }

    const target = interaction.options.getUser("user", true);
    const rig = await getRigRow(target.id);

    let status: string;
    let color: number;

    if (!rig) {
      status = "No active rig.";
      color = 0x6b7280;
    } else if (rig.mode === "next_loss") {
      status = "⚠️ **Next game forced loss** (one-shot)";
      color = 0xef4444;
    } else if (rig.mode === "pct_loss") {
      status = `🔴 **${rig.value}% lose rate** (persistent)`;
      color = 0xef4444;
    } else {
      status = `🟢 **${rig.value}% win rate** (persistent)`;
      color = 0x22c55e;
    }

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`Rig Status — ${target.username}`)
      .setDescription(status)
      .setThumbnail(target.displayAvatarURL());

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

export default command;
