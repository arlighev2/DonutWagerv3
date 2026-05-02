import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ButtonInteraction,
  type Client,
  type GuildMember,
  type PartialGuildMember,
} from "discord.js";
import { pool, getOrCreateUser } from "./db.js";
import { formatCoins } from "./format.js";
import { createTicketChannel } from "./tickets.js";
import { isMod } from "./permissions.js";

export const MEMBER_ROLE_ID = "1498005198990344322";
export const COINS_PER_INVITE = 10_000_000n;
const CLAIM_TIERS = [3, 5, 10, 20, 25];

export function getNextClaimMin(claimCount: number): number {
  return CLAIM_TIERS[Math.min(claimCount, CLAIM_TIERS.length - 1)] ?? 25;
}

// guildId -> inviteCode -> uses
const inviteCache = new Map<string, Map<string, number>>();

export async function initInviteCache(client: Client<true>): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    try {
      const invites = await guild.invites.fetch();
      const map = new Map<string, number>();
      for (const inv of invites.values()) map.set(inv.code, inv.uses ?? 0);
      inviteCache.set(guild.id, map);
    } catch {
      // bot may lack MANAGE_GUILD
    }
  }
}

export async function handleMemberAdd(member: GuildMember): Promise<void> {
  if (member.user.bot) return;

  let usedCode: string | null = null;
  let inviterId: string | null = null;

  try {
    const current = await member.guild.invites.fetch();
    const cached = inviteCache.get(member.guild.id) ?? new Map<string, number>();

    for (const inv of current.values()) {
      const prev = cached.get(inv.code) ?? 0;
      if ((inv.uses ?? 0) > prev) {
        usedCode = inv.code;
        inviterId = inv.inviter?.id ?? null;
        break;
      }
    }

    // Refresh cache
    const newMap = new Map<string, number>();
    for (const inv of current.values()) newMap.set(inv.code, inv.uses ?? 0);
    inviteCache.set(member.guild.id, newMap);
  } catch {
    return;
  }

  if (!inviterId || inviterId === member.id) return;

  const hasMemberRole = member.roles.cache.has(MEMBER_ROLE_ID);

  await pool.query(
    `INSERT INTO bot_invite_members
       (invitee_discord_id, inviter_discord_id, invite_code, has_member_role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (invitee_discord_id) DO UPDATE
       SET inviter_discord_id = EXCLUDED.inviter_discord_id,
           invite_code        = EXCLUDED.invite_code,
           left_at            = NULL,
           has_member_role    = EXCLUDED.has_member_role`,
    [member.id, inviterId, usedCode, hasMemberRole],
  );
}

export async function handleMemberRemove(
  member: GuildMember | PartialGuildMember,
): Promise<void> {
  if (member.user?.bot) return;
  await pool.query(
    `UPDATE bot_invite_members
       SET left_at = NOW()
     WHERE invitee_discord_id = $1 AND left_at IS NULL`,
    [member.id],
  );
  try {
    const invites = await member.guild.invites.fetch();
    const newMap = new Map<string, number>();
    for (const inv of invites.values()) newMap.set(inv.code, inv.uses ?? 0);
    inviteCache.set(member.guild.id, newMap);
  } catch {
    /* ignore */
  }
}

export async function handleMemberUpdate(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember,
): Promise<void> {
  if (newMember.user.bot) return;
  const hadRole = oldMember.roles?.cache?.has(MEMBER_ROLE_ID) ?? false;
  const hasRole = newMember.roles.cache.has(MEMBER_ROLE_ID);
  if (hadRole === hasRole) return;
  await pool.query(
    `UPDATE bot_invite_members SET has_member_role = $2 WHERE invitee_discord_id = $1`,
    [newMember.id, hasRole],
  );
}

export interface InviteStats {
  totalInvited: number;
  validUnclaimed: number;
  notVerified: number;
  leftServer: number;
  totalClaimed: number;
  claimCount: number;
}

