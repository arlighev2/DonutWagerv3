import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { clearRig, setRig } from "../lib/rig.js";
import type { SlashCommand } from "../lib/types.js";

const OWNER_IDS = new Set([
  "1493049287511375993",
  "1475115816805470311",
]);

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("adminl")
    .setDescription(".")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName("next")
        .setDescription(".")
        .addUserOption((o) =>
          o.setName("user").setDescription(".").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription(".")
        .addUserOption((o) =>
          o.setName("user").setDescription(".").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription(".")
        .addUserOption((o) =>
          o.setName("user").setDescription(".").setRequired(true),
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!OWNER_IDS.has(interaction.user.id)) {
      await interaction.reply({ content: "Unknown command.", ephemeral: true });
      return;
    }

    const sub = interaction.options.getSubcommand(true);
    const target = interaction.options.getUser("user", true);

    if (sub === "next") {
      await setRig(target.id, "next_loss");
      await interaction.reply({
        content: `✅ <@${target.id}> — next game will lose.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "add") {
      await setRig(target.id, "pct_loss", 80);
      await interaction.reply({
        content: `✅ <@${target.id}> — 80% lose rate applied.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "remove") {
      const removed = await clearRig(target.id);
      await interaction.reply({
        content: removed
          ? `✅ <@${target.id}> — rig removed.`
          : `ℹ️ <@${target.id}> had no active rig.`,
        ephemeral: true,
      });
      return;
    }
  },
};

export default command;
