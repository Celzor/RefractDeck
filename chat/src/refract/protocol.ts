/**
 * The Refract local control protocol, version 1, as this plugin speaks it.
 * The contract both sides follow is docs/PROTOCOL.md; keep the two in step.
 *
 * Everything arriving from the socket is checked here before the rest of the
 * plugin sees it, so a malformed message can never put a key in a wrong state.
 */

export const PROTOCOL_VERSION = 1;

export type InputMode = "voiceActivity" | "pushToTalk";
export type CallStatus = "connecting" | "connected" | "reconnecting";

/** the call the app is in, or joining */
export type RefractCall = {
	channelId: number;
	channelName: string;
	/** null for a private call, which belongs to no server */
	serverId: number | null;
	serverName: string | null;
	status: CallStatus;
};

/** the soundboard of the call, while it can be used */
export type RefractSoundboard = {
	/** the server whose sounds can be played right now: the call's */
	serverId: number;
	/** the sound this user is playing into the call, or null */
	playingSoundId: number | null;
};

/** what the call bar shows, and the app's unread counts, as one snapshot */
export type RefractState = {
	/** the app's page is loaded and someone is signed in; nothing can be controlled until then */
	signedIn: boolean;
	call: RefractCall | null;
	/** the microphone is switched off */
	muted: boolean;
	deafened: boolean;
	/** the screen is being shared */
	streaming: boolean;
	/** the camera is on */
	camera: boolean;
	inputMode: InputMode;
	/** push to talk is held open right now, by its key or by a client */
	pushToTalkActive: boolean;
	/** push to mute is held right now, by its key or by a client */
	pushToMuteActive: boolean;
	/** null while the call bar's soundboard button cannot be used */
	soundboard: RefractSoundboard | null;
	/** unread messages, as the app's taskbar badge counts them */
	unread: number;
	/** unread mentions, as the same badge counts them */
	mentions: number;
};

export type RefractChannel = { id: number; name: string; category: string | null };
export type RefractServer = { id: number; name: string; channels: RefractChannel[] };

/** a soundboard sound, its id unique within its server only; its emoji only when a list can show it */
export type RefractSound = { id: number; name: string; emoji: string | null; category: string | null };
export type RefractSoundServer = { id: number; name: string; sounds: RefractSound[] };

/** the state shown while the app cannot be reached */
export const OFFLINE_STATE: RefractState = Object.freeze({
	signedIn: false,
	call: null,
	muted: false,
	deafened: false,
	streaming: false,
	camera: false,
	inputMode: "voiceActivity",
	pushToTalkActive: false,
	pushToMuteActive: false,
	soundboard: null,
	unread: 0,
	mentions: 0,
});

/** the commands a client may send, each with its parameters */
export type RefractCommands = {
	joinChannel: { channelId: number };
	leaveCall: Record<string, never>;
	setMute: { value: boolean | "toggle" };
	setDeafen: { value: boolean | "toggle" };
	setStream: { value: boolean | "toggle" };
	setCamera: { value: boolean | "toggle" };
	setInputMode: { value: InputMode | "toggle" };
	pushToTalk: { pressed: boolean };
	pushToMute: { pressed: boolean };
	playSound: { serverId: number; soundId: number };
	stopSound: Record<string, never>;
	openNotifications: Record<string, never>;
};
export type RefractCommandName = keyof RefractCommands;

/** why a command was refused, as the app reports it; the last three are this client's own */
export type RefractErrorCode =
	| "invalid_request"
	| "unknown_action"
	| "not_ready"
	| "not_in_call"
	| "wrong_input_mode"
	| "unknown_channel"
	| "unknown_sound"
	| "wrong_server"
	| "forbidden"
	| "failed"
	| "timeout"
	| "offline"
	| "disconnected";

const ERROR_CODES = new Set<string>([
	"invalid_request",
	"unknown_action",
	"not_ready",
	"not_in_call",
	"wrong_input_mode",
	"unknown_channel",
	"unknown_sound",
	"wrong_server",
	"forbidden",
	"failed",
	"timeout",
]);

export class RefractError extends Error {
	constructor(
		readonly code: RefractErrorCode,
		message?: string,
	) {
		super(message || code);
		this.name = "RefractError";
	}
}

const MAX_NAME_LENGTH = 100;
const MAX_SERVERS = 200;
const MAX_CHANNELS_PER_SERVER = 500;
const MAX_SOUNDS_PER_SERVER = 200;
const MAX_EMOJI_LENGTH = 32;
const MAX_COUNT = 999_999;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const name = (value: unknown, fallback: string): string =>
	typeof value === "string" && value.trim() ? value.trim().slice(0, MAX_NAME_LENGTH) : fallback;

function parseCall(value: unknown): RefractCall | null {
	if (!isRecord(value) || !isId(value.channelId)) return null;
	const status = value.status;
	return {
		channelId: value.channelId,
		channelName: name(value.channelName, "Voice call"),
		serverId: isId(value.serverId) ? value.serverId : null,
		serverName: typeof value.serverName === "string" ? name(value.serverName, "") || null : null,
		status: status === "connecting" || status === "reconnecting" ? status : "connected",
	};
}

