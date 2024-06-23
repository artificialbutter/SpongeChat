/* --marker:loader_exclude */
export const __loader_exclude = true;

/**
 * @typedef {object} IntegrationMessages LLM messages to be sent back to the model
 * @property {"system" | "user" | "assistant" | "tool"} role The role of the message
 * @property {string} content The content of the message
 */

/**
 * @typedef {object} IntegrationResponse The response to a callsystem activation request
 * @property {boolean} success Whether the integration task was successful
 * @property {IntegrationMessages[]} messages The messages to be sent back to the model
 * @property {object | null} data A data object that contains any information that needs to be returned back to the integration
 */

/**
 * The base class for all integrations. Only integrations that extend this class will be able to be activated by the Integrations callsystem.
 *
 * Most of the accessors and methods in this class are similar to those in the Callsystem class. See individual methods/properties for differences.
 */
export class Integration {
	constructor({ env, message, client, std, provider }) {
		this.client = client;
		this.env = env;
		this.message = message;
		this.std = std;
		this.provider = provider;
	}

	/**
	 * Similar to callsystems, Integrations uses package IDs to identify integrations internally.
	 *
	 * This package ID should be in a namespaced format. All callsystems have a root namespace of "in".
	 * @returns {string} The package ID of the integration.
	 * @example
	 * class HelloWorld extends Integration {
	 *     static get packageId() {
	 *         return "in.spongedsc.helloworld";
	 *     }
	 * }
	 *
	 * HelloWorld.packageId; // => "cs.spongedsc.legacy"
	 */
	static get packageId() {
		return "in.spongedsc.core";
	}

	/**
     * This should return the integration's name.
     * @returns {string} A string that represents the integration's name.
     * @example 
    class HelloWorld extends Integration {
        get name() {
            return "Hello world!";
        }
    };
    
    HelloWorld.name; // => "Hello world!"
    */
	static get name() {
		return "Integration";
	}

	/**
	 * Similar to callsystems, this should return a version string for the integration. Core uses this for debugging and versioning purposes.
	 * 
     * Again, we recommend that you use semantic versioning (https://semver.org/), but Core will not enforce this.
	 * @returns {string} A version string for the integration.
     * @example
    class HelloWorld extends Integration {
       static get version() {
           return "1.0.0";
       }
    };
       
    HelloWorld.version; // => "1.0.0"
	*/
	static get version() {
		return "1.0.0";
	}

	/**
	 * This should return the tool configuration that Integrations will send to the model.
	 *
	 * See the OpenAI API reference on tools for more information.
	 * @link https://platform.openai.com/docs/api-reference/chat/create#chat-create-tools
	 * @returns {object} An object containing the tool configuration for the integration.
	 *
	 **/
	static get tool() {
		return {
			type: "function",
			function: {
				name: "hello",
			},
		};
	}

	/**
     * This should return a Date object corresponding to the release date of this release.
     * This is used for sorting purposes. Otherwise, Integrations will use the current date.
     * @returns {Date} A Date object corresponding to the release date of this release.
     * @example 
    class HelloWorld extends Integration {
       static get releaseDate() {
           return new Date("2024-06-02");
       }
    };
     */
	static get releaseDate() {
		return new Date("2024-06-02");
	}

	/**
	 * The main lifecycle function for the integration. Returns data and context to be sent back to the model.
	 *
	 * This function is called by Integrations when the caller model detects that this integration could be used to complete the task.
	 * @param {object[]} arguments The arguments passed to the integration.
	 * @returns {Promise<IntegrationResponse>} The response to the activation request
	 * @example
	 * class HelloWorld extends Integration {
	 *     async activate({ arguments }) {
	 *         return {
	 *             success: true,
	 *             messages: [],
	 *             data: {}
	 *         }
	 *     }
	 * }
	 *
	 * await new HelloWorld().activate(); // => { success: true, messages: [], data: {} }
	 */
	async activate() {
		return {
			success: true,
			messages: [],
			data: {},
		};
	}
}

export const predicate = (structure) =>
	Boolean(structure) &&
	Object.getPrototypeOf(structure.prototype).constructor === Integration &&
	typeof structure.packageId === "string" &&
	typeof structure.name === "string" &&
	typeof structure.version === "string" &&
	typeof structure.tool === "object" &&
	typeof new structure().activate === "function";
