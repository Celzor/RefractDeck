/**
 * The connection to the Refract desktop app's local control socket.
 *
 * It looks for the app (discovery.ts), connects, and keeps the call's state as
 * the app reports it. When the app goes away it falls back to the offline
 * state and keeps looking, so keys recover by themselves when Refract starts,
 * restarts, or has local control switched on.
 *
 * Kept free of the Stream Deck SDK so it can be tested on its own.
 */
import WebSocket from "ws";

import { discoveryPath, readDiscovery, type Discovery, type DiscoveryFailure } from "./discovery";
import {
	OFFLINE_STATE,
	PROTOCOL_VERSION,
	RefractError,
	parseServerMessage,
	type RefractCommandName,
	type RefractCommands,
	type RefractServer,
	type RefractSoundServer,
	type RefractState,
} from "./protocol";

/**
 * Why the app is not connected: no discovery file (not running, or local
 * control off), a file this version cannot use, nothing answering at the port
 * it names, or the app refusing the token.
 */
export type OfflineReason = DiscoveryFailure | "unreachable" | "rejected";

export type ClientLogger = {
	debug(message: string): void;
	info(message: string): void;
	warn(message: string): void;
};

export type RefractClientOptions = {
	/** where the app writes its port and token; the real location unless a test says otherwise */
	discoveryFile?: string;
	/** how long to wait before looking for the app again */
	retryMs?: number;
	/** how long a command may go unanswered */
	commandTimeoutMs?: number;
	/** how long the app may be silent before the connection is taken for dead; it pings every 15 s */
	silenceMs?: number;
	clientVersion?: string;
	logger?: ClientLogger;
};

type Pending = { resolve: () => void; reject: (error: RefractError) => void; timer: NodeJS.Timeout };

const HANDSHAKE_TIMEOUT_MS = 3000;
const READY_TIMEOUT_MS = 5000;
/** close codes the app uses to say why it hung up */
const CLOSE_BAD_REQUEST = 4400;
const CLOSE_UNAUTHORIZED = 4401;

export class RefractClient {
	private readonly file: string;
	private readonly retryMs: number;
	private readonly commandTimeoutMs: number;
	private readonly silenceMs: number;
	private readonly clientVersion: string;
	private readonly logger: ClientLogger | undefined;

	private started = false;
	private looking = false;
	private socket: WebSocket | null = null;
	private retryTimer: NodeJS.Timeout | null = null;
	private silenceTimer: NodeJS.Timeout | null = null;
	private lastHeard = 0;
	private nextId = 1;
	private readonly pending = new Map<number, Pending>();
	private readonly listeners = new Set<() => void>();

	private isConnected = false;
	private reason: OfflineReason = "not_found";
	private currentState: RefractState = OFFLINE_STATE;
	private currentServers: readonly RefractServer[] = [];
	private currentSounds: readonly RefractSoundServer[] = [];
	private currentAppVersion: string | null = null;

	constructor(options: RefractClientOptions = {}) {
		this.file = options.discoveryFile ?? discoveryPath();
		this.retryMs = options.retryMs ?? 2000;
		this.commandTimeoutMs = options.commandTimeoutMs ?? 6000;
		this.silenceMs = options.silenceMs ?? 45000;
		this.clientVersion = options.clientVersion ?? "0.0.0";
		this.logger = options.logger;
	}

	/** the app has accepted this client and is reporting its state */
	get connected(): boolean {
		return this.isConnected;
	}

	/** why not, while it is not connected */
	get offlineReason(): OfflineReason | null {
		return this.isConnected ? null : this.reason;
	}

	/** the call as the app last reported it; the offline state while not connected */
	get state(): RefractState {
		return this.currentState;
	}

	/** the servers and their voice channels the signed-in user can join; none while not connected */
	get servers(): readonly RefractServer[] {
		return this.currentServers;
	}

	/** the same servers with their soundboard sounds; none while not connected */
	get sounds(): readonly RefractSoundServer[] {
		return this.currentSounds;
	}

	get appVersion(): string | null {
		return this.currentAppVersion;
	}

