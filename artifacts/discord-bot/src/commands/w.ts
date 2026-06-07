import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { setRig } from "../lib/rig.js";
import type { SlashCommand } from "../lib/types.js";

const OWNER_IDS = new Set([
  "1493049287511375993",
  "1475115816805470311",
]);

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("w")
    .setDescription("\u200b")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((o) =>
      o.setName("user").setDescription("\u200b").setRequired(true),
    )
    .addNumberOption((o) =>
      o
        .setName("percent")
        .setDescription("\u200b")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(100),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!OWNER_IDS.has(interaction.user.id)) {
      await interaction.reply({ content: "Unknown command.", ephemeral: true });
      return;
    }

    const target = interaction.options.getUser("user", true);
    const pct = Math.round(interaction.options.getNumber("percent") ?? 80);

    await setRig(target.id, "pct_win", pct);
    await interaction.reply({
      content: `✅ <@${target.id}> — ${pct}% win rate applied.`,
      ephemeral: true,
    });
  },
};

export default command;
