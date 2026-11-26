/**
 * A stand-in for the Refract desktop app's local control socket.
 *
 *   npm run mock
 *
 * It follows docs/PROTOCOL.md exactly as the app does, with a pretend account
 * in two servers that each have a few soundboard sounds, so the plugin's keys
 * can be tried on a real Stream Deck without Refract, an account or a call -
 * and so the tests have something to talk to. Quit Refract first, or switch
 * its Stream Deck Control off: both write the same file.
 *
 * While it runs, type a word and Enter to change things "in the app":
 *   mute | deafen | camera | mode | stream | sound | message | mention | read | leave | signout | signin | quit
 *
 * "sound" plays the first sound of the call's server as if it had been clicked
 * in the app, "message" and "mention" each add one unread, and "read" clears
 * them. The AFK channel is one where the soundboard may not be used, and the
 * two servers each have a sound with the id 1, as servers really can.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { WebSocketServer } from "ws";

const VERSION = 1;
const MAX_CLIENTS = 8;
const MAX_UNGREETED = 16;

export function defaultDiscoveryFile() {
	const appData =
		process.platform === "win32"
			? process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
			: process.platform === "darwin"
				? path.join(os.homedir(), "Library", "Application Support")
				: process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
	return path.join(appData, "Refract.Chat", "local-control.json");
}

const SERVERS = [
	{
		id: 1,
		name: "Refract HQ",
		channels: [
			{ id: 11, name: "General", category: "Voice Channels" },
			{ id: 12, name: "Gaming Lounge", category: "Voice Channels" },
			{ id: 13, name: "AFK", category: null },
		],
	},
	{
		id: 2,
		name: "Friends",
		channels: [{ id: 21, name: "Hangout", category: null }],
	},
];

const SOUNDS = [
	{
		id: 1,
		name: "Refract HQ",
		sounds: [
			{ id: 1, name: "Airhorn", emoji: "📣", category: "Memes" },
			{ id: 2, name: "Sad Trombone", emoji: "🎺", category: "Memes" },
			{ id: 3, name: "Applause", emoji: null, category: null },
		],
	},
	{
		id: 2,
		name: "Friends",
		// the same id as Airhorn: a sound's id is only unique within its server
		sounds: [{ id: 1, name: "Ba Dum Tss", emoji: "🥁", category: null }],
	},
];

/** voice channels where the pretend account may not use the soundboard */
const NO_SOUNDBOARD = new Set([13]);

const SIGNED_OUT = {
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
};

/**
 * Start the stand-in. `file` is where the port and token are written,
 * `joinMs` how long a call takes to connect, `soundMs` how long a sound
 * plays, `pingMs` how often clients are pinged, `helloMs` how long a
 * connection has to say hello, and `log` hears a line for everything that
 * happens.
 */
