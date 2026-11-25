import streamDeck from "@elgato/streamdeck";

import { Deafen } from "./actions/deafen";
import { Disconnect } from "./actions/disconnect";
import { JoinChannel } from "./actions/join-channel";
import { Camera } from "./actions/camera";
import { Mute } from "./actions/mute";
import { Notifications } from "./actions/notifications";
import { PushToMute } from "./actions/push-to-mute";
import { PushToTalk } from "./actions/push-to-talk";
import { Soundboard } from "./actions/soundboard";
import { Stream } from "./actions/stream";
import { VoiceMode } from "./actions/voice-mode";
import { refract } from "./refract";
import { channelItems, type JoinChannelSettings } from "./refract/channels";
import { soundItems, soundServerItems, type SoundboardSettings } from "./refract/sounds";

streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new JoinChannel());
streamDeck.actions.registerAction(new Disconnect());
streamDeck.actions.registerAction(new Stream());
streamDeck.actions.registerAction(new PushToTalk());
streamDeck.actions.registerAction(new PushToMute());
streamDeck.actions.registerAction(new Deafen());
streamDeck.actions.registerAction(new Mute());
streamDeck.actions.registerAction(new VoiceMode());
streamDeck.actions.registerAction(new Camera());
streamDeck.actions.registerAction(new Soundboard());
streamDeck.actions.registerAction(new Notifications());

// ---- the property inspectors ----
//
// They ask for these by name, and are told again whenever one changes:
// "getStatus", whether Refract is connected (every inspector shows it),
// "getChannels", the voice channels a Join Channel key can be set to, and
// "getSoundServers" and "getSounds", the servers a Soundboard key can be set
// to and the sounds of the one it is (the last three are sdpi-components' data
// sources for its <sdpi-select>).

const JOIN_CHANNEL = "plugins.refract.chat.join-channel";
const SOUNDBOARD = "plugins.refract.chat.soundboard";

/** what an inspector shows about the connection */
function status() {
	return {
		event: "status",
		connected: refract.connected,
		reason: refract.offlineReason,
		signedIn: refract.state.signedIn,
		appVersion: refract.appVersion,
		call: refract.state.call?.channelName ?? null,
	};
}

async function sendChannels(action: { manifestId: string; getSettings(): Promise<unknown> }): Promise<void> {
	if (action.manifestId !== JOIN_CHANNEL) return;
	const settings = ((await action.getSettings()) ?? {}) as JoinChannelSettings;
	await streamDeck.ui.sendToPropertyInspector({ event: "getChannels", items: channelItems(refract.servers, settings) });
}

/** one of a Soundboard key's two lists, or both when neither is named */
async function sendSounds(
	action: { manifestId: string; getSettings(): Promise<unknown> },
	only?: "getSoundServers" | "getSounds",
): Promise<void> {
	if (action.manifestId !== SOUNDBOARD) return;
	const settings = ((await action.getSettings()) ?? {}) as SoundboardSettings;
	if (only !== "getSounds") {
		await streamDeck.ui.sendToPropertyInspector({
			event: "getSoundServers",
			items: soundServerItems(refract.sounds, settings),
		});
	}
	if (only !== "getSoundServers") {
		await streamDeck.ui.sendToPropertyInspector({ event: "getSounds", items: soundItems(refract.sounds, settings) });
	}
}

streamDeck.ui.onSendToPlugin((ev) => {
	const payload = ev.payload;
	const event = payload && typeof payload === "object" && !Array.isArray(payload) ? payload.event : null;
	const done =
		event === "getStatus"
			? streamDeck.ui.sendToPropertyInspector(status())
			: event === "getChannels"
				? sendChannels(ev.action)
				: event === "getSoundServers" || event === "getSounds"
					? sendSounds(ev.action, event)
					: null;
	done?.catch((error) => streamDeck.logger.warn(`Could not answer the property inspector: ${String(error)}`));
});

// what the open inspector was last told, so it only hears of real changes: redrawing
// the channel list for every mute would shut a dropdown the user has open
let toldStatus = "";
let toldServers: unknown = null;
let toldSounds: unknown = null;

streamDeck.ui.onDidAppear(() => {
	// a newly opened inspector asks for everything itself, and must be told of the next change
	toldStatus = "";
	toldServers = null;
	toldSounds = null;
});

refract.onChange(() => {
	// only while an inspector is open; the SDK drops these otherwise, but there is no need to build them
	const open = streamDeck.ui.action;
	if (!open) return;
	const updates: Promise<void>[] = [];
	const now = status();
	if (JSON.stringify(now) !== toldStatus) {
		toldStatus = JSON.stringify(now);
		updates.push(streamDeck.ui.sendToPropertyInspector(now));
	}
	if (refract.servers !== toldServers) {
		toldServers = refract.servers;
		updates.push(sendChannels(open));
	}
	if (refract.sounds !== toldSounds) {
		toldSounds = refract.sounds;
		updates.push(sendSounds(open));
	}
	Promise.all(updates).catch((error) =>
		streamDeck.logger.warn(`Could not update the property inspector: ${String(error)}`),
	);
});

refract.start();
streamDeck.connect();