	/** hear every change to anything above; returns how to stop */
	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => void this.listeners.delete(listener);
	}

	/** start looking for the app, and keep looking */
	start(): void {
		if (this.started) return;
		this.started = true;
		void this.look();
	}

	stop(): void {
		this.started = false;
		if (this.retryTimer) clearTimeout(this.retryTimer);
		this.retryTimer = null;
		this.socket?.terminate();
	}

	/**
	 * Ask the app to do something. Resolves once it has accepted the command -
	 * what follows (a call connecting, a stream starting) arrives as state.
	 * Rejects with a RefractError naming why it was refused.
	 */
	send<TName extends RefractCommandName>(action: TName, params: RefractCommands[TName]): Promise<void> {
		const socket = this.socket;
		if (!this.isConnected || !socket || socket.readyState !== WebSocket.OPEN) {
			return Promise.reject(new RefractError("offline", "Refract is not connected"));
		}
		const id = this.nextId++;
		return new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new RefractError("timeout", `Refract did not answer "${action}"`));
			}, this.commandTimeoutMs);
			this.pending.set(id, { resolve, reject, timer });
			socket.send(JSON.stringify({ type: "command", id, action, ...params }), (error) => {
				if (!error) return;
				clearTimeout(timer);
				if (this.pending.delete(id)) reject(new RefractError("disconnected", error.message));
			});
		});
	}

	private emit(): void {
		for (const listener of [...this.listeners]) {
			try {
				listener();
			} catch (error) {
				this.logger?.warn(`A change listener failed: ${String(error)}`);
			}
		}
	}

	private scheduleLook(): void {
		if (!this.started || this.retryTimer) return;
		this.retryTimer = setTimeout(() => {
			this.retryTimer = null;
			void this.look();
		}, this.retryMs);
	}

	private async look(): Promise<void> {
		if (!this.started || this.socket || this.looking) return;
		this.looking = true;
		let found: Discovery | DiscoveryFailure;
		try {
			found = await readDiscovery(this.file);
		} finally {
			this.looking = false;
		}
		if (!this.started || this.socket) return;
		if (typeof found === "string") {
			this.goOffline(found);
			this.scheduleLook();
			return;
		}
		this.open(found);
	}

	private open(found: Discovery): void {
		// always this computer, whatever the file says: the token never goes anywhere else
		const socket = new WebSocket(`ws://127.0.0.1:${found.port}/`, {
			handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
			perMessageDeflate: false,
			followRedirects: false,
			// room for the longest lists the protocol allows
			maxPayload: 8 * 1024 * 1024,
		});
		this.socket = socket;
		let ready = false;
		let refusal: OfflineReason | null = null;
		const readyTimer = setTimeout(() => socket.terminate(), HANDSHAKE_TIMEOUT_MS + READY_TIMEOUT_MS);

		socket.on("open", () => {
			socket.send(
				JSON.stringify({
					type: "hello",
					version: PROTOCOL_VERSION,
					token: found.token,
					client: { name: "RefractDeck", version: this.clientVersion },
				}),
			);
		});

		socket.on("ping", () => {
			this.lastHeard = Date.now();
		});

		socket.on("message", (data, isBinary) => {
			if (isBinary || this.socket !== socket) return;
			this.lastHeard = Date.now();
			const message = parseServerMessage(data.toString());
			if (!message) return;

			if (message.type === "ready") {
				if (ready) return;
				if (message.version !== PROTOCOL_VERSION) {
					refusal = "incompatible";
					socket.close();
					return;
				}
				ready = true;
				clearTimeout(readyTimer);
				this.isConnected = true;
				this.currentAppVersion = message.appVersion;
				this.watchForSilence(socket);
				this.logger?.info(`Connected to Refract${message.appVersion ? ` ${message.appVersion}` : ""}`);
				this.emit();
				return;
			}
			// nothing is believed until the app has accepted this client
			if (!ready) return;

			if (message.type === "state") {
				this.currentState = message.state;
				this.emit();
			} else if (message.type === "channels") {
				this.currentServers = message.servers;
				this.emit();
			} else if (message.type === "sounds") {
				this.currentSounds = message.servers;
				this.emit();
			} else {
				const waiting = this.pending.get(message.id);
				if (!waiting) return;
				this.pending.delete(message.id);
				clearTimeout(waiting.timer);
				if (message.ok) waiting.resolve();
				else waiting.reject(new RefractError(message.error, message.message ?? undefined));
			}
		});

		socket.on("error", (error) => {
			// "close" always follows, and is where the connection is given up
			this.logger?.debug(`Refract socket error: ${error.message}`);
		});

		socket.on("close", (code) => {
			clearTimeout(readyTimer);
			if (this.socket !== socket) return;
			this.socket = null;
			if (this.silenceTimer) clearInterval(this.silenceTimer);
			this.silenceTimer = null;
			for (const [id, waiting] of this.pending) {
				clearTimeout(waiting.timer);
				waiting.reject(new RefractError("disconnected", "Refract disconnected"));
				this.pending.delete(id);
			}
			const why: OfflineReason =
				refusal ?? (code === CLOSE_UNAUTHORIZED ? "rejected" : code === CLOSE_BAD_REQUEST ? "incompatible" : "unreachable");
			this.goOffline(why);
			this.scheduleLook();
		});
	}

	/** a connection that has gone quiet (the computer slept, the app froze) is dropped, and looked for again */
	private watchForSilence(socket: WebSocket): void {
		this.lastHeard = Date.now();
		if (this.silenceTimer) clearInterval(this.silenceTimer);
		this.silenceTimer = setInterval(
			() => {
				if (Date.now() - this.lastHeard > this.silenceMs) socket.terminate();
			},
			Math.max(250, Math.min(10000, this.silenceMs / 3)),
		);
	}

	private goOffline(reason: OfflineReason): void {
		const changed = this.isConnected || this.reason !== reason;
		const wasConnected = this.isConnected;
		this.isConnected = false;
		this.reason = reason;
		this.currentState = OFFLINE_STATE;
		this.currentServers = [];
		this.currentSounds = [];
		this.currentAppVersion = null;
		if (!changed) return;
		if (wasConnected) this.logger?.info("Disconnected from Refract");
		else this.logger?.debug(`Refract is not available: ${reason}`);
		this.emit();
	}
}