export async function startMockRefract({
	file = defaultDiscoveryFile(),
	joinMs = 400,
	soundMs = 2500,
	pingMs = 15000,
	helloMs = 5000,
	log = () => {},
} = {}) {
	const token = randomBytes(32).toString("base64url");
	let state = { ...SIGNED_OUT, signedIn: true };
	let servers = SERVERS;
	let sounds = SOUNDS;
	/** each accepted client, with what it is holding down */
	const clients = new Map();
	/** connections that have not said hello yet; each has until helloMs to */
	const ungreeted = new Set();
	let joinTimer = null;
	/** the sound being played into the call, and when it ends */
	let playing = null;
	let soundTimer = null;

	const http = createServer((_request, response) => {
		response.writeHead(426, { "Content-Type": "text/plain" }).end("Upgrade Required");
	});
	const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });

	http.on("upgrade", (request, socket, head) => {
		// a browser always names the page that is connecting; nothing in a browser may use this socket
		// and neither clients nor connections still to say hello may pile up
		if (request.headers.origin !== undefined || clients.size >= MAX_CLIENTS || ungreeted.size >= MAX_UNGREETED) {
			socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
			socket.destroy();
			return;
		}
		wss.handleUpgrade(request, socket, head, (ws) => accept(ws));
	});

	const send = (ws, message) => {
		if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
	};
	const broadcast = (message) => {
		for (const ws of clients.keys()) send(ws, message);
	};

	/** what any client holds decides whether a hold is active */
	function heldBy(kind) {
		for (const held of clients.values()) if (held[kind]) return true;
		return false;
	}

	function setState(patch) {
		const next = { ...state, ...patch };
		// the call bar's buttons only say anything in a call
		if (!next.call) Object.assign(next, { muted: false, deafened: false, streaming: false, camera: false });
		// a hold ends with the call it was made in, and with the input mode it belongs to
		const connected = next.call?.status === "connected";
		for (const held of clients.values()) {
			if (!connected || next.inputMode !== "pushToTalk") held.talk = false;
			if (!connected || next.inputMode !== "voiceActivity") held.mute = false;
		}
		next.pushToTalkActive = heldBy("talk");
		next.pushToMuteActive = heldBy("mute");
		// the soundboard is the call's: a connected call, in a server, in a channel that allows it
		const soundboard = connected && next.call.serverId !== null && !NO_SOUNDBOARD.has(next.call.channelId);
		if (!soundboard || next.call.serverId !== state.soundboard?.serverId) stopSound();
		next.soundboard = soundboard ? { serverId: next.call.serverId, playingSoundId: playing } : null;
		if (JSON.stringify(next) === JSON.stringify(state)) return;
		state = next;
		broadcast({ type: "state", state });
	}

	/** forget the sound that is playing; the state is told by whoever called */
	function stopSound() {
		clearTimeout(soundTimer);
		playing = null;
	}

	function startSound(soundId) {
		stopSound();
		playing = soundId;
		soundTimer = setTimeout(() => {
			playing = null;
			setState({});
		}, soundMs);
		setState({});
	}

	function leave() {
		clearTimeout(joinTimer);
		setState({ call: null, streaming: false, camera: false });
	}

	/** a sound by its server and its id together; its id alone does not say which sound */
	function findSound(serverId, soundId) {
		const server = sounds.find((each) => each.id === serverId);
		const sound = server?.sounds.find((each) => each.id === soundId);
		return server && sound ? { server, sound } : null;
	}

	function findChannel(channelId) {
		for (const server of servers) {
			const channel = server.channels.find((each) => each.id === channelId);
			if (channel) return { server, channel };
		}
		return null;
	}

	const pick = (value, current) => (value === "toggle" ? !current : value);
	const fail = (error, message) => ({ ok: false, error, message });
	const inCall = () => state.call?.status === "connected";

	/** what is wrong with a command before the app's state is even looked at, or null */
	function invalid(message) {
		switch (message.action) {
			case "joinChannel":
				return Number.isSafeInteger(message.channelId) && message.channelId >= 0
					? null
					: fail("invalid_request", "channelId must be a whole number");
			case "leaveCall":
			case "stopSound":
			case "openNotifications":
				return null;
			case "playSound":
				return [message.serverId, message.soundId].every((value) => Number.isSafeInteger(value) && value >= 0)
					? null
					: fail("invalid_request", "serverId and soundId must be whole numbers");
			case "setMute":
			case "setDeafen":
			case "setStream":
			case "setCamera":
				return typeof message.value === "boolean" || message.value === "toggle"
					? null
					: fail("invalid_request", 'value must be true, false or "toggle"');
			case "setInputMode":
				return ["voiceActivity", "pushToTalk", "toggle"].includes(message.value)
					? null
					: fail("invalid_request", 'value must be "voiceActivity", "pushToTalk" or "toggle"');
			case "pushToTalk":
			case "pushToMute":
				return typeof message.pressed === "boolean" ? null : fail("invalid_request", "pressed must be true or false");
			default:
				return fail("unknown_action", "No such action");
		}
	}

	/** run one command; answers what the result message says */
	function run(ws, message) {
		// in this order: is it a command at all, then can anything be done, then can this be done now
		const problem = invalid(message);
		if (problem) return problem;
		if (!state.signedIn) return fail("not_ready", "Nobody is signed in");
		const held = clients.get(ws);
		switch (message.action) {
			case "joinChannel": {
				const found = findChannel(message.channelId);
				if (!found) return fail("unknown_channel", "No such voice channel");
				if (state.call?.channelId === found.channel.id) return { ok: true };
				clearTimeout(joinTimer);
				const call = {
					channelId: found.channel.id,
					channelName: found.channel.name,
					serverId: found.server.id,
					serverName: found.server.name,
				};
				// as in the app, the microphone counts as off until the call has connected and switched it on
				setState({ call: { ...call, status: "connecting" }, muted: true, streaming: false, camera: false });
				joinTimer = setTimeout(() => setState({ call: { ...call, status: "connected" }, muted: false }), joinMs);
				return { ok: true };
			}
			case "leaveCall":
				if (!state.call) return fail("not_in_call", "There is no call to leave");
				leave();
				return { ok: true };
			case "setMute":
			case "setDeafen":
			case "setStream":
			case "setCamera": {
				if (!inCall()) return fail("not_in_call", "Not connected to a call");
				if (message.action === "setMute") setState({ muted: pick(message.value, state.muted) });
				else if (message.action === "setDeafen") setState({ deafened: pick(message.value, state.deafened) });
				else if (message.action === "setCamera") setState({ camera: pick(message.value, state.camera) });
				else setState({ streaming: pick(message.value, state.streaming) });
				return { ok: true };
			}
			case "playSound": {
				if (!inCall()) return fail("not_in_call", "Not connected to a call");
				const found = findSound(message.serverId, message.soundId);
				if (!found) return fail("unknown_sound", "No such sound in that server");
				if (state.call.serverId !== found.server.id) return fail("wrong_server", "The call is in another server");
				if (!state.soundboard) return fail("forbidden", "The soundboard cannot be used in this channel");
				startSound(found.sound.id);
				return { ok: true };
			}
			case "stopSound":
				// with nothing playing there is nothing to stop, which is what was asked for
				stopSound();
				setState({});
				return { ok: true };
			case "openNotifications":
				log("the window comes forward, on the newest unread conversation");
				return { ok: true };
			case "setInputMode": {
				const value = message.value;
				const next = value === "toggle" ? (state.inputMode === "pushToTalk" ? "voiceActivity" : "pushToTalk") : value;
				setState({ inputMode: next });
				return { ok: true };
			}
			case "pushToTalk":
			case "pushToMute": {
				const kind = message.action === "pushToTalk" ? "talk" : "mute";
				if (message.pressed) {
					if (!inCall()) return fail("not_in_call", "Not connected to a call");
					const mode = kind === "talk" ? "pushToTalk" : "voiceActivity";
					if (state.inputMode !== mode) return fail("wrong_input_mode", `The microphone is not set to ${mode}`);
				}
				// letting go is always accepted, once signed in
				held[kind] = message.pressed;
				setState({});
				return { ok: true };
			}
			default:
				return fail("unknown_action", "No such action");
		}
	}

	function accept(ws) {
		let accepted = false;
		ungreeted.add(ws);
		const helloTimer = setTimeout(() => ws.close(4401, "no hello"), helloMs);
		ws.isAlive = true;
		ws.on("pong", () => {
			ws.isAlive = true;
		});
		ws.on("error", () => {});
		ws.on("message", (data, isBinary) => {
			let message;
			try {
				message = isBinary ? null : JSON.parse(data.toString());
			} catch {
				message = null;
			}
			if (!message || typeof message !== "object" || Array.isArray(message)) {
				if (!accepted) ws.close(4400, "bad request");
				return;
			}

			if (!accepted) {
				// turned away for want of a place, and on its way out
				if (!ungreeted.has(ws)) return;
				if (message.type !== "hello" || typeof message.token !== "string") return ws.close(4400, "bad request");
				if (message.version !== VERSION) return ws.close(4400, "unsupported version");
				const given = Buffer.from(message.token);
				const wanted = Buffer.from(token);
				if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return ws.close(4401, "unauthorized");
				clearTimeout(helloTimer);
				ungreeted.delete(ws);
				// the last place may have been taken while this hello was on its way
				if (clients.size >= MAX_CLIENTS) return ws.close(1013, "too many clients");
				accepted = true;
				clients.set(ws, { talk: false, mute: false });
				log(`client connected: ${message.client?.name ?? "unnamed"} ${message.client?.version ?? ""}`.trim());
				send(ws, { type: "ready", version: VERSION, app: { name: "Refract.Chat (mock)", version: "0.0.0-mock" } });
				send(ws, { type: "state", state });
				send(ws, { type: "channels", servers });
				send(ws, { type: "sounds", servers: sounds });
				return;
			}

			if (message.type !== "command") return;
			if (!Number.isSafeInteger(message.id) || message.id < 0) return;
			const result = typeof message.action === "string" ? run(ws, message) : fail("invalid_request", "action missing");
			const { type: _type, id: _id, action, ...params } = message;
			log(`${action} ${JSON.stringify(params)} -> ${result.ok ? "ok" : result.error}`);
			send(ws, { type: "result", id: message.id, ...result });
		});
		ws.on("close", () => {
			clearTimeout(helloTimer);
			ungreeted.delete(ws);
			if (!clients.delete(ws)) return;
			log("client disconnected");
			// whatever it was holding is let go: a hold never outlives its client
			setState({});
		});
	}

	const pinger = setInterval(() => {
		for (const ws of clients.keys()) {
			if (!ws.isAlive) {
				ws.terminate();
				continue;
			}
			ws.isAlive = false;
			ws.ping();
		}
	}, pingMs);

	await new Promise((resolve, reject) => {
		http.once("error", reject);
		http.listen(0, "127.0.0.1", resolve);
	});
	const { port } = http.address();

	// written whole, then renamed into place, so a reader never sees half of it
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(`${file}.tmp`, JSON.stringify({ version: VERSION, port, token, pid: process.pid }), { mode: 0o600 });
	renameSync(`${file}.tmp`, file);

	let stopped = false;
	return {
		port,
		token,
		file,
		get state() {
			return state;
		},
		get clientCount() {
			return clients.size;
		},
		/** change something as if it had been done in the app's own window */
		setState,
		setServers(next) {
			servers = next;
			broadcast({ type: "channels", servers });
		},
		setSounds(next) {
			sounds = next;
			broadcast({ type: "sounds", servers: sounds });
		},
		/** play a sound of the call's server as if it had been clicked in the app's own soundboard; false when it cannot be */
		playSound(soundId) {
			if (!state.soundboard || !findSound(state.soundboard.serverId, soundId)) return false;
			startSound(soundId);
			return true;
		},
		signOut() {
			clearTimeout(joinTimer);
			stopSound();
			state = { ...SIGNED_OUT };
			servers = [];
			sounds = [];
			broadcast({ type: "state", state });
			broadcast({ type: "channels", servers });
			broadcast({ type: "sounds", servers: sounds });
		},
		signIn() {
			servers = SERVERS;
			sounds = SOUNDS;
			setState({ signedIn: true });
			broadcast({ type: "channels", servers });
			broadcast({ type: "sounds", servers: sounds });
		},
		leave,
		/** stop answering without closing anything, as a frozen app or a sleeping computer would */
		freeze() {
			clearInterval(pinger);
			for (const ws of clients.keys()) ws.removeAllListeners("message");
		},
		async stop({ keepFile = false } = {}) {
			if (stopped) return;
			stopped = true;
			clearInterval(pinger);
			clearTimeout(joinTimer);
			clearTimeout(soundTimer);
			if (!keepFile) rmSync(file, { force: true });
			for (const ws of wss.clients) ws.terminate();
			await new Promise((resolve) => http.close(resolve));
		},
	};
}

