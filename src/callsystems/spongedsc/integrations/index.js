import Legacy from "../../spongedsc/legacy/index.js";
import { Caller as IntegrationCaller } from "./models/openai.js";
import { Caller as TextModel } from "./models/openai.js";
import { Callsystem } from "../../../lib/callsystems/index.js";
import { Temporal } from "temporal-polyfill";
import { HistoryManager } from "../../../lib/callsystems/std/managers/history.js";
import { personas } from "../../../util/models/constants.js";
import { ActionRowBuilder, ButtonBuilder } from "@discordjs/builders";
import { ButtonStyle } from "discord.js";

export default class Integrations extends Callsystem {
	constructor(opts) {
		const { env, message, client, defaultModel, defaultProvider } = opts || {};
		super({ env, message, client, defaultModel, defaultProvider });
	}

	static get packageId() {
		return "cs.spongedsc.integrations";
	}

	static get name() {
		return "Integrations";
	}

	static get version() {
		return "0.0.1";
	}

	static get releaseDate() {
		return new Date("2024-06-02");
	}

	static get capabilities() {
		return ["text", "vision", "image", "tools"];
	}

	static get managerOptions() {
		return {
			contextWindow: 5,
			instructionSet: "default",
			recordTemplate: "%USER% (%PRONOUNS%) at %TIMESTAMP%: %RESPONSE%",
			variables: {},
		};
	}

	async activate() {
		const { message, client, env } = this;
		const hisMan = new HistoryManager({
			kv: this.std.kv,
			instructionSet: client?.tempStore.get("instructionSet") || env?.MODEL_LLM_PRESET || "default",
			baseHistory: [],
			model: "@openai/gpt-4/o",
			contextWindow: 5,
			recordTemplate:
				this.constructor.managerOptions.recordTemplate || "%USER% (%PRONOUNS%) at %TIMESTAMP%: %RESPONSE%",
			variables: {
				...(this.constructor.managerOptions.variables || {}),
				"%PRONOUNS%": "they",
				"%USER%": message.author.username,
				"%TIMESTAMP%": Temporal.Now.plainDateTimeISO(this?.tz || "Etc/UTC").toString(),
			},
			keyPrefix: "unified",
		});

		const integrations = Array.from(client.integrationsMap.keys())
			.filter((i) => {
				return i.startsWith("in.") && i.endsWith("-latest");
			})
			.map((i) => client.integrationsMap.get(i));

		const integrationCallHistory = [
			...personas.integrationCaller.messages,
			...(await hisMan.get(message.channel.id, false)),
			{
				contextId: message.id,
				role: "user",
				content: message.content,
			},
		];

		await message.channel.sendTyping();

		const integrationCaller = new IntegrationCaller({ key: env.OPENAI_ACCOUNT_TOKEN });
		const { text: placeholderText, toolCalls: integrationsRequested } = await integrationCaller
			.call({
				model: "gpt-4o",
				messages: integrationCallHistory,
				tools: integrations.map((i) => i.tool),
			})
			.catch(async (e) => {
				this.std.log({ level: "error", message: "Error calling integrations" });
				console.error(e);
				await message.react("⚠️").catch(() => {});
				return [];
			});

		const integrationsResponses = await Promise.all(
			integrationsRequested.map(async (i) => {
				const integrationClass = integrations.find((int) => int.tool?.function?.name === i.toolName);
				const integration = new integrationClass({ env, message, client, std: this.std, provider: this.provider });
				return await integration
					.activate({
						arguments: i.args,
					})
					.then((r) => ({
						...r,
						messages: r.messages.map((m) => ({
							type: "tool-result",
							toolCallId: i.toolCallId,
							toolName: i.toolName,
							result: m.content,
							isError: false,
						})),
						integration: i.toolName,
					}))
					.catch((e) => {
						this.std.log({ level: "error", message: "Error activating integration" });
						console.error(e);
						return {
							success: false,
							messages: [
								{
									role: "tool",
									content: [
										{
											type: "tool-result",
											toolCallId: i.toolCallId,
											toolName: i.toolName,
											result: `Error activating integration: Catastrophic failure`,
											isError: true,
										},
									],
								},
							],
							data: {
								message: "Catastrophic failure to activate integration",
							},
						};
					});
			}),
		);

		if (integrationsResponses.length === 0) {
			const callsystemInstance = new Legacy({ env, message, client });
			return await callsystemInstance.activate();
		}

		const componentsList = new ActionRowBuilder().addComponents(
			new ButtonBuilder()
				.setCustomId("using")
				.setLabel(
					`Using "${integrationsRequested?.[0]?.toolName?.charAt(0).toUpperCase() + integrationsRequested?.[0]?.toolName?.slice(1)}"`,
				)
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(true),
			...[
				integrationsRequested?.length > 1
					? new ButtonBuilder()
							.setCustomId("plusMore")
							.setLabel(`(and ${integrationsRequested.length - 1} others)`)
							.setStyle(ButtonStyle.Secondary)
							.setDisabled(true)
					: null,
			].filter((r) => r !== null),
		);

		if (integrationsRequested.length > 3) {
			componentsList.addComponents(
				new ButtonBuilder()
					.setCustomId("plusMore")
					.setLabel(`+ ${integrationsRequested.length - 3} more`)
					.setStyle(ButtonStyle.Primary)
					.setDisabled(true),
			);
		}

		const trimmedText =
			placeholderText.length === 0 ? "Hold on, give me a minute to get the data that you need." : placeholderText;
		const response = await message
			.reply({
				...this.std.responseTransform({ content: trimmedText }),
				components: [componentsList],
			})
			.catch((e) => {
				this.std.log({ level: "error", message: "Error sending response" });
				console.error(e);
				return null;
			});

		if (!response) return;

		const history = await hisMan
			.add(message.channel.id, {
				contextId: message?.id,
				role: "user",
				content: message.content,
			})
			.catch((e) => {
				this.std.log({ level: "error", message: e });
				console.error(e);
				return [];
			});

		const formattedResponses = integrationsResponses.map((i) => ({
			role: "tool",
			content: i.messages,
		}));

		const toSend = [
			...history.map((m) => ({ role: m.role, content: m.content })),
			{
				role: "assistant",
				content: [
					{
						type: "text",
						text: placeholderText,
					},
					...integrationsRequested,
				],
			},
			...formattedResponses,
		];

		const textModel = new TextModel({ key: env.OPENAI_ACCOUNT_TOKEN });
		const textResponse = await textModel
			.call({
				model: "gpt-4o",
				messages: toSend,
			})
			.catch((e) => {
				this.std.log({ level: "error", message: "Error calling text model" });
				console.error(e);
				return "";
			})
			.then((r) => r.text);

		await response.edit({
			...this.std.responseTransform({ content: textResponse }),
			components: [componentsList],
		});

		await hisMan.addMany(
			message.channel.id,
			[
				{
					contextId: message?.id,
					role: "system",
					content: `(Called integrations: ${integrationsResponses.map((i) => i.integration).join(", ")})`,
				},
				{
					contextId: message?.id,
					role: "assistant",
					content: textResponse,
					context: {
						model: "@openai/gpt-4/o",
					},
				},
			],
			false,
			true,
			{ template: "%RESPONSE%" },
		);

		return {
			success: true,
			summary: "Integrations activated",
			context: {},
		};
	}
}
