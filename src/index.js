import process from "node:process";
import { URL } from "node:url";
import { Client, GatewayIntentBits } from "discord.js";
import { cmdRollout } from "./util/deploy/lib.js";
import { loadCallsystems, loadCommands, loadEvents, loadIntegrations } from "./util/loaders.js";
import { registerEvents } from "./util/registerEvents.js";
import chalk from "chalk";

// Instead of relying on Date directly, we're choosing to adopt the new Temporal standard (currently TC39).
// Why Temporal? See -> https://tc39.es/proposal-temporal/docs/
import "temporal-polyfill/global";

(() => {
	console.log(`${chalk.bold.green("Core")} running with environment context: ${chalk.bold(process.env.NODE_ENV)}`);
	console.log(`${chalk.bold.magenta("AI")} running with LLM preset: ${chalk.bold(process.env.MODEL_LLM_PRESET)}`);
})();

// Initialize the client
const client = new Client({
	intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessages],
	allowedMentions: { parse: [], repliedUser: false },
});

// Deploy commands
await cmdRollout();

// Load the events and commands
const events = await loadEvents(new URL("events/", import.meta.url));
const commands = await loadCommands(new URL("commands/", import.meta.url));
const actions = await loadCommands(new URL("actions/", import.meta.url));
const callsystems = await loadCallsystems(new URL("callsystems/", import.meta.url));
const integrations = await loadIntegrations(new URL("integrations/", import.meta.url));

// Register the event handlers
registerEvents(commands, actions, callsystems, integrations, events, client);

// Login to the client
void client.login(process.env.DISCORD_TOKEN);
