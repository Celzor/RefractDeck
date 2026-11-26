# Task: add "local control" to the Refract.Chat desktop app

You are working in the Refract.Chat repository (`oasis-core`). Add a small, local-only control interface to the
Electron desktop app: a WebSocket server in its main process, so that a Stream Deck plugin running on the same computer
can do what the call bar (`frontend/src/components/shell/FloatingCallBar.tsx`) does, join a voice channel, play
soundboard sounds, and open the newest unread conversation.

The plugin already exists and is finished. It is called RefractDeck and lives outside this repository at
`C:\Users\Celbr\OneDrive\Documents\vsCode Work\RefractDeck\chat`. It speaks the protocol in the appendix of this
message, and today has nothing to talk to: Refract has no local API of any kind. Your job is the app's side of that
protocol. **The protocol is fixed.** Implement it exactly; do not redesign it. If you find something in it that cannot
be built as written, stop and say so rather than deviating, because the plugin would then need the matching change.

Desktop app only. The web app in a browser must gain nothing from this and must not break.

## What must work when you are done

From the Stream Deck, with the Refract desktop app running and signed in:

| Key           | Protocol                                             | In the app today                                                               |
| ------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| Join Channel  | `channels`, `joinChannel`                            | clicking a server voice channel (`joinRTC(channelId)`)                         |
| Disconnect    | `leaveCall`                                          | the call bar's Disconnect (`leaveRTC`)                                         |
| Stream        | `setStream`, `state.streaming`                       | Share screen, which opens the screen share dialog, and End stream (`startScreenShare`, `stopScreenShare`) |
| Camera        | `setCamera`, `state.camera`                          | the call bar's camera button (`toggleCamera`)                                  |
| Soundboard    | `sounds`, `playSound`, `stopSound`, `state.soundboard` | clicking a sound in the call bar's soundboard (`soundboardPlayer.play`)      |
| Notifications | `state.unread`, `state.mentions`, `openNotifications` | the taskbar badge's counts, and the navigation dock's unread buttons (`ShellNavigation.tsx`) |
| Push to Talk  | `pushToTalk`                                         | holding the push to talk key                                                   |
| Push to Mute  | `pushToMute`                                         | holding the push to mute key                                                   |
| Deafen        | `setDeafen`                                          | `toggleDeafen`                                                                 |
| Mute          | `setMute`                                            | `toggleMicrophone`                                                             |
| Voice Mode    | `setInputMode`                                       | the microphone's right-click choice (`updateAudioSettings({ inputMode })`)     |

Every key also shows the app's current state, so the app must report state as it changes (`state`, `channels` and
`sounds` messages), including changes made in the app's own window or by its hotkeys.

The Stream key does one thing to start a share: it opens the app's own screen share dialog. What to share, and at what
quality, is chosen there by the user. Nothing about that choice crosses the protocol, and none is to be added.

## Where things are (read these first)

This is what the code looked like on `develop` when the plugin was written. Verify it before relying on it.

- `electron/main.ts`: every IPC handler checks `trustedSender(event)`. Push to talk and hotkeys are the closest
  existing feature: the main process hears something and tells the page with
  `mainWindow?.webContents.send(DESKTOP_IPC.pushToTalkState, pressed)` and `DESKTOP_IPC.hotkeyPressed`.
- `electron/hotkeys.ts` and `electron/pushToTalk.ts`: the house style for main-process logic. Pure, free of Electron,
  heavily validated, with the reasoning in comments, and tested on their own.
- `electron/desktopProtocol.ts`: `DESKTOP_IPC` channel names. `electron/preload.js` is the only bridge to the page;
  `scripts/build-preload.mjs` injects the identifiers into it. `frontend/src/electron.d.ts` types the bridge and
  `frontend/src/lib/electron.ts` wraps it with feature checks (`hasGlobalHotkeys()` and friends).
- `electron/desktopSettings.ts`: settings that belong to this computer (`closeToTray`), kept in
  `desktop-settings.json`. `frontend/src/components/settings/DesktopAppSettings.tsx` has the Close To Tray switch,
  which is the pattern for a new switch.
- `frontend/src/components/HotkeysBridge.tsx`: already runs most of these controls by name from outside the UI
  (`toggleMute`, `toggleDeafen`, `toggleCamera`, `startStream`, `endStream`, `leaveCall`), reading `useLivekit()`
  through a ref. It is mounted in `App.tsx` as `{electronAPI.isElectron() && <HotkeysBridge />}`. A new bridge belongs
  beside it.
