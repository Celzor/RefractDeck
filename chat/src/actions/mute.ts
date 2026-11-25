import { action, type KeyDownEvent } from "@elgato/streamdeck";

import { refract } from "../refract";
import { desiredValue, RefractKey, type KeyView } from "./refract-key";

/** Mutes or unmutes the microphone, and shows which it is. */
@action({ UUID: "plugins.refract.chat.mute" })
export class Mute extends RefractKey {
	protected readonly image = "mute";

	protected view(): KeyView {
		const { call, muted, pushToMuteActive } = refract.state;
		// The app reports muted while a call is still connecting, until its microphone is on. Shown, that would
		// flash the key red on every join, so the key waits for the call before it believes it.
		const joining = call?.status === "connecting";
		// as the call bar does, a held push to mute shows as muted
		return { available: call !== null, state: !joining && (muted || pushToMuteActive) ? 1 : 0 };
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		await this.command(ev.action, "setMute", { value: desiredValue(ev.payload, refract.state.muted) });
	}
}
