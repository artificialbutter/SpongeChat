import dedent from "dedent";
import { personas } from "../../../../util/models/constants.js";
import { nanoid } from "nanoid";

/**
 * A helper class for managing passive activation history. This class is exposed to the callsystem via CallsystemStd.
 */
export class HistoryManager {
	/**
	 * @param {object} options
	 *
	 */
	constructor({
		kv,
		instructionSet,
		baseHistory = [],
		model,
		contextWindow = 5,
		recordTemplate,
		variables,
		keyPrefix: prefix,
	}) {
		this.kv = kv;
		this.options = {
			contextWindow: contextWindow || 5,
			instructionSet,
			prefix: prefix || "std.history",
			template: recordTemplate || "%RESPONSE%",
			variables: variables || {},
		};

		this.instructionSet = personas[instructionSet || "default"].messages;
		this.baseHistory = [...(baseHistory || []), ...this.instructionSet].map((m) => ({ ...m, base: true }));
		this.model = model;
	}

	/**
	 * Prefixes a string with a specified prefix (found in this.options.prefix).
	 * @param {*} key The string to prefix
	 * @returns {string} The prefixed key
	 */
	prefixKey(key) {
		return (this.options?.prefix || "std.history") + "-" + key;
	}

	/**
	 * This static method transforms a context object to include additional necessary information.
	 * @param {object} context The context object to transform
	 * @returns {object} The transformed context object
	 */
	transformContext(context) {
		if (context === null) return null;
		return {
			timestamp: Temporal.Now.plainDateTimeISO(this?.tz || "Etc/UTC").toString(),
			...context,
		};
	}

	/**
	 * Transform a content object to conform to a template provided by the callsystem.
	 *
	 * By default, the template is "%RESPONSE%" and returns the content as-is. However, this can be overridden using `recordTemplate` in the callsystem's manager options.
	 *
	 * Variables can be used in the template. They are defined in the callsystem's manager options under `variables`.
	 * @param {string} content
	 * @returns {string} The transformed content
	 */
	transformContent(content, role, variables, templateOverride) {
		const template = templateOverride || this.options.template || "%RESPONSE%";
		const vars = { ...(this.options.variables || {}), ...variables };
		if (typeof content !== "string") return content;

		if (role !== "user") return content;

		const randomisedVars = Object.keys(vars).map((key) => {
			const randomId = nanoid();
			return {
				id: `{_${randomId}}`,
				trueId: key,
				value: vars[key],
			};
		});

		// replace all variable expressions with randomised ID expressions
		const sanitisedTemplate = Object.keys(vars).reduce((acc, key) => {
			const variable = randomisedVars.find((v) => v.trueId === key);
			return acc.replaceAll(key, variable.id);
		}, template || "%RESPONSE%");

		// replace all sanitised variable sequences in the content with their values
		// %RESPONSE% and {RESPONSE} are special variables that are replaced with the response. these are not included here for safety
		const loadedTemplate = Object.keys(vars).reduce((acc, key) => {
			const variable = randomisedVars.find((v) => v.trueId === key);
			return acc.replaceAll(variable.id, variable.value);
		}, sanitisedTemplate);

		if (loadedTemplate.includes("%RESPONSE%")) return loadedTemplate.replaceAll("%RESPONSE%", content);

		return loadedTemplate.includes("{RESPONSE}") ? loadedTemplate.replaceAll("{RESPONSE}", content) : loadedTemplate;
	}

	/**
	 * Fetch the last [contextWindow] records (messages) from the history for a given key. The default window is 5, but `contextWindow` is changeable in the callsystem's manager options.
	 * @param {*} key The key to fetch records from
	 * @returns {Promise<object[]>} The last [contextWindow] records from the history
	 */
	async get(key, includeBase = true) {
		// get the last [contextWindow] messages
		const request = (await this.kv.lRange(this.prefixKey(key), -(this.options.contextWindow + 2), -1))
			.map((m) => JSON.parse(m))
			// sort by timestamp; if the timestamps are the same, sort by sequence
			.sort((a, b) => {
				if (a.sequenceId === b.sequenceId) return b.context?.sequence - a.context?.sequence;
				return new Date(a.timestamp) - new Date(b.timestamp);
			})
			.slice(0, this.options.contextWindow)
			.sort((a, b) => {
				if (a.sequenceId === b.sequenceId) return a.context?.sequence - b.context?.sequence;
				return new Date(b.timestamp) - new Date(a.timestamp);
			});

		return [...(includeBase ? this.baseHistory : []), ...request];
	}

