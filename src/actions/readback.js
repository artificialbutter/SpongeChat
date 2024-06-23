// Readback: Read the direct context of what was said in the message
import { ContextMenuCommandBuilder, ApplicationCommandType } from "discord.js";
import { ModelInteractions } from "../util/models/index.js";

/** @type {import('./index.js').Action} */
export default {
	data: new ContextMenuCommandBuilder().setName("Direct context window").setType(ApplicationCommandType.Message),
	async execute(interaction) {
		await interaction.deferReply({ ephemeral: true });
		const client = interaction.client;

		const modelInteractions = new ModelInteractions(
			{
				kv: client.kv,
				instructionSet: client.tempStore.get("instructionSet") || process.env.MODEL_LLM_PRESET || "default",
				baseHistory: [],
				accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
				token: process.env.CLOUDFLARE_ACCOUNT_TOKEN,
			},
			["response", "messageEvent"],
		);

		try {
			const { log, length } = await modelInteractions.history
				.formatLog({
					key: "unified-" + interaction?.channel?.id,
					filter: (im) =>
						im?.context?.respondingTo === interaction.targetMessage?.id ||
						im?.context?.respondingTo === interaction?.targetMessage?.reference?.messageId ||
						im?.contextId === interaction.targetMessage?.id ||
						im?.contextId === interaction?.targetMessage?.reference?.messageId,
				})
				.then((returns) => ({
					...returns,
					log: Buffer.from(returns?.log),
				}));

			if (length === 0)
				return await interaction.editReply({
					content: "No context was found for this message. Maybe the history was cleared?",
				});

			return await interaction?.editReply({
				content: "",
				files: [
					{
						attachment: log,
						name: "context.md",
					},
				],
				failIfNotExists: true,
			});
		} catch (e) {
			console.error(e);
			await interaction.editReply({ content: "An error occurred whilst sending the context." });
		}
	},
};
