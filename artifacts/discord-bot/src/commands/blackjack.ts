import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import { adjustBalance, getOrCreateUser, recordGame } from "../lib/db.js";
import { formatCoins } from "../lib/format.js";
import { antiSpam, requireVerified, resolveBet } from "../lib/guards.js";
import { houseShouldWin, riggingBias, shuffle } from "../lib/house.js";
import { logGamble } from "../lib/gamblelog.js";
import type { SlashCommand } from "../lib/types.js";
import { endSession, getSession, startSession } from "../games/sessions.js";

type Suit = "♠" | "♥" | "♦" | "♣";
type Rank =
  | "A"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K";

interface Card {
  rank: Rank;
  suit: Suit;
}

const RANKS: Rank[] = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
];
const SUITS: Suit[] = ["♠", "♥", "♦", "♣"];

function buildDeck(): Card[] {
  const cards: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) cards.push({ rank: r, suit: s });
  return shuffle(cards);
}

function cardValue(rank: Rank): number {
  if (rank === "A") return 11;
  if (rank === "K" || rank === "Q" || rank === "J" || rank === "10") return 10;
  return parseInt(rank, 10);
}

function handTotal(hand: Card[]): number {
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    total += cardValue(c.rank);
    if (c.rank === "A") aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function renderCard(c: Card): string {
  const color = c.suit === "♥" || c.suit === "♦" ? "🟥" : "⬛";
  return `\`${c.rank}${c.suit}\``;
}

function renderHand(hand: Card[], hideSecond = false): string {
  if (hideSecond && hand.length >= 2) {
    return `${renderCard(hand[0]!)}  \`??\``;
  }
  return hand.map(renderCard).join("  ");
}

interface BJState {
  bet: bigint;
  deck: Card[];
  player: Card[];
  dealer: Card[];
  finished: boolean;
  willHouseWin: boolean;
  rig: number;
}

function buildEmbed(state: BJState, status: string, hideDealer: boolean) {
  const playerTotal = handTotal(state.player);
  const dealerTotal = hideDealer ? cardValue(state.dealer[0]!.rank) : handTotal(state.dealer);
  return new EmbedBuilder()
    .setColor(0x166534)
    .setTitle("🃏 Blackjack")
    .setDescription(status)
    .addFields(
      {
        name: `Dealer ${hideDealer ? "" : `(${dealerTotal})`}`,
        value: renderHand(state.dealer, hideDealer),
      },
      {
        name: `You (${playerTotal})`,
        value: renderHand(state.player),
      },
      { name: "Bet", value: formatCoins(state.bet), inline: true },
    );
}

function controls(disabled: boolean) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("bj:hit")
      .setLabel("Hit")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("bj:stand")
      .setLabel("Stand")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

/**
 * Pull the next card. If the round is "house favored" and we still have
 * options in the deck, prefer cards that hurt the player / help the dealer.
 */
function drawBiased(state: BJState, forPlayer: boolean): Card {
  // The rigging bias dictates how often we cherry-pick a card from the
  // deck instead of drawing the next one off the top. At rig = 0 (rate <=
  // 0.5) every draw is the natural top-of-deck — a fully fair shoe.
  if (state.rig <= 0 || Math.random() >= state.rig || state.deck.length < 5) {
    return state.deck.pop()!;
  }

  const playerTotal = handTotal(state.player);
  const dealerTotal = handTotal(state.dealer);
  const wantBust = state.willHouseWin && forPlayer;
  const wantHelpDealer = state.willHouseWin && !forPlayer;
  const wantHelpPlayer = !state.willHouseWin && forPlayer;
  const wantBustDealer = !state.willHouseWin && !forPlayer;

  const sorted = [...state.deck].sort((a, b) => {
    const av = cardValue(a.rank);
    const bv = cardValue(b.rank);
    if (wantBust) {
      // Prefer high cards to bust the player
      const aBusts = playerTotal + av > 21;
      const bBusts = playerTotal + bv > 21;
      if (aBusts !== bBusts) return aBusts ? -1 : 1;
      return bv - av;
    }
    if (wantHelpDealer) {
      // Bring dealer toward 17-21
      const aGood = dealerTotal + av >= 17 && dealerTotal + av <= 21;
      const bGood = dealerTotal + bv >= 17 && dealerTotal + bv <= 21;
      if (aGood !== bGood) return aGood ? -1 : 1;
      return Math.abs(20 - (dealerTotal + av)) - Math.abs(20 - (dealerTotal + bv));
    }
    if (wantHelpPlayer) {
      const aGood = playerTotal + av <= 21;
      const bGood = playerTotal + bv <= 21;
      if (aGood !== bGood) return aGood ? -1 : 1;
      return Math.abs(20 - (playerTotal + av)) - Math.abs(20 - (playerTotal + bv));
    }
    if (wantBustDealer) {
      const aBusts = dealerTotal + av > 21;
      const bBusts = dealerTotal + bv > 21;
      if (aBusts !== bBusts) return aBusts ? -1 : 1;
      return bv - av;
    }
    return 0;
  });

  const choice = sorted[0]!;
  state.deck = state.deck.filter((c) => c !== choice);
  return choice;
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("blackjack")
    .setDescription("Play a hand of blackjack against the dealer")
    .addStringOption((o) =>
      o.setName("bet").setDescription("Amount to bet").setRequired(true),
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
    const user = await getOrCreateUser(interaction.user.id);
    const bet = await resolveBet(interaction, user, rawBet);
    if (!bet) return;

    startSession(interaction.user.id, "blackjack");
    await adjustBalance(interaction.user.id, -bet);

    const deck = buildDeck();
    const state: BJState = {
      bet,
      deck,
      player: [],
      dealer: [],
      finished: false,
      willHouseWin: houseShouldWin(bet),
      rig: riggingBias(bet),
    };
    state.player.push(drawBiased(state, true));
    state.dealer.push(drawBiased(state, false));
    state.player.push(drawBiased(state, true));
    state.dealer.push(drawBiased(state, false));

    const playerTotal = handTotal(state.player);
    const dealerTotal = handTotal(state.dealer);

    // Natural blackjack check
    const blackjack = playerTotal === 21;
    const dealerBlackjack = dealerTotal === 21;

    const reply = await interaction.reply({
      embeds: [buildEmbed(state, "Hit or Stand.", true)],
      components: [controls(false)],
      withResponse: true,
    });
    const message = reply.resource?.message;
    if (!message) {
      endSession(interaction.user.id);
      return;
    }

    const finishHand = async (
      btn: ButtonInteraction | null,
      doubled = false,
    ): Promise<void> => {
      // Dealer plays
      while (handTotal(state.dealer) < 17) {
        state.dealer.push(drawBiased(state, false));
      }
      const pTotal = handTotal(state.player);
      const dTotal = handTotal(state.dealer);
      const stake = doubled ? state.bet * 2n : state.bet;

      let result: "win" | "lose" | "push";
      let payout = 0n;
      if (pTotal > 21) {
        result = "lose";
      } else if (dTotal > 21 || pTotal > dTotal) {
        result = "win";
        payout = stake * 2n;
      } else if (pTotal === dTotal) {
        result = "push";
        payout = stake;
      } else {
        result = "lose";
      }

      if (payout > 0n) await adjustBalance(interaction.user.id, payout);
      await recordGame({
        discordId: interaction.user.id,
        game: "blackjack",
        bet: stake,
        payout,
        won: result === "win",
        details: { result, pTotal, dTotal, doubled },
      });
      await logGamble({
        discordId: interaction.user.id,
        game: "blackjack",
        bet: stake,
        payout,
        won: result === "win",
        detail: `player:${pTotal} dealer:${dTotal} ${result}`,
      });

      const msg =
        result === "win"
          ? `**You won ${formatCoins(payout - stake)}!**`
          : result === "push"
            ? `**Push.** Bet returned.`
            : `**You lost ${formatCoins(stake)}.**`;

      const finalEmbed = buildEmbed(
        { ...state, bet: stake },
        msg,
        false,
      ).setColor(
        result === "win" ? 0x22c55e : result === "push" ? 0xfacc15 : 0xef4444,
      );
      const payload = { embeds: [finalEmbed], components: [controls(true)] };
      if (btn) await btn.update(payload);
      else await message.edit(payload);
      endSession(interaction.user.id);
      collector.stop("done");
    };

    if (blackjack || dealerBlackjack) {
      // Resolve immediately (player BJ pays 2.5x stake)
      let payout = 0n;
      let label: string;
      if (blackjack && !dealerBlackjack) {
        payout = (state.bet * 5n) / 2n + state.bet; // returns stake + 1.5x
        label = `**Blackjack! You won ${formatCoins(payout - state.bet)}.**`;
        await adjustBalance(interaction.user.id, payout);
      } else if (!blackjack && dealerBlackjack) {
        label = `**Dealer blackjack — you lost ${formatCoins(state.bet)}.**`;
      } else {
        payout = state.bet;
        label = "**Push.** Both have blackjack.";
        await adjustBalance(interaction.user.id, payout);
      }
      await recordGame({
        discordId: interaction.user.id,
        game: "blackjack",
        bet: state.bet,
        payout,
        won: payout > state.bet,
        details: { instantBJ: true, blackjack, dealerBlackjack },
      });
      await logGamble({
        discordId: interaction.user.id,
        game: "blackjack",
        bet: state.bet,
        payout,
        won: payout > state.bet,
        detail: blackjack && dealerBlackjack ? "push BJ" : blackjack ? "natural BJ" : "dealer BJ",
      });
      await message.edit({
        embeds: [
          buildEmbed(state, label, false).setColor(
            payout > state.bet ? 0x22c55e : payout === state.bet ? 0xfacc15 : 0xef4444,
          ),
        ],
        components: [controls(true)],
      });
      endSession(interaction.user.id);
      return;
    }

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 5 * 60 * 1000,
      filter: (i) => i.user.id === interaction.user.id,
    });

    collector.on("collect", async (btn: ButtonInteraction) => {
      if (state.finished) return;
      if (btn.customId === "bj:hit") {
        state.player.push(drawBiased(state, true));
        if (handTotal(state.player) > 21) {
          state.finished = true;
          await finishHand(btn);
          return;
        }
        await btn.update({
          embeds: [buildEmbed(state, "Hit or Stand.", true)],
          components: [controls(false)],
        });
      } else if (btn.customId === "bj:stand") {
        state.finished = true;
        await finishHand(btn);
      }
    });

    collector.on("end", async (_c, reason) => {
      if (reason === "done") return;
      if (!state.finished) {
        await adjustBalance(interaction.user.id, state.bet);
        endSession(interaction.user.id);
        try {
          await message.edit({
            embeds: [buildEmbed(state, "Timed out — bet refunded.", false)],
            components: [controls(true)],
          });
        } catch {
          /* ignore */
        }
      }
    });
  },
};

export default command;
