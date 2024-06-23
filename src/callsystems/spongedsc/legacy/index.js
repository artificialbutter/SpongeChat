import { Callsystem } from "../../../lib/callsystems/index.js";

export default class Legacy extends Callsystem {
	constructor(opts) {
		const { env, message, client, defaultModel, defaultProvider } = opts || {};
		super({ env, message, client, defaultModel, defaultProvider });
	}

	static get packageId() {
		return "cs.spongedsc.legacy";
	}

	static get name() {
		return "Legacy";
	}

	static get version() {
		return "2.0.1";
	}

	static get releaseDate() {
		return new Date("2024-05-25");
	}

	static get capabilities() {
		return ["legacy"];
	}

	async activate() {
		const { message, client, env } = this;
		const modelInteractions = this.std.modelInteractions;

		const formattedMessage = await modelInteractions.response.formatUserMessage();
		const validityCheck = await modelInteractions.messageEvent.validateHistory();

		if (!validityCheck.valid) {
			if (validityCheck?.handled?.isRequired && !validityCheck?.handled?.executed)
				return await message.react("⚠️").catch(() => {
					console.log("Failed to delete key from KV after valid history check failed");
					console.error(e);
					return false;
				});
		}

		const history = await modelInteractions.history
			.add({
				key: "unified-" + message?.channel?.id,
				role: "user",
				content:
					formattedMessage +
					(validityCheck?.valid
						? ""
						: "\n\nAlso, you had a system error and your memory was cleared. Explain that to me."),
				respondingTo: message?.id,
			})
			.catch(console.error);

		const { textResponse, genData, callResponse } = await modelInteractions.messageEvent.handleTextModelCall({
			history,
		});

		if (callResponse?.length === 0 || callResponse === "") return await message.react("⚠️").catch(() => false);

		const { responseMsg, events } = await modelInteractions.messageEvent.createResponse({
			textResponse,
			conditions: {
				amnesia: !validityCheck?.valid && validityCheck?.handled?.isRequired && validityCheck?.handled?.executed,
				imagine: callResponse?.includes("!gen"),
			},
		});

		if (responseMsg && callResponse?.includes("!gen"))
			return await modelInteractions.messageEvent.handleImageModelCall({ genData, textResponse, responseMsg, events });
	}
}