function parseSoundboard(value: unknown): RefractSoundboard | null {
	if (!isRecord(value) || !isId(value.serverId)) return null;
	return { serverId: value.serverId, playingSoundId: isId(value.playingSoundId) ? value.playingSoundId : null };
}

/** a count of unread things: a whole number, or none */
const count = (value: unknown): number => (isId(value) ? Math.min(value, MAX_COUNT) : 0);

/** the state in a `state` message, or null when it is not one */
export function parseState(value: unknown): RefractState | null {
	if (!isRecord(value)) return null;
	return {
		signedIn: value.signedIn === true,
		call: parseCall(value.call),
		muted: value.muted === true,
		deafened: value.deafened === true,
		streaming: value.streaming === true,
		camera: value.camera === true,
		inputMode: value.inputMode === "pushToTalk" ? "pushToTalk" : "voiceActivity",
		pushToTalkActive: value.pushToTalkActive === true,
		pushToMuteActive: value.pushToMuteActive === true,
		soundboard: parseSoundboard(value.soundboard),
		unread: count(value.unread),
		mentions: count(value.mentions),
	};
}

/** the servers in a `channels` message, or null when it is not one; anything malformed inside is left out */
export function parseServers(value: unknown): RefractServer[] | null {
	if (!Array.isArray(value)) return null;
	const servers: RefractServer[] = [];
	for (const entry of value.slice(0, MAX_SERVERS)) {
		if (!isRecord(entry) || !isId(entry.id)) continue;
		const channels: RefractChannel[] = [];
		for (const channel of Array.isArray(entry.channels) ? entry.channels.slice(0, MAX_CHANNELS_PER_SERVER) : []) {
			if (!isRecord(channel) || !isId(channel.id)) continue;
			channels.push({
				id: channel.id,
				name: name(channel.name, `Channel ${channel.id}`),
				category: typeof channel.category === "string" ? name(channel.category, "") || null : null,
			});
		}
		servers.push({ id: entry.id, name: name(entry.name, `Server ${entry.id}`), channels });
	}
	return servers;
}

/** the servers in a `sounds` message, or null when it is not one; anything malformed inside is left out */
export function parseSoundServers(value: unknown): RefractSoundServer[] | null {
	if (!Array.isArray(value)) return null;
	const servers: RefractSoundServer[] = [];
	for (const entry of value.slice(0, MAX_SERVERS)) {
		if (!isRecord(entry) || !isId(entry.id)) continue;
		const sounds: RefractSound[] = [];
		for (const sound of Array.isArray(entry.sounds) ? entry.sounds.slice(0, MAX_SOUNDS_PER_SERVER) : []) {
			if (!isRecord(sound) || !isId(sound.id)) continue;
			const emoji = typeof sound.emoji === "string" ? sound.emoji.trim() : "";
			sounds.push({
				id: sound.id,
				name: name(sound.name, `Sound ${sound.id}`),
				emoji: emoji && emoji.length <= MAX_EMOJI_LENGTH ? emoji : null,
				category: typeof sound.category === "string" ? name(sound.category, "") || null : null,
			});
		}
		servers.push({ id: entry.id, name: name(entry.name, `Server ${entry.id}`), sounds });
	}
	return servers;
}

/** the code of a refused command, defaulting to "failed" for one this version does not know */
export function parseErrorCode(value: unknown): RefractErrorCode {
	return typeof value === "string" && ERROR_CODES.has(value) ? (value as RefractErrorCode) : "failed";
}

/** a message from the app, already parsed from JSON */
export type ServerMessage =
	| { type: "ready"; version: number; appVersion: string | null }
	| { type: "state"; state: RefractState }
	| { type: "channels"; servers: RefractServer[] }
	| { type: "sounds"; servers: RefractSoundServer[] }
	| { type: "result"; id: number; ok: true }
	| { type: "result"; id: number; ok: false; error: RefractErrorCode; message: string | null };

/** check one message from the app; null for anything this version does not understand, which is ignored */
export function parseServerMessage(text: string): ServerMessage | null {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return null;
	}
	if (!isRecord(value)) return null;
	switch (value.type) {
		case "ready": {
			if (typeof value.version !== "number") return null;
			const app = isRecord(value.app) ? value.app : {};
			return {
				type: "ready",
				version: value.version,
				appVersion: typeof app.version === "string" ? app.version.slice(0, 64) : null,
			};
		}
		case "state": {
			const state = parseState(value.state);
			return state ? { type: "state", state } : null;
		}
		case "channels": {
			const servers = parseServers(value.servers);
			return servers ? { type: "channels", servers } : null;
		}
		case "sounds": {
			const servers = parseSoundServers(value.servers);
			return servers ? { type: "sounds", servers } : null;
		}
		case "result": {
			if (!isId(value.id)) return null;
			if (value.ok === true) return { type: "result", id: value.id, ok: true };
			return {
				type: "result",
				id: value.id,
				ok: false,
				error: parseErrorCode(value.error),
				message: typeof value.message === "string" ? value.message.slice(0, 200) : null,
			};
		}
		default:
			return null;
	}
}
