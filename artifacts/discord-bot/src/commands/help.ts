import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../lib/types.js";

const HOW_TO_PLAY: Record<
  string,
  { title: string; color: number; description: string }
> = {
  coinflip: {
    title: "🪙 How to Play — Coinflip",
    color: 0xfacc15,
    description:
      "**Usage:** `/coinflip <bet> <heads|tails>`\n\n" +
      "Pick heads or tails. The bot flips a coin — if you called it right you win **2×** your bet, otherwise you lose your bet.\n\n" +
      "**Example:** `/coinflip 1mil heads` — bet 1,000,000 coins on heads.\n\n" +
      "**Odds:** ~50/50 (house edge applies).",
  },
  dice: {
    title: "🎲 How to Play — Dice",
    color: 0x3b82f6,
    description:
      "**Usage:** `/dice <bet> <target>`\n\n" +
      "Pick a target number between **2 and 98**. The bot rolls a number from 1–100.\n" +
      "- Pick **under** a high number (e.g. 80) → easier to win, lower payout\n" +
      "- Pick **over** a low number (e.g. 20) → harder to win, higher payout\n\n" +
      "You win if the roll is **strictly over** your target.\n\n" +
      "**Example:** `/dice 1mil 50` — win if the roll is 51–100.\n\n" +
      "**Payout:** scales with your target — higher risk = higher reward.",
  },
  mines: {
    title: "💣 How to Play — Mines",
    color: 0xef4444,
    description:
      "**Usage:** `/mines <bet> [mines]`\n\n" +
      "A **5×5 grid** (25 tiles). Hidden under the tiles are gems 💎 and bombs 💣.\n\n" +
      "1. Click a tile to reveal it.\n" +
      "2. Hit a gem → multiplier increases, keep going or cash out.\n" +
      "3. Hit a bomb → you lose your bet immediately.\n" +
      "4. Click **Cash Out** at any time to lock in your winnings.\n\n" +
      "**Mines option:** 1–24 mines (default varies). More mines = higher multiplier per gem, but riskier.\n\n" +
      "**Example:** `/mines 500k 5` — bet 500k with 5 bombs on the board.",
  },
  blackjack: {
    title: "🃏 How to Play — Blackjack",
    color: 0x22c55e,
    description:
      "**Usage:** `/blackjack <bet>`\n\n" +
      "Classic blackjack against the dealer.\n\n" +
      "**Goal:** Get closer to 21 than the dealer without going over (busting).\n\n" +
      "**Card values:**\n" +
      "- 2–10 → face value\n" +
      "- J, Q, K → 10\n" +
      "- Ace → 1 or 11 (whichever helps you more)\n\n" +
      "**Actions:**\n" +
      "- **Hit** — draw another card\n" +
      "- **Stand** — keep your hand, dealer plays\n" +
      "- **Double** — double your bet, take exactly one more card\n\n" +
      "**Payouts:** Win → 2×, Blackjack (21 on first 2 cards) → 2.5×, Tie → bet returned.",
  },
  roulette: {
    title: "🎡 How to Play — Roulette",
    color: 0xa855f7,
    description:
      "**Usage:** `/roulette <bet> <choice>`\n\n" +
      "The wheel spins 0–36. Place your bet on where the ball lands.\n\n" +
      "**Choices & payouts:**\n" +
      "- `red` / `black` → **2×** (covers 18 numbers each)\n" +
      "- `even` / `odd` → **2×** (covers 18 numbers, 0 loses)\n" +
      "- `1-18` / `19-36` → **2×**\n" +
      "- `1st12` / `2nd12` / `3rd12` (dozens) → **3×**\n" +
      "- A single number (e.g. `7`) → **35×**\n\n" +
      "Landing on **0** loses all outside bets.\n\n" +
      "**Example:** `/roulette 200k red` — bet 200k on red.",
  },
  towers: {
    title: "🗼 How to Play — Towers",
    color: 0xf97316,
    description:
      "**Usage:** `/towers <bet> [difficulty]`\n\n" +
      "Climb a tower with **4 rows**. Each row has multiple tiles — one is safe, the rest are traps.\n\n" +
      "**Difficulties:**\n" +
      "- `easy` — 3 tiles, 1 trap (pick 1-of-3 safe)\n" +
      "- `medium` — 2 tiles, 1 trap (50/50)\n" +
      "- `hard` — 4 tiles, 3 traps (pick 1-of-4 safe)\n\n" +
      "Pick the safe tile to advance. Your multiplier grows with each row.\n" +
      "Hit a trap → lose your bet. Reach the top → maximum payout.\n" +
      "You can **Cash Out** after any row to keep your current multiplier.\n\n" +
      "**Example:** `/towers 1mil medium` — bet 1mil on medium difficulty.",
  },
};

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show all commands, or learn how to play a specific game")
    .addStringOption((opt) =>
      opt
        .setName("game")
        .setDescription("Learn how to play a specific game")
        .setRequired(false)
        .addChoices(
          { name: "Coinflip", value: "coinflip" },
          { name: "Dice", value: "dice" },
          { name: "Mines", value: "mines" },
          { name: "Blackjack", value: "blackjack" },
          { name: "Roulette", value: "roulette" },
          { name: "Towers", value: "towers" },
        ),
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const game = interaction.options.getString("game");

    if (game) {
      const info = HOW_TO_PLAY[game];
      if (!info) {
        await interaction.reply({ content: "Unknown game.", ephemeral: true });
        return;
      }
      const embed = new EmbedBuilder()
        .setColor(info.color)
        .setTitle(info.title)
        .setDescription(info.description)
        .setFooter({ text: "All games are provably fair. Gamble responsibly." });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0xfacc15)
      .setTitle("🎰 DonutSMP Casino — Commands")
      .setDescription(
        "Use `/help game:<game>` to learn how to play any specific game.",
      )
      .addFields(
        {
          name: "Account",
          value:
            "`/balance` — view your coins and stats\n" +
            "`/daily` — claim your free daily reward (10,000 coins)\n" +
            "`/history balance` — see where your coins came from\n" +
            "`/history games` — see your recent game results",
        },
        {
          name: "Banking",
          value:
            "`/deposit <amount>` — open a deposit ticket (min **1mil**)\n" +
            "`/withdraw <amount>` — open a withdrawal ticket (min **1mil**)\n" +
            "`/close` — close the current ticket",
        },
        {
          name: "Games",
          value:
            "`/coinflip <bet> <heads|tails>`\n" +
            "`/dice <bet> <target>`\n" +
            "`/mines <bet> [mines]`\n" +
            "`/blackjack <bet>`\n" +
            "`/roulette <bet> <choice>`\n" +
            "`/towers <bet> [difficulty]`",
        },
        {
          name: "Extras",
          value:
            "`/redeem <code>` — claim free coins from a promo code\n" +
            "`/provablyfair <game>` — verify any game result\n" +
            "`/resethash` — rotate your seed",
        },
        {
          name: "Amount Format",
          value:
            "`1k` · `10k` · `1mil` · `10mil` · `100mil` · `1bil` · `1.5bil`\n" +
            "For bets: `all` and `half` also work.",
        },
      )
      .setFooter({ text: "All games are provably fair. Gamble responsibly." });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

export default command;
