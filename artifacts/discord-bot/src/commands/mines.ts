import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ContainerBuilder,
  MessageFlags,
  SlashCommandBuilder,
  TextDisplayBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import { adjustBalance, getOrCreateUser, recordGame } from "../lib/db.js";
import { formatCoins } from "../lib/format.js";
import { antiSpam, requireVerified, resolveBet } from "../lib/guards.js";
import { houseRateFor, houseShouldWin } from "../lib/house.js";
import { logGamble } from "../lib/gamblelog.js";
import type { SlashCommand } from "../lib/types.js";
import { endSession, getSession, startSession } from "../games/sessions.js";

// 5x5 board: 25 tiles fill all 5 standard action rows. To still fit the
// Cash Out button on the same message we use Discord's Components V2 layout
// (Container with TextDisplay + 5 board rows + 1 cashout row), which lifts
// the 5-row cap to 10.
const COLS = 5;
const ROWS = 5;
const GRID = COLS * ROWS; // 25
const MAX_MINES = GRID - 1; // 24

// Default mines count when the user doesn't pass one.
const DEFAULT_MINES = 3;

// Display-side house edge applied once on top of the fair multiplier.
// The bigger swing comes from `houseShouldWin` biasing the survival roll.
const HOUSE_EDGE_FACTOR = 0.92;

// Hard ceiling: once the player's current multiplier crosses this,
// the very next tile they click is forced to be a mine. They can still
// cash out instead — they just can't keep climbing.
const MAX_MULTIPLIER_BEFORE_FORCED_BOMB = 50;

// In house-win games, every click (including the first) has this chance
// of bombing on top of normal positional play. The chance scales with
// HOUSE_WIN_RATE / BIG_BET_HOUSE_RATE so that 1.0 means "auto-lose every
// game". Lucky games (the games NOT pre-flagged as house wins) ignore
// this bias entirely.
function rigChanceFor(bet: bigint): number {
  return houseRateFor(bet);
}

interface MinesState {
  bet: bigint;
  mines: number;
  revealed: Set<number>;
  exploded: boolean;
  cashedOut: boolean;
  timedOut: boolean;
  willHouseWin: boolean;
  mineTiles: Set<number>;
  safeTiles: Set<number>;
}

type EndSummary = {
  multiplier: number;
  netDelta: bigint; // signed: + for cashout, - for bust
  newBalance: bigint;
};

function formatSigned(delta: bigint): string {
  if (delta >= 0n) return `+${formatCoins(delta)}`;
  return `-${formatCoins(-delta)}`;
}

function multiplierFor(picks: number, mines: number): number {
  if (picks === 0) return 1;
  let m = 1;
  for (let i = 0; i < picks; i++) {
    const safeRemaining = GRID - mines - i;
    const totalRemaining = GRID - i;
    if (safeRemaining <= 0) return m * HOUSE_EDGE_FACTOR;
    m *= totalRemaining / safeRemaining;
  }
  return m * HOUSE_EDGE_FACTOR;
}

function buildBoard(state: MinesState, gameOver: boolean) {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let r = 0; r < ROWS; r++) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (let c = 0; c < COLS; c++) {
      const idx = r * COLS + c;
      const isRevealed = state.revealed.has(idx);
      const isMine = state.mineTiles.has(idx);

      const btn = new ButtonBuilder().setCustomId(`mines:tile:${idx}`);

      if (gameOver) {
        if (isRevealed && !isMine) {
          btn.setLabel("💎").setStyle(ButtonStyle.Success).setDisabled(true);
        } else if (isMine) {
          btn.setLabel("💣").setStyle(ButtonStyle.Danger).setDisabled(true);
        } else {
          btn.setLabel("·").setStyle(ButtonStyle.Secondary).setDisabled(true);
        }
      } else if (isRevealed) {
        btn.setLabel("💎").setStyle(ButtonStyle.Success).setDisabled(true);
      } else {
        btn.setLabel("\u200b").setStyle(ButtonStyle.Primary);
      }
      row.addComponents(btn);
    }
    rows.push(row);
  }
  return rows;
}

function buildCashoutRow(enabled: boolean) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("mines:cashout")
      .setLabel("Cash Out")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!enabled),
  );
}

