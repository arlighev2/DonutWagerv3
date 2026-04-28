import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  findUserByMinecraftUsername,
  getOrCreateUser,
} from "../lib/db.js";
import { createTicketChannel } from "../lib/tickets.js";
import type { SlashCommand } from "../lib/types.js";

// Java usernames: 3-16 chars, [A-Za-z0-9_].
const JAVA_REGEX = /^[A-Za-z0-9_]{3,16}$/;
// Bedrock gamertags accept ANYTHING — owner approves/denies manually in-ticket.

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

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("verify")
    .setDescription(
      "Open a verification ticket to link your DonutSMP Minecraft account",
    )
    .addStringOption((opt) =>
      opt
        .setName("minecraft")
        .setDescription("Your DonutSMP Minecraft username")
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(16),
    )
    .addStringOption((opt) =>
      opt
        .setName("platform")
        .setDescription("Pick Java or Bedrock — you must choose one")
        .setRequired(true)
        .addChoices(
          { name: "Java Edition", value: "java" },
          { name: "Bedrock Edition", value: "bedrock" },
        ),
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const username = interaction.options.getString("minecraft", true).trim();
    const platform = interaction.options.getString("platform", true) as
      | "java"
      | "bedrock";

    if (platform === "java" && !JAVA_REGEX.test(username)) {
      await interaction.reply({
        content:
          "Invalid Java username. Use 3-16 characters: letters, numbers, underscore.",
        ephemeral: true,
      });
      return;
    }
    if (platform === "bedrock" && (username.length < 1 || username.length > 32)) {
      await interaction.reply({
        content: "Bedrock gamertag must be 1-32 characters.",
        ephemeral: true,
      });
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({
        content: "This command must be used in a server.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const user = await getOrCreateUser(interaction.user.id);
    if (user.verified) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x22c55e)
            .setTitle("Already Verified")
            .setDescription(
              "You're already linked to a Minecraft account.\nContact a moderator if you need to change it (they can use `/reset`).",
            ),
        ],
      });
      return;
    }

    // For Java, enforce one-Discord-per-MC-account up-front. Bedrock skips
    // the DB check entirely — the owner manually approves/denies in-ticket.
    if (platform === "java") {
      const existing = await findUserByMinecraftUsername(username);
      if (existing && existing.discord_id !== interaction.user.id) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xef4444)
              .setTitle("Account Already Linked")
              .setDescription(
                "That Minecraft account is already linked to another Discord user. If this is your account, contact a moderator to have it transferred.",
              ),
          ],
        });
        return;
      }
    }

    let displayName = username;
    let uuid: string | null = null;
    let avatarUrl: string | null = null;

    if (platform === "java") {
      const profile = await lookupMinecraftProfile(username);
      if (!profile) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xef4444)
              .setTitle("Minecraft Account Not Found")
              .setDescription(
                `No Java account exists with the username **${username}**. Double-check the spelling, or pick **Bedrock** if you play on console/mobile.`,
              ),
          ],
        });
        return;
      }
      displayName = profile.name;
      uuid = profile.id;
      avatarUrl = `https://mc-heads.net/avatar/${profile.id}/128`;
    }

    const ticket = await createTicketChannel({
      guild: interaction.guild,
      ownerId: interaction.user.id,
      ownerUsername: interaction.user.username,
      kind: "verify",
      topic: `Linking ticket for ${interaction.user.tag} — ${platform.toUpperCase()}: ${displayName}`,
      allowAttachments: true,
    });

    if (!ticket) {
      await interaction.editReply({
        content:
          "Couldn't create the linking ticket. Make sure I have **Manage Channels** permission and try again.",
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("Account Linking Request")
      .setDescription(
        `<@${interaction.user.id}> wants to link their **${platform === "bedrock" ? "Bedrock" : "Java"}** account **${displayName}**.\n\nA staff member will verify ownership in-game on DonutSMP and approve below.`,
      )
      .addFields(
        { name: "Platform", value: platform === "bedrock" ? "Bedrock Edition" : "Java Edition", inline: true },
        { name: "Minecraft", value: `\`${displayName}\``, inline: true },
      );
    if (uuid) embed.addFields({ name: "UUID", value: `\`${uuid}\``, inline: true });
    if (avatarUrl) embed.setThumbnail(avatarUrl);
    embed.setFooter({
      text: "Mods: confirm in-game ownership, then click Approve.",
    });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          `verify:approve:${interaction.user.id}:${displayName}`,
        )
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
    await ticket.channel.send({
      content: mention,
      embeds: [embed],
      components: [row],
    });

    await interaction.editReply({
      content: `Linking ticket created: <#${ticket.channel.id}>\nA staff member will check your account in-game on DonutSMP.`,
    });
  },
};

export default command;
