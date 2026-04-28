 /**
 * House edge engine.
 *
 * Default house win share is ~65% / user 35%. For "whale" bets above
 * BIG_BET_THRESHOLD, the house win share jumps to BIG_BET_HOUSE_RATE so the
 * casino can't be drained by a few lucky max-bet rolls.
 *
 * All games consult `houseShouldWin(bet)` before resolving any randomized
 * outcome. Pass the bet (as bigint) so the rate can be tilted automatically.
 */

export const HOUSE_WIN_RATE = 0.57;
export const BIG_BET_THRESHOLD = 99_000_000n; // > 99m mil
export const BIG_BET_HOUSE_RATE = 0.63;

/** Effective house win rate for a given bet. */
export function houseRateFor(bet?: bigint): number {
  if (bet !== undefined && bet > BIG_BET_THRESHOLD) return BIG_BET_HOUSE_RATE;
  return HOUSE_WIN_RATE;
}

/**
 * Returns true when the HOUSE should win this round.
 * Returns false when the USER should win this round.
 */
export function houseShouldWin(bet?: bigint): boolean {
  return Math.random() < houseRateFor(bet);
}

export function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

export function pickRandomExcept<T>(items: readonly T[], exclude: T): T {
  const filtered = items.filter((i) => i !== exclude);
  return filtered[Math.floor(Math.random() * filtered.length)]!;
}

export function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}
