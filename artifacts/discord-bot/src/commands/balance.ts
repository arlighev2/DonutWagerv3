import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { getOrCreateUser } from "../lib/db.js";
import { formatCoins } from "../lib/format.js";
import { isMod } from "../lib/permissions.js";
import type { SlashCommand } from "../lib/types.js";

function balanceColor(balance: bigint): number {
  if (balance >= 100_000_000n) return 0xf59e0b; // gold — whale
  if (balance >= 10_000_000n) return 0x22c55e;  // green — rich
  if (balance >= 1_000_000n) return 0x3b82f6;   // blue — solid
  return 0x6b7280;                               // grey — starter
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("balance")
    .setDescription("Check your coin balance and stats")
    .addUserOption((o) =>
      o
        .setName("user")
        .setDescription("Check another user's balance (mod only)")
        .setRequired(false),
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const target = interaction.options.getUser("user") ?? interaction.user;
    const user = await getOrCreateUser(target.id);

    const viewerIsMod = await isMod(interaction);
    const isSelf = target.id === interaction.user.id;

    const balance = BigInt(user.balance);
    const wagered = BigInt(user.total_wagered);
    const won = BigInt(user.total_won);
    const lost = BigInt(user.total_lost);
    const winRate =
      user.games_played > 0
        ? ((user.games_won / user.games_played) * 100).toFixed(1)
        : "0.0";
    const net = won - lost;
    const netSign = net >= 0n ? "+" : "-";
    const netAbs = net < 0n ? -net : net;
    const netStr = `${netSign}${formatCoins(netAbs)}`;

    const embed = new EmbedBuilder()
      .setColor(balanceColor(balance))
      .setTitle(`🎰 Casino Profile`)
      .setDescription(`<@${target.id}>`)
      .setThumbnail(target.displayAvatarURL({ size: 128 }))
      .addFields(
        {
          name: "💰 Balance",
          value: formatCoins(balance),
          inline: true,
        },
        {
          name: "✅ Verified",
          value: user.verified ? "Yes" : "No",
          inline: true,
        },
        {
          name: "📊 Net P/L",
          value: netStr,
          inline: true,
        },
        {
          name: "🎲 Total Wagered",
          value: formatCoins(wagered),
          inline: true,
        },
        {
          name: "🏆 Total Won",
          value: formatCoins(won),
          inline: true,
        },
        {
          name: "💸 Total Lost",
          value: formatCoins(lost),
          inline: true,
        },
        {
          name: "🎮 Games Played",
          value: user.games_played.toLocaleString(),
          inline: true,
        },
        {
          name: "🥇 Games Won",
          value: user.games_won.toLocaleString(),
          inline: true,
        },
        {
          name: "📈 Win Rate",
          value: `${winRate}%`,
          inline: true,
        },
      )
      .setFooter({ text: "DonutSMP Casino" })
      .setTimestamp();

    const wagerReq = BigInt(user.wager_requirement ?? "0");
    if (wagerReq > 0n) {
      const withdrawable = balance > wagerReq ? balance - wagerReq : 0n;
      embed.addFields(
        {
          name: "✅ Available to Withdraw",
          value: formatCoins(withdrawable),
          inline: true,
        },
        {
          name: "🔒 Locked",
          value: `${formatCoins(wagerReq)}\n*Must gamble before withdraw*`,
          inline: true,
        },
      );
    }

    if (viewerIsMod && user.minecraft_username) {
      embed.addFields({
        name: "🎮 Linked Minecraft (mod-only)",
        value: `\`${user.minecraft_username}\``,
        inline: false,
      });
    }

    const ephemeral = !isSelf || (viewerIsMod && !!user.minecraft_username);

    await interaction.reply({ embeds: [embed], ephemeral });
  },
};

export default command;
