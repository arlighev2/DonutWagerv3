import type { SlashCommand } from "../lib/types.js";
import balance from "./balance.js";
import daily from "./daily.js";
import pay from "./pay.js";
import close from "./close.js";
import admin from "./admin.js";
import reset from "./reset.js";
import coupon from "./coupon.js";
import redeem from "./redeem.js";
import help from "./help.js";
import history from "./history.js";
import coinflip from "./coinflip.js";
import dice from "./dice.js";
import roulette from "./roulette.js";
import blackjack from "./blackjack.js";
import mines from "./mines.js";
import towers from "./towers.js";
import provablyfair from "./provablyfair.js";
import resethash from "./resethash.js";

export const commands: SlashCommand[] = [
  balance,
  daily,
  pay,
  close,
  admin,
  reset,
  coupon,
  redeem,
  help,
  history,
  coinflip,
  dice,
  roulette,
  blackjack,
  mines,
  towers,
  provablyfair,
  resethash,
];

export const commandMap: Map<string, SlashCommand> = new Map(
  commands.map((c) => [c.data.name, c]),
);
