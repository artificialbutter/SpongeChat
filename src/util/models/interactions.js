import { fetch } from "undici";
import { events, instructionSets } from "./constants.js";
import { WorkersAI } from "./index.js";

export class InteractionHistory {
	constructor(
		{ kv, instructionSet, baseHistory, model, contextWindow } = {
			kv: null,
			instructionSet: process.env.MODEL_LLM_PRESET || "default",
			baseHistory: [],
			model: "@cf/meta/llama-3-8b-instruct",
			contextWindow: 10,
		},
	) {
		this.kv = kv;
		this.contextWindow = contextWindow || 10;
		this.instructionSet = instructionSets[instructionSet || "default"];
		this.baseHistory = [
			...(baseHistory || []),
			{
				role: "system",
				content: this.instructionSet,
			},
		];
		this.model = model;
	}

	async get({ key }, all = false) {
		const fetchedMessages = (await this.kv.lRange(key, 0, -1))
			.reverse()
			.map((m) => JSON.parse(m))
			// only return the last [contextWindow] messages
			// if all is true, return all messages
			.slice(0, all ? -1 : this.contextWindow)
			.reduce((acc, item, index) => {
				// this reducer is very.. redundant, but i'm adding it for later
				acc.push(item);
				return acc;
			}, []);

		return [...this.baseHistory, ...fetchedMessages];
	}

	async add(
		{ key, role, content, context, respondingTo, model, timestamp } = {
			model: this.model || "@cf/meta/llama-3-8b-instruct",
		},
		returnOne,
	) {
		let abstractedCtx = {
			...context,
			respondingTo,
			timestamp: timestamp || Temporal.Now.plainDateTimeISO(this?.tz || "Etc/UTC").toString(),
			model: model || "@cf/meta/llama-3-8b-instruct",
		};

		const runOperation = async () => {
			return await this.kv.lPush(key, JSON.stringify({ role, content, context: abstractedCtx }));
		};

		if (returnOne) {
			await runOperation();

			return { role, content, context: abstractedCtx };
		} else {
			const base = await this.get({ key });
			await runOperation();
			return [...base, { role, content, context: abstractedCtx }];
		}
	}

	async formatLog({ key, filter }) {
		const current = (
			await this.kv
				.lRange(key, 0, -1)
				.then((r) => r.map((m) => JSON.parse(m)))
				.catch(() => [])
		).reverse();
		const interactions = current?.filter(typeof filter === "function" ? filter : (f) => f);

		const formatted = interactions
			?.map((entry) => {
				if (entry?.role !== "assistant") return entry.content;
				return `Assistant (${entry?.context?.model}) on ${entry?.context?.timestamp} UTC: ${entry?.content}`;
			})
			?.join("\n\n==========\n\n");

		return {
			length: interactions?.length,
			log: formatted,
		};
	}
}

export class InteractionResponse {
	constructor({ message, tz, accountId, token, model = "@cf/meta/llama-3-8b-instruct" }) {
		this.message = message;
		this.author = message?.author;
		this.tz = tz || "Etc/UTC";
		this.workersAI = new WorkersAI({ accountId, token, model });
	}

	async authorPronouns(id) {
		const request = await fetch(`https://pronoundb.org/api/v2/lookup?platform=discord&ids=${id}`)
			.then((r) => r.json())
			.catch(() => ({}));

		const reqKeys = Object.keys(request);
		const userSets = request?.[id]?.sets;

		if (!reqKeys?.includes(id)) return "they/them";
		if (!userSets?.hasOwnProperty("en")) return "they/them";

		return userSets?.en?.join("/");
	}

	async imageRecognition() {
		if (this?.message?.attachments?.size === 0) return null;
		const image = await fetch(this?.message?.attachments?.first()?.url).then((r) => r.arrayBuffer());

		const callToModel = await this.workersAI
			.callModel({
				model: "@cf/llava-hf/llava-1.5-7b-hf",
				input: {
					image: [...new Uint8Array(image)],
					prompt: "Generate a caption for this image",
				},
				maxTokens: 256,
			})
			.then((r) => "(attached an image: " + String(r?.result?.description)?.toLowerCase() + ")")
			.catch(() => null);

		return callToModel;
	}

	async generateImage({ data }) {
		const callToModel = await this.workersAI
			.callModel(
				{
					model: "@cf/lykon/dreamshaper-8-lcm",
					input: {
						prompt: data,
					},
				},
				true,
			)
			.then((r) => r.arrayBuffer())
			.catch(() => (e) => {
				console.error(e);
				return null;
			});

		if (callToModel === null) return null;

		const buffer = Buffer.from(callToModel);

		return buffer;
	}

