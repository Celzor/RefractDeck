import { action, type KeyDownEvent } from "@elgato/streamdeck";

import { refract } from "../refract";
import { desiredValue, RefractKey, type KeyView } from "./refract-key";

/** Turns the camera on or off, and shows which it is. */
@action({ UUID: "plugins.refract.chat.camera" })
export class Camera extends RefractKey {
	protected readonly image = "camera";

	protected view(): KeyView {
		const { call, camera } = refract.state;
		return { available: call !== null, state: camera ? 1 : 0 };
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		await this.command(ev.action, "setCamera", { value: desiredValue(ev.payload, refract.state.camera) });
	}
}
