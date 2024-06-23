import { ModelInteractions, WorkersAI } from "../../util/models/index.js";
import { Logger } from "../logger.js";
import { Logview } from "../web/logview.js";
import { HistoryManager } from "./std/managers/history.js";
import { CallsystemUnitTestSuite } from "./std/managers/cuts.js";

/**
 * @typedef {string} CallsystemCapabilities
 * @readonly
 */

/**
 * @enum {CallsystemCapabilities}
 */
export const VALID_CAPABILITIES = ["text", "vision", "image", "ears", "audio", "tools", "legacy"];

/**
 * @typedef {object} CallsystemActivationResponse The response to a callsystem activation request
 * @property {boolean} success Whether the activation was successful
 * @property {string | null} summary A brief summary of any information that needs to be known about the activation
 * @property {object | null} context A context object that can be used to store any additional data (i.e. message/user ID)
 */

/**
 * The Callsystem standard library provides a set of standardised helper functions and accessors for the callsystem to interact with elements outside of the callsystem's scope/domain.
 *
 * CallsystemStd does not have to be used. However, unless if you have an absolute need to build on top of a separate layer, we recommend using CallsystemStd.
 * If you aren't building on top of CallsystemStd, we highly recommend returning responses and building systems that are compatible with it.
 */
export class CallsystemStd {
	constructor({ env, callsystemName, packageId, kv, instructionSet, modelInteractionsOptions, managerOptions }) {
		this.callsystem = callsystemName;
		this.packageId = packageId;
		this._services = {
			Logview: new Logview({ host: env?.WEB_HOIST, key: env?.WEB_KEY }),
			kv,
			ModelInteractions: new ModelInteractions(modelInteractionsOptions),
		};
		this._managers = {
			history: new HistoryManager({ ...modelInteractionsOptions, ...managerOptions }),
			cuts: new CallsystemUnitTestSuite({
				packageId: packageId,
				name: callsystemName,
				loggerOptions: {
					callsystem: callsystemName,
				},
			}),
		};
	}

	get services() {
		return this._services;
	}

	get managers() {
		return this._managers;
	}

	get kv() {
		return this.services.kv;
	}

	get logview() {
		return this.services.Logview;
	}

	get modelInteractions() {
		return this.services.ModelInteractions;
	}

	get history() {
		return this.managers.history;
	}

	get cuts() {
		return this.managers.cuts;
	}

	static conditions(message, env) {
		const client = message?.client;

		const channelSetlist = env.ACTIVATION_CHANNEL_SETLIST.split(",");
		const channelSatisfies = channelSetlist?.includes(message?.channel?.id);

		// a bot mention supercedes all other cases; if the message mentions the bot, it's valid
		const mentionCase = message?.mentions?.has(client?.user?.id);
		// these conditions MUST return true for the message to be valid
		const whitelistCase = process.env.ACTIVATION_MODE === "WHITELIST" && channelSatisfies;
		const blacklistCase = process.env.ACTIVATION_MODE === "BLACKLIST" && !channelSatisfies;

		// these conditions MUST return false for the message to be invalid
		const commentCase = message?.content?.startsWith("!!");
		const silentModeCase = client.tempStore.get("silentMode") === true;

		// if there isn't a comment, then the bot MUST not be mentioned, the whitelist/blacklist MUST be met, and silent mode MUST be off
		return !commentCase && (mentionCase || ((whitelistCase || blacklistCase) && !silentModeCase));
	}

	responseTransform({ content = "", files = [] }) {
		if (!content)
			return {
				content: "",
				files: [],
			};

		const returnContent = content?.length >= 2000 ? "" : content;
		const returnFiles =
			content?.length >= 2000
				? [{ attachment: Buffer.from(text, "utf-8"), name: "response.md" }, ...files]
				: [...files];

		return {
			content: returnContent,
			files: returnFiles,
		};
	}

	log({ message, level = "default", ...options }) {
		const logger = new Logger({
			callsystem: this.callsystem || "Legacy",
		});
		return logger.log(message, { level, module: "callsystem", ...options });
	}
}

