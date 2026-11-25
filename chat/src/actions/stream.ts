import { action, type KeyDownEvent } from "@elgato/streamdeck";

import { refract } from "../refract";
import { desiredValue, RefractKey, type KeyView } from "./refract-key";

/**
 * Opens Refract's screen share dialog, and becomes "end stream" while a share
 * is running. Starting only brings Refract forward with that dialog open, as
 * its own hotkey does: what to share, and how, is chosen in the app's window,
 * never on the key.
 */
@action({ UUID: "plugins.refract.chat.stream" })
export class Stream extends RefractKey {
	protected readonly image = "stream";

	protected view(): KeyView {
		const { call, streaming } = refract.state;
		return { available: call !== null, state: streaming ? 1 : 0 };
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		await this.command(ev.action, "setStream", { value: desiredValue(ev.payload, refract.state.streaming) });
	}
}
