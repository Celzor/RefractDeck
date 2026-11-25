import type { KeyDownEvent, KeyUpEvent } from "@elgato/streamdeck";

import { refract, type RefractState } from "../refract";
import { RefractKey, type KeyView } from "./refract-key";

/**
 * A key that does something for as long as it is held: push to talk, and push
 * to mute. The app is told when the first copy of the key goes down and when
 * the last comes up.
 *
 * A hold must never outlive the finger. So the release is sent when the key
 * comes up, and also when it leaves view while held (a page or profile change
 * mid-hold sends no key up). Should the connection drop instead, the app
 * releases every hold of a client that has gone, by itself.
 */
export abstract class HoldKey extends RefractKey {
	protected abstract readonly holdCommand: "pushToTalk" | "pushToMute";
	/** the input mode this key belongs to; the other mode has no use for it */
	protected abstract readonly mode: RefractState["inputMode"];
	/** whether the app reports the hold as active, by this key or by the keyboard */
	protected abstract active(state: RefractState): boolean;

	/** the keys held down right now, by id */
	private readonly held = new Set<string>();

	constructor() {
		super();
		refract.onChange(() => {
			// the app let go of everything this client held when the connection dropped
			if (refract.connected || this.held.size === 0) return;
			this.held.clear();
			this.refresh();
		});
	}

	protected view(): KeyView {
		const state = refract.state;
		const available = state.call !== null && state.inputMode === this.mode;
		// lit from the moment it goes down, without waiting for the app to say so
		return { available, state: this.active(state) || (available && this.held.size > 0) ? 1 : 0 };
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		const id = ev.action.id;
		if (this.held.has(id)) return;
		this.held.add(id);
		this.refresh();
		// another copy of the key is already holding it
		if (this.held.size > 1) return;
		if (await this.command(ev.action, this.holdCommand, { pressed: true })) return;
		// refused: nothing is held, whatever the finger is doing
		this.held.delete(id);
		this.refresh();
	}

	override onKeyUp(ev: KeyUpEvent): void {
		this.release(ev.action.id);
	}

	protected override forget(id: string): void {
		this.release(id);
		super.forget(id);
	}

	private release(id: string): void {
		if (!this.held.delete(id)) return;
		this.refresh();
		if (this.held.size > 0) return;
		// nothing to show if this fails: the app releases a hold whose client has gone
		void refract.send(this.holdCommand, { pressed: false }).catch(() => undefined);
	}
}