	async formatUserMessage() {
		const username = this?.author?.username;
		const pronouns = await this.authorPronouns(this?.author?.id).catch(() => "they/them");
		const date = Temporal.Now.plainDateTimeISO(this?.tz || "Etc/UTC").toString() + " UTC";
		const content = this?.message?.content;
		const reference = this?.message?.reference
			? await this.message
					?.fetchReference()
					.then(async (r) => {
						const refContent = r?.content;
						const refAuthor = r?.author?.username;
						const refPronouns = await this.authorPronouns(r?.author?.id).catch(() => "they/them");
						/**
						 * NOTE: Message#createdAt is a Date. As Date.prototype#toTemporalInstant isn't polyfilled yet, we're using it as a raw date here.
						 * In the future, this should be changed to be converted into a TemporalInstant.
						 */
						const refDate = r?.createdAt.toISOString() + " UTC";
						return `[Reply to]\n> ${refAuthor} (${refPronouns}) on ${refDate}: ${refContent}\n\n`;
					})
					.catch((e) => {
						console.error(e);
						return "";
					})
			: "";

		const image = await this.imageRecognition();

		return `${reference} ${username} (${pronouns}) on ${date}: ${content} ${image !== null ? "\n\nImage description: " + image : ""}`.trim();
	}

	formatAssistantMessage(content) {
		return content.trim();
	}

	/**
	 *
	 * @param {string} content The content of the message
	 * @param {object} event The event object
	 * @returns {string} The formatted message
	 */

	/**
	 * Formats the output message for the given content and event.
	 * @param {string} content The content of the message
	 * @param {object} event The event object
	 * @param {boolean} event.active Whether the event is active or not
	 * @param {string} event.type The type of event
	 * @param {string} event.status The status of the event
	 * @returns {string} The formatted message
	 * @example
	 * const message = await this.formatOutputMessage(content, event);
	 * console.log(message);
	 * // Outputs the formatted message
	 */

	formatOutputMessage(content, allEvents = []) {
		if (!content) return "";
		const bannerArr = allEvents
			.map((event) => {
				const eventData = events[event?.type];
				const bannerTitle = "> **" + (eventData?.title || "Unknown event") + "**\n";
				const bannerStatus = "> " + (eventData?.statuses?.[event?.status] || "An unrecognised event took place.");
				return event?.active ? bannerTitle + bannerStatus : null;
			})
			.filter((e) => e !== null);

		const banner = allEvents.length > 0 ? bannerArr.join("\n\n") : "";

		return banner + "\n" + content?.trim();
	}

	currentTemporalISO() {
		return Temporal.Now.plainDateTimeISO(this?.tz || "Etc/UTC").toString();
	}
}

export class InteractionMessageEvent {
	constructor({ message, interactionResponse, interactionHistory, model }) {
		this.message = message;
		this.client = message?.client;
		this.author = message?.author;
		this.response = interactionResponse;
		this.history = interactionHistory;
		this.model = model;
	}

	checkPreliminaryConditions() {
		const channelSetlist = process.env.ACTIVATION_CHANNEL_SETLIST.split(",");
		const channelSatisfies = channelSetlist?.includes(this.message?.channel?.id);

		// a bot mention supercedes all other cases; if the message mentions the bot, it's valid
		const mentionCase = this.message?.mentions?.has(this.client?.user?.id);
		// these conditions MUST return true for the message to be valid
		const whitelistCase = process.env.ACTIVATION_MODE === "WHITELIST" && channelSatisfies;
		const blacklistCase = process.env.ACTIVATION_MODE === "BLACKLIST" && !channelSatisfies;

		// these conditions MUST return false for the message to be invalid
		const commentCase = this.message?.content?.startsWith("!!");
		const silentModeCase = this.client.tempStore.get("silentMode") === true;

		// if the bot isn't mentioned, then whitelist/blacklist MUST be met, silent mode MUST be off and the message MUST NOT be a comment
		return mentionCase || ((whitelistCase || blacklistCase) && !silentModeCase && !commentCase);
	}

