import { action, type KeyDownEvent } from "@elgato/streamdeck";

import { refract } from "../refract";
import { RefractKey, type KeyView } from "./refract-key";

/** Leaves the call. */
@action({ UUID: "plugins.refract.chat.disconnect" })
export class Disconnect extends RefractKey {
	protected readonly image = "disconnect";

	protected view(): KeyView {
		return { available: refract.state.call !== null };
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		if (!refract.connected) return this.refuse(ev.action, "Disconnect was pressed while Refract is not connected");
		// with no call there is nothing to leave, which is what was asked for
		if (refract.state.call === null) return;
		await this.command(ev.action, "leaveCall", {});
	}
}
