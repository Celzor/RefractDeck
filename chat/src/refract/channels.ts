/**
 * The voice channels a Join Channel key can be set to: reading a key's choice,
 * finding it among the servers the app lists, and laying both out for the key
 * and its property inspector. Kept free of the Stream Deck SDK so it can be
 * tested on its own.
 */
import type { RefractChannel, RefractServer } from "./protocol";

export type JoinChannelSettings = {
	/** the voice channel this key joins, chosen in the property inspector */
	channelId?: number | string;
	/** its name as it was when chosen, shown while the app is not there to ask */
	channelName?: string;
	/** pressing the key while already in the channel leaves the call, unless this is on */
	stayConnected?: boolean;
};

/** the channel a key is set to, or null before one has been chosen */
export function chosenChannelId(settings: JoinChannelSettings): number | null {
	const raw = settings.channelId;
	const id = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
	return typeof id === "number" && Number.isSafeInteger(id) && id >= 0 ? id : null;
}

export function findChannel(
	servers: readonly RefractServer[],
	channelId: number,
): { server: RefractServer; channel: RefractChannel } | null {
	for (const server of servers) {
		const channel = server.channels.find((each) => each.id === channelId);
		if (channel) return { server, channel };
	}
	return null;
}

/** a name broken over at most two short lines, as much as a key's title has room for */
export function keyTitle(name: string): string {
	const LINE = 10;
	const clip = (line: string) => (line.length > LINE ? `${line.slice(0, LINE - 1)}…` : line);
	const words = name.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return "";
	// as many whole words as fit on the first line; whatever is left shares the second
	let first = words[0];
	let next = 1;
	while (next < words.length && `${first} ${words[next]}`.length <= LINE) first += ` ${words[next++]}`;
	const rest = words.slice(next).join(" ");
	return rest ? `${clip(first)}\n${clip(rest)}` : clip(first);
}

export type ChannelItem = { value: number; label: string };
export type ChannelItems = (ChannelItem | { label: string; children: ChannelItem[] })[];

/**
 * The property inspector's list of channels: each server, with its voice
 * channels beneath. The channel a key is already set to is always offered,
 * even while the app is closed or no longer lists it, so opening the
 * inspector never appears to lose the choice.
 */
export function channelItems(servers: readonly RefractServer[], settings: JoinChannelSettings): ChannelItems {
	const items: ChannelItems = servers
		.filter((server) => server.channels.length > 0)
		.map((server) => ({
			label: server.name,
			children: server.channels.map((channel) => ({ value: channel.id, label: channel.name })),
		}));
	const chosen = chosenChannelId(settings);
	if (chosen !== null && !findChannel(servers, chosen)) {
		items.unshift({ value: chosen, label: settings.channelName || `Channel ${chosen}` });
	}
	return items;
}