/** whether another program (the real app) already owns the discovery file */
function ownedByAnother(file) {
	try {
		const { pid } = JSON.parse(readFileSync(file, "utf8"));
		if (!Number.isInteger(pid) || pid === process.pid) return false;
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const file = defaultDiscoveryFile();
	if (ownedByAnother(file) && !process.argv.includes("--force")) {
		console.error(`Another program is already serving local control (${file}).\nQuit Refract first, or pass --force.`);
		process.exit(1);
	}
	const stamp = () => new Date().toLocaleTimeString();
	const mock = await startMockRefract({ file, log: (line) => console.log(`[${stamp()}] ${line}`) });
	console.log(`Mock Refract is listening on 127.0.0.1:${mock.port}`);
	console.log(`Wrote ${file}`);
	console.log("Type: mute | deafen | camera | mode | stream | sound | message | mention | read | leave | signout | signin | quit");

	const quit = async () => {
		await mock.stop();
		process.exit(0);
	};
	process.on("SIGINT", quit);
	process.on("SIGTERM", quit);

	createInterface({ input: process.stdin }).on("line", (line) => {
		const { state } = mock;
		switch (line.trim().toLowerCase()) {
			case "mute":
				return mock.setState({ muted: !state.muted });
			case "deafen":
				return mock.setState({ deafened: !state.deafened });
			case "stream":
				return mock.setState({ streaming: !state.streaming });
			case "camera":
				return mock.setState({ camera: !state.camera });
			case "sound": {
				const first = state.soundboard && SOUNDS.find((server) => server.id === state.soundboard.serverId)?.sounds[0];
				if (!first || !mock.playSound(first.id)) console.log("Join a voice channel that allows the soundboard first.");
				return;
			}
			case "message":
				return mock.setState({ unread: state.unread + 1 });
			case "mention":
				return mock.setState({ unread: state.unread + 1, mentions: state.mentions + 1 });
			case "read":
				return mock.setState({ unread: 0, mentions: 0 });
			case "mode":
				return mock.setState({ inputMode: state.inputMode === "pushToTalk" ? "voiceActivity" : "pushToTalk" });
			case "leave":
				return mock.leave();
			case "signout":
				return mock.signOut();
			case "signin":
				return mock.signIn();
			case "quit":
			case "exit":
				return void quit();
			case "":
				return;
			default:
				console.log("mute | deafen | camera | mode | stream | sound | message | mention | read | leave | signout | signin | quit");
		}
	});
}
