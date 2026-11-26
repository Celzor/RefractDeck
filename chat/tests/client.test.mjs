/**
 * The plugin's connection to Refract, against the stand-in app
 * (tools/mock-refract.mjs), which follows docs/PROTOCOL.md.
 *
 *   npm test
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, afterEach, describe, test } from "node:test";

import WebSocket from "ws";

import {
	channelItems,
	chosenChannelId,
	chosenSound,
	chosenSoundServerId,
	discoveryPath,
	keyTitle,
	parseDiscovery,
	parseServerMessage,
	RefractClient,
	RefractError,
	savedSoundName,
	soundItems,
	soundServerItems,
	withoutStaleSound,
} from "../build/refract-core.js";
import { startMockRefract } from "../tools/mock-refract.mjs";

const folder = mkdtempSync(path.join(os.tmpdir(), "refractdeck-test-"));
after(() => rmSync(folder, { recursive: true, force: true }));

let fileNumber = 0;
const newFile = () => path.join(folder, `local-control-${++fileNumber}.json`);

/** wait until `check` holds, looking again after every change the client reports */
function until(client, check, what, timeoutMs = 4000) {
	return new Promise((resolve, reject) => {
		if (check()) return resolve();
		const timer = setTimeout(() => {
			stop();
			reject(new Error(`timed out waiting for ${what}`));
		}, timeoutMs);
		const stop = client.onChange(() => {
			if (!check()) return;
			clearTimeout(timer);
			stop();
			resolve();
		});
	});
}

const refused = (code) => (error) => error instanceof RefractError && error.code === code;

