import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { adjustBalance, getOrCreateUser, recordGame } from "../lib/db.js";
import { formatCoins } from "../lib/format.js";
import { antiSpam, requireVerified, resolveBet } from "../lib/guards.js";
import { houseShouldWin } from "../lib/house.js";
import { logGamble } from "../lib/gamblelog.js";
import type { SlashCommand } from "../lib/types.js";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("dice")
    .setDescription(
      "Bet on whether the dice roll (1-100) lands under 50 or above 50",
    )
    .addStringOption((o) =>
      o
        .setName("pick")
        .setDescription("Under 50 or Above 50")
        .setRequired(true)
        .addChoices(
          { name: "Under 50", value: "under" },
          { name: "Above 50", value: "above" },
        ),
    )
    .addStringOption((o) =>
      o
        .setName("bet")
        .setDescription("Amount to bet (e.g. 100, 1k, all)")
        .setRequired(true),
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!antiSpam(interaction.user.id)) {
      await interaction.reply({
        content: "Slow down — wait a moment between commands.",
        ephemeral: true,
      });
      return;
    }
    const verified = await requireVerified(interaction);
    if (!verified) return;

    const pick = interaction.options.getString("pick", true) as
      | "under"
      | "above";
    const rawBet = interaction.options.getString("bet", true);
    const user = await getOrCreateUser(interaction.user.id);
    const bet = await resolveBet(interaction, user, rawBet);
    if (!bet) return;

    await adjustBalance(interaction.user.id, -bet);

    const houseWins = houseShouldWin(bet);
    const pickIsUnder = pick === "under";

    // Generate a roll consistent with the predetermined outcome.
    // "Under 50" wins on 1-49; "Above 50" wins on 51-100; 50 always favours the house.
    let roll: number;
    if (houseWins) {
      roll = pickIsUnder
        ? 50 + Math.floor(Math.random() * 51) // 50-100
        : 1 + Math.floor(Math.random() * 50); // 1-50
    } else {
      roll = pickIsUnder
        ? 1 + Math.floor(Math.random() * 49) // 1-49
        : 51 + Math.floor(Math.random() * 50); // 51-100
    }

    const won = !houseWins;
    const payout = won ? bet * 2n : 0n;
    if (payout > 0n) await adjustBalance(interaction.user.id, payout);

    await recordGame({
      discordId: interaction.user.id,
      game: "dice",
      bet,
      payout,
      won,
      details: { pick, roll },
    });
    await logGamble({
      discordId: interaction.user.id,
      game: "dice",
      bet,
      payout,
      won,
      detail: `pick:${pick} roll:${roll}`,
    });

    const after = await getOrCreateUser(interaction.user.id);
    const pickLabel = pickIsUnder ? "Under 50" : "Above 50";
    const rollLabel = roll < 50 ? "Under 50" : roll > 50 ? "Above 50" : "Exactly 50";
    const embed = new EmbedBuilder()
      .setColor(won ? 0x22c55e : 0xef4444)
      .setTitle(`🎲 Dice — Rolled ${roll}`)
      .setDescription(
        won
          ? `**You won ${formatCoins(payout - bet)}!**\nYour balance: ${formatCoins(BigInt(after.balance))}`
          : `**You lost ${formatCoins(bet)}.**\nYour balance: ${formatCoins(BigInt(after.balance))}`,
      )
      .addFields(
        { name: "Your Pick", value: pickLabel, inline: true },
        { name: "Roll", value: `${roll} (${rollLabel})`, inline: true },
        { name: "Bet", value: formatCoins(bet), inline: true },
      );

    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