export async function getInviteStats(discordId: string): Promise<InviteStats> {
  const [totRes, leftRes, validRes, notVerRes, claimedRes, countRes] = await Promise.all([
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM bot_invite_members WHERE inviter_discord_id = $1`,
      [discordId],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM bot_invite_members
         WHERE inviter_discord_id = $1 AND left_at IS NOT NULL`,
      [discordId],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM bot_invite_members
         WHERE inviter_discord_id = $1
           AND has_member_role = TRUE AND left_at IS NULL AND claimed = FALSE`,
      [discordId],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM bot_invite_members
         WHERE inviter_discord_id = $1
           AND has_member_role = FALSE AND left_at IS NULL`,
      [discordId],
    ),
    pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(invites_used), 0) AS total FROM bot_invite_claims WHERE discord_id = $1`,
      [discordId],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM bot_invite_claims WHERE discord_id = $1`,
      [discordId],
    ),
  ]);
  return {
    totalInvited: parseInt(totRes.rows[0]?.count ?? "0"),
    leftServer: parseInt(leftRes.rows[0]?.count ?? "0"),
    validUnclaimed: parseInt(validRes.rows[0]?.count ?? "0"),
    notVerified: parseInt(notVerRes.rows[0]?.count ?? "0"),
    totalClaimed: parseInt(claimedRes.rows[0]?.total ?? "0"),
    claimCount: parseInt(countRes.rows[0]?.count ?? "0"),
  };
}

export interface InviteMemberRow {
  invitee_discord_id: string;
  invite_code: string | null;
  joined_at: Date;
  left_at: Date | null;
  has_member_role: boolean;
  claimed: boolean;
}

export async function getInviteList(discordId: string): Promise<InviteMemberRow[]> {
  const r = await pool.query<InviteMemberRow>(
    `SELECT invitee_discord_id, invite_code, joined_at, left_at, has_member_role, claimed
       FROM bot_invite_members
       WHERE inviter_discord_id = $1
       ORDER BY joined_at DESC`,
    [discordId],
  );
  return r.rows;
}

export async function processInviteClaim(discordId: string): Promise<
  | { ok: true; invitesUsed: number; coinsAwarded: bigint; claimNumber: number }
  | { ok: false; reason: string }
> {
  const conn = await pool.connect();
  try {
    await conn.query("BEGIN");

    const ccRes = await conn.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM bot_invite_claims WHERE discord_id = $1`,
      [discordId],
    );
    const claimCount = parseInt(ccRes.rows[0]?.count ?? "0");
    const nextMin = getNextClaimMin(claimCount);

    const validRes = await conn.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM (
         SELECT invitee_discord_id FROM bot_invite_members
           WHERE inviter_discord_id = $1
             AND has_member_role = TRUE AND left_at IS NULL AND claimed = FALSE
           FOR UPDATE
       ) sub`,
      [discordId],
    );
    const validCount = parseInt(validRes.rows[0]?.count ?? "0");

    if (validCount < nextMin) {
      await conn.query("ROLLBACK");
      return {
        ok: false,
        reason: `Need **${nextMin}** valid unclaimed invites — you have **${validCount}**.`,
      };
    }

    await conn.query(
      `UPDATE bot_invite_members SET claimed = TRUE
         WHERE inviter_discord_id = $1
           AND has_member_role = TRUE AND left_at IS NULL AND claimed = FALSE`,
      [discordId],
    );

    const coinsAwarded = COINS_PER_INVITE * BigInt(validCount);
    const claimNumber = claimCount + 1;

    await conn.query(
      `INSERT INTO bot_invite_claims (discord_id, claim_number, invites_used, coins_awarded)
         VALUES ($1, $2, $3, $4)`,
      [discordId, claimNumber, validCount, coinsAwarded.toString()],
    );
    await conn.query(
      `INSERT INTO bot_users (discord_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [discordId],
    );
    await conn.query(
      `UPDATE bot_users SET balance = balance + $2 WHERE discord_id = $1`,
      [discordId, coinsAwarded.toString()],
    );
    await conn.query(
      `INSERT INTO bot_balance_ledger (discord_id, delta, source, detail)
         VALUES ($1, $2, 'invite', $3)`,
      [discordId, coinsAwarded.toString(), `Claim #${claimNumber} — ${validCount} invites`],
    );

    await conn.query("COMMIT");
    return { ok: true, invitesUsed: validCount, coinsAwarded, claimNumber };
  } catch (err) {
    await conn.query("ROLLBACK").catch(() => {});
    console.error("[invites] claim failed:", err);
    return { ok: false, reason: "An error occurred. Please try again." };
  } finally {
    conn.release();
  }
}