describe("with Refract running", () => {
	let mock;
	let client;

	beforeEach(async () => {
		const file = newFile();
		mock = await startMockRefract({ file, joinMs: 30, soundMs: 150 });
		client = new RefractClient({ discoveryFile: file, retryMs: 40, clientVersion: "test" });
		client.start();
		await until(
			client,
			() => client.connected && client.servers.length > 0 && client.sounds.length > 0,
			"the connection",
		);
	});

	/** join a channel and wait for the call to connect */
	async function join(channelId) {
		await client.send("joinChannel", { channelId });
		await until(client, () => client.state.call?.channelId === channelId && client.state.call.status === "connected", "the call");
	}

	afterEach(async () => {
		client.stop();
		await mock.stop();
	});

	test("reports the app's state and the channels that can be joined", () => {
		assert.equal(client.offlineReason, null);
		assert.equal(client.appVersion, "0.0.0-mock");
		assert.deepEqual(client.state, {
			signedIn: true,
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
		assert.deepEqual(
			client.sounds.map((server) => [server.name, server.sounds.map((sound) => sound.name)]),
			[
				["Refract HQ", ["Airhorn", "Sad Trombone", "Applause"]],
				["Friends", ["Ba Dum Tss"]],
			],
		);
		assert.deepEqual(client.sounds[0].sounds[0], { id: 1, name: "Airhorn", emoji: "📣", category: "Memes" });
		assert.deepEqual(
			client.servers.map((server) => [server.name, server.channels.map((channel) => channel.name)]),
			[
				["Refract HQ", ["General", "Gaming Lounge", "AFK"]],
				["Friends", ["Hangout"]],
			],
		);
	});

	test("joins a channel, and follows the call as it connects", async () => {
		const seen = [];
		const stop = client.onChange(() => client.state.call && seen.push(`${client.state.call.status} ${client.state.muted}`));
		await client.send("joinChannel", { channelId: 12 });
		await until(client, () => client.state.call?.status === "connected", "the call");
		stop();
		// the microphone counts as off until the call has connected, as the app reports it
		assert.deepEqual([...new Set(seen)], ["connecting true", "connected false"]);
		assert.deepEqual(client.state.call, {
			channelId: 12,
			channelName: "Gaming Lounge",
			serverId: 1,
			serverName: "Refract HQ",
			status: "connected",
		});
	});

	test("mutes, deafens, streams and leaves", async () => {
		await client.send("joinChannel", { channelId: 11 });
		await until(client, () => client.state.call?.status === "connected", "the call");

		await client.send("setMute", { value: true });
		await until(client, () => client.state.muted, "muted");
		await client.send("setMute", { value: "toggle" });
		await until(client, () => !client.state.muted, "unmuted");

		await client.send("setDeafen", { value: true });
		await until(client, () => client.state.deafened, "deafened");

		await client.send("setStream", { value: true });
		await until(client, () => client.state.streaming, "streaming");
		await client.send("setStream", { value: false });
		await until(client, () => !client.state.streaming, "the stream ending");

		await client.send("leaveCall", {});
		await until(client, () => client.state.call === null, "leaving");
	});

	test("turns the camera on and off, and a call that ends takes it with it", async () => {
		await assert.rejects(client.send("setCamera", { value: true }), refused("not_in_call"));
		await join(11);

		await client.send("setCamera", { value: true });
		await until(client, () => client.state.camera, "the camera");
		await client.send("setCamera", { value: true });
		assert.equal(client.state.camera, true);
		await client.send("setCamera", { value: "toggle" });
		await until(client, () => !client.state.camera, "the camera going off");

		await client.send("setCamera", { value: true });
		await until(client, () => client.state.camera, "the camera");
		await client.send("leaveCall", {});
		await until(client, () => client.state.call === null, "leaving");
		assert.equal(client.state.camera, false);
	});

	test("offers the soundboard of the call's server, once the call has connected", async () => {
		assert.equal(client.state.soundboard, null);
		await client.send("joinChannel", { channelId: 11 });
		await until(client, () => client.state.call?.status === "connecting", "the call starting");
		assert.equal(client.state.soundboard, null);
		await until(client, () => client.state.call?.status === "connected", "the call");
		assert.deepEqual(client.state.soundboard, { serverId: 1, playingSoundId: null });

		await join(21);
		assert.deepEqual(client.state.soundboard, { serverId: 2, playingSoundId: null });
	});

	test("plays a sound, shows it playing until it ends, and cuts it off with the next", async () => {
		await join(11);
		await client.send("playSound", { serverId: 1, soundId: 1 });
		await until(client, () => client.state.soundboard?.playingSoundId === 1, "the sound");
		await client.send("playSound", { serverId: 1, soundId: 2 });
		await until(client, () => client.state.soundboard?.playingSoundId === 2, "the next sound");
		await until(client, () => client.state.soundboard?.playingSoundId === null, "the sound ending");
	});

	test("stops a sound, and stopping with nothing playing is accepted", async () => {
		await client.send("stopSound", {});
		await join(11);
		await client.send("playSound", { serverId: 1, soundId: 3 });
		await until(client, () => client.state.soundboard?.playingSoundId === 3, "the sound");
		await client.send("stopSound", {});
		await until(client, () => client.state.soundboard?.playingSoundId === null, "the sound stopping");
		await client.send("stopSound", {});
	});

	test("a sound ends with its call", async () => {
		await join(11);
		await client.send("playSound", { serverId: 1, soundId: 1 });
		await until(client, () => client.state.soundboard?.playingSoundId === 1, "the sound");
		await join(21);
		assert.deepEqual(client.state.soundboard, { serverId: 2, playingSoundId: null });
	});

	test("two servers' sounds with the same id are told apart by their server", async () => {
		// the stand-in's two servers each have a sound 1
		await join(11);
		await assert.rejects(client.send("playSound", { serverId: 2, soundId: 1 }), refused("wrong_server"));
		await client.send("playSound", { serverId: 1, soundId: 1 });
		await until(client, () => client.state.soundboard?.playingSoundId === 1, "the first server's sound");

		await join(21);
		await assert.rejects(client.send("playSound", { serverId: 1, soundId: 1 }), refused("wrong_server"));
		await client.send("playSound", { serverId: 2, soundId: 1 });
		await until(
			client,
			() => client.state.soundboard?.serverId === 2 && client.state.soundboard.playingSoundId === 1,
			"the second server's sound",
		);
	});

	test("says why a sound was not played: no call, not listed, another server's, then not allowed", async () => {
		await assert.rejects(client.send("playSound", { serverId: 1, soundId: 1 }), refused("not_in_call"));
		await assert.rejects(client.send("playSound", { serverId: 1, soundId: 999 }), refused("not_in_call"));
		await assert.rejects(client.send("playSound", {}), refused("invalid_request"));
		await assert.rejects(client.send("playSound", { soundId: 1 }), refused("invalid_request"));
		await assert.rejects(client.send("playSound", { serverId: 1 }), refused("invalid_request"));

		await join(11);
		await assert.rejects(client.send("playSound", { serverId: 1, soundId: 999 }), refused("unknown_sound"));
		await assert.rejects(client.send("playSound", { serverId: 9, soundId: 1 }), refused("unknown_sound"));
		// a sound the first server has, but the second does not, asked for under the second
		await assert.rejects(client.send("playSound", { serverId: 2, soundId: 3 }), refused("unknown_sound"));
		await assert.rejects(client.send("playSound", { serverId: 2, soundId: 1 }), refused("wrong_server"));

		// the stand-in's AFK channel does not allow the soundboard
		await join(13);
		assert.equal(client.state.soundboard, null);
		await assert.rejects(client.send("playSound", { serverId: 2, soundId: 1 }), refused("wrong_server"));
		await assert.rejects(client.send("playSound", { serverId: 1, soundId: 1 }), refused("forbidden"));
	});

	test("follows a sound played in the app itself, and the app's list of sounds", async () => {
		await join(11);
		assert.equal(mock.playSound(2), true);
		await until(client, () => client.state.soundboard?.playingSoundId === 2, "the sound");

		mock.setSounds([{ id: 1, name: "Refract HQ", sounds: [{ id: 4, name: "New One", emoji: null, category: null }] }]);
		await until(client, () => client.sounds[0]?.sounds[0]?.id === 4, "the new list");
		await assert.rejects(client.send("playSound", { serverId: 1, soundId: 1 }), refused("unknown_sound"));
	});

	test("counts what is unread, and opens the newest unread conversation", async () => {
		mock.setState({ unread: 3, mentions: 1 });
		await until(client, () => client.state.unread === 3 && client.state.mentions === 1, "the counts");
		await client.send("openNotifications", {});
		// the key's counts change only when the app reports the conversation it opened as read
		assert.equal(client.state.unread, 3);
		mock.setState({ unread: 2, mentions: 0 });
		await until(client, () => client.state.unread === 2 && client.state.mentions === 0, "reading it");
	});

	test("follows changes made in the app itself", async () => {
		mock.setState({ inputMode: "pushToTalk" });
		await until(client, () => client.state.inputMode === "pushToTalk", "the input mode");
	});

	test("says why a command was refused", async () => {
		await assert.rejects(client.send("setMute", { value: true }), refused("not_in_call"));
		await assert.rejects(client.send("leaveCall", {}), refused("not_in_call"));
		await assert.rejects(client.send("joinChannel", { channelId: 999 }), refused("unknown_channel"));
		await assert.rejects(client.send("noSuchThing", {}), refused("unknown_action"));
	});

	test("holds push to talk only in its own input mode", async () => {
		await client.send("joinChannel", { channelId: 11 });
		await until(client, () => client.state.call?.status === "connected", "the call");

		await assert.rejects(client.send("pushToTalk", { pressed: true }), refused("wrong_input_mode"));

		await client.send("setInputMode", { value: "pushToTalk" });
		await client.send("pushToTalk", { pressed: true });
		await until(client, () => client.state.pushToTalkActive, "talking");
		await assert.rejects(client.send("pushToMute", { pressed: true }), refused("wrong_input_mode"));
		await client.send("pushToTalk", { pressed: false });
		await until(client, () => !client.state.pushToTalkActive, "letting go");

		await client.send("setInputMode", { value: "voiceActivity" });
		await client.send("pushToMute", { pressed: true });
		await until(client, () => client.state.pushToMuteActive, "the held mute");
		await client.send("pushToMute", { pressed: false });
		await until(client, () => !client.state.pushToMuteActive, "letting go");
	});

	test("a hold ends with its input mode, and with its call", async () => {
		await client.send("joinChannel", { channelId: 11 });
		await until(client, () => client.state.call?.status === "connected", "the call");
		await client.send("pushToMute", { pressed: true });
		await until(client, () => client.state.pushToMuteActive, "the held mute");
		await client.send("setInputMode", { value: "pushToTalk" });
		await until(client, () => client.state.inputMode === "pushToTalk", "the input mode");
		assert.equal(client.state.pushToMuteActive, false);

		await client.send("pushToTalk", { pressed: true });
		await until(client, () => client.state.pushToTalkActive, "talking");
		await client.send("leaveCall", {});
		await until(client, () => client.state.call === null, "leaving");
		assert.equal(client.state.pushToTalkActive, false);
	});

	test("a command is checked before the app's state is: unknown, then malformed, then signed out", async () => {
		mock.signOut();
		await until(client, () => !client.state.signedIn, "signing out");
		await assert.rejects(client.send("noSuchThing", {}), refused("unknown_action"));
		await assert.rejects(client.send("setMute", {}), refused("invalid_request"));
		await assert.rejects(client.send("setMute", { value: true }), refused("not_ready"));
		await assert.rejects(client.send("playSound", {}), refused("invalid_request"));
		await assert.rejects(client.send("playSound", { serverId: 1, soundId: 1 }), refused("not_ready"));
		await assert.rejects(client.send("stopSound", {}), refused("not_ready"));
		await assert.rejects(client.send("openNotifications", {}), refused("not_ready"));
		// letting go is refused too while signed out; nothing is held then
		await assert.rejects(client.send("pushToTalk", { pressed: false }), refused("not_ready"));
	});

	test("a command with no action is malformed, not unknown", async () => {
		const answer = (command) =>
			new Promise((resolve) => {
				const socket = new WebSocket(`ws://127.0.0.1:${mock.port}/`);
				socket.on("open", () => socket.send(JSON.stringify({ type: "hello", version: 1, token: mock.token })));
				socket.on("message", (data) => {
					const message = JSON.parse(data.toString());
					if (message.type === "ready") socket.send(JSON.stringify(command));
					if (message.type !== "result") return;
					socket.close();
					resolve(message.error);
				});
			});
		assert.equal(await answer({ type: "command", id: 1 }), "invalid_request");
		assert.equal(await answer({ type: "command", id: 1, action: 7 }), "invalid_request");
		assert.equal(await answer({ type: "command", id: 1, action: "noSuchThing" }), "unknown_action");
	});

	test("a hold is let go when its client disappears", async () => {
		await client.send("joinChannel", { channelId: 11 });
		await until(client, () => client.state.call?.status === "connected", "the call");
		await client.send("setInputMode", { value: "pushToTalk" });
		await client.send("pushToTalk", { pressed: true });
		await until(client, () => client.state.pushToTalkActive, "talking");

		client.stop();
		const deadline = Date.now() + 2000;
		while (mock.state.pushToTalkActive && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
		assert.equal(mock.state.pushToTalkActive, false);
	});

	test("goes offline when the app quits, and comes back when it starts again", async () => {
		await client.send("joinChannel", { channelId: 11 });
		await until(client, () => client.state.call !== null, "the call");
		const file = mock.file;

		await mock.stop();
		await until(client, () => !client.connected, "going offline");
		assert.equal(client.state.call, null);
		assert.deepEqual(client.servers, []);
		assert.deepEqual(client.sounds, []);
		await until(client, () => client.offlineReason === "not_found", "the missing file");
		await assert.rejects(client.send("setMute", { value: true }), refused("offline"));

		mock = await startMockRefract({ file, joinMs: 30 });
		await until(client, () => client.connected && client.servers.length > 0, "the new connection");
		assert.equal(client.state.signedIn, true);
	});

	test("shows nothing to control once signed out", async () => {
		mock.signOut();
		await until(
			client,
			() => !client.state.signedIn && client.servers.length === 0 && client.sounds.length === 0,
			"signing out",
		);
		assert.equal(client.connected, true);
		await assert.rejects(client.send("setInputMode", { value: "toggle" }), refused("not_ready"));
	});

	test("drops a connection that has gone silent", async () => {
		const quick = new RefractClient({ discoveryFile: mock.file, retryMs: 5000, silenceMs: 150 });
		quick.start();
		try {
			await until(quick, () => quick.connected, "the connection");
			mock.freeze();
			await until(quick, () => !quick.connected, "noticing the silence");
		} finally {
			quick.stop();
		}
	});

	test("fails a command the app never answers", async () => {
		const impatient = new RefractClient({ discoveryFile: mock.file, commandTimeoutMs: 80 });
		impatient.start();
		try {
			await until(impatient, () => impatient.connected, "the connection");
			mock.freeze();
			await assert.rejects(impatient.send("setInputMode", { value: "toggle" }), refused("timeout"));
		} finally {
			impatient.stop();
		}
	});

	test("the stand-in turns away a browser, a wrong token and a wrong version", async () => {
		const closeCode = (headers, hello) =>
			new Promise((resolve) => {
				const socket = new WebSocket(`ws://127.0.0.1:${mock.port}/`, { headers });
				socket.on("open", () => socket.send(JSON.stringify(hello)));
				socket.on("unexpected-response", (_request, response) => resolve(response.statusCode));
				socket.on("close", (code) => resolve(code));
				socket.on("error", () => {});
			});
		const hello = { type: "hello", version: 1, token: mock.token };
		assert.equal(await closeCode({ Origin: "https://example.com" }, hello), 403);
		assert.equal(await closeCode({}, { ...hello, token: "x".repeat(43) }), 4401);
		assert.equal(await closeCode({}, { ...hello, version: 2 }), 4400);
	});

	test("the stand-in keeps to 8 clients and 16 connections still to say hello, and the plugin gets in once there is room", async () => {
		client.stop();
		await until(client, () => !client.connected, "the plugin's own connection closing");
		const open = () =>
			new Promise((resolve) => {
				const socket = new WebSocket(`ws://127.0.0.1:${mock.port}/`);
				socket.on("open", () => resolve(socket));
				socket.on("unexpected-response", (_request, response) => resolve(response.statusCode));
				socket.on("error", () => {});
			});
		const closed = (socket) => new Promise((resolve) => socket.once("close", resolve));
		const hello = JSON.stringify({ type: "hello", version: 1, token: mock.token });

		// sixteen that say nothing fill every waiting place, and a seventeenth is turned away at the door
		const silent = await Promise.all(Array.from({ length: 16 }, open));
		assert.ok(silent.every((socket) => typeof socket !== "number"));
		assert.equal(await open(), 403);

		// eight of them say hello and are clients; the ninth hello finds no place left
		for (const socket of silent.slice(0, 8)) socket.send(hello);
		for (let waited = 0; waited < 2000 && mock.clientCount < 8; waited += 20) await new Promise((r) => setTimeout(r, 20));
		assert.equal(mock.clientCount, 8);
		const ninth = closed(silent[8]);
		silent[8].send(hello);
		assert.equal(await ninth, 1013);
		assert.equal(await open(), 403);

		// the plugin keeps trying, and is let in when a client leaves
		client.start();
		await new Promise((resolve) => setTimeout(resolve, 150));
		assert.equal(client.connected, false);
		assert.equal(client.offlineReason, "unreachable");
		for (const socket of silent) socket.terminate();
		await until(client, () => client.connected, "the plugin connecting once there is room");
	});
});

describe("without Refract", () => {
	test("is offline, and says the app was not found", async () => {
		const client = new RefractClient({ discoveryFile: newFile(), retryMs: 30 });
		client.start();
		try {
			await new Promise((resolve) => setTimeout(resolve, 120));
			assert.equal(client.connected, false);
			assert.equal(client.offlineReason, "not_found");
			assert.equal(client.state.signedIn, false);
			await assert.rejects(client.send("setMute", { value: true }), refused("offline"));
		} finally {
			client.stop();
		}
	});

	test("a file left behind by an app that has gone is unreachable, not a crash", async () => {
		const file = newFile();
		const mock = await startMockRefract({ file });
		await mock.stop({ keepFile: true });
		const client = new RefractClient({ discoveryFile: file, retryMs: 30 });
		client.start();
		try {
			await until(client, () => client.offlineReason === "unreachable", "the dead port");
			assert.equal(client.connected, false);
		} finally {
			client.stop();
			rmSync(file, { force: true });
		}
	});

	test("a stale token is refused, and the file is read again for the next try", async () => {
		const file = newFile();
		const mock = await startMockRefract({ file });
		writeFileSync(file, JSON.stringify({ version: 1, port: mock.port, token: "y".repeat(43), pid: 1 }));
		const client = new RefractClient({ discoveryFile: file, retryMs: 30 });
		client.start();
		try {
			await until(client, () => client.offlineReason === "rejected", "the refusal");
			writeFileSync(file, JSON.stringify({ version: 1, port: mock.port, token: mock.token, pid: 1 }));
			await until(client, () => client.connected, "the connection");
		} finally {
			client.stop();
			await mock.stop();
		}
	});

	test("a file from a newer protocol is incompatible", async () => {
		const file = newFile();
		writeFileSync(file, JSON.stringify({ version: 2, port: 1234, token: "z".repeat(43) }));
		const client = new RefractClient({ discoveryFile: file, retryMs: 30 });
		client.start();
		try {
			await until(client, () => client.offlineReason === "incompatible", "the version check");
		} finally {
			client.stop();
		}
	});
});

describe("the discovery file", () => {
	test("is in the user's application data folder on each system", () => {
		assert.equal(
			discoveryPath("win32", { APPDATA: "C:\\Users\\me\\AppData\\Roaming" }, "C:\\Users\\me"),
			path.join("C:\\Users\\me\\AppData\\Roaming", "Refract.Chat", "local-control.json"),
		);
		assert.equal(
			discoveryPath("darwin", {}, "/Users/me"),
			path.join("/Users/me", "Library", "Application Support", "Refract.Chat", "local-control.json"),
		);
		assert.equal(
			discoveryPath("linux", { XDG_CONFIG_HOME: "/cfg" }, "/home/me"),
			path.join("/cfg", "Refract.Chat", "local-control.json"),
		);
		assert.equal(
			discoveryPath("linux", {}, "/home/me"),
			path.join("/home/me", ".config", "Refract.Chat", "local-control.json"),
		);
	});

	test("is checked before it is believed", () => {
		const token = "a".repeat(43);
		assert.deepEqual(parseDiscovery(JSON.stringify({ version: 1, port: 5000, token, pid: 9 })), { port: 5000, token });
		assert.equal(parseDiscovery("not json"), "invalid");
		assert.equal(parseDiscovery("null"), "invalid");
		assert.equal(parseDiscovery(JSON.stringify({ version: 3, port: 5000, token })), "incompatible");
		assert.equal(parseDiscovery(JSON.stringify({ version: 1, port: 0, token })), "invalid");
		assert.equal(parseDiscovery(JSON.stringify({ version: 1, port: 70000, token })), "invalid");
		assert.equal(parseDiscovery(JSON.stringify({ version: 1, port: 5000, token: "short" })), "invalid");
		assert.equal(parseDiscovery(JSON.stringify({ version: 1, port: 5000, token: `${token}/../x` })), "invalid");
	});
});

describe("messages from the app", () => {
	test("anything malformed is ignored or put right", () => {
		assert.equal(parseServerMessage("{"), null);
		assert.equal(parseServerMessage("[]"), null);
		assert.equal(parseServerMessage(JSON.stringify({ type: "mystery" })), null);
		assert.equal(parseServerMessage(JSON.stringify({ type: "state" })), null);
		assert.equal(parseServerMessage(JSON.stringify({ type: "result", id: "1", ok: true })), null);

		const state = parseServerMessage(
			JSON.stringify({ type: "state", state: { signedIn: 1, muted: "yes", inputMode: "shouting", call: { channelId: "7" } } }),
		);
		assert.deepEqual(state.state, {
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

		// an app from before these fields were added is still a state, with nothing in them
		const counts = parseServerMessage(
			JSON.stringify({
				type: "state",
				state: { camera: "on", unread: -4, mentions: 2.5, soundboard: { serverId: 1, playingSoundId: "x" } },
			}),
		);
		assert.equal(counts.state.camera, false);
		assert.equal(counts.state.unread, 0);
		assert.equal(counts.state.mentions, 0);
		assert.deepEqual(counts.state.soundboard, { serverId: 1, playingSoundId: null });
		assert.equal(parseServerMessage(JSON.stringify({ type: "state", state: { soundboard: {} } })).state.soundboard, null);

		assert.equal(parseServerMessage(JSON.stringify({ type: "sounds" })), null);
		const sounds = parseServerMessage(
			JSON.stringify({
				type: "sounds",
				servers: [
					{
						id: 1,
						name: " Home ",
						sounds: [
							{ id: 2, name: "", emoji: " 📣 " },
							{ id: 3, name: "Horn", emoji: "x".repeat(40), category: " Loud " },
							{ id: "x" },
							null,
						],
					},
					{ name: "no id" },
					5,
				],
			}),
		);
		assert.deepEqual(sounds.servers, [
			{
				id: 1,
				name: "Home",
				sounds: [
					{ id: 2, name: "Sound 2", emoji: "📣", category: null },
					{ id: 3, name: "Horn", emoji: null, category: "Loud" },
				],
			},
		]);

		const unknown = parseServerMessage(JSON.stringify({ type: "result", id: 5, ok: false, error: "wrong_server" }));
		assert.equal(unknown.error, "wrong_server");

		const channels = parseServerMessage(
			JSON.stringify({
				type: "channels",
				servers: [{ id: 1, name: " Home ", channels: [{ id: 2, name: "" }, { id: "x" }, null] }, { name: "no id" }, 5],
			}),
		);
		assert.deepEqual(channels.servers, [{ id: 1, name: "Home", channels: [{ id: 2, name: "Channel 2", category: null }] }]);

		const result = parseServerMessage(JSON.stringify({ type: "result", id: 4, ok: false, error: "made_up" }));
		assert.deepEqual(result, { type: "result", id: 4, ok: false, error: "failed", message: null });
	});
});

describe("a Soundboard key", () => {
	// both servers have a sound 7
	const servers = [
		{
			id: 1,
			name: "Home",
			sounds: [
				{ id: 7, name: "Airhorn", emoji: "📣", category: null },
				{ id: 8, name: "Applause", emoji: null, category: null },
			],
		},
		{ id: 2, name: "Quiet", sounds: [] },
		{ id: 3, name: "Away", sounds: [{ id: 7, name: "Gong", emoji: "🔔", category: null }] },
	];

	test("reads its server and sound however the inspector saved them, and needs both", () => {
		assert.equal(chosenSound({}), null);
		assert.equal(chosenSound({ soundId: 7 }), null);
		assert.equal(chosenSound({ serverId: 1 }), null);
		assert.deepEqual(chosenSound({ serverId: 1, soundId: 7 }), { serverId: 1, soundId: 7 });
		assert.deepEqual(chosenSound({ serverId: "3", soundId: "7" }), { serverId: 3, soundId: 7 });
		assert.equal(chosenSound({ serverId: "", soundId: 7 }), null);
		assert.equal(chosenSound({ serverId: 1, soundId: -1 }), null);
		assert.equal(chosenSoundServerId({ serverId: "3" }), 3);
		assert.equal(chosenSoundServerId({}), null);
	});

	test("lists the servers that have sounds, then the sounds of the one chosen", () => {
		assert.deepEqual(soundServerItems(servers, {}), [
			{ value: 1, label: "Home" },
			{ value: 3, label: "Away" },
		]);
		assert.deepEqual(soundItems(servers, {}), []);
		assert.deepEqual(soundItems(servers, { serverId: 1 }), [
			{ value: 7, label: "📣 Airhorn" },
			{ value: 8, label: "Applause" },
		]);
		// the same id is another sound in another server
		assert.deepEqual(soundItems(servers, { serverId: 3 }), [{ value: 7, label: "🔔 Gong" }]);
	});

	test("keeps offering its server and sound while the app does not list them", () => {
		const settings = { serverId: 1, serverName: "Home", soundId: 7, soundName: "📣 Airhorn" };
		assert.deepEqual(soundServerItems([], settings), [{ value: 1, label: "Home" }]);
		assert.deepEqual(soundItems([], settings), [{ value: 7, label: "📣 Airhorn" }]);
		assert.deepEqual(soundServerItems([], { serverId: 1 }), [{ value: 1, label: "Server 1" }]);
		assert.deepEqual(soundItems([], { serverId: 1, soundId: 7 }), [{ value: 7, label: "Sound 7" }]);
		// a server whose sounds have all gone is still the one chosen
		assert.deepEqual(soundServerItems(servers, { serverId: 2 })[0], { value: 2, label: "Quiet" });
		assert.equal(soundServerItems(servers, settings).length, 2);
		assert.equal(soundItems(servers, settings).length, 2);
	});

	test("lets go of its sound when another server is chosen, and only then", () => {
		const before = { serverId: 1, serverName: "Home", soundId: 7, soundName: "📣 Airhorn", stopWhenPlaying: true };
		assert.deepEqual(withoutStaleSound(before, { ...before, serverId: 3, serverName: "Away" }), {
			serverId: 3,
			serverName: "Away",
			stopWhenPlaying: true,
		});
		// the same server, a new sound, or a sound chosen along with the server: nothing to let go
		assert.equal(withoutStaleSound(before, { ...before, stopWhenPlaying: false }), null);
		assert.equal(withoutStaleSound(before, { ...before, soundId: 8, soundName: "Applause" }), null);
		assert.equal(withoutStaleSound(before, { ...before, serverId: 3, soundId: 9 }), null);
		assert.equal(withoutStaleSound({ serverId: 1 }, { serverId: 3 }), null);
		assert.equal(withoutStaleSound(before, { ...before, serverId: "1" }), null);
	});

	test("shows the sound's name without the emoji the inspector saved in front of it", () => {
		assert.equal(savedSoundName({ soundName: "📣 Airhorn" }), "Airhorn");
		assert.equal(savedSoundName({ soundName: "Sad Trombone" }), "Sad Trombone");
		assert.equal(savedSoundName({ soundName: "2 Fast" }), "2 Fast");
		assert.equal(savedSoundName({ soundName: "📣" }), "📣");
		assert.equal(savedSoundName({ soundName: "  " }), null);
		assert.equal(savedSoundName({}), null);
		assert.equal(savedSoundName({ soundName: "📣 Old Name" }, servers[0].sounds[0]), "Airhorn");
	});
});

describe("a Join Channel key", () => {
	const servers = [
		{ id: 1, name: "Home", channels: [{ id: 11, name: "General", category: null }] },
		{ id: 2, name: "Empty", channels: [] },
	];

	test("reads its chosen channel however the inspector saved it", () => {
		assert.equal(chosenChannelId({}), null);
		assert.equal(chosenChannelId({ channelId: 11 }), 11);
		assert.equal(chosenChannelId({ channelId: "11" }), 11);
		assert.equal(chosenChannelId({ channelId: "" }), null);
		assert.equal(chosenChannelId({ channelId: "abc" }), null);
		assert.equal(chosenChannelId({ channelId: -1 }), null);
		assert.equal(chosenChannelId({ channelId: 1.5 }), null);
	});

	test("lists channels by server, leaving out servers with none", () => {
		assert.deepEqual(channelItems(servers, {}), [{ label: "Home", children: [{ value: 11, label: "General" }] }]);
	});

	test("keeps offering its channel while the app does not list it", () => {
		assert.deepEqual(channelItems([], { channelId: 11, channelName: "General" }), [{ value: 11, label: "General" }]);
		assert.deepEqual(channelItems([], { channelId: 11 }), [{ value: 11, label: "Channel 11" }]);
		assert.equal(channelItems(servers, { channelId: 11, channelName: "General" }).length, 1);
	});

	test("fits a channel's name on the key", () => {
		assert.equal(keyTitle("General"), "General");
		assert.equal(keyTitle("Gaming Lounge"), "Gaming\nLounge");
		assert.equal(keyTitle("AFK a b"), "AFK a b");
		assert.equal(keyTitle("Supercalifragilistic"), "Supercali…");
		assert.equal(keyTitle("The Very Long Channel Name Here"), "The Very\nLong Chan…");
		assert.equal(keyTitle("  "), "");
	});
});
