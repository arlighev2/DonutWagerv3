import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "../lib/types.js";
import {
  COINS_PER_INVITE,
  getInviteStats,
  getNextClaimMin,
} from "../lib/invite_flow.js";
import { formatCoins } from "../lib/format.js";

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("invites")
    .setDescription("View your invite stats and claim your coin rewards"),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const stats = await getInviteStats(interaction.user.id);
    const nextMin = getNextClaimMin(stats.claimCount);
    const canClaim = stats.validUnclaimed >= nextMin;
    const coinsNow = COINS_PER_INVITE * BigInt(stats.validUnclaimed);
    const needMore = nextMin - stats.validUnclaimed;

    const statusLine = canClaim
      ? "✅ Ready to claim!"
      : `❌ Need ${needMore} more valid invite${needMore !== 1 ? "s" : ""}`;

    const embed = new EmbedBuilder()
      .setColor(canClaim ? 0x22c55e : 0xfacc15)
      .setTitle("🎟️ Your Invite Stats")
      .addFields(
        { name: "📨 Total Invited", value: `${stats.totalInvited}`, inline: true },
        { name: "✅ Valid Unclaimed", value: `${stats.validUnclaimed}`, inline: true },
        { name: "❌ Left Server", value: `${stats.leftServer}`, inline: true },
        {
          name: "⏳ Not Verified",
          value: `${stats.notVerified}`,
          inline: true,
        },
        {
          name: "🏆 Total Claimed",
          value: `${stats.totalClaimed} invite${stats.totalClaimed !== 1 ? "s" : ""}`,
          inline: true,
        },
        {
          name: "🎯 Next Claim Needs",
          value: `${nextMin} valid unclaimed`,
          inline: true,
        },
        { name: "⏳ Status", value: statusLine, inline: false },
        {
          name: "💰 Claimable Now",
          value: canClaim
            ? `${formatCoins(coinsNow)} (${stats.validUnclaimed} invites)`
            : `— (reach ${nextMin} valid invites to unlock)`,
          inline: false,
        },
      )
      .setFooter({ text: "Not Verified = joined but hasn't verified in-game yet • Earn 10m per valid invite" });

    if (canClaim) {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("invite:claim")
          .setLabel("Ready to Claim!")
          .setStyle(ButtonStyle.Success),
      );
      await interaction.editReply({ embeds: [embed], components: [row] });
    } else {
      await interaction.editReply({ embeds: [embed] });
    }
  },
};

export default command;