function buildContainer(
  state: MinesState,
  currentMultiplier: number,
  gameOver: boolean,
  summary?: EndSummary,
): ContainerBuilder {
  const color = state.exploded
    ? 0xef4444
    : state.cashedOut
      ? 0x22c55e
      : 0x3b82f6;

  let header: string;
  let bodyLines: string[];

  if (state.cashedOut && summary) {
    header = "## Cashed Out!";
    bodyLines = [
      `**Tiles revealed:** ${state.revealed.size}`,
      `**Multiplier:** x${summary.multiplier.toFixed(2)}`,
      `**Gross:** ${formatSigned(summary.netDelta)} 🪙`,
      `**New Balance:** ${formatCoins(summary.newBalance)} 🪙`,
    ];
  } else if (state.exploded && summary) {
    header = "## 💥 BOOM — Mine Hit!";
    bodyLines = [
      `**Tiles revealed:** ${state.revealed.size}`,
      `**Multiplier:** x0.00`,
      `**Gross:** ${formatSigned(summary.netDelta)} 🪙`,
      `**New Balance:** ${formatCoins(summary.newBalance)} 🪙`,
    ];
  } else if (state.timedOut) {
    header = "## ⌛ Timed Out";
    bodyLines = [`Game expired after 5 minutes — your bet was refunded.`];
  } else {
    header = "## 💎 Mines";
    const potential = BigInt(
      Math.floor(Number(state.bet) * currentMultiplier),
    );
    const profit = potential - state.bet;
    bodyLines = [
      `**Bet:** ${formatCoins(state.bet)} 🪙  •  **Mines:** ${state.mines} / ${GRID}  •  **Revealed:** ${state.revealed.size}`,
      `**Multiplier:** x${currentMultiplier.toFixed(2)}  •  **Cash out for:** ${formatCoins(potential)} 🪙 (${formatSigned(profit)})`,
    ];
  }

  const titleText = new TextDisplayBuilder().setContent(header);
  const bodyText = new TextDisplayBuilder().setContent(bodyLines.join("\n"));

  const cashoutEnabled =
    !gameOver &&
    !state.cashedOut &&
    !state.exploded &&
    state.revealed.size > 0;

  const container = new ContainerBuilder().setAccentColor(color);
  container.addTextDisplayComponents(titleText);
  for (const row of buildBoard(state, gameOver)) {
    container.addActionRowComponents(row);
  }
  container.addTextDisplayComponents(bodyText);
  container.addActionRowComponents(buildCashoutRow(cashoutEnabled));
  return container;
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("mines")
    .setDescription("Reveal gems and avoid the mines (5x5 board)")
    .addStringOption((o) =>
      o.setName("bet").setDescription("Amount to bet").setRequired(true),
    )
    .addIntegerOption((o) =>
      o
        .setName("mines")
        .setDescription(`Number of mines (1-${MAX_MINES}, default ${DEFAULT_MINES} = ~50/50)`)
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(MAX_MINES),
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!antiSpam(interaction.user.id)) {
      await interaction.reply({ content: "Slow down.", ephemeral: true });
      return;
    }
    const verified = await requireVerified(interaction);
    if (!verified) return;

    if (getSession(interaction.user.id)) {
      await interaction.reply({
        content: "Finish your active game first.",
        ephemeral: true,
      });
      return;
    }

    const rawBet = interaction.options.getString("bet", true);
    const minesOpt = interaction.options.getInteger("mines") ?? DEFAULT_MINES;
    if (!Number.isInteger(minesOpt) || minesOpt < 1 || minesOpt > MAX_MINES) {
      await interaction.reply({
        content: `Mines must be a whole number between 1 and ${MAX_MINES}.`,
        ephemeral: true,
      });
      return;
    }
    const user = await getOrCreateUser(interaction.user.id);
    const bet = await resolveBet(interaction, user, rawBet);
    if (!bet) return;

    startSession(interaction.user.id, "mines");
    await adjustBalance(interaction.user.id, -bet);

    const refundAndAbort = async (msg: string): Promise<void> => {
      try {
        await adjustBalance(interaction.user.id, bet);
      } finally {
        endSession(interaction.user.id);
      }
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: msg, ephemeral: true });
        } else {
          await interaction.reply({ content: msg, ephemeral: true });
        }
      } catch {
        /* ignore */
      }
    };

    const minePositions = new Set<number>();
    while (minePositions.size < minesOpt) {
      minePositions.add(Math.floor(Math.random() * GRID));
    }

    const state: MinesState = {
      bet,
      mines: minesOpt,
      revealed: new Set(),
      exploded: false,
      cashedOut: false,
      timedOut: false,
      willHouseWin: houseShouldWin(bet),
      mineTiles: minePositions,
      safeTiles: new Set(),
    };

    let reply;
    try {
      reply = await interaction.reply({
        flags: MessageFlags.IsComponentsV2,
        components: [
          buildContainer(state, multiplierFor(0, state.mines), false),
        ],
        withResponse: true,
      });
    } catch (err) {
      console.error("[mines] failed to send game message:", err);
      await refundAndAbort(
        "Couldn't start the game (Discord error). Your bet was refunded.",
      );
      return;
    }
    const message = reply.resource?.message;
    if (!message) {
      await refundAndAbort(
        "Couldn't start the game. Your bet was refunded — please try again.",
      );
      return;
    }

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 5 * 60 * 1000,
      filter: (i) => i.user.id === interaction.user.id,
    });

    collector.on("collect", async (btn: ButtonInteraction) => {
      if (state.exploded || state.cashedOut) return;
      const id = btn.customId;

      if (id === "mines:cashout") {
        if (state.revealed.size === 0) {
          await btn.reply({
            content: "Reveal at least one tile before cashing out.",
            ephemeral: true,
          });
          return;
        }
        state.cashedOut = true;
        const mult = multiplierFor(state.revealed.size, state.mines);
        const payout = BigInt(Math.floor(Number(state.bet) * mult));
        const newBalance = await adjustBalance(interaction.user.id, payout);
        await recordGame({
          discordId: interaction.user.id,
          game: "mines",
          bet: state.bet,
          payout,
          won: payout > state.bet,
          details: { picks: state.revealed.size, mines: state.mines, mult },
        });
        await logGamble({
          discordId: interaction.user.id,
          game: "mines",
          bet: state.bet,
          payout,
          won: payout > state.bet,
          detail: `cashout ${state.revealed.size} picks, ${state.mines} mines, x${mult.toFixed(2)}`,
        });
        // Reveal remaining mines for visual effect.
        let safety = 0;
        while (state.mineTiles.size < state.mines && safety++ < 200) {
          const candidate = Math.floor(Math.random() * GRID);
          if (!state.revealed.has(candidate) && !state.mineTiles.has(candidate))
            state.mineTiles.add(candidate);
        }
        try {
          await btn.update({
            components: [
              buildContainer(state, mult, true, {
                multiplier: mult,
                netDelta: payout - state.bet,
                newBalance,
              }),
            ],
          });
        } catch {
          /* ignore */
        }
        endSession(interaction.user.id);
        collector.stop("cashout");
        return;
      }

      const tileMatch = id.match(/^mines:tile:(\d+)$/);
      if (!tileMatch) return;
      const idx = parseInt(tileMatch[1]!, 10);

      if (state.revealed.has(idx)) {
        await btn.deferUpdate();
        return;
      }

      const isFirstClick = state.revealed.size === 0;
      const currentMult = multiplierFor(state.revealed.size, state.mines);
      const overCeiling = currentMult > MAX_MULTIPLIER_BEFORE_FORCED_BOMB;

      const rig = rigChanceFor(state.bet);

      let survive: boolean;
      if (overCeiling) {
        // Force a bomb on this tile, even if it was originally safe.
        survive = false;
        if (!state.mineTiles.has(idx)) state.mineTiles.add(idx);
      } else if (isFirstClick) {
        if (state.mineTiles.has(idx)) {
          // Lucky games always survive the first click on a mine; rigged
          // games bomb with probability `rig` (1.0 = auto-lose).
          if (state.willHouseWin && Math.random() < rig) {
            survive = false;
          } else {
            state.mineTiles.delete(idx);
            const safe: number[] = [];
            for (let i = 0; i < GRID; i++) {
              if (i !== idx && !state.mineTiles.has(i)) safe.push(i);
            }
            if (safe.length > 0) {
              const swapTo = safe[Math.floor(Math.random() * safe.length)]!;
              state.mineTiles.add(swapTo);
            }
            survive = true;
          }
        } else if (state.willHouseWin && Math.random() < rig) {
          // Rigged game: even safe first clicks can be flipped to a bomb.
          state.mineTiles.add(idx);
          survive = false;
        } else {
          survive = true;
        }
      } else if (state.mineTiles.has(idx)) {
        // Real pre-placed mine.
        survive = false;
      } else if (state.willHouseWin && Math.random() < rig) {
        // Rigged game: secretly convert this safe tile into a mine.
        state.mineTiles.add(idx);
        survive = false;
      } else {
        survive = true;
      }

      if (!survive) {
        state.exploded = true;
        if (!state.mineTiles.has(idx)) state.mineTiles.add(idx);
        await recordGame({
          discordId: interaction.user.id,
          game: "mines",
          bet: state.bet,
          payout: 0n,
          won: false,
          details: {
            picks: state.revealed.size,
            mines: state.mines,
            blewUp: idx,
          },
        });
        await logGamble({
          discordId: interaction.user.id,
          game: "mines",
          bet: state.bet,
          payout: 0n,
          won: false,
          detail: `boom on tile ${idx} after ${state.revealed.size} picks`,
        });
        // Bet was deducted at game start; fetch current balance to display.
        const currentUser = await getOrCreateUser(interaction.user.id);
        try {
          await btn.update({
            components: [
              buildContainer(state, 0, true, {
                multiplier: 0,
                netDelta: -state.bet,
                newBalance: BigInt(currentUser.balance),
              }),
            ],
          });
        } catch {
          /* ignore */
        }
        endSession(interaction.user.id);
        collector.stop("explode");
        return;
      }

      state.revealed.add(idx);
      state.safeTiles.add(idx);
      const mult = multiplierFor(state.revealed.size, state.mines);
      try {
        await btn.update({
          components: [buildContainer(state, mult, false)],
        });
      } catch {
        /* ignore */
      }
    });

    collector.on("end", async (_collected, reason) => {
      if (reason === "cashout" || reason === "explode") return;
      if (state.exploded || state.cashedOut) return;
      await adjustBalance(interaction.user.id, state.bet);
      endSession(interaction.user.id);
      state.timedOut = true;
      try {
        await message.edit({
          components: [
            buildContainer(
              state,
              multiplierFor(state.revealed.size, state.mines),
              true,
            ),
          ],
        });
      } catch {
        /* ignore */
      }
    });
  },
};

export default command;