- `frontend/src/contexts/LivekitContext.tsx`: `isConnected`, `connectionState`, `connectedChannelId`,
  `isMicrophoneEnabled`, `isDeafened`, `isCameraEnabled`, `isScreenSharing`, `audioSettings`, and `joinRTC`,
  `leaveRTC`, `toggleMicrophone`, `toggleDeafen`, `toggleCamera`, `startScreenShare`, `stopScreenShare`,
  `updateAudioSettings`.
- The screen share dialog: in the desktop app `startScreenShare()` with no arguments asks the main process
  (`electron/screenPicker.ts`), which has the page show `frontend/src/components/ScreenSharePickerBridge.tsx`. The
  call bar's Share screen button does exactly that (`ScreenShareSettingsPopover.tsx`, where
  `electronAPI.hasScreenSharePicker()`), and so does the `startStream` hotkey after `electronAPI.focusWindow()`.
- `frontend/src/hooks/usePushToTalk.ts`, `frontend/src/components/MicProcessorBridge.tsx`,
  `frontend/src/lib/micPipeline.ts`: how a held key becomes transmitting (push to talk) or silenced (push to mute,
  with `setHeldMute` so the call bar shows it). `InputMode` is `"voiceActivity" | "pushToTalk"`.
- `frontend/src/hooks/useServers.ts`, `useChannels.ts`, `usePermissions.ts`, `lib/stores/serverStore.ts`,
  `channelStore.ts`: servers, channels and `hasChannelPermission("connect", channelId)`.
  `frontend/src/pages/ChatArea.tsx` shows the conditions under which the app itself joins a server voice channel
  (type `SERVER_VOICE`, the `connect` permission, and the NSFW preference).
