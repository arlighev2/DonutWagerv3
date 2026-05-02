import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../lib/types.js";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("How to play and all available commands"),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const embed = new EmbedBuilder()
      .setColor(0xfacc15)
      .setTitle("🎰 DonutSMP Casino — How to Play")
      .setDescription(
        "Welcome to the DonutSMP Casino! Here's everything you need to know to get started.",
      )
      .addFields(
        {
          name: "📋 Getting Started",
          value:
            "**1.** Click ⚙️ **Settings** on the casino panel → choose your platform (Java / Bedrock) → enter your Minecraft username. Staff will approve your link.\n" +
            "**2.** Click 📥 **Deposit** on the panel → enter an amount → a ticket opens → pay the staff member in-game on DonutSMP → send a screenshot as proof.\n" +
            "**3.** Your balance is credited once staff confirms. Use `/balance` to check it.\n" +
            "**4.** Use any game command to start gambling!\n" +
            "**5.** When you're done, click 📤 **Withdraw** on the panel → enter an amount → staff will pay you in-game.",
        },
        {
          name: "🎮 Games",
          value:
            "`/coinflip <bet> <heads|tails>` — Call it. Win **2×** your bet.\n" +
            "`/dice <bet> <target>` — Pick a target (1–100). Roll over it to win.\n" +
            "`/mines <bet> [mines]` — 5×5 grid. Reveal gems, avoid bombs. Cash out anytime.\n" +
            "`/blackjack <bet>` — Beat the dealer. Hit, stand, double — classic rules.\n" +
            "`/roulette <bet> <choice>` — Red/black/number/dozen/column. Spin the wheel.\n" +
            "`/towers <bet> [difficulty]` — Climb 4 rows, pick the safe tile each time.",
        },
        {
          name: "💰 Banking",
          value:
            "`/deposit <amount>` — Open a deposit ticket (min **1 mil**)\n" +
            "`/withdraw <amount>` — Open a withdrawal ticket (min **1 mil**)\n" +
            "`/balance` — Check your current coin balance\n" +
            "`/daily` — Claim your free **10,000 coins** daily reward\n" +
            "`/close` — Close the current ticket channel",
        },
        {
          name: "📊 History & Stats",
          value:
            "`/history balance` — See all your deposits, withdrawals, and adjustments\n" +
            "`/history games` — See your recent game results and win/loss record",
        },
        {
          name: "🎁 Extras",
          value:
            "`/redeem <code>` — Claim free coins from a promo code\n" +
            "`/provablyfair <game>` — Verify any game result is genuinely random\n" +
            "`/resethash` — Rotate your seed for provable fairness",
        },
        {
          name: "🔢 Amount Format",
          value:
            "Use plain numbers or shortcuts:\n" +
            "`1k` · `10k` · `1mil` · `10mil` · `100mil` · `1bil` · `1.5bil`\n" +
            "For bets you can also use `all` or `half`.",
        },
        {
          name: "ℹ️ Additional Info",
          value:
            "**Min bet:** 10,000 coins\n" +
            "**Min deposit / withdraw:** 1,000,000 coins (1 mil)\n" +
            "All games are **provably fair** — use `/provablyfair` to verify any result.\n" +
            "Your linked Minecraft username is only visible to you and moderators.\n" +
            "Contact a moderator to change your linked account.",
        },
      )
      .setFooter({ text: "Gamble responsibly. Good luck!" });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

export default command;
