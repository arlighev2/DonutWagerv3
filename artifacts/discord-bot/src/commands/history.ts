import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { getBalanceHistory, getGameHistory } from "../lib/db.js";
import { formatCoinsShort } from "../lib/format.js";
import type { SlashCommand } from "../lib/types.js";

const SOURCE_LABEL: Record<string, string> = {
  coupon: "🎟️ Coupon",
  daily: "🎁 Daily",
  admin: "🛠️ Admin",
  withdraw: "📤 Withdraw",
  irlwithdraw: "💵 IRL Sale",
};

function formatTime(d: Date): string {
  const t = Math.floor(new Date(d).getTime() / 1000);
  return `<t:${t}:R>`;
}

function formatDelta(deltaStr: string): string {
  const n = BigInt(deltaStr);
  if (n >= 0n) return `+${formatCoinsShort(n)}`;
  return `-${formatCoinsShort(-n)}`;
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("history")
    .setDescription("View your recent balance changes or game results")
    .addSubcommand((sc) =>
      sc
        .setName("balance")
        .setDescription("Where your coins came from / went (coupons, admin, withdrawals)"),
    )
    .addSubcommand((sc) =>
      sc
        .setName("games")
        .setDescription("Your most recent games and whether you won or lost"),
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand();

    if (sub === "balance") {
      const events = await getBalanceHistory(interaction.user.id, 15);
      if (events.length === 0) {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x3b82f6)
              .setTitle("Balance History")
              .setDescription(
                "No non-game balance changes yet. Use `/history games` to see your gambling results.",
              ),
          ],
          ephemeral: true,
        });
        return;
      }
      const lines = events.map((e) => {
        const label = SOURCE_LABEL[e.source] ?? e.source;
        const delta = formatDelta(e.delta);
        const detail = e.detail ? ` — ${e.detail}` : "";
        return `${label} · **${delta}** · ${formatTime(e.created_at)}${detail}`;
      });
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x3b82f6)
            .setTitle("Balance History")
            .setDescription(lines.join("\n"))
            .setFooter({
              text: "Coupons, daily, admin actions, withdrawals — last 15 events.",
            }),
        ],
        ephemeral: true,
      });
      return;
    }

    if (sub === "games") {
      const games = await getGameHistory(interaction.user.id, 15);
      if (games.length === 0) {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x3b82f6)
              .setTitle("Game History")
              .setDescription("You haven't played any games yet."),
          ],
          ephemeral: true,
        });
        return;
      }
      const lines = games.map((g) => {
        const bet = BigInt(g.bet);
        const payout = BigInt(g.payout);
        const net = g.won ? payout - bet : -bet;
        const marker = g.won ? "✅" : "❌";
        const verb = g.won ? "won" : "lost";
        return `${marker} **${g.game}** · ${verb} **${formatCoinsShort(net < 0n ? -net : net)}** (bet ${formatCoinsShort(bet)}) · ${formatTime(g.created_at)}`;
      });
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x3b82f6)
            .setTitle("Game History")
            .setDescription(lines.join("\n"))
            .setFooter({ text: "Last 15 games." }),
        ],
        ephemeral: true,
      });
      return;
    }
  },
};

export default command;
