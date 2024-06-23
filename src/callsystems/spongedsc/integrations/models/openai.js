import { z } from "zod";
import { generateText, tool } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { nanoid } from "nanoid";

class OpenAI {
	constructor({ key, apiUrl = "https://api.openai.com/v1" }) {
		this.key = key;
		this.apiUrl = apiUrl;
		this.providerInstance = createOpenAI({ apiKey: this.key, baseURL: this.apiUrl });
	}

	async call({
		model,
		messages,
		temperature = 0,
		top_p = 1,
		frequency_penalty = 0,
		presence_penalty = 0,
		max_tokens = 2048,
		stop = null,
		tools = [],
	}) {
		const toCall = tools.reduce((acc, tool) => {
			acc[tool?.function?.name || nanoid()] = tool?.function;
			return acc;
		}, {});

		return await generateText({
			model: this.providerInstance(model || "gpt-4o"),
			messages: messages.map((m) => ({
				role: m.role,
				content: m.content,
			})),
			temperature,
			top_p,
			frequency_penalty,
			presence_penalty,
			max_tokens,
			stop,
			tools: toCall,
		});
	}
}

export { OpenAI as Caller };