export class Callsystem {
	constructor({ env, message, client, defaultModel, defaultProvider }) {
		this.env = env;
		this.client = client;
		this.message = message;
		this.defaultModel = defaultModel;
		this.defaultProvider = defaultProvider;

		this.provider = new WorkersAI({
			accountId: this.env?.CLOUDFLARE_ACCOUNT_ID,
			token: this.env?.CLOUDFLARE_ACCOUNT_TOKEN,
			defaultModel: this.defaultModel,
		});

		/**
		 * @type {CallsystemStd}
		 */
		this.std = new CallsystemStd({
			callsystemName: this.constructor.name,
			packageId: this.constructor.packageId,
			kv: client?.kv,
			env,
			instructionSet: client?.tempStore.get("instructionSet") || env?.MODEL_LLM_PRESET || "default",
			modelInteractionsOptions: {
				message,
				kv: client?.kv,
				instructionSet: client?.tempStore.get("instructionSet") || env?.MODEL_LLM_PRESET || "default",
				baseHistory: [],
				accountId: env?.CLOUDFLARE_ACCOUNT_ID,
				token: env?.CLOUDFLARE_ACCOUNT_TOKEN,
				model: "@cf/meta/llama-3-8b-instruct",
			},
			managerOptions: {
				...(this.constructor.managerOptions || {}),
				kv: client?.kv,
			},
		});
	}

	/**
	 * This should return the package ID of the callsystem. Callsystem package IDs are used to identify the callsystem internally.
	 *
	 * This package ID should be in a namespaced format. All callsystems have a root namespace of "cs".
	 * @returns {string} The package ID of the callsystem.
	 * @example
	 * class Legacy extends Callsystem {
	 *     static get packageId() {
	 *         return "cs.spongedsc.legacy";
	 *     }
	 * }
	 *
	 * Legacy.packageId; // => "cs.spongedsc.legacy"
	 */
	static get packageId() {
		return "cs.spongedsc.legacy";
	}

	/**
     * This should return the callsystem's name.
     * @returns {string} A string that represents the callsystem's name.
     * @example 
    class Legacy extends Callsystem {
        get name() {
            return "Legacy";
        }
    };
    
    new Legacy.name; // => "Legacy"
    */
	static get name() {
		return "Base Callsystem";
	}

	/**
	 * This should return a version string for the callsystem. Core uses this for debugging and versioning purposes.
	 * 
     * We recommend that you use semantic versioning (https://semver.org/), but Core will not enforce this.
	 * @returns {string} A version string for the callsystem.
     * @example 
    class Legacy extends Callsystem {
       static get version() {
           return "2.0.1";
       }
    };
       
    new Legacy.version; // => "2.0.1"
	*/
	static get version() {
		return "0.0.1";
	}

	/**
     * This should return a Date object corresponding to the release date of this release.
     * This is used for sorting purposes. Otherwise, Core will use the current date.
     * @returns {Date} A Date object corresponding to the release date of this release.
     * @example 
    class Legacy extends Callsystem {
       static get releaseDate() {
           return new Date("2024-05-25");
       }
    };
     */
	static get releaseDate() {
		return new Date("2024-05-01");
	}

	/**
	 * This should always return a static array of what the callsystem supports.
	 * See CallsystemCapabilities for a list of valid capabilities.
     * @example 
    class Integrations extends Callsystem {
        static get capabilities() {
            return ["text", "image", "tools", "internet"];
        }
    };
       
    new Integrations.capabilities; // => ["text", "image", "tools", "internet"]
	 * @property {string} text Capable of text generation
	 * @property {string} vision Capable of vision (image classification)
	 * @property {string} image Capable of image generation
	 * @property {string} ears Capable of hearing (audio transcription)
	 * @property {string} audio Capable of audio generation
	 * @property {string} tools Capable of tool calls and function calling
	 * @property {string} legacy All capabilities enabled; this should not be used and is only included for the Legacy callsystem
	 * @returns {CallsystemCapabilities[]} A list of valid capabilities
    */
	static get capabilities() {
		return [];
	}

	/**
	 * This should return an object containing any options that should be passed to CallsystemStd managers.
	 *
	 * @returns {object} Options to be passed to CallsystemStd's managers
	 */
	static get managerOptions() {
		return {};
	}

	/**
	 * The main lifecycle function for the callsystem. Model calls and context should be handled here.
	 *
	 * This function is called when passive activation is triggered (i.e. sending a message in a whitelisted/unblacklisted channel, pinging the bot).
	 * @returns {Promise<CallsystemActivationResponse>} The response to the activation request
	 * @example
	 * class Legacy extends Callsystem {
	 *     async activate() {
	 *         return {
	 *             success: true,
	 *             message: null,
	 *             context: {}
	 *         }
	 *     }
	 * }
	 *
	 * await new Legacy().activate(); // => { success: true, message: , context: {} }
	 */
	async activate() {
		return {
			success: true,
			summary: null,
			context: {},
		};
	}
}

export const predicate = (structure) =>
	Boolean(structure) &&
	Object.getPrototypeOf(structure.prototype).constructor === Callsystem &&
	typeof structure.packageId === "string" &&
	typeof structure.name === "string" &&
	typeof structure.version === "string" &&
	Array.isArray(structure.capabilities) &&
	typeof new structure().activate === "function";