- The soundboard:
  - `frontend/src/lib/soundboardPlayer.ts`: `soundboardPlayer.play(sound)`, `stop()`, `isAttached()`,
    `playingSoundId()` and `subscribe()`. It plays on a track of its own, so it works while muted.
    `frontend/src/components/SoundboardBridge.tsx` attaches it to the call (it is rendered from `LiveKitBridge.tsx`).
  - `frontend/src/lib/stores/soundboardStore.ts` and `hooks/useServerSoundboard.ts`: each server's sounds and
    categories, **loaded lazily, one server at a time**, when something first shows them. The socket's
    `SOUNDBOARD_UPDATED` carries a server's whole new list, and a reconnect marks every list stale.
  - `frontend/src/components/soundboard/SoundboardPopover.tsx`: how the app lists sounds (`groupSoundboardSounds` from
    the SDK, with the server's categories, `uncategorizedPosition` and the `soundboardSort` preference) and plays one,
    with its toast when a sound cannot be played. It is loaded lazily through `components/CallPopovers.tsx`.
  - `FloatingCallBar.tsx`, `canUseSoundboard`: when the soundboard button is enabled. A server voice channel, with the
    `speak` and `use_soundboard` permissions in it. A private call has no soundboard.
  - `ISoundboardSound` in the SDK: `id`, `serverId`, `name` (at most 32 characters), `categoryId`, and `emoji`, which
    is a Unicode emoji or an instance custom emoji key (`custom:<id>`, see `parseCustomEmojiKey`). A sound's `id` is
    **not** unique across servers: a server federated from another instance keeps that instance's sound ids.
- Notifications:
  - `frontend/src/components/DesktopBadgeBridge.tsx`: the two counts the taskbar badge shows, and where they come
    from (`useUnreadPart("totalUnreadCount")`, and `privateMentionCount` plus `mentionsByServer`). Muting and the
    unread badge setting already apply to them.
  - `frontend/src/components/shell/ShellNavigation.tsx`: the navigation dock, whose buttons for the newest unread
    direct message and for the server with the newest unread message open them. **`useShell()` only works inside the
    shell**, and a bridge mounted beside `HotkeysBridge` in `App.tsx` is outside it. `messageLinks.setOpener`
    (`lib/messageLinks.ts`) and `callDrop.setHandler` are how code outside the shell already reaches into it.
  - `electronAPI.focusWindow()` brings the window forward (`focusWindow` in `electron/window.ts`).
- `CLAUDE.md` and `electron/README.md` (the "Hotkeys and push to talk" section) for conventions and for how the
  existing input features are documented.

## Requirements

### The main process owns the socket

1. A WebSocket server in the Electron main process, bound to `127.0.0.1` only, on a port the system picks, following
   sections 1 and 2 of the protocol to the letter: the discovery file and where it goes, the fresh token per run, the
   `Origin` refusal, the hello handshake and its close codes, the size limit, the client limit, the pings.
   `ws` is the expected library; add it to `electron/package.json` dependencies and to the third-party notices the
   package build generates.
2. It runs only while the new desktop setting is on, and the setting is **off by default**. Switching it on starts the
   server and writes the file at once; switching it off closes every client with `1001`, stops listening and deletes
   the file. No restart needed either way.
3. On quit the file is removed, but only if its `pid` is this process (a development run and an installed build can
   run side by side and share the path; the last to start owns the file).
4. The token and the socket never reach the renderer. The page learns only what it is asked to do, and says only what
   the protocol reports.
5. The main process validates every command before the page hears of it (action name, parameter types), and answers
   `unknown_action` and `invalid_request` itself. It answers `not_ready` itself when there is no page to ask. It
   answers `timeout` if the page has not replied in 5 seconds. Every command gets exactly one `result`.
6. The main process keeps the last state, channel list and sound list the page reported, already checked and clipped
   to the protocol's limits. The renderer is not trusted to send well-formed data: check types, clip names to 100
   characters and an emoji to 32, cap the list lengths, make the two counts whole numbers of zero or more, and drop a
   `soundboard` that is not the shape the protocol gives. It sends all three to a client on `ready`, in the protocol's
   order, and each to every client on change, and only when it actually changed.
7. When the window is closed, reloads, crashes, or navigates away, the main process falls back to the signed-out
   state, an empty channel list and an empty sound list by itself, and tells clients.
8. Holds (`pushToTalk`, `pushToMute`) are tracked in the main process per connection. The page is told one boolean
   for each kind: whether any client holds it. When a connection closes, for any reason, its holds end. This is the
   safety property of the whole feature: a microphone must never stay open because a plugin crashed.

### The page does the work

9. A bridge component, mounted only in the desktop app beside `HotkeysBridge`, that:
   - reports `state` whenever any field of it changes (section 3 of the protocol);
   - reports `channels` and `sounds` whenever either list changes;
   - runs commands sent by the main process and answers each with ok or an error code from section 4.
10. The bridge costs nothing while the setting is off. The main process tells the page whether local control is on,
    and again when that changes; while it is off the bridge reports nothing and loads nothing the app would not have
    loaded anyway (requirements 11 and 18 both load data for servers that are not open).
11. `channels` must list the voice channels of **every** server the user is in, not only the server that is open.
    Check how and when `channelStore` is filled for servers that are not selected; if it is filled lazily, load what
    the list needs. List only `SERVER_VOICE` channels the user may `connect` to and that the sidebar would show them
    (apply the same NSFW rule the app applies), in sidebar order, with the category name or `null`.
12. `joinChannel` must work for a channel in a server that is not the one open, and must not change what the user is
    looking at or bring the window forward. Check that nothing `joinRTC` relies on assumes the channel was opened
    first.
13. `setStream` with `true` only opens the screen share dialog, exactly as the existing `startStream` hotkey does:
    bring the window forward and call `startScreenShare()` with no arguments. Answer `ok` as soon as the dialog has
    been asked for, not when the user has chosen. Closing the dialog without choosing leaves `streaming` false and is
    not an error. `setStream` with `false` ends the share.
14. `setMute`, `setDeafen`, `setStream`, `setCamera` and `setInputMode` take an explicit value or `"toggle"`. With an
    explicit value that already holds, answer `ok` and do nothing. The existing functions are toggles, so read the
    current value at the moment the command runs.
15. `setCamera` behaves as the call bar's camera button does (`toggleCamera`), and `camera` follows
    `isCameraEnabled`. Answer `ok` once the camera has been asked to start. A camera that then cannot start (none
    found, no permission, in use) shows the app's existing message, and `camera` stays false. It does not bring the
    window forward.
16. Push to talk and push to mute from a client must behave exactly as the bound key does, including the press and
    release sounds and the call bar's held-mute look, and must work **when no key is bound at all**
    (`usePushToTalk` currently returns early without a binding). A hold from a client and a hold from the key combine:
    held while either is down.
17. `pushToTalkActive` and `pushToMuteActive` in `state` are true while the hold is in effect by either source, so a
    Stream Deck key lights when the keyboard key is held too.
18. `sounds` must list the soundboard of **every** server the user is in, in a call or not. The store loads a
    server's sounds lazily, so load what the list needs, a few servers at a time rather than all at once, and check
    that each list then stays current by itself (the socket event, and the reload after a reconnect). Report the list
    again as servers finish loading. For each server: its sounds in the order `SoundboardPopover` shows them with
    nothing typed in its search, `category` the category's name or `null` for Uncategorized, and `emoji` only when it
    is a Unicode emoji (`null` for none and for a `custom:<id>` key).
19. A sound's `id` is unique within its server only, so the protocol names a sound by its server's id and its own
    together. Report each sound's real `id` under its server, untranslated. `playSound` carries `serverId` and
    `soundId`: look the sound up in that server's list, and never by its id alone, in the page and in anything the
    main process keeps.
20. `state.soundboard` is not `null` exactly when the call bar's soundboard button is enabled: the call is connected,
    in a server voice channel, and `canUseSoundboard` holds. Use the same condition as the call bar, not a copy that
    can drift from it. `playingSoundId` follows `soundboardPlayer.playingSoundId()`, so a sound clicked in the app's
    own soundboard shows too.
21. `playSound` plays the sound as clicking it in `SoundboardPopover` does: `soundboardPlayer.play(sound)` with the
    sound from that server's list in the store. It must work when the soundboard popover has never been opened in this run of the app, must
    not open it, and must not bring the window forward. Answer `ok` once the checks have passed and the sound has
    been asked for; do not wait for it to download. If it then cannot be played, show the message the popover would.
    `stopSound` is `soundboardPlayer.stop()`.
22. `unread` and `mentions` are the two numbers `DesktopBadgeBridge` gives the taskbar badge, and zero while signed
    out. Share the calculation with it rather than writing it twice.
23. `openNotifications` brings the window forward, also when it is minimised or closed to the tray, and opens the
    newest conversation with anything unread as the navigation dock's buttons do: the newest direct message or group
    first, else the server channel with the newest unread message, muted ones left out. Check how a bridge outside the
    shell can ask for that (see "Where things are"). With nothing unread it only brings the window forward.
24. The error precedence in section 4 is part of the contract (`unknown_action`, `invalid_request`, `not_ready`,
    then the state-dependent ones, with `playSound`'s own order under "Sounds").

### The setting

25. Settings, Desktop App: a switch named **Stream Deck Control**, off by default, with one or two sentences saying
    what it allows (other programs on this computer, such as a Stream Deck, can control your call, play soundboard
    sounds, and see which voice channels and sounds you have and how many notifications are unread) and that it only
    listens on this computer. It is stored with the other desktop settings, never in the account's preferences.
26. The switch only appears in a desktop build that has the feature. A newer web frontend loaded in an older desktop
    build must not show it or throw (follow the `has…()` feature checks in `lib/electron.ts`).

### What it must not do

- Nothing beyond the protocol: no messages (not their text, who sent them, or where; two counts and no more), no
  member lists, no account details, no tokens, no settings other than the input mode, no choice of what is shared.
- Never play a sound the app's own soundboard would not let the user play right now.
- Never listen on anything but `127.0.0.1`. Never accept a connection that names an `Origin`.
- Never log the token. Never put it in a URL.
- Do not weaken `trustedSender` or expose Node to the renderer.

## Tests and documentation

- Unit tests in the style of `electron/security.test.ts` for the pure parts: command validation and its error
  precedence for every action, the discovery file contents and path per platform, the token comparison, hold tracking
  across several connections (including a connection closing mid-hold), and checking what the renderer reports
  (state, channels and sounds, each with malformed and oversized input).
- Frontend unit tests for whatever pure helpers you add (building the state snapshot, building the channel list,
  building the sound list with its order and its custom emoji, deciding whether the soundboard can be used).
- A "Local control" section in `electron/README.md` in the voice of the existing sections, and the protocol itself as
  a document in the repository (`docs/` is where cross-package documents live), so the app's side of the contract is
  recorded where the app is.
- Format with Prettier and run the package checks named in `CLAUDE.md` for every package you touched. Do not run
  `ready` in a dirty tree; it reformats files.

## How to verify against the real plugin

The RefractDeck folder has a checker that connects to the running app as a client and tests it against the protocol
without changing the call or what the app shows:

```
cd "C:\Users\Celbr\OneDrive\Documents\vsCode Work\RefractDeck\chat"
node tools/check-refract.mjs
```

Run it three times, and it must print "All checks passed." each time: signed out, signed in outside a call, and
signed in while in a call in a server voice channel. `node tools/check-refract.mjs --watch` then prints every `state`,
`channels` and `sounds` message, to watch them follow what you do in the app.

`tools/mock-refract.mjs` in the same folder is a reference implementation of the server side of the protocol in about
500 lines. Where this message and the mock seem to disagree, the protocol appendix decides; tell the user about the
disagreement.

The checker sends nothing that plays a sound, starts a camera or moves the window, so those are checked by hand, with
the Stream Deck keys or a short script that sends the command. With local control switched on:

1. Mute, deafen, turn the camera on and off, start and end a stream, and change the input mode in the app's own
   window, and watch `--watch` report each.
2. Hold the push to talk key on the keyboard and see `pushToTalkActive` go true and false.
3. Kill the checker with Ctrl+C while a hold is in effect and confirm the app stops transmitting at once.
4. Send `setStream` with `true`: the window comes forward with the screen share dialog open, and `ok` arrives before
   anything is chosen. Close the dialog: `streaming` stays false.
5. Join a server voice channel and see `soundboard` name its server. Click a sound in the app's soundboard and see
   `playingSoundId` name it and then go back to `null`. Send `playSound` for a sound of that server without ever
   having opened the soundboard since the app started: everyone in the call hears it. Send `stopSound` while one is
   playing.
6. Send `playSound` for a sound of another server (`wrong_server`), and in a voice channel where the account lacks
   `use_soundboard` (`forbidden`, and `soundboard` is `null`). Start a private call: `soundboard` is `null`. If two
   of the account's servers have a sound with the same id, play each from its own server and hear the right one.
7. Add, rename and delete a sound in a server's settings, in a server that is not the one open, and watch `sounds`
   follow each.
8. Have another account send a message and a mention somewhere not on screen: `unread` and `mentions` match the
   taskbar badge, and fall when read. Minimise the app and send `openNotifications`: it comes forward on the direct
   message, the counts fall, and sending it again opens the server channel.
9. Switch local control off and confirm the file is gone and the checker can no longer connect. Quit the app with it
   on and confirm the file is gone.
10. Open `http://example.com` in a browser, and from its console try `new WebSocket("ws://127.0.0.1:<port>")`. It
    must fail to connect.

## Report back

When finished, tell the user: what you built and where, anything in the protocol you could not implement as written,
and the result of each run of the checker. Give the answers to the things you were asked to check:

- how channels of servers that are not open are loaded;
- whether `joinRTC` needs the channel opened;
- how the soundboards of servers that are not open are loaded and kept current, and what that costs an account in
  many servers;
- how the bridge reaches the shell to open the newest unread conversation.

The main process changed, so say plainly that the desktop app must be rebuilt and restarted, not only the web
frontend.

---

# Appendix: the protocol

## Refract local control protocol, version 1

How a program on the same computer, such as the RefractDeck Stream Deck plugin, controls a call in the Refract.Chat
desktop app: the buttons of the call bar (microphone, headphones, camera, soundboard, screen share, disconnect),
joining a voice channel, and opening the newest unread conversation.

The desktop app is the **server**; RefractDeck is a **client**. This document is the contract between them. Two
programs in the RefractDeck repository follow it exactly and can be used to check either side:

- `tools/mock-refract.mjs` behaves as the app must (`npm run mock`).
- `tools/check-refract.mjs` checks a running app as a client meets it (`node tools/check-refract.mjs`).

It only exists in the desktop app. A browser tab running Refract offers none of this.

### 1. Finding the app

Local control is a setting of the desktop app, **off by default**. While it is on and the app is running, the app:

1. listens for WebSocket connections on `127.0.0.1`, on a port the operating system picks (`listen(0)`), never on
   another address;
2. makes a fresh token for this run: 32 random bytes, base64url, no padding (43 characters);
3. writes the **discovery file**.

The discovery file is `local-control.json` in the folder `Refract.Chat` inside the user's application data folder,
which is Electron's `app.getPath("appData")`:

| System  | Path                                                                                |
| ------- | ----------------------------------------------------------------------------------- |
| Windows | `%APPDATA%\Refract.Chat\local-control.json`                                         |
| macOS   | `~/Library/Application Support/Refract.Chat/local-control.json`                     |
| Linux   | `$XDG_CONFIG_HOME/Refract.Chat/local-control.json`, or `~/.config/Refract.Chat/...` |

The path is the same for an installed build and a development run. It is deliberately **not** `userData`, which
differs between them.

```json
{ "version": 1, "port": 53540, "token": "pZ0u…43 characters…", "pid": 13696 }
```

| Field     | Meaning                                                            |
| --------- | ------------------------------------------------------------------ |
| `version` | the protocol version the app speaks; `1`                           |
| `port`    | the port on `127.0.0.1`                                            |
| `token`   | what a client presents; matches `^[A-Za-z0-9_-]{32,128}$`          |
| `pid`     | the app's main process, so a leftover file can be told from a live |

The app writes it whole to `local-control.json.tmp` and renames it into place, with permissions `0600` where the
system has them, and creates the folder if needed. It deletes the file when local control is switched off and when
the app quits, but only if the file's `pid` is still its own (another copy of the app may have replaced it).

**Being able to read this file is the authorisation.** Only programs running as the same user can. There are no API
keys, no accounts and nothing to register or paste.

A client reads the file each time it tries to connect, and tries again every couple of seconds while there is no file,
the file cannot be used, or nothing answers at the port (a file left behind by a crash).

### 2. Connecting

A client opens `ws://127.0.0.1:<port>/` and sends one text message:

```json
{ "type": "hello", "version": 1, "token": "<token>", "client": { "name": "RefractDeck", "version": "0.1.0.0" } }
```

`client` is for the app's log only and is optional.

The app answers with `ready`, then the current `state`, then the current `channels`, then the current `sounds`, in
that order:

```json
{ "type": "ready", "version": 1, "app": { "name": "Refract.Chat", "version": "1.9.11" } }
```

Until `ready`, the app sends nothing else and acts on nothing.

#### The app refuses

| When                                                                           | How                                    |
| ------------------------------------------------------------------------------ | -------------------------------------- |
| the request has an `Origin` header (every browser sends one; no client does)   | HTTP `403`, before the upgrade         |
| there are already 8 clients, or 16 connections that have not yet said `hello`  | HTTP `403`, before the upgrade         |
| the first message is not JSON, not a `hello`, or has no string `token`         | close code `4400`                      |
| `version` is not one the app speaks                                            | close code `4400`                      |
| the token is wrong (compared in constant time)                                 | close code `4401`                      |
| the eighth client's place was taken while this `hello` was on its way          | close code `1013`                      |
| no `hello` within 5 seconds                                                    | close code `4401`                      |
| local control is switched off, or the app is quitting                          | close code `1001`, every client        |

Other requirements on the app:

- Text messages only. An incoming message larger than 64 KiB closes the connection. Compression is off.
- It pings every client every 15 seconds and drops one that has not answered by the next ping.
- After `ready`, a message that is not JSON, or not a `command` with a whole-number `id`, is ignored.

A client treats 45 seconds without a message or a ping as a dead connection, closes it, and looks for the app again.
It does the same after any refusal, whatever the status or close code: the file is read afresh for each try.

### 3. What the app reports

Three messages: `state`, `channels` and `sounds`. Each carries a whole snapshot, never a difference. The app sends
each after `ready`, and again whenever anything in it changes. Several changes close together may be sent as one
message. A client ignores fields it does not know.

#### `state`

```json
{
  "type": "state",
  "state": {
    "signedIn": true,
    "call": { "channelId": 12, "channelName": "Gaming Lounge", "serverId": 1, "serverName": "Refract HQ", "status": "connected" },
    "muted": false,
    "deafened": false,
    "streaming": false,
    "camera": false,
    "inputMode": "voiceActivity",
    "pushToTalkActive": false,
    "pushToMuteActive": false,
    "soundboard": { "serverId": 1, "playingSoundId": null },
    "unread": 4,
    "mentions": 1
  }
}
```

| Field              | Type                              | Meaning                                                                                                    |
| ------------------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `signedIn`         | boolean                           | the app's page is loaded and someone is signed in. While false nothing can be controlled.                   |
| `call`             | object or `null`                  | the call the app is in or joining; `null` when there is none                                               |
| `call.channelId`   | whole number                      | the channel of the call                                                                                    |
| `call.channelName` | string, 1 to 100 characters       | as the call bar titles it                                                                                  |
| `call.serverId`    | whole number or `null`            | `null` for a private call                                                                                  |
| `call.serverName`  | string or `null`                  | `null` for a private call                                                                                  |
| `call.status`      | `"connecting"`, `"connected"`, `"reconnecting"` | as the call bar shows it                                                                     |
| `muted`            | boolean                           | the microphone is switched off (the call bar's microphone button). Also true while a call is `"connecting"`, until its microphone is on. |
| `deafened`         | boolean                           | the call bar's headphones button                                                                           |
| `streaming`        | boolean                           | the screen is being shared                                                                                 |
| `camera`           | boolean                           | the camera is on (the call bar's camera button)                                                            |
| `inputMode`        | `"voiceActivity"`, `"pushToTalk"` | the microphone's input mode setting                                                                        |
| `pushToTalkActive` | boolean                           | push to talk is held open right now, by its key **or** by a client                                         |
| `pushToMuteActive` | boolean                           | push to mute is held right now, by its key **or** by a client                                              |
| `soundboard`       | object or `null`                  | the soundboard of the call, while the call bar's soundboard button can be used; `null` otherwise           |
| `soundboard.serverId` | whole number                   | the server whose sounds can be played right now: the server of the call                                    |
| `soundboard.playingSoundId` | whole number or `null`   | the sound of that server this user is playing into the call right now; `null` when none                    |
| `unread`           | whole number, zero or more        | unread messages, as the app's taskbar or dock badge counts them (muted conversations left out)             |
| `mentions`         | whole number, zero or more        | unread mentions, as the same badge counts them                                                             |

`soundboard` is `null` outside a call, while the call is not `"connected"`, in a private call, and in a server voice
channel where the user may not use the soundboard. It says nothing of whether the server has any sounds.

`unread` and `mentions` are numbers only. The protocol never carries a message, who sent it, or where.

While nobody is signed in, the page is still loading, or the window has been closed, the state is exactly:

```json
{ "signedIn": false, "call": null, "muted": false, "deafened": false, "streaming": false, "camera": false, "inputMode": "voiceActivity", "pushToTalkActive": false, "pushToMuteActive": false, "soundboard": null, "unread": 0, "mentions": 0 }
```

#### `channels`

The voice channels the signed-in user can join, for a client to offer as a choice.

```json
{
  "type": "channels",
  "servers": [
    { "id": 1, "name": "Refract HQ", "channels": [{ "id": 11, "name": "General", "category": "Voice Channels" }] }
  ]
}
```

- Every server the user is in, in the order the app shows them, **whichever server is open in the app**.
- Under each, its server voice channels that the user has permission to connect to and that the app would show them,
  in the order the sidebar lists them. `category` is the name of the channel's category, or `null`.
- Names are 1 to 100 characters. At most 200 servers and 500 channels each.
- Empty (`"servers": []`) while `signedIn` is false.
- Private conversations are not listed. Version 1 joins server voice channels only.

#### `sounds`

The soundboard sounds of the signed-in user's servers, for a client to offer as a choice.

```json
{
  "type": "sounds",
  "servers": [
    { "id": 1, "name": "Refract HQ", "sounds": [{ "id": 7, "name": "Airhorn", "emoji": "📣", "category": "Memes" }] }
  ]
}
```

- Every server the user is in, in the order the app shows them, **whichever server the call is in**, and outside a
  call too. A server with no sounds is listed with `"sounds": []`.
- Under each, its sounds in the order the app's soundboard lists them. `category` is the name of the sound's
  category, or `null` for one that has none.
- `emoji` is the sound's emoji when it is a Unicode emoji, at most 32 characters; `null` when it has none, or has one
  of the instance's own custom emoji, which a client cannot draw.
- A sound's `id` is unique **within its server only**. Two servers may each have a sound with the same `id` (a
  server federated from another instance keeps that instance's ids), so a sound is always named by its server's `id`
  and its own together, and a client offers the choice that way: the server first, then one of its sounds.
- Names are 1 to 100 characters. At most 200 servers and 200 sounds each.
- A server's sounds may arrive a moment after the server itself, while the app is still loading them.
- Empty (`"servers": []`) while `signedIn` is false.
- Being listed does not mean a sound can be played now: that is `state.soundboard`.

### 4. Commands

```json
{ "type": "command", "id": 7, "action": "setMute", "value": true }
```

`id` is a whole number of the client's choosing, zero or more, unique among its unanswered commands. The app answers
every command exactly once, within 5 seconds:

```json
{ "type": "result", "id": 7, "ok": true }
{ "type": "result", "id": 7, "ok": false, "error": "not_in_call", "message": "Not connected to a call" }
```

`ok: true` means the command was **accepted and begun**, not that it has finished: a call still has to connect, a
screen still has to be chosen, a camera still has to start, a sound still has to download. When one of those then
fails, the app says so in its own window, and `state` does not change. What happens next arrives as `state`. A `result` and the `state` it leads to may arrive
in either order. `message` is optional text for a log, at most 200 characters.

| `action`       | Parameters                                           | Refused unless                                        | Does                                                                                                                          |
| -------------- | ---------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `joinChannel`  | `channelId`: whole number                            | the channel is one listed in `channels`               | Joins it, as clicking it in the sidebar does, leaving any other call first. Already in or joining that channel: accepted, nothing happens. |
| `leaveCall`    | none                                                 | `call` is not `null`                                  | Leaves the call, also while it is still connecting.                                                                           |
| `setMute`      | `value`: `true`, `false` or `"toggle"`               | `call.status` is `"connected"`                        | Makes `muted` that value.                                                                                                     |
| `setDeafen`    | `value`: `true`, `false` or `"toggle"`               | `call.status` is `"connected"`                        | Makes `deafened` that value.                                                                                                  |
| `setStream`    | `value`: `true`, `false` or `"toggle"`               | `call.status` is `"connected"`                        | `true`: brings the app's window forward and opens its screen share dialog, as its Start stream hotkey does, and nothing more: what to share, and how, is chosen there. `false`: ends the share. Already so: accepted, nothing happens. |
| `setCamera`    | `value`: `true`, `false` or `"toggle"`               | `call.status` is `"connected"`                        | Makes `camera` that value, as the call bar's camera button does. Already so: accepted, nothing happens.                        |
| `setInputMode` | `value`: `"voiceActivity"`, `"pushToTalk"`, `"toggle"` | signed in                                           | Changes the input mode setting. Works outside a call.                                                                         |
| `pushToTalk`   | `pressed`: boolean                                   | to press: connected, and `inputMode` is `"pushToTalk"` | While held, the microphone is sent, exactly as while the push to talk key is held. Needs no key to be bound.                  |
| `pushToMute`   | `pressed`: boolean                                   | to press: connected, and `inputMode` is `"voiceActivity"` | While held, the microphone is silenced, exactly as while the push to mute key is held. Needs no key to be bound.          |
| `playSound`    | `serverId`: whole number, `soundId`: whole number    | the sound is listed under that server in `sounds`, and `soundboard.serverId` is that server | Plays it into the call, as clicking it in the app's soundboard does, cutting off whichever sound this user is still playing. Works while `muted` or `deafened`. |
| `stopSound`    | none                                                 | signed in                                             | Stops the sound this user is playing, as the soundboard's Stop does. Nothing playing: accepted, nothing happens.              |
| `openNotifications` | none                                            | signed in                                             | Brings the app's window forward and opens the newest conversation with anything unread, as clicking its button in the app's navigation dock does: the newest direct message or group first, else the server channel with the newest unread message. Muted conversations are left out, as from `unread`. Opening it reads it, as in the app. Nothing unread: only brings the window forward. |

#### Holds

`pushToTalk` and `pushToMute` are held, not pressed, and a hold must never outlive the finger:

- `pressed: false` is **always accepted** while `signedIn` is true, whatever the call and the input mode, including
  when nothing was held. While `signedIn` is false it is answered `not_ready` like every other command, and nothing
  is held then: signing out has already ended every hold.
- The app remembers each client's holds separately. A hold is in effect while any client, or the bound key, holds it.
- The app ends a client's holds by itself when that client's connection closes for any reason, when the call ends or
  stops being `"connected"`, when the input mode changes, and when the page reloads or signs out.
- Pressing while `muted` is accepted: the hold is taken, and nothing is sent until the microphone is switched on, as
  with the key.

#### Sounds

- `playSound` names a sound by its server and its id, as `sounds` lists it:
  `{ "type": "command", "id": 8, "action": "playSound", "serverId": 1, "soundId": 7 }`.
- It is refused with `not_in_call` unless `call.status` is `"connected"`; then with `unknown_sound` when that
  server is not listed, or lists no sound with that id; then with `wrong_server` when the call is not in that
  server; then with `forbidden` when the user may not use the soundboard in the call's channel. Those last two are
  when `soundboard` is `null`, or names another server.
- One sound at a time for each user, as in the app: playing a second cuts off the first.
- `soundboard.playingSoundId` names the sound from when it is asked for until it ends, is stopped, or the call ends,
  whether it was started by a client or in the app's own window.

#### Why a command is refused

Checked in this order, and the first that applies is the answer:

| `error`            | When                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `unknown_action`   | `action` is text that is not in the table above                                                  |
| `invalid_request`  | `action` is missing or is not text, or a parameter is missing or of the wrong kind               |
| `not_ready`        | `signedIn` is false                                                                              |
| `not_in_call`      | the command needs a call, or a connected one, and there is none                                  |
| `wrong_input_mode` | `pushToTalk` or `pushToMute` was pressed in the other input mode                                 |
| `unknown_channel`  | `joinChannel` named a channel that is not listed                                                 |
| `unknown_sound`    | `playSound` named a server and a sound that are not listed together                              |
| `wrong_server`     | `playSound` named a server other than the call's (a private call has no server)                  |
| `forbidden`        | the user may not do this (permission was lost since the channel was listed, a server mute, a voice channel where they may not use the soundboard) |
| `failed`           | the app tried and could not                                                                      |
| `timeout`          | the app's page did not answer its main process in time                                           |

A client treats a code it does not know as `failed`.

### 5. Changes to this protocol

`version` only changes when an existing client would misbehave. New `state` fields, new actions and new error codes
are added without changing it: clients ignore fields they do not know, and the app answers an action it does not know
with `unknown_action`.
