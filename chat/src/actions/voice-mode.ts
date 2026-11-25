import { action, type KeyDownEvent } from "@elgato/streamdeck";

import { refract } from "../refract";
import { desiredValue, RefractKey, type KeyView } from "./refract-key";

/** Switches the microphone between voice activity and push to talk, and shows which is in use. */
@action({ UUID: "plugins.refract.chat.voice-mode" })
export class VoiceMode extends RefractKey {
	protected readonly image = "voice-mode";

	protected view(): KeyView {
		const { signedIn, inputMode } = refract.state;
		// a setting rather than part of a call, so it can be changed before joining one
		return { available: signedIn, state: inputMode === "pushToTalk" ? 1 : 0 };
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		const pushToTalk = desiredValue(ev.payload, refract.state.inputMode === "pushToTalk");
		await this.command(ev.action, "setInputMode", { value: pushToTalk ? "pushToTalk" : "voiceActivity" });
	}
}
