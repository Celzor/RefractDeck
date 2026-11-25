import { action, type KeyDownEvent } from "@elgato/streamdeck";

import { refract } from "../refract";
import { desiredValue, RefractKey, type KeyView } from "./refract-key";

/** Stops or starts hearing the call, and shows which it is. */
@action({ UUID: "plugins.refract.chat.deafen" })
export class Deafen extends RefractKey {
	protected readonly image = "deafen";

	protected view(): KeyView {
		const { call, deafened } = refract.state;
		return { available: call !== null, state: deafened ? 1 : 0 };
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		await this.command(ev.action, "setDeafen", { value: desiredValue(ev.payload, refract.state.deafened) });
	}
}
