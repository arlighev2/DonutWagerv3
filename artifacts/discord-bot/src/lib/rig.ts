import { pool } from "./db.js";

export type RigMode = "next_loss" | "pct_loss" | "pct_win";

export type RigResult =
  | { active: false }
  | { active: true; forceLoss: true; forceWin: false }
  | { active: true; forceLoss: false; forceWin: true };

export async function setRig(
  discordId: string,
  mode: RigMode,
  value = 80,
): Promise<void> {
  await pool.query(
    `INSERT INTO bot_rigged (discord_id, mode, value)
     VALUES ($1, $2, $3)
     ON CONFLICT (discord_id) DO UPDATE SET mode = $2, value = $3, created_at = NOW()`,
    [discordId, mode, value],
  );
}

export async function clearRig(discordId: string): Promise<boolean> {
  const r = await pool.query(
    "DELETE FROM bot_rigged WHERE discord_id = $1 RETURNING discord_id",
    [discordId],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function getRigRow(
  discordId: string,
): Promise<{ mode: RigMode; value: number } | null> {
  const r = await pool.query<{ mode: RigMode; value: number }>(
    "SELECT mode, value FROM bot_rigged WHERE discord_id = $1",
    [discordId],
  );
  return r.rows[0] ?? null;
}

/**
 * Resolve the rig for a user at game start.
 * - next_loss: atomically consumed, forces loss on this one game.
 * - pct_loss: rolls the dice; returns forceLoss at the stored probability.
 * - pct_win: rolls the dice; returns forceWin at the stored probability.
 */
export async function checkRig(discordId: string): Promise<RigResult> {
  const rig = await getRigRow(discordId);
  if (!rig) return { active: false };

  if (rig.mode === "next_loss") {
    const r = await pool.query(
      "DELETE FROM bot_rigged WHERE discord_id = $1 AND mode = 'next_loss' RETURNING discord_id",
      [discordId],
    );
    if ((r.rowCount ?? 0) === 0) return { active: false };
    return { active: true, forceLoss: true, forceWin: false };
  }

  if (rig.mode === "pct_loss") {
    const p = Math.min(100, Math.max(0, rig.value)) / 100;
    return Math.random() < p
      ? { active: true, forceLoss: true, forceWin: false }
      : { active: false };
  }

  if (rig.mode === "pct_win") {
    const p = Math.min(100, Math.max(0, rig.value)) / 100;
    return Math.random() < p
      ? { active: true, forceLoss: false, forceWin: true }
      : { active: false };
  }

  return { active: false };
}
