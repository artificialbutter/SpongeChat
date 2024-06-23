import { z } from "zod";
import { Integration } from "../../../callsystems/spongedsc/integrations/lib/class.js";
import { tool } from "ai";
import { fetch } from "undici";
import dedent from "dedent";
import { codes as wmo } from "./wmo.data.js";
export default class HelloWorld extends Integration {
	constructor(opts) {
		const { env, message, client, std, provider } = opts || {};
		super({ env, message, client, std, provider });
	}

	static get packageId() {
		return "in.spongedsc.weather";
	}

	static get name() {
		return "Weather";
	}

	static get version() {
		return "0.0.1";
	}

	static get tool() {
		return {
			type: "function",
			function: tool({
				name: "weather",
				description: "Get the weather for a given location",
				parameters: z.object({
					location: z.string().describe("The location to get the weather for"),
				}),
			}),
		};
	}

	static get releaseDate() {
		return new Date("2023-06-02");
	}

	/**
	 * This function is called when the integration is activated by the Integrations callsystem.
	 * @param {object[]} arguments The arguments passed to the integration.
	 * @returns {Promise<IntegrationResponse>} The response to the activation request.
	 */
	async activate({ arguments: args }) {
		const { env, message, client } = this;

		const pois = await fetch(
			`https://nominatim.openstreetmap.org/search?addressdetails=1&q=${args.location}&format=jsonv2&limit=1`,
		)
			.then((res) => res.json())
			.catch((err) => {
				console.log(err);
				return [];
			});

		if (pois.length === 0) {
			return {
				success: false,
				messages: [
					{
						role: "tool",
						content: `The weather in ${args.location} is unknown`,
					},
				],
				data: {},
			};
		}

		const weather = await fetch(
			`https://api.open-meteo.com/v1/forecast?latitude=${pois[0]?.lat}&longitude=${pois[0]?.lon}&current=temperature_2m,is_day,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`,
		)
			.then((res) => res.json())
			.catch((err) => {
				console.log(err);
				return {};
			});

		const isDay = weather?.current?.is_day === 1;

		return {
			success: true,
			messages: [
				{
					role: "tool",
					content: dedent`
                    The weather in ${pois[0]?.display_name} is currently ${weather?.current?.temperature_2m || "<unknown>"}°C and ${wmo[weather?.current?.weather_code]?.[isDay ? "day" : "night"] || "<unknown>"}.
                    
                    Today, the weather is expected to be ${wmo[weather?.daily?.weather_code?.[0]]?.[isDay ? "day" : "night"] || "<unknown>"}, with a high of ${weather?.daily?.temperature_2m_max?.[0] || "<unknown>"}°C and a low of ${weather?.daily?.temperature_2m_min?.[0] || "<unknown>"}°C.
                    `,
				},
			],
			data: {},
		};
	}
}
