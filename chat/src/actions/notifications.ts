import { action, type KeyDownEvent } from "@elgato/streamdeck";

import { refract } from "../refract";
import { RefractKey, type KeyView } from "./refract-key";

/** a count as a key has room for it */
const short = (count: number): string => (count > 99 ? "99+" : String(count));

/**
 * Shows how much is unread in Refract, mentions ahead of everything else, and
 * brings the app forward on its Activity page when pressed. Reading happens in
 * the app: the key only ever knows the two counts.
 */
@action({ UUID: "plugins.refract.chat.notifications" })
export class Notifications extends RefractKey {
	protected readonly image = "notifications";

	protected view(): KeyView {
		const { signedIn, unread, mentions } = refract.state;
		return {
			available: signedIn,
			state: unread > 0 || mentions > 0 ? 1 : 0,
			title: mentions > 0 ? `@${short(mentions)}` : unread > 0 ? short(unread) : null,
		};
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		await this.command(ev.action, "openNotifications", {});
	}
}
