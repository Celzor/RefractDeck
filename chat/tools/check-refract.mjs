/**
 * Checks a running Refract desktop app against docs/PROTOCOL.md, as a client
 * would meet it. For whoever is building local control into Refract.
 *
 *   node tools/check-refract.mjs            the checks, then exit (0 when all pass)
 *   node tools/check-refract.mjs --watch    then keep printing state as it changes
 *   node tools/check-refract.mjs --file <path>   read another discovery file
 *
 * Nothing here changes the call or what the app shows: every command sent is
 * one the app must refuse, a release of a hold that was never taken, or a stop
 * while no sound is playing. Start Refract, sign in, and switch local control
 * on first.
 */
import { readFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import WebSocket from "ws";

import { defaultDiscoveryFile } from "./mock-refract.mjs";

const args = process.argv.slice(2);
const watch = args.includes("--watch");
const fileFlag = args.indexOf("--file");
const file = fileFlag >= 0 ? path.resolve(args[fileFlag + 1]) : defaultDiscoveryFile();

let failures = 0;
function check(ok, what, detail = "") {
	if (!ok) failures++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
	return ok;
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isId = (value) => Number.isSafeInteger(value) && value >= 0;

// ---- the discovery file ----

let discovery;
try {
	discovery = JSON.parse(readFileSync(file, "utf8"));
} catch (error) {
	console.log(`FAIL  discovery file ${file}  (${error.code ?? error.message})`);
	console.log("      Is Refract running, with local control switched on?");
	process.exit(1);
}
check(discovery.version === 1, "discovery: version is 1", `got ${JSON.stringify(discovery.version)}`);
check(
	Number.isInteger(discovery.port) && discovery.port > 0 && discovery.port < 65536,
	"discovery: port is a port number",
	String(discovery.port),
);
check(
	typeof discovery.token === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(discovery.token),
	"discovery: token is 32-128 base64url characters",
);
let pidAlive = false;
try {
	process.kill(discovery.pid, 0);
	pidAlive = true;
} catch {
	/* not running */
}
check(Number.isInteger(discovery.pid) && pidAlive, "discovery: pid is the running app", String(discovery.pid));
if (failures > 0) process.exit(1);

const url = `ws://127.0.0.1:${discovery.port}/`;

// ---- who may connect ----

/** the handshake's HTTP status when refused, or the close code once connected and closed */
function outcome(options, firstMessage) {
	return new Promise((resolve) => {
		const socket = new WebSocket(url, { handshakeTimeout: 3000, ...options });
		const timer = setTimeout(() => {
			socket.terminate();
			resolve("still open after 7 s");
		}, 7000);
		const done = (value) => {
			clearTimeout(timer);
			resolve(value);
		};
		socket.on("open", () => firstMessage !== undefined && socket.send(firstMessage));
		socket.on("unexpected-response", (_request, response) => done(`HTTP ${response.statusCode}`));
		socket.on("close", (code) => done(code));
		socket.on("error", () => {});
	});
}

const hello = (extra = {}) =>
	JSON.stringify({ type: "hello", version: 1, token: discovery.token, client: { name: "check-refract", version: "1" }, ...extra });

const lan = Object.values(os.networkInterfaces())
	.flat()
	.find((address) => address && address.family === "IPv4" && !address.internal);
if (lan) {
	const reachable = await new Promise((resolve) => {
		const socket = net.connect({ host: lan.address, port: discovery.port });
		socket.setTimeout(1500);
		socket.on("connect", () => (socket.destroy(), resolve(true)));
		socket.on("timeout", () => (socket.destroy(), resolve(false)));
		socket.on("error", () => resolve(false));
	});
	check(!reachable, "listens on 127.0.0.1 only", `tried ${lan.address}`);
}

const fromBrowser = await outcome({ headers: { Origin: "https://example.com" } }, hello());
check(String(fromBrowser).startsWith("HTTP 4"), "a connection naming an Origin is refused before the upgrade", String(fromBrowser));
check((await outcome({}, hello({ token: "A".repeat(43) }))) === 4401, "a wrong token is closed with 4401");
check((await outcome({}, hello({ version: 99 }))) === 4400, "an unsupported version is closed with 4400");
check((await outcome({}, "not json")) === 4400, "a first message that is not a hello is closed with 4400");

// ---- a real client ----

const socket = new WebSocket(url, { handshakeTimeout: 3000 });
const received = [];
const waiting = [];
let pinged = false;
socket.on("ping", () => {
	pinged = true;
});
socket.on("message", (data) => {
	let message;
	try {
		message = JSON.parse(data.toString());
	} catch {
		check(false, "every message is JSON", data.toString().slice(0, 80));
		return;
	}
	received.push(message);
	for (const entry of [...waiting]) {
		if (!entry.match(message)) continue;
		waiting.splice(waiting.indexOf(entry), 1);
		clearTimeout(entry.timer);
		entry.resolve(message);
	}
	if (watch && message.type === "state") console.log(`state  ${JSON.stringify(message.state)}`);
	if (watch && message.type === "channels") console.log(`channels  ${JSON.stringify(message.servers)}`);
	if (watch && message.type === "sounds") console.log(`sounds  ${JSON.stringify(message.servers)}`);
});
/** the first message matching, already received or yet to come; null after two seconds without one */
function next(match, timeoutMs = 2000) {
	const had = received.find(match);
	if (had) return Promise.resolve(had);
	return new Promise((resolve) => {
		const entry = { match, resolve, timer: setTimeout(() => resolve(null), timeoutMs) };
		waiting.push(entry);
	});
}

await new Promise((resolve, reject) => {
	socket.once("open", resolve);
	socket.once("error", reject);
});
socket.send(hello());

const ready = await next((message) => message.type === "ready");
check(!!ready && ready.version === 1, "hello is answered with ready, version 1", JSON.stringify(ready));
check(received[0]?.type === "ready", "ready is the first message", received[0]?.type);

const stateMessage = await next((message) => message.type === "state");
const state = stateMessage?.state;
check(!!state && typeof state === "object", "state follows ready");
if (state) {
	for (const key of ["signedIn", "muted", "deafened", "streaming", "camera", "pushToTalkActive", "pushToMuteActive"]) {
		check(typeof state[key] === "boolean", `state.${key} is a boolean`, JSON.stringify(state[key]));
	}
	for (const key of ["unread", "mentions"]) {
		check(isId(state[key]), `state.${key} is a whole number, zero or more`, JSON.stringify(state[key]));
	}
	check("soundboard" in state, "state.soundboard is present (null when the soundboard cannot be used)");
	if (state.soundboard) {
		const soundboard = state.soundboard;
		check(isId(soundboard.serverId), "soundboard.serverId is a whole number");
		check(
			soundboard.playingSoundId === null || isId(soundboard.playingSoundId),
			"soundboard.playingSoundId is a whole number or null",
		);
		check(
			state.call?.status === "connected" && state.call.serverId === soundboard.serverId,
			"soundboard is only given in a connected call, and names the call's server",
		);
	}
	if (!state.signedIn) {
		const expected = {
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
		check(
			Object.entries(expected).every(([key, value]) => state[key] === value),
			"the signed-out state is exactly the one the protocol gives",
		);
	}
	check(state.inputMode === "voiceActivity" || state.inputMode === "pushToTalk", "state.inputMode is a known mode", state.inputMode);
	check("call" in state, "state.call is present (null when there is no call)");
	if (state.call) {
		const call = state.call;
		check(isId(call.channelId), "call.channelId is a whole number");
		check(typeof call.channelName === "string" && call.channelName.length > 0, "call.channelName is a name");
		check(call.serverId === null || isId(call.serverId), "call.serverId is a whole number or null");
		check(call.serverName === null || typeof call.serverName === "string", "call.serverName is a string or null");
		check(["connecting", "connected", "reconnecting"].includes(call.status), "call.status is a known status", call.status);
	}
	console.log(`      state: ${JSON.stringify(state)}`);
}

const channelsMessage = await next((message) => message.type === "channels");
const servers = channelsMessage?.servers;
check(Array.isArray(servers), "channels follows ready");
if (Array.isArray(servers)) {
	const sound = servers.every(
		(server) =>
			isId(server.id) &&
			typeof server.name === "string" &&
			Array.isArray(server.channels) &&
			server.channels.every(
				(channel) =>
					isId(channel.id) && typeof channel.name === "string" && (channel.category === null || typeof channel.category === "string"),
			),
	);
	check(sound, "every server and channel has an id, a name, and a category or null");
	const count = servers.reduce((total, server) => total + server.channels.length, 0);
	console.log(`      ${servers.length} server(s), ${count} voice channel(s)`);
	if (state?.signedIn && count === 0) console.log("      NOTE: signed in, but no voice channels are listed");
	if (!state?.signedIn) check(servers.length === 0, "no channels are listed while signed out");
}

const soundsMessage = await next((message) => message.type === "sounds");
const soundServers = soundsMessage?.servers;
check(Array.isArray(soundServers), "sounds follows ready");
{
	// by where each first appears: the state may change again before the lists have all arrived
	const first = (type) => received.findIndex((message) => message.type === type);
	check(
		first("state") >= 0 && first("state") < first("channels") && first("channels") < first("sounds"),
		"after ready come state, channels and sounds, in that order",
		received.slice(0, 5).map((message) => message.type).join(" "),
	);
}
/** every sound listed, as the server and id that name it */
const listedSounds = [];
if (Array.isArray(soundServers)) {
	const sound = soundServers.every(
		(server) =>
			isId(server.id) &&
			typeof server.name === "string" &&
			Array.isArray(server.sounds) &&
			server.sounds.every(
				(each) =>
					isId(each.id) &&
					typeof each.name === "string" &&
					each.name.length > 0 &&
					(each.emoji === null || (typeof each.emoji === "string" && each.emoji.length > 0 && each.emoji.length <= 32)) &&
					(each.category === null || typeof each.category === "string"),
			),
	);
	check(sound, "every sound has an id, a name, an emoji or null, and a category or null");
	let total = 0;
	let repeated = false;
	for (const server of soundServers) {
		const ids = new Set();
		for (const each of Array.isArray(server.sounds) ? server.sounds : []) {
			total++;
			if (ids.has(each.id)) repeated = true;
			ids.add(each.id);
			listedSounds.push({ serverId: server.id, soundId: each.id });
		}
	}
	check(!repeated, "a sound's id is unique within its server");
	check(
		new Set(soundServers.map((server) => server.id)).size === soundServers.length,
		"each server is listed once",
	);
	check(
		!soundServers.some((server) => server.sounds?.some((each) => typeof each.emoji === "string" && each.emoji.startsWith("custom:"))),
		"a custom emoji is reported as null",
	);
	console.log(`      ${soundServers.length} server(s), ${total} soundboard sound(s)`);
	if (!state?.signedIn) check(soundServers.length === 0, "no sounds are listed while signed out");
	if (Array.isArray(servers) && state?.signedIn) {
		check(
			soundServers.map((server) => server.id).join() === servers.map((server) => server.id).join(),
			"sounds lists the same servers as channels, in the same order",
		);
	}
}

// ---- commands that must be refused, and one that must not ----

let commandId = 0;
async function command(action, params = {}) {
	const id = ++commandId;
	socket.send(JSON.stringify({ type: "command", id, action, ...params }));
	return next((message) => message.type === "result" && message.id === id, 6000);
}
async function expectRefusal(what, action, params, ...codes) {
	const result = await command(action, params);
	check(
		!!result && result.ok === false && codes.includes(result.error),
		`${what} is refused with ${codes.join(" or ")}`,
		JSON.stringify(result),
	);
}

await expectRefusal("an unknown action", "noSuchAction", {}, "unknown_action");
await expectRefusal("a command with no action", undefined, {}, "invalid_request");
if (state?.signedIn) {
	await expectRefusal("setMute without a value", "setMute", {}, "invalid_request");
	await expectRefusal("setInputMode with a made-up mode", "setInputMode", { value: "shouting" }, "invalid_request");
	await expectRefusal("joinChannel without a channel", "joinChannel", {}, "invalid_request");
	await expectRefusal("joinChannel for a channel that is not listed", "joinChannel", { channelId: 2147483000 }, "unknown_channel", "forbidden");
	await expectRefusal("pushToTalk without pressed", "pushToTalk", {}, "invalid_request");
	await expectRefusal("setCamera without a value", "setCamera", {}, "invalid_request");
	await expectRefusal("playSound without a sound", "playSound", {}, "invalid_request");
	await expectRefusal("playSound with a sound but no server", "playSound", { soundId: 1 }, "invalid_request");
	await expectRefusal("playSound with a server but no sound", "playSound", { serverId: 1 }, "invalid_request");
	if (state.call?.status === "connected") {
		const unlisted = { serverId: state.call.serverId ?? 2147483000, soundId: 2147483000 };
		await expectRefusal("playSound for a sound that is not listed", "playSound", unlisted, "unknown_sound");
		await expectRefusal(
			"playSound for a server that is not listed",
			"playSound",
			{ serverId: 2147483000, soundId: listedSounds[0]?.soundId ?? 1 },
			"unknown_sound",
		);
		const elsewhere = listedSounds.find((each) => each.serverId !== state.call.serverId);
		if (elsewhere) {
			await expectRefusal("playSound for a sound of another server", "playSound", elsewhere, "wrong_server");
		} else console.log("      NOTE: no sound of another server is listed, so wrong_server was not checked");
	}
	if (!state.soundboard?.playingSoundId) {
		const stop = await command("stopSound");
		check(stop?.ok === true, "stopSound with nothing playing is accepted", JSON.stringify(stop));
	}
	if (!state.call) {
		await expectRefusal("setCamera outside a call", "setCamera", { value: true }, "not_in_call");
		await expectRefusal("playSound outside a call", "playSound", { serverId: 2147483000, soundId: 2147483000 }, "not_in_call");
		await expectRefusal("setMute outside a call", "setMute", { value: true }, "not_in_call");
		await expectRefusal("leaveCall outside a call", "leaveCall", {}, "not_in_call");
		await expectRefusal("holding push to talk outside a call", "pushToTalk", { pressed: true }, "not_in_call");
	} else {
		const wrong = state.inputMode === "pushToTalk" ? "pushToMute" : "pushToTalk";
		await expectRefusal(`holding ${wrong} in the other input mode`, wrong, { pressed: true }, "wrong_input_mode");
	}
	const release = await command("pushToTalk", { pressed: false });
	check(release?.ok === true, "releasing a hold that was never taken is accepted", JSON.stringify(release));
} else {
	await expectRefusal("a command while signed out", "setInputMode", { value: "toggle" }, "not_ready");
	await expectRefusal("openNotifications while signed out", "openNotifications", {}, "not_ready");
	await expectRefusal("stopSound while signed out", "stopSound", {}, "not_ready");
	await expectRefusal("releasing a hold while signed out", "pushToTalk", { pressed: false }, "not_ready");
	console.log("      NOTE: sign in to Refract and run this again for the remaining checks");
}

console.log("      waiting up to 20 s for a ping...");
for (let waited = 0; waited < 20000 && !pinged; waited += 250) await wait(250);
check(pinged, "the app pings its clients at least every 15 s");

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
if (watch) {
	console.log("Watching state. Ctrl+C to stop.");
} else {
	socket.close();
	process.exit(failures === 0 ? 0 : 1);
}
