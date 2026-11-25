import streamDeck from "@elgato/streamdeck";

import { RefractClient } from "./client";

const logger = streamDeck.logger.createScope("Refract");

/** the one connection to the Refract desktop app that every action shares */
export const refract = new RefractClient({
	clientVersion: streamDeck.info?.plugin?.version,
	logger: {
		debug: (message) => logger.debug(message),
		info: (message) => logger.info(message),
		warn: (message) => logger.warn(message),
	},
});

export { RefractError } from "./protocol";
export type {
	RefractCommandName,
	RefractCommands,
	RefractServer,
	RefractSoundServer,
	RefractState,
} from "./protocol";
