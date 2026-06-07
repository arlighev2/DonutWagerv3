import { REST, Routes } from "discord.js";
import { commands } from "./commands/index.js";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error("Missing DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID");
  process.exit(1);
}

const body = commands.map((c) => c.data.toJSON());
const rest = new REST({ version: "10" }).setToken(TOKEN);

console.log(`Registering ${body.length} commands globally…`);

try {
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body });
  console.log("Done — all commands registered globally.");
} catch (err) {
  console.error("Registration failed:", err);
  process.exit(1);
}
