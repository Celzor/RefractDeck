import { action, type KeyDownEvent } from "@elgato/streamdeck";

import { refract } from "../refract";
import { chosenChannelId, findChannel, keyTitle, type JoinChannelSettings } from "../refract/channels";
import { RefractKey, type KeyView } from "./refract-key";

/**
 * Joins one voice channel, chosen from the servers the signed-in user is in.
 * The key shows the channel's name, and lights while the call is in it;
 * pressing it then leaves, unless it is set to stay connected.
 */
@action({ UUID: "plugins.refract.chat.join-channel" })
export class JoinChannel extends RefractKey<JoinChannelSettings> {
	protected readonly image = "join-channel";

	protected view(settings: JoinChannelSettings): KeyView {
		const channelId = chosenChannelId(settings);
		const { signedIn, call } = refract.state;
		const listed = channelId === null ? null : findChannel(refract.servers, channelId);
		const name = listed?.channel.name ?? (channelId === null ? null : settings.channelName || null);
		return {
			available: signedIn && channelId !== null,
			state: channelId !== null && call?.channelId === channelId ? 1 : 0,
			title: name ? keyTitle(name) : null,
		};
	}

	override async onKeyDown(ev: KeyDownEvent<JoinChannelSettings>): Promise<void> {
		const settings = ev.payload.settings;
		const channelId = chosenChannelId(settings);
		if (channelId === null) return this.refuse(ev.action, "Join Channel was pressed before a channel was chosen for it");

		if (refract.state.call?.channelId === channelId) {
			// in a multi-action the key means "be in this channel", never "leave it"
			if (settings.stayConnected || ev.payload.isInMultiAction) return;
			await this.command(ev.action, "leaveCall", {});
			return;
		}
		await this.command(ev.action, "joinChannel", { channelId });
	}
}
