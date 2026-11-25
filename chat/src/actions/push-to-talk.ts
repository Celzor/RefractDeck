import { action } from "@elgato/streamdeck";

import type { RefractState } from "../refract";
import { HoldKey } from "./hold-key";

/** Sends the microphone for as long as the key is held, while Refract is set to push to talk. */
@action({ UUID: "plugins.refract.chat.push-to-talk" })
export class PushToTalk extends HoldKey {
	protected readonly image = "push-to-talk";
	protected readonly holdCommand = "pushToTalk";
	protected readonly mode = "pushToTalk";

	protected active(state: RefractState): boolean {
		return state.pushToTalkActive;
	}
}
