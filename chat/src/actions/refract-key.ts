import streamDeck, {
	SingletonAction,
	type Action,
	type DidReceiveSettingsEvent,
	type KeyAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { UNAVAILABLE_IMAGES, type ActionImageName } from "../generated/images";
import { refract, RefractError, type RefractCommandName, type RefractCommands } from "../refract";

/** what a key should look like right now */
export type KeyView = {
	/** whether pressing it can do anything; when not, the key is dimmed */
	available: boolean;
	/** which of the manifest's two states to show; left out for a key with one */
	state?: 0 | 1;
	/** the title to show, or null for none; left out when the action never sets one */
	title?: string | null;
};

const logger = streamDeck.logger.createScope("Keys");

/**
 * A key that follows the Refract app. Each action says how it looks for the
 * app's current state (`view`), and this keeps every visible copy of it
 * showing that: on appearing, when its settings change, and whenever the app
 * reports a change.
 */
export abstract class RefractKey<TSettings extends JsonObject = JsonObject> extends SingletonAction<TSettings> {
	/** which key's images this action uses (scripts/generate-icons.mjs) */
	protected abstract readonly image: ActionImageName;

	/** the settings of each visible key, by its id */
	protected readonly settings = new Map<string, TSettings>();
	private readonly wanted = new Map<string, KeyView>();
	private readonly shown = new Map<string, KeyView>();
	private readonly drawing = new Set<string>();

	constructor() {
		super();
		refract.onChange(() => this.refresh());
	}

	/** how a key with these settings should look, given what the app last reported */
	protected abstract view(settings: TSettings): KeyView;

	override onWillAppear(ev: WillAppearEvent<TSettings>): Promise<void> {
		this.settings.set(ev.action.id, ev.payload.settings);
		// Stream Deck shows the key as the manifest has it, so everything is sent again
		this.shown.delete(ev.action.id);
		return this.draw(ev.action);
	}

	override onWillDisappear(ev: WillDisappearEvent<TSettings>): void {
		this.forget(ev.action.id);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<TSettings>): Promise<void> {
		this.settings.set(ev.action.id, ev.payload.settings);
		return this.draw(ev.action);
	}

	/** draw every visible copy of this action again */
	protected refresh(): void {
		for (const action of this.actions) void this.draw(action);
	}

	/** a key has gone from view; subclasses that track more per key clear it here */
	protected forget(id: string): void {
		this.settings.delete(id);
		this.wanted.delete(id);
		this.shown.delete(id);
	}

	/**
	 * Send a command for a key press, showing the alert triangle when the app
	 * refuses it or cannot be reached. Answers whether it was accepted.
	 */
	protected async command<TName extends RefractCommandName>(
		key: KeyAction<TSettings>,
		action: TName,
		params: RefractCommands[TName],
	): Promise<boolean> {
		try {
			await refract.send(action, params);
			return true;
		} catch (error) {
			const code = error instanceof RefractError ? error.code : "failed";
			logger.warn(`"${action}" was not done (${code}): ${error instanceof Error ? error.message : String(error)}`);
			await key.showAlert().catch(() => undefined);
			return false;
		}
	}

	/** show the alert triangle for a press that cannot do anything, and say why in the log */
	protected async refuse(key: KeyAction<TSettings>, why: string): Promise<void> {
		logger.warn(why);
		await key.showAlert().catch(() => undefined);
	}

	private async draw(action: Action<TSettings>): Promise<void> {
		// a key inside a multi-action has no face of its own to draw
		if (!action.isKey() || action.isInMultiAction()) return;
		const id = action.id;
		this.wanted.set(id, this.view(this.settings.get(id) ?? ({} as TSettings)));
		// one writer per key, so changes arriving together are applied in order and end on the latest
		if (this.drawing.has(id)) return;
		this.drawing.add(id);
		try {
			for (;;) {
				const want = this.wanted.get(id);
				if (!want) return;
				const shown = this.shown.get(id);
				if (shown && shown.available === want.available && shown.state === want.state && shown.title === want.title) {
					return;
				}
				if (!shown || shown.available !== want.available) {
					// no image hands the key back to the manifest's, or the one its owner chose
					await action.setImage(want.available ? undefined : UNAVAILABLE_IMAGES[this.image]);
				}
				if (want.state !== undefined && (!shown || shown.state !== want.state)) await action.setState(want.state);
				if (want.title !== undefined && (!shown || shown.title !== want.title)) {
					await action.setTitle(want.title ?? undefined);
				}
				this.shown.set(id, want);
			}
		} catch (error) {
			logger.warn(`Could not draw a key: ${String(error)}`);
		} finally {
			this.drawing.delete(id);
		}
	}
}

/**
 * What a press of a two-state key asks for: the state the multi-action was
 * told to reach, when it is in one, and otherwise the opposite of now.
 */
export function desiredValue(
	payload: { isInMultiAction: boolean; userDesiredState?: number },
	current: boolean,
): boolean {
	if (payload.isInMultiAction && typeof payload.userDesiredState === "number") return payload.userDesiredState === 1;
	return !current;
}
