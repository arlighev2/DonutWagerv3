import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../lib/types.js";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show all available commands"),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("🎰 DonutSMP Casino — Commands")
      .setDescription(
        "Link your DonutSMP account, deposit some in-game money, and try your luck.",
      )
      .addFields(
        {
          name: "Account",
          value:
            "`/verify minecraft:<name> [platform:Java|Bedrock]` — open a linking ticket so staff can confirm your DonutSMP account\n" +
            "`/balance` — view your coins and stats\n" +
            "`/daily` — claim your free daily reward (10,000 coins)\n" +
            "`/history balance` — see where your coins came from (coupons, admin, withdrawals)\n" +
            "`/history games` — see your recent games and wins/losses",
        },
        {
          name: "Banking (DonutSMP in-game $)",
          value:
            "`/deposit amount` — open a deposit ticket (min **1mil**) — _will be fully automatic one day_\n" +
            "`/pay screenshot` — submit your in-game payment proof in a deposit ticket\n" +
            "`/withdraw amount` — open a withdrawal ticket (min **1mil**)\n" +
            "`/close` — close the current ticket",
        },
        {
          name: "Games",
          value:
            "`/coinflip side bet` — heads or tails (2x)\n" +
            "`/dice pick bet` — pick 1-100, win if the roll lands on the same side of 50\n" +
            "`/roulette choice bet` — red/black/even/odd/etc.\n" +
            "`/blackjack bet` — beat the dealer (hit / stand)\n" +
            "`/mines bet [mines]` — 5x5 board, reveal gems, avoid bombs (default 12 mines = ~50/50)\n" +
            "`/towers bet [difficulty]` — climb 4 levels, pick the safe tile each row (easy 1-of-3, medium 1-of-2 / 50-50, hard 1-of-4)",
        },
        {
          name: "Provably Fair",
          value:
            "`/provablyfair game:<game>` — view the verifier script and your current seed/hash\n" +
            "`/resethash` — rotate your seed and publish a new server hash",
        },
        {
          name: "Promo Codes",
          value: "`/redeem code:<code>` — claim free coins from a promo code",
        },
        {
          name: "Privacy",
          value:
            "Minecraft usernames are private. Only the user themselves and moderators ever see linked account names. Mods can use `/reset user:` to unlink an account.",
        },
        {
          name: "Amount Format",
          value:
            "Plain numbers (`100`, `5000`, `1500000`) or shortcuts:\n" +
            "`1k`, `10k`, `1mil`, `10mil`, `100mil`, `1bil`, `1.5bil`, plus `all` / `half` for bets.",
        },
      )
      .setFooter({
        text: "All games are provably fair. Gamble responsibly.",
      });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

export default command;
