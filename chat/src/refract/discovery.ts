/**
 * Finding the running Refract desktop app.
 *
 * While local control is switched on, the app listens on a port of its own
 * choosing on 127.0.0.1 and writes where, and the token a client must present,
 * to one file in the signed-in user's own application data folder. Being able
 * to read that file is what authorises a client: only programs running as the
 * same user can. Nothing is typed, pasted or registered anywhere.
 */
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { PROTOCOL_VERSION } from "./protocol";

export type Discovery = { port: number; token: string };

/** why there is nothing to connect to */
export type DiscoveryFailure = "not_found" | "invalid" | "incompatible";

/**
 * Where the app writes it: Electron's `appData` folder, then "Refract.Chat".
 * The same path whether the app is an installed build or a development run.
 */
export function discoveryPath(
	platform: NodeJS.Platform = process.platform,
	env: NodeJS.ProcessEnv = process.env,
	home: string = os.homedir(),
): string {
	const appData =
		platform === "win32"
			? env.APPDATA || path.join(home, "AppData", "Roaming")
			: platform === "darwin"
				? path.join(home, "Library", "Application Support")
				: env.XDG_CONFIG_HOME || path.join(home, ".config");
	return path.join(appData, "Refract.Chat", "local-control.json");
}

/** check the file's contents; a failure names why it cannot be used */
export function parseDiscovery(text: string): Discovery | DiscoveryFailure {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return "invalid";
	}
	if (typeof value !== "object" || value === null) return "invalid";
	const { version, port, token } = value as Record<string, unknown>;
	if (typeof version !== "number") return "invalid";
	if (version !== PROTOCOL_VERSION) return "incompatible";
	if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) return "invalid";
	if (typeof token !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) return "invalid";
	return { port, token };
}

export async function readDiscovery(file: string): Promise<Discovery | DiscoveryFailure> {
	let text: string;
	try {
		text = await readFile(file, "utf8");
	} catch {
		// no file: the app is not running, or local control is switched off
		return "not_found";
	}
	return parseDiscovery(text);
}
