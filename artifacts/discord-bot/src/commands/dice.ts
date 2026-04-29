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

// Stake-style dice. Roll is a decimal between 0.01 and 100.00.
// Player picks a target (1.00 - 99.00) and whether to roll OVER or
// UNDER it. Win probability shrinks the multiplier accordingly.
const MIN_TARGET = 1.0;
const MAX_TARGET = 99.0;
const MIN_ROLL = 0.01;
const MAX_ROLL = 100.0;
const HOUSE_EDGE_FACTOR = 0.99;

function clampTarget(t: number): number {
  if (Number.isNaN(t)) return 50.0;
  return Math.min(MAX_TARGET, Math.max(MIN_TARGET, Math.round(t * 100) / 100));
}

function winChancePct(target: number, mode: "under" | "over"): number {
  // "Under target" wins on rolls strictly less than target.
  // "Over target" wins on rolls strictly greater than target.
  if (mode === "under") return target;
  return 100 - target;
}

function multiplierFor(winChance: number): number {
  // Fair multiplier (excluding house edge) is 100 / winChance.
  return (100 / winChance) * HOUSE_EDGE_FACTOR;
}

function rollDecimal(): number {
  // 0.01 .. 100.00 inclusive on both ends.
  const n = MIN_ROLL + Math.random() * (MAX_ROLL - MIN_ROLL);
  return Math.round(n * 100) / 100;
}

function rollLosing(target: number, mode: "under" | "over"): number {
  // "under" loses on >= target. "over" loses on <= target.
  if (mode === "under") {
    const min = target;
    const span = MAX_ROLL - min;
    return Math.round((min + Math.random() * span) * 100) / 100;
  }
  const max = target;
  const span = max - MIN_ROLL;
  return Math.round((MIN_ROLL + Math.random() * span) * 100) / 100;
}

function rollWinning(target: number, mode: "under" | "over"): number {
  if (mode === "under") {
    // Strictly less than target.
    const span = target - MIN_ROLL;
    let n = MIN_ROLL + Math.random() * span;
    if (n >= target) n = target - 0.01;
    return Math.round(n * 100) / 100;
  }
  // Strictly greater than target.
  const span = MAX_ROLL - target;
  let n = target + Math.random() * span;
  if (n <= target) n = target + 0.01;
  return Math.round(n * 100) / 100;
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("dice")
    .setDescription(
      "Roll a 0.01-100.00 dice — pick a target and whether to roll under or over it",
    )
    .addStringOption((o) =>
      o
        .setName("mode")
        .setDescription("Win on rolls Under or Over your target")
        .setRequired(true)
        .addChoices(
          { name: "Roll Under", value: "under" },
          { name: "Roll Over", value: "over" },
        ),
    )
    .addStringOption((o) =>
      o
        .setName("bet")
        .setDescription("Amount to bet (e.g. 100, 1k, all)")
        .setRequired(true),
    )
    .addNumberOption((o) =>
      o
        .setName("target")
        .setDescription("Target between 1.00 and 99.00 (default 50.00)")
        .setRequired(false)
        .setMinValue(MIN_TARGET)
        .setMaxValue(MAX_TARGET),
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

    const mode = interaction.options.getString("mode", true) as
      | "under"
      | "over";
    const target = clampTarget(
      interaction.options.getNumber("target") ?? 50.0,
    );
    const rawBet = interaction.options.getString("bet", true);
    const user = await getOrCreateUser(interaction.user.id);
    const bet = await resolveBet(interaction, user, rawBet);
    if (!bet) return;

    const winChance = winChancePct(target, mode);
    const mult = multiplierFor(winChance);
    if (!Number.isFinite(mult) || mult <= 1) {
      await interaction.reply({
        content: "Pick a target with a real win chance (try 1.00 - 99.00).",
        ephemeral: true,
      });
      return;
    }

    await adjustBalance(interaction.user.id, -bet);

    const houseWins = houseShouldWin(bet);
    const won = !houseWins;
    const roll = won ? rollWinning(target, mode) : rollLosing(target, mode);

    // Payout returns stake * mult on win, 0 on loss.
    const payout = won ? BigInt(Math.floor(Number(bet) * mult)) : 0n;
    if (payout > 0n) await adjustBalance(interaction.user.id, payout);

    await recordGame({
      discordId: interaction.user.id,
      game: "dice",
      bet,
      payout,
      won,
      details: { mode, target, roll, mult },
    });
    await logGamble({
      discordId: interaction.user.id,
      game: "dice",
      bet,
      payout,
      won,
      detail: `${mode} ${target.toFixed(2)} rolled ${roll.toFixed(2)} x${mult.toFixed(2)}`,
    });

    const after = await getOrCreateUser(interaction.user.id);
    const targetLabel =
      mode === "under"
        ? `Under ${target.toFixed(2)}`
        : `Over ${target.toFixed(2)}`;
    const embed = new EmbedBuilder()
      .setColor(won ? 0x22c55e : 0xef4444)
      .setTitle(`🎲 Dice — Rolled ${roll.toFixed(2)}`)
      .setDescription(
        won
          ? `**You won ${formatCoins(payout - bet)}!**\nYour balance: ${formatCoins(BigInt(after.balance))}`
          : `**You lost ${formatCoins(bet)}.**\nYour balance: ${formatCoins(BigInt(after.balance))}`,
      )
      .addFields(
        { name: "Pick", value: targetLabel, inline: true },
        { name: "Multiplier", value: `x${mult.toFixed(2)}`, inline: true },
        { name: "Win Chance", value: `${winChance.toFixed(2)}%`, inline: true },
        { name: "Bet", value: formatCoins(bet), inline: true },
      );

    await interaction.reply({ embeds: [embed] });
  },
};

export default command;
