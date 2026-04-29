import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Message,
  type ModalSubmitInteraction,
  type TextChannel,
} from "discord.js";
import {
  adjustBalance,
  confirmPendingWithdrawalIgn,
  getPendingWithdrawalById,
  markPendingWithdrawalCancelled,
  recordBalanceEvent,
  updatePendingWithdrawalIgn,
} from "./db.js";
import { formatCoins } from "./format.js";

export const WITHDRAW_BTN_PREFIX = "withdraw_pending";
export const WITHDRAW_MODAL_PREFIX = "withdraw_modal";

/** Build the embed + action row shown inside a withdraw ticket. */
export function buildWithdrawEmbed(params: {
  ownerId: string;
  amount: bigint;
  ign: string;
  ignConfirmed: boolean;
  modRoleId?: string | null;
}): { embed: EmbedBuilder; row: ActionRowBuilder<ButtonBuilder> } {
  const { ownerId, amount, ign, ignConfirmed } = params;
  const embed = new EmbedBuilder()
    .setColor(ignConfirmed ? 0x22c55e : 0xfacc15)
    .setTitle("Withdrawal Request")
    .setDescription(
      ignConfirmed
        ? `Please wait for somebody to pay you in-game on **DonutSMP**. Your IGN is **\`${ign}\`** — staff will pay this account exactly.`
        : `Please wait for somebody to pay you. Your IGN is **\`${ign}\`** — is that correct?`,
    )
    .addFields(
      {
        name: "Amount",
        value: `${formatCoins(amount)}`,
        inline: true,
      },
      {
        name: "Status",
        value: ignConfirmed
          ? "✅ IGN confirmed — awaiting staff payout"
          : "⏳ Confirm your IGN below",
        inline: true,
      },
      {
        name: "After staff pay you",
        value:
          "A moderator will run `/admin withdraw` here to log the payout — your `/vouch` command will still work as normal.",
      },
    )
    .setFooter({
      text: "Cancel any time before payout to refund your balance.",
    });

  // The component IDs encode the pending-withdrawal id so the global
  // interaction handler can resolve them without a per-message collector.
  return { embed, row: new ActionRowBuilder<ButtonBuilder>() };
}

export function buildWithdrawComponents(params: {
  pendingId: string;
  ignConfirmed: boolean;
}): ActionRowBuilder<ButtonBuilder>[] {
  const { pendingId, ignConfirmed } = params;
  if (ignConfirmed) {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${WITHDRAW_BTN_PREFIX}:cancel:${pendingId}`)
          .setLabel("Cancel & Refund")
          .setStyle(ButtonStyle.Danger),
      ),
    ];
  }
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${WITHDRAW_BTN_PREFIX}:yes:${pendingId}`)
        .setLabel("Yes, that's my IGN")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${WITHDRAW_BTN_PREFIX}:no:${pendingId}`)
        .setLabel("No, change IGN")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${WITHDRAW_BTN_PREFIX}:cancel:${pendingId}`)
        .setLabel("Cancel & Refund")
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

async function refreshTicketMessage(
  message: Message,
  pendingId: string,
  amount: bigint,
  ign: string,
  ignConfirmed: boolean,
): Promise<void> {
  const { embed } = buildWithdrawEmbed({
    ownerId: message.id,
    amount,
    ign,
    ignConfirmed,
  });
  const components = buildWithdrawComponents({ pendingId, ignConfirmed });
  try {
    await message.edit({ embeds: [embed], components });
  } catch {
    /* ignore */
  }
}

