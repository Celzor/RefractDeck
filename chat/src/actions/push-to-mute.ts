import { action } from "@elgato/streamdeck";

import type { RefractState } from "../refract";
import { HoldKey } from "./hold-key";

/** Silences the microphone for as long as the key is held, while Refract is set to voice activity. */
@action({ UUID: "plugins.refract.chat.push-to-mute" })
export class PushToMute extends HoldKey {
	protected readonly image = "push-to-mute";
	protected readonly holdCommand = "pushToMute";
	protected readonly mode = "voiceActivity";

	protected active(state: RefractState): boolean {
		return state.pushToMuteActive;
	}
}
