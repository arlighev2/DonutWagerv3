/**
 * Hard-coded Discord channel IDs for cross-server posts. If these need to be
 * configurable later, move them to bot_config and look up via getConfig.
 */
export const VOUCH_CHANNEL_ID = "1498009841451536584";
export const GAMBLE_LOG_CHANNEL_ID = "1498036843428577330";
/** Audit log for sensitive admin/economy actions (coupon creation, admin payouts, balance changes). */
export const ADMIN_LOG_CHANNEL_ID = "1498419875021066240";
/** Public-ish history of all withdrawal payouts. */
export const WITHDRAW_LOG_CHANNEL_ID = "1498440931026927817";

/** Channel-name prefix marking a ticket that has been paid out and is now mod-only to close. */
export const PAID_TICKET_PREFIX = "paid-";
