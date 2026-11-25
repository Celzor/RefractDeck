/**
 * The soundboard sounds a Soundboard key can be set to: reading a key's
 * choice, finding it among the servers the app lists, and laying both out for
 * the key and its property inspector. Kept free of the Stream Deck SDK so it
 * can be tested on its own.
 *
 * A sound's id is only unique within its server, so a key remembers both: the
 * server is chosen first, and then one of that server's sounds.
 */
import type { RefractSound, RefractSoundServer } from "./protocol";

export type SoundboardSettings = {
	/** the server whose soundboard this key plays from, chosen first in the property inspector */
	serverId?: number | string;
	/** its name as it was when chosen, shown while the app is not there to ask */
	serverName?: string;
	/** the sound of that server this key plays */
	soundId?: number | string;
	/** its name as it was when chosen */
	soundName?: string;
	/** pressing the key while its sound is playing stops it, rather than starting it again */
	stopWhenPlaying?: boolean;
};

/** an id however the inspector saved it, or null */
function id(raw: number | string | undefined): number | null {
	const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** the server a key is set to, or null before one has been chosen */
export function chosenSoundServerId(settings: SoundboardSettings): number | null {
	return id(settings.serverId);
}

/** the sound a key is set to, with its server, or null until both have been chosen */
export function chosenSound(settings: SoundboardSettings): { serverId: number; soundId: number } | null {
	const serverId = id(settings.serverId);
	const soundId = id(settings.soundId);
	return serverId === null || soundId === null ? null : { serverId, soundId };
}

export function findSound(
	servers: readonly RefractSoundServer[],
	serverId: number,
	soundId: number,
): { server: RefractSoundServer; sound: RefractSound } | null {
	const server = servers.find((each) => each.id === serverId);
	const sound = server?.sounds.find((each) => each.id === soundId);
	return server && sound ? { server, sound } : null;
}

/**
 * A key's settings after its server was changed in the inspector: the sound
 * chosen under the old server is let go, because the same id under the new
 * server would be a different sound. Null when nothing needs letting go.
 */
export function withoutStaleSound(before: SoundboardSettings, now: SoundboardSettings): SoundboardSettings | null {
	if (id(before.serverId) === id(now.serverId)) return null;
	// a sound chosen together with the new server is kept
	if (id(now.soundId) === null || id(now.soundId) !== id(before.soundId)) return null;
	const { soundId: _soundId, soundName: _soundName, ...rest } = now;
	return rest;
}

/** a sound's name as the inspector's list shows it, with its emoji in front as in the app */
function label(sound: RefractSound): string {
	return sound.emoji ? `${sound.emoji} ${sound.name}` : sound.name;
}

/**
 * What a key remembers as its sound's name: the inspector saves the label it
 * showed, so the emoji in front of it is taken off again.
 */
export function savedSoundName(settings: SoundboardSettings, known?: RefractSound | null): string | null {
	if (known) return known.name;
	const saved = settings.soundName?.trim();
	if (!saved) return null;
	// an emoji is never letters or digits, and a sound's name may well start with either
	const [first, ...rest] = saved.split(" ");
	return rest.length > 0 && !/[\p{L}\p{N}]/u.test(first) ? rest.join(" ") : saved;
}

export type SoundItem = { value: number; label: string };

/**
 * The inspector's first list: the servers that have sounds. The server a key
 * is already set to is always offered, even while the app is closed or no
 * longer lists it, so opening the inspector never appears to lose the choice.
 */
export function soundServerItems(servers: readonly RefractSoundServer[], settings: SoundboardSettings): SoundItem[] {
	const items = servers
		.filter((server) => server.sounds.length > 0)
		.map((server) => ({ value: server.id, label: server.name }));
	const chosen = id(settings.serverId);
	if (chosen !== null && !items.some((item) => item.value === chosen)) {
		const listed = servers.find((server) => server.id === chosen);
		items.unshift({ value: chosen, label: listed?.name ?? (settings.serverName || `Server ${chosen}`) });
	}
	return items;
}

/**
 * The inspector's second list: the sounds of the server chosen in the first,
 * and none before one is. The sound a key is already set to is always offered.
 */
export function soundItems(servers: readonly RefractSoundServer[], settings: SoundboardSettings): SoundItem[] {
	const serverId = id(settings.serverId);
	if (serverId === null) return [];
	const server = servers.find((each) => each.id === serverId);
	const items = (server?.sounds ?? []).map((sound) => ({ value: sound.id, label: label(sound) }));
	const chosen = id(settings.soundId);
	if (chosen !== null && !items.some((item) => item.value === chosen)) {
		items.unshift({ value: chosen, label: settings.soundName || `Sound ${chosen}` });
	}
	return items;
}