export async function handleWithdrawButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const parts = interaction.customId.split(":");
  // withdraw_pending:<action>:<pendingId>
  const action = parts[1];
  const pendingId = parts[2];
  if (!action || !pendingId) return;

  const pending = await getPendingWithdrawalById(pendingId);
  if (!pending) {
    await interaction.reply({
      content: "This withdrawal is no longer active.",
      ephemeral: true,
    });
    return;
  }
  if (interaction.user.id !== pending.discord_id) {
    await interaction.reply({
      content: "Only the requester can use these buttons.",
      ephemeral: true,
    });
    return;
  }
  if (pending.status !== "pending") {
    await interaction.reply({
      content: `This withdrawal is already **${pending.status}**.`,
      ephemeral: true,
    });
    return;
  }

  const amount = BigInt(pending.amount);

  if (action === "yes") {
    await confirmPendingWithdrawalIgn(pendingId);
    await refreshTicketMessage(
      interaction.message,
      pendingId,
      amount,
      pending.ign,
      true,
    );
    await interaction.reply({
      content: `Got it — staff will pay **\`${pending.ign}\`** in-game.`,
      ephemeral: true,
    });
    return;
  }

  if (action === "no") {
    const modal = new ModalBuilder()
      .setCustomId(`${WITHDRAW_MODAL_PREFIX}:${pendingId}`)
      .setTitle("Type your real Minecraft IGN");
    const input = new TextInputBuilder()
      .setCustomId("ign")
      .setLabel("Minecraft IGN")
      .setPlaceholder("e.g. Notch")
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(32)
      .setStyle(TextInputStyle.Short)
      .setValue(pending.ign);
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(input),
    );
    await interaction.showModal(modal);
    return;
  }

  if (action === "cancel") {
    await markPendingWithdrawalCancelled(pendingId);
    const newBalance = await adjustBalance(pending.discord_id, amount);
    await recordBalanceEvent({
      discordId: pending.discord_id,
      delta: amount,
      source: "withdraw",
      detail: `Refund — withdrawal cancelled in <#${pending.channel_id}>`,
    });

    const cancelEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("Withdrawal Cancelled")
      .setDescription(
        `Your withdrawal was cancelled. **${formatCoins(amount)}** has been refunded.`,
      )
      .addFields({
        name: "New Balance",
        value: formatCoins(newBalance),
      })
      .setFooter({ text: "This channel will close in 10 seconds." });

    try {
      await interaction.update({ embeds: [cancelEmbed], components: [] });
    } catch {
      /* ignore */
    }

    const ch = interaction.channel;
    if (ch && ch.type === ChannelType.GuildText) {
      const channel = ch as TextChannel;
      setTimeout(() => {
        channel.delete("Withdrawal cancelled — auto-close").catch(() => {});
      }, 10_000);
    }
    return;
  }
}

export async function handleWithdrawModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  // withdraw_modal:<pendingId>
  const pendingId = interaction.customId.split(":")[1];
  if (!pendingId) return;

  const pending = await getPendingWithdrawalById(pendingId);
  if (!pending) {
    await interaction.reply({
      content: "This withdrawal is no longer active.",
      ephemeral: true,
    });
    return;
  }
  if (interaction.user.id !== pending.discord_id) {
    await interaction.reply({
      content: "Only the requester can update this withdrawal.",
      ephemeral: true,
    });
    return;
  }
  if (pending.status !== "pending") {
    await interaction.reply({
      content: `This withdrawal is already **${pending.status}**.`,
      ephemeral: true,
    });
    return;
  }

  const newIgn = interaction.fields.getTextInputValue("ign").trim();
  if (!/^[A-Za-z0-9_]{1,32}$/.test(newIgn)) {
    await interaction.reply({
      content: "Invalid IGN — Minecraft names are letters/numbers/underscore.",
      ephemeral: true,
    });
    return;
  }

  await updatePendingWithdrawalIgn(pendingId, newIgn);

  const ch = interaction.channel;
  if (ch && ch.type === ChannelType.GuildText) {
    try {
      const msg = await ch.messages.fetch(pending.channel_id).catch(() => null);
      // The pending row stores the *channel* id, not the message id, so we
      // can't fetch the original embed by ID — instead we re-send a fresh
      // confirmation prompt and let the previous one stay as history.
      void msg;
      const { embed } = buildWithdrawEmbed({
        ownerId: pending.discord_id,
        amount: BigInt(pending.amount),
        ign: newIgn,
        ignConfirmed: false,
      });
      const components = buildWithdrawComponents({
        pendingId,
        ignConfirmed: false,
      });
      await (ch as TextChannel).send({
        content: `<@${pending.discord_id}> updated their IGN to \`${newIgn}\`. Confirm again?`,
        embeds: [embed],
        components,
      });
    } catch {
      /* ignore */
    }
  }

  await interaction.reply({
    content: `IGN updated to \`${newIgn}\` — confirm it on the new prompt above.`,
    ephemeral: true,
  });
}
