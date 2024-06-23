import { ModelInteractions } from "../util/models/index.js";
import { ButtonBuilder, ButtonStyle, ActionRowBuilder } from "discord.js";
import { Logview } from "../lib/web/logview.js";
import { Logger } from "../lib/logger.js";

/** @type {import('./index.js').Command} */
export default {
	data: {
		name: "forget",
		description: "Forget the conversation history in the current channel.",
	},
	async execute(interaction) {
		await interaction.deferReply();
		const client = interaction.client;

		const modelInteractions = new ModelInteractions({
			kv: client.kv,
			instructionSet: client.tempStore.get("instructionSet") || process.env.MODEL_LLM_PRESET || "default",
			baseHistory: [],
			model: "@cf/meta/llama-3-8b-instruct",
		});

		const logview = new Logview({ host: process.env.WEB_HOST, key: process.env.WEB_KEY });

		const { log, length } = await modelInteractions.history
			.formatLog({
				key: "unified-" + interaction?.channel?.id,
			})
			.then((returns) => ({
				...returns,
				log: Buffer.from(returns?.log),
			}));

		const cardinalRules = new Intl.PluralRules("en-GB");

		const noun = cardinalRules.select(length) === "one" ? "memory" : "memories";

		const operation = await client.kv
			.del("unified-" + interaction?.channel.id)
			.then(() => true)
			.catch(() => false);

		if (!operation) return await interaction.editReply({ content: `✖️ Failed to clear ${length || 0} ${noun}.` });

		const toSay = `✔️ Cleared ${length || 0} ${noun}.`;

		if (length === 0) return await interaction.editReply({ content: toSay });

		try {
			const request = await logview.create(log.toString("utf-8"));
			const button = new ButtonBuilder()
				.setLabel("View cleared memories")
				.setURL(request !== false ? request.url : "https://blahaj.ca/")
				.setStyle(ButtonStyle.Link);

			await interaction?.editReply({
				content: `${toSay}`,
				failIfNotExists: true,
				components: request !== false ? [new ActionRowBuilder().addComponents(button)] : [],
			});

			return;
		} catch (e) {
			new Logger({ callsystem: "web logview" }).error("Error uploading logs to memory viewer: " + e, {
				module: "web logview",
			});
			console.error(e);
			return interaction.editReply({
				content: toSay,
				files: [
					{
						attachment: log,
						name: "context.md",
					},
				],
			});
		}
	},
};