	async validateHistory() {
		const initialHistory = (await this.history.get({ key: this.message?.channel?.id })).filter(
			(e) => e.role === "assistant",
		);

		// condition for last two responses to be empty
		if (initialHistory.length < 2) return { valid: true, handled: { isRequired: false, executed: false } };
		const lastSeqEmpty = initialHistory.slice(-2).every((entry) => {
			return entry.content === "[no response]";
		});

		// condition for last response to be empty
		const lastEmpty = initialHistory[initialHistory.length - 1]?.content === "[no response]";

		// if last two responses are empty, delete the key from the KV
		if (lastSeqEmpty) {
			const operation = await this.client.kv
				.del(this.message?.channel?.id)
				.then(() => true)
				.catch(() => false);

			// if the operation failed, return no validity and special handling failed
			if (operation === false)
				return {
					valid: false,
					handled: {
						isRequired: true,
						executed: false,
					},
				};

			// otherwise, return validity but special handling carried safely
			return {
				valid: false,
				handled: {
					isRequired: true,
					executed: true,
				},
			};
		}

		// if last response was empty but there was a previous response in the last two, it's not valid but special handling is not required
		if (lastEmpty)
			return {
				valid: false,
				handled: {
					isRequired: false,
					executed: false,
				},
			};

		// otherwise, it's valid and no special handling is required
		return {
			valid: true,
			handled: {
				isRequired: false,
				executed: true,
			},
		};
	}

	async handleTextModelCall({ history }) {
		await this.message?.channel?.sendTyping();
		const modelCall = await this.response.workersAI
			.callModel({
				input: {
					messages: history.map((e) => ({
						role: e.role,
						content: e.content,
					})),
				},
				maxTokens: 512,
			})
			.catch(() => ({
				result: { response: "" },
			}));

		const callResponse = modelCall?.result?.response?.trim();
		const textResponse = callResponse?.split("!gen")?.[0];
		const genData = callResponse?.split("!gen")?.[1]?.replace("[", "").replace("]", "");

		await this.history
			.add(
				{
					key: "unified-" + this.message?.channel?.id,
					role: "assistant",
					content: this.response?.formatAssistantMessage(textResponse || "[no response]"),
					respondingTo: this.message?.id,
				},
				true,
			)
			.catch(console.error);

		return {
			textResponse,
			genData,
			callResponse,
		};
	}

	async handleImageModelCall({ genData, textResponse, responseMsg, events }) {
		const final = this.response.formatOutputMessage(
			textResponse,
			events.filter((e) => e.type !== "imagine"),
		);
		if (genData === null || genData?.length <= 1) return await responseMsg.edit({ content: final }).catch(() => null);
		await this.message?.channel?.sendTyping();

		await this.history
			.add(
				{
					key: "unified-" + this.message?.channel?.id,
					role: "assistant",
					content: this.response.formatAssistantMessage(`\n${genData.trim()}`, "imagine"),
					contextId: this.message?.id,
					respondingTo: this.message?.id,
					model: "@cf/lykon/dreamshaper-8-lcm",
				},
				true,
			)
			.catch(console.error);

		const imageGen = await this.response.generateImage({ data: genData }).catch((e) => {
			console.error(e);
			return null;
		});

		if (imageGen === null) return await responseMsg.edit({ content: textResponse }).catch(() => null);

		responseMsg
			.reply({
				files: [
					{
						attachment: imageGen,
						name: "generated0.jpg",
					},
				],
			})
			.catch(() => {});

		return await responseMsg
			.edit({
				content: final?.trim()?.length >= 2000 ? "" : final,
				files: [
					final?.trim()?.length >= 2000
						? {
								attachment: Buffer.from(final, "utf-8"),
								name: "response.md",
							}
						: null,
				].filter((e) => e !== null),
			})
			.catch((e) => {
				console.error(e);
				return e;
			});
	}

	async createResponse(
		{ textResponse, conditions } = {
			conditions: {
				amnesia: false,
				imagine: false,
			},
		},
	) {
		const events = Object.keys(conditions || {})
			.filter((key) => conditions[key] === true)
			.map((e) => {
				return {
					active: true,
					type: e,
					status: "default",
				};
			});

		const text = this.response.formatOutputMessage(textResponse, events);
		const content = textResponse?.length >= 2000 ? "" : text;
		const files = textResponse?.length >= 2000 ? [{ attachment: Buffer.from(text, "utf-8"), name: "response.md" }] : [];

		const responseMsg = await this.message
			?.reply({
				content,
				files,
				failIfNotExists: true,
			})
			.catch(() => this.message.react("❌").catch(() => false));

		return {
			responseMsg,
			events,
		};
	}
}
