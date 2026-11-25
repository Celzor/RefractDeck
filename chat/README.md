# RefractDeck

A Stream Deck plugin that puts the Refract.Chat call bar on keys: join a voice channel, mute, deafen, camera, stream,
soundboard, push to talk, and disconnect, with a key for your notifications. The keys follow the app, so a key shows
muted whether you muted from the deck, the app or a hotkey.

It works with the **Refract desktop app only**, on Windows and macOS. A browser tab running Refract cannot be
controlled.

> **Refract's side is built, and not yet in a release.** The plugin talks to the desktop app over a local connection
> described in [docs/PROTOCOL.md](docs/PROTOCOL.md). The app's end of it is in the app's own repository, where
> `docs/local-control-protocol.md` is the same protocol. With a Refract that does not have it yet, every key shows
> dimmed, and the plugin can be tried against a stand-in app: see
> [Trying it without Refract](#trying-it-without-refract).

## Keys

| Action        | Press                                                                    | Shows                                                | Usable                                            |
| ------------- | ------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------- |
| Join Channel  | Joins the voice channel chosen for the key. Press again to leave.        | The channel's name; green while you are in it        | signed in, with a channel chosen                  |
| Disconnect    | Leaves the call.                                                         |                                                      | in a call                                         |
| Stream        | Brings Refract forward with its screen share dialog open. Press again to end the stream. | Start stream, or red End stream while sharing | in a call                                    |
| Camera        | Turns your camera on or off.                                             | Green while the camera is on                         | in a call                                         |
| Soundboard    | Plays the sound chosen for the key into the call.                        | The sound's name; green while it plays               | in a call in the sound's server, where you may use the soundboard |
| Notifications | Brings Refract forward on its Activity page.                             | Red with a count while something is unread: `@2` for mentions, else the unread messages | signed in       |
| Push to Talk  | Hold to talk.                                                            | Green while talking, by this key or the keyboard's   | in a call, input mode Push to Talk                |
| Push to Mute  | Hold to mute.                                                            | Red while held                                       | in a call, input mode Voice Activity              |
| Deafen        | Stops or starts hearing the call.                                        | Red while deafened                                   | in a call                                         |
| Mute          | Mutes or unmutes the microphone.                                         | Red while muted                                      | in a call                                         |
| Voice Mode    | Switches between Voice Activity and Push to Talk.                        | Which one is in use                                  | signed in                                         |

A key is dimmed while it cannot be used. Pressing it then shows the alert triangle, and the reason is in the log.

Join Channel and Soundboard are set up in their settings panels in the Stream Deck app. For Join Channel, pick the
channel from the list of your servers. For Soundboard, pick the server, then one of that server's sounds. Refract has
to be open and signed in for the lists to fill. The key remembers the names for when it is not.

Stream never chooses what to share: it opens Refract's own screen share dialog, and you choose there.

A Soundboard key plays one sound, so a board is a folder or a page of them. As in Refract, a sound can only be played
in a call in its own server, one at a time: pressing another key cuts the first sound off. Pressing a key again
restarts its sound, or stops it if the key is set to.

Notifications only ever knows two numbers, the ones on Refract's taskbar badge. Reading happens in the app.

In a multi-action, Mute, Deafen, Camera, Stream and Voice Mode go to the state you pick there rather than toggling,
Join Channel only ever joins, and Soundboard only ever plays. The two hold keys cannot be used in a multi-action.

## Setting up

1. In Refract: **Settings, Desktop App, Stream Deck Control**, and switch it on. It is off by default.
2. Build the plugin (below). It is already linked into Stream Deck on this computer; on another, run
   `npx streamdeck link plugins.refract.chat.sdPlugin` once.
3. Drag the actions from the **RefractDeck** category onto keys.

There are no API keys, accounts or pairing codes. While Stream Deck Control is on, Refract writes a small file in your
own application data folder saying where it is listening and with which token, and the plugin reads it. Only programs
running as you can read that file. Nothing leaves the computer.

Each key's settings panel says whether the plugin has found Refract.

## Building

Needs Node.js 20 or later and the Stream Deck app, 7.1 or later.

```
npm install
npm run build        builds plugins.refract.chat.sdPlugin/bin/plugin.js
npx streamdeck restart plugins.refract.chat
```

| Script             | Does                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------- |
| `npm run build`    | builds the plugin                                                                      |
| `npm run watch`    | builds on every change and restarts the plugin in Stream Deck                          |
| `npm test`         | tests the connection to Refract against the stand-in app                               |
| `npm run validate` | checks the manifest and files with the Stream Deck CLI                                 |
| `npm run pack`     | makes an installable `dist/plugins.refract.chat.streamDeckPlugin`                      |
| `npm run icons`    | redraws every key image (after changing `scripts/generate-icons.mjs`)                  |
| `npm run mock`     | runs the stand-in for Refract                                                          |
| `npm run check`    | checks a running Refract against the protocol                                          |
| `npm run prompt`   | rebuilds `docs/REFRACT_PROMPT.md` (after changing the protocol or the brief)           |

The plugin's log is `plugins.refract.chat.sdPlugin/logs/plugins.refract.chat.0.log`.

## Trying it without Refract

`npm run mock` starts a stand-in that behaves as Refract does: a pretend account in two servers with four voice
channels and four soundboard sounds. Quit Refract first, or switch its Stream Deck Control off, as both write the same
file.

With it running, the keys on the deck come alive. Join a channel, mute, hold push to talk, play a sound. Type `mute`,
`deafen`, `camera`, `mode`, `stream`, `sound`, `message`, `mention`, `read`, `leave` or `signout` in its window to
change things "in the app" and watch the keys follow. `quit` stops it and the keys dim again. Its AFK channel is one
where the soundboard may not be used, to see a Soundboard key dim.

## How it is put together

```
src/
  plugin.ts               registers the actions, answers the settings panels
  actions/                one file per key; refract-key.ts keeps keys drawn, hold-key.ts is the two hold keys
  refract/                the connection to the app, free of the Stream Deck SDK
    discovery.ts          finding the app's port and token
    client.ts             connecting, reconnecting, commands, state
    protocol.ts           the messages, and checking them
    channels.ts           the channel list for Join Channel
    sounds.ts             the sound list for Soundboard
  generated/images.ts     the dimmed key images, written by npm run icons
plugins.refract.chat.sdPlugin/
  manifest.json           the actions as Stream Deck sees them
  imgs/                   key and list images
  ui/                     the settings panels
tools/
  mock-refract.mjs        the stand-in app
  check-refract.mjs       the checker for the real app
docs/
  PROTOCOL.md             the contract between the plugin and Refract; sections 1 to 5 are word for word
                          the app's docs/local-control-protocol.md, so a change is made in both
  REFRACT_PROMPT.md       the brief Refract's side was built from
```

Third-party material is listed in [NOTICE.md](NOTICE.md).
