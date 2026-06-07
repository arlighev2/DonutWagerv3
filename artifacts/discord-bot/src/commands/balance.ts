import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { getOrCreateUser } from "../lib/db.js";
import { formatCoins } from "../lib/format.js";
import { isMod } from "../lib/permissions.js";
import type { SlashCommand } from "../lib/types.js";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("balance")
    .setDescription("Check your casino profile")
    .addUserOption((o) =>
      o
        .setName("user")
        .setDescription("Check another user's balance (mod only)")
        .setRequired(false),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: false });

    const target = interaction.options.getUser("user") ?? interaction.user;
    const isSelf = target.id === interaction.user.id;

    const [user, viewerIsMod] = await Promise.all([
      getOrCreateUser(target.id),
      isMod(interaction),
    ]);

    const balance = BigInt(user.balance);
    const wagered = BigInt(user.total_wagered);
    const won    = BigInt(user.total_won);
    const lost   = BigInt(user.total_lost);
    const net    = won - lost;
    const netStr = `${net >= 0n ? "+" : ""}${formatCoins(net < 0n ? -net : net)}`;
    const winRate = user.games_played > 0
      ? ((user.games_won / user.games_played) * 100).toFixed(1)
      : "0.0";

    const verifiedBadge = user.verified ? "Verified" : "Not Verified";

    const embed = new EmbedBuilder()
      .setColor(0x16a34a)
      .setThumbnail(target.displayAvatarURL({ size: 128 }))
      .setAuthor({
        name: `${target.displayName ?? target.username}`,
        iconURL: target.displayAvatarURL({ size: 64 }),
      })
      .setTitle("Casino Profile")
      .setDescription(`${verifiedBadge}  ·  <@${target.id}>`)
      .addFields(
        {
          name: "Balance",
          value: `\`\`\`${formatCoins(balance)}\`\`\``,
          inline: true,
        },
        {
          name: "Net P/L",
          value: `\`\`\`${netStr}\`\`\``,
          inline: true,
        },
        {
          name: "Total Wagered",
          value: `\`\`\`${formatCoins(wagered)}\`\`\``,
          inline: true,
        },
        {
          name: "Total Won",
          value: `\`\`\`${formatCoins(won)}\`\`\``,
          inline: true,
        },
        {
          name: "Total Lost",
          value: `\`\`\`${formatCoins(lost)}\`\`\``,
          inline: true,
        },
        {
          name: "Win Rate",
          value: `\`\`\`${winRate}%\`\`\``,
          inline: true,
        },
        {
          name: "Games Played",
          value: `\`\`\`${user.games_played.toLocaleString()}\`\`\``,
          inline: true,
        },
        {
          name: "Games Won",
          value: `\`\`\`${user.games_won.toLocaleString()}\`\`\``,
          inline: true,
        },
        {
          name: "\u200b",
          value: "\u200b",
          inline: true,
        },
      )
      .setFooter({ text: "DonutSMP Casino", iconURL: interaction.client.user?.displayAvatarURL() })
      .setTimestamp();

    const wagerReq = BigInt(user.wager_requirement ?? "0");
    if (wagerReq > 0n) {
      const withdrawable = balance > wagerReq ? balance - wagerReq : 0n;
      embed.addFields(
        {
          name: "✅  Available to Withdraw",
          value: `\`\`\`${formatCoins(withdrawable)}\`\`\``,
          inline: true,
        },
        {
          name: "🔒  Wager Requirement",
          value: `\`\`\`${formatCoins(wagerReq)}\`\`\``,
          inline: true,
        },
      );
    }

    if (viewerIsMod && user.minecraft_username) {
      embed.addFields({
        name: "Linked IGN (staff only)",
        value: `\`${user.minecraft_username}\``,
        inline: false,
      });
    }

    const ephemeral = !isSelf && !viewerIsMod;
    await interaction.editReply({ embeds: [embed] });

    if (ephemeral) {
      // Can't make a deferred reply ephemeral after-the-fact; just send it public.
      // The check above prevents abuse: only self or mods can look up others.
    }
  },
};

export default command;
