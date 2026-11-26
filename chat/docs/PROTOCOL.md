# Refract local control protocol, version 1

How a program on the same computer, such as the RefractDeck Stream Deck plugin, controls a call in the Refract.Chat
desktop app: the buttons of the call bar (microphone, headphones, camera, soundboard, screen share, disconnect),
joining a voice channel, and opening the newest unread conversation.

The desktop app is the **server**; RefractDeck is a **client**. This document is the contract between them. Two
programs in the RefractDeck repository follow it exactly and can be used to check either side:

- `tools/mock-refract.mjs` behaves as the app must (`npm run mock`).
- `tools/check-refract.mjs` checks a running app as a client meets it (`node tools/check-refract.mjs`).

It only exists in the desktop app. A browser tab running Refract offers none of this.

## 1. Finding the app

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

## 2. Connecting

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

### The app refuses

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

## 3. What the app reports

Three messages: `state`, `channels` and `sounds`. Each carries a whole snapshot, never a difference. The app sends
each after `ready`, and again whenever anything in it changes. Several changes close together may be sent as one
message. A client ignores fields it does not know.

### `state`

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

### `channels`

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

### `sounds`

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

## 4. Commands

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

### Holds

`pushToTalk` and `pushToMute` are held, not pressed, and a hold must never outlive the finger:

- `pressed: false` is **always accepted** while `signedIn` is true, whatever the call and the input mode, including
  when nothing was held. While `signedIn` is false it is answered `not_ready` like every other command, and nothing
  is held then: signing out has already ended every hold.
- The app remembers each client's holds separately. A hold is in effect while any client, or the bound key, holds it.
- The app ends a client's holds by itself when that client's connection closes for any reason, when the call ends or
  stops being `"connected"`, when the input mode changes, and when the page reloads or signs out.
- Pressing while `muted` is accepted: the hold is taken, and nothing is sent until the microphone is switched on, as
  with the key.

### Sounds

- `playSound` names a sound by its server and its id, as `sounds` lists it:
  `{ "type": "command", "id": 8, "action": "playSound", "serverId": 1, "soundId": 7 }`.
- It is refused with `not_in_call` unless `call.status` is `"connected"`; then with `unknown_sound` when that
  server is not listed, or lists no sound with that id; then with `wrong_server` when the call is not in that
  server; then with `forbidden` when the user may not use the soundboard in the call's channel. Those last two are
  when `soundboard` is `null`, or names another server.
- One sound at a time for each user, as in the app: playing a second cuts off the first.
- `soundboard.playingSoundId` names the sound from when it is asked for until it ends, is stopped, or the call ends,
  whether it was started by a client or in the app's own window.

### Why a command is refused

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

## 5. Changes to this protocol

`version` only changes when an existing client would misbehave. New `state` fields, new actions and new error codes
are added without changing it: clients ignore fields they do not know, and the app answers an action it does not know
with `unknown_action`.