	/**
	 * Return all records (messages) from the history for a given key.
	 * @param {*} key The key to fetch records from
	 * @returns {Promise<object[]>} All records from the history
	 */
	async everything(key, includeBase = true) {
		const request = (await this.kv.lRange(this.prefixKey(key), 0, -1))
			.map((m) => JSON.parse(m))
			.reverse()
			.sort((a, b) => {
				if (a.sequenceId === b.sequenceId) return a.context.sequence - b.context.sequence;
				return new Date(b.timestamp) - new Date(a.timestamp);
			});

		return [...(includeBase ? this.baseHistory : []), ...request];
	}

	/**
	 * Add a single record (message) to the history for a given key.
	 * @param {*} key The key to add the record to
	 * @param {object} param1 Parameters for the record.
	 * @param {string} param1.contextId The context ID of the record; this is usually the message ID being sent/replied to
	 * @param {string} param1.role The role of the record; this is usually "user" or "assistant"
	 * @param {string} param1.content The content of the record
	 * @param {object} param1.context The context of the record; this usually includes information about the user or the conversation, i.e. timestamps
	 * @param {boolean} returnEverything Whether to return the entire history after adding the record. Will only be triggered on `returnEverything = true`.
	 * @returns {Promise<object[]>} The history after adding the record
	 */
	async add(
		key,
		{ contextId, role, content, context },
		returnEverything = false,
		includeBase = true,
		{ variables = {}, template = this.options.template || "%RESPONSE%" } = {},
	) {
		const runOperation = async () => {
			return await this.kv.lPush(
				this.prefixKey(key),
				JSON.stringify({
					contextId,
					role,
					content: this.transformContent(content, role, variables, template),
					context: this.transformContext(context),
				}),
			);
		};

		const base = returnEverything === true ? await this.everything(key, includeBase) : await this.get(key, includeBase);
		await runOperation();
		return [
			...base,
			{ contextId, role, content: this.transformContent(content, variables), context: this.transformContext(context) },
		];
	}

	async addMany(
		key,
		messages = [],
		returnEverything = false,
		includeBase = true,
		{ variables = {}, template = this.options.template || "%RESPONSE%" } = {},
	) {
		const sequenceId = nanoid();
		const mappedMsgs = messages.map((m) => ({
			...m,
			content: this.transformContent(m.content, m.role, variables, template),
			context: { ...this.transformContext(m.context), sequence: messages.indexOf(m), sequenceId },
		}));
		const runOperation = async () => {
			return await this.kv.lPush(
				this.prefixKey(key),
				mappedMsgs.map((m) => JSON.stringify(m)),
			);
		};

		const base = returnEverything === true ? await this.everything(key, includeBase) : await this.get(key, includeBase);
		await runOperation();
		return [...base, ...mappedMsgs];
	}

	async remove(key, contextId, type = ["system", "assistant", "user"]) {
		const base = await this.everything(key);
		const filtered = base?.filter((m) => (m.contextId !== contextId || !type.includes(m.role)) && !m.base);
		await this.kv.del(this.prefixKey(key));
		if (filtered.length === 0) return [];
		await this.kv.lPush(this.prefixKey(key), ...filtered.map((m) => JSON.stringify(m)));
		return filtered;
	}

	async removeAll(key, type = ["system", "assistant", "user"]) {
		if (type.includes("system") && type.includes("assistant") && type.includes("user")) {
			await this.kv.del(this.prefixKey(key));

			return [];
		}

		const base = await this.everything(key);
		const filtered = base?.filter((m) => !type.includes(m.role) && !m.base);
		await this.kv.del(this.prefixKey(key));

		if (filtered.length === 0) return [];

		await this.kv.lPush(this.prefixKey(key), ...filtered.map((m) => JSON.stringify(m)));
		return filtered;
	}
}