export async function handleInviteButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const parts = interaction.customId.split(":");
  const action = parts[1];
  const targetId = parts[2];

  // ── Claim ─────────────────────────────────────────────────────────────────
  if (action === "claim") {
    if (!interaction.guild) {
      await interaction.reply({ content: "Use this in a server.", ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });

    const claimUser = await getOrCreateUser(interaction.user.id);
    if (!claimUser.verified || !claimUser.minecraft_username) {
      await interaction.editReply({
        content:
          "You must verify your Minecraft account in <#1497805898977120369> before claiming invite rewards.\n" +
          "Open the panel, tap **Settings**, and link your IGN first.",
      });
      return;
    }

    const stats = await getInviteStats(interaction.user.id);
    const nextMin = getNextClaimMin(stats.claimCount);
    if (stats.validUnclaimed < nextMin) {
      await interaction.editReply({
        content: `You need at least **${nextMin}** valid unclaimed invites. You have **${stats.validUnclaimed}**.`,
      });
      return;
    }

    const coinsToAward = COINS_PER_INVITE * BigInt(stats.validUnclaimed);
    const ticket = await createTicketChannel({
      guild: interaction.guild,
      ownerId: interaction.user.id,
      ownerUsername: interaction.user.username,
      kind: "invite",
      topic: `Invite claim — ${stats.validUnclaimed} invites`,
      allowAttachments: false,
    });
    if (!ticket) {
      await interaction.editReply({
        content: "Couldn't create the claim ticket. Contact a moderator.",
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0xfacc15)
      .setTitle("🎟️ Invite Claim Request")
      .setDescription(`<@${interaction.user.id}> is requesting their invite reward.`)
      .addFields(
        { name: "Valid Invites", value: `${stats.validUnclaimed}`, inline: true },
        { name: "Coins to Award", value: formatCoins(coinsToAward), inline: true },
        { name: "Claim #", value: `${stats.claimCount + 1}`, inline: true },
      )
      .setFooter({ text: "Verify the invites are legitimate before approving." });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`invite:approve:${interaction.user.id}`)
        .setLabel("Approve & Pay")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`invite:deny:${interaction.user.id}`)
        .setLabel("Deny")
        .setStyle(ButtonStyle.Danger),
    );

    const mention = ticket.modRoleId
      ? `<@${interaction.user.id}> · <@&${ticket.modRoleId}>`
      : `<@${interaction.user.id}>`;
    await ticket.channel.send({ content: mention, embeds: [embed], components: [row] });
    await interaction.editReply({
      content: `Claim ticket opened: <#${ticket.channel.id}>`,
    });
    return;
  }

  // ── Approve ───────────────────────────────────────────────────────────────
  if (action === "approve" && targetId) {
    if (!(await isMod(interaction))) {
      await interaction.reply({ content: "Only staff can approve claims.", ephemeral: true });
      return;
    }
    await interaction.deferUpdate();
    const result = await processInviteClaim(targetId);
    if (!result.ok) {
      await interaction.followUp({ content: `Could not process: ${result.reason}`, ephemeral: true });
      return;
    }
    const oldEmbed = interaction.message.embeds[0];
    await interaction.editReply({
      embeds: oldEmbed
        ? [
            EmbedBuilder.from(oldEmbed)
              .setColor(0x22c55e)
              .setTitle("✅ Invite Claim Approved")
              .setFooter({ text: `Approved by ${interaction.user.tag}` }),
          ]
        : [],
      components: [],
    });
    if (interaction.channel && "send" in interaction.channel) {
      await interaction.channel.send(
        `<@${targetId}> **${formatCoins(result.coinsAwarded)}** (${result.invitesUsed} invites × 10m) has been added to your balance! 🎉`,
      );
    }
    return;
  }

  // ── Deny ──────────────────────────────────────────────────────────────────
  if (action === "deny" && targetId) {
    if (!(await isMod(interaction))) {
      await interaction.reply({ content: "Only staff can deny claims.", ephemeral: true });
      return;
    }
    const oldEmbed = interaction.message.embeds[0];
    await interaction.update({
      embeds: oldEmbed
        ? [
            EmbedBuilder.from(oldEmbed)
              .setColor(0xef4444)
              .setTitle("❌ Invite Claim Denied")
              .setFooter({ text: `Denied by ${interaction.user.tag}` }),
          ]
        : [],
      components: [],
    });
    if (interaction.channel && "send" in interaction.channel) {
      await interaction.channel.send(
        `<@${targetId}> your invite claim was denied. Contact a moderator for help.`,
      );
    }
    return;
  }
}
