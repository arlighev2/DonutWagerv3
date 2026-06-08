import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type User,
} from "discord.js";
import { clearRig, getRigRow, setRig } from "../lib/rig.js";
import { OWNER_IDS } from "../lib/owners.js";
import type { SlashCommand } from "../lib/types.js";

export const AP_BTN_PREFIX = "ap";
export const AP_MODAL_PREFIX = "ap_modal";

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildEmbed(
  target: User,
  rig: { mode: string; value: number } | null,
): EmbedBuilder {
  let statusLine: string;
  let color: number;

  if (!rig) {
    statusLine = "No rig active — playing fair.";
    color = 0x6b7280;
  } else if (rig.mode === "next_loss") {
    statusLine = "⚡ **Next game: forced loss** (one-shot, auto-removes after firing)";
    color = 0xef4444;
  } else if (rig.mode === "pct_loss") {
    statusLine = `🔴 **${rig.value}% lose rate** applied to every game`;
    color = 0xef4444;
  } else {
    statusLine = `🟢 **${rig.value}% win rate** applied to every game`;
    color = 0x22c55e;
  }

  return new EmbedBuilder()
    .setColor(color)
    .setTitle("🎛️  Admin Rig Panel")
    .setThumbnail(target.displayAvatarURL({ size: 64 }))
    .addFields(
      {
        name: "Player",
        value: `<@${target.id}>\n\`${target.username}\``,
        inline: true,
      },
      {
        name: "Active Rig",
        value: statusLine,
        inline: false,
      },
    )
    .setFooter({ text: "Changes apply at the start of the player's next game." })
    .setTimestamp();
}

function buildComponents(targetId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${AP_BTN_PREFIX}:win:${targetId}`)
        .setLabel("Win %")
        .setEmoji("🟢")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${AP_BTN_PREFIX}:loss:${targetId}`)
        .setLabel("Loss %")
        .setEmoji("🔴")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`${AP_BTN_PREFIX}:next:${targetId}`)
        .setLabel("Next Loss")
        .setEmoji("⚡")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`${AP_BTN_PREFIX}:remove:${targetId}`)
        .setLabel("Remove Rig")
        .setEmoji("🗑️")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${AP_BTN_PREFIX}:refresh:${targetId}`)
        .setLabel("Refresh")
        .setEmoji("🔄")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ── Slash command ─────────────────────────────────────────────────────────────

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("adminpanel")
    .setDescription(".")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((o) =>
      o.setName("user").setDescription(".").setRequired(true),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    if (!OWNER_IDS.has(interaction.user.id)) {
      await interaction.editReply({ content: "Unknown command." });
      return;
    }

    const target = interaction.options.getUser("user", true);
    const rig = await getRigRow(target.id);

    await interaction.editReply({
      embeds: [buildEmbed(target, rig)],
      components: buildComponents(target.id),
    });
  },
};

export default command;

// ── Button handler ────────────────────────────────────────────────────────────

export async function handleAdminPanelButton(
  interaction: ButtonInteraction,
): Promise<void> {
  if (!OWNER_IDS.has(interaction.user.id)) {
    await interaction.reply({ content: "Unknown command.", ephemeral: true });
    return;
  }

  const parts = interaction.customId.split(":");
  const action = parts[1];
  const targetId = parts[2];
  if (!action || !targetId) return;

  if (action === "win" || action === "loss") {
    const isWin = action === "win";
    const modal = new ModalBuilder()
      .setCustomId(`${AP_MODAL_PREFIX}:${action}:${targetId}`)
      .setTitle(isWin ? "🟢 Set Win Rate" : "🔴 Set Loss Rate");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("percent")
          .setLabel(isWin ? "Win chance per game (1–100)" : "Loss chance per game (1–100)")
          .setPlaceholder("80")
          .setMinLength(1)
          .setMaxLength(3)
          .setRequired(true)
          .setStyle(TextInputStyle.Short),
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  // All remaining actions update the embed in-place
  await interaction.deferUpdate();

  if (action === "next") {
    await setRig(targetId, "next_loss");
  } else if (action === "remove") {
    await clearRig(targetId);
  }
  // "refresh" — just re-fetch and redraw

  const target = await interaction.client.users.fetch(targetId);
  const rig = await getRigRow(targetId);

  await interaction.editReply({
    embeds: [buildEmbed(target, rig)],
    components: buildComponents(targetId),
  });
}

// ── Modal handler ─────────────────────────────────────────────────────────────

export async function handleAdminPanelModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  if (!OWNER_IDS.has(interaction.user.id)) {
    await interaction.reply({ content: "Unknown command.", ephemeral: true });
    return;
  }

  const parts = interaction.customId.split(":");
  const action = parts[1];
  const targetId = parts[2];
  if (!action || !targetId) return;

  const raw = interaction.fields.getTextInputValue("percent").trim();
  const pct = parseInt(raw, 10);
  if (isNaN(pct) || pct < 1 || pct > 100) {
    await interaction.reply({
      content: "Invalid percentage — must be a number between 1 and 100.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();
  await setRig(targetId, action === "win" ? "pct_win" : "pct_loss", pct);

  const target = await interaction.client.users.fetch(targetId);
  const rig = await getRigRow(targetId);

  await interaction.editReply({
    embeds: [buildEmbed(target, rig)],
    components: buildComponents(targetId),
  });
}
