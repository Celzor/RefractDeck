import streamDeck, { action, type DidReceiveSettingsEvent, type KeyDownEvent } from "@elgato/streamdeck";

import { refract } from "../refract";
import { keyTitle } from "../refract/channels";
import {
	chosenSound,
	findSound,
	savedSoundName,
	soundItems,
	withoutStaleSound,
	type SoundboardSettings,
} from "../refract/sounds";
import { RefractKey, type KeyView } from "./refract-key";

/**
 * Plays one soundboard sound into the call: a server is chosen for the key,
 * and then one of that server's sounds. The key shows the sound's name and
 * lights while it plays. It can be pressed while the call is in the sound's
 * server and the soundboard may be used there, as in the app.
 */
@action({ UUID: "plugins.refract.chat.soundboard" })
export class Soundboard extends RefractKey<SoundboardSettings> {
	protected readonly image = "soundboard";

	protected view(settings: SoundboardSettings): KeyView {
		const chosen = chosenSound(settings);
		const { soundboard } = refract.state;
		const listed = chosen && findSound(refract.sounds, chosen.serverId, chosen.soundId);
		const here = chosen !== null && soundboard?.serverId === chosen.serverId;
		const name = savedSoundName(settings, listed?.sound);
		return {
			available: !!listed && here,
			state: here && soundboard?.playingSoundId === chosen.soundId ? 1 : 0,
			title: chosen && name ? keyTitle(name) : null,
		};
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<SoundboardSettings>): Promise<void> {
		const before = this.settings.get(ev.action.id);
		const cleared = before ? withoutStaleSound(before, ev.payload.settings) : null;
		if (cleared) {
			// another server was chosen: the sound picked under the old one no longer means anything
			this.settings.set(ev.action.id, cleared);
			await ev.action.setSettings(cleared);
			this.refresh();
		} else {
			await super.onDidReceiveSettings(ev);
		}
		// the inspector's second list is the sounds of whichever server is now chosen
		if (streamDeck.ui.action?.id !== ev.action.id) return;
		const settings = this.settings.get(ev.action.id) ?? {};
		await streamDeck.ui
			.sendToPropertyInspector({ event: "getSounds", items: soundItems(refract.sounds, settings) })
			.catch(() => undefined);
	}

	override async onKeyDown(ev: KeyDownEvent<SoundboardSettings>): Promise<void> {
		const settings = ev.payload.settings;
		const chosen = chosenSound(settings);
		if (chosen === null) return this.refuse(ev.action, "Soundboard was pressed before a sound was chosen for it");

		// in a multi-action the key means "play this", never "stop it"
		const { soundboard } = refract.state;
		const playing = soundboard?.serverId === chosen.serverId && soundboard.playingSoundId === chosen.soundId;
		if (playing && settings.stopWhenPlaying && !ev.payload.isInMultiAction) {
			await this.command(ev.action, "stopSound", {});
			return;
		}
		await this.command(ev.action, "playSound", chosen);
	}
}
