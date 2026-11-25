/**
 * Draws every image the plugin uses, from one description of each key.
 *
 *   npm run icons
 *
 * Writes the action-list icons and the key images into the .sdPlugin folder,
 * and src/generated/images.ts, which holds the dimmed "not available right
 * now" image of each key for the plugin to show at runtime. The output is
 * committed, so this only needs running again after changing a glyph or colour.
 *
 * The glyphs are the ones Refract's own call bar uses, from Lucide
 * (https://lucide.dev, ISC licence) - see NOTICE.md.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(root, "plugins.refract.chat.sdPlugin");

const p = (d) => `<path d="${d}"/>`;

/** Lucide 0.564.0 glyphs on a 24 x 24 grid, drawn with a 2px round stroke */
const GLYPHS = {
	mic: [p("M12 19v3"), p("M19 10v2a7 7 0 0 1-14 0v-2"), `<rect x="9" y="2" width="6" height="13" rx="3"/>`],
	micOff: [
		p("M12 19v3"),
		p("M15 9.34V5a3 3 0 0 0-5.68-1.33"),
		p("M16.95 16.95A7 7 0 0 1 5 12v-2"),
		p("M18.89 13.23A7 7 0 0 0 19 12v-2"),
		p("m2 2 20 20"),
		p("M9 9v3a3 3 0 0 0 5.12 2.12"),
	],
	headphones: [
		p(
			"M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3",
		),
	],
	headphoneOff: [
		p("M21 14h-1.343"),
		p("M9.128 3.47A9 9 0 0 1 21 12v3.343"),
		p("m2 2 20 20"),
		p("M20.414 20.414A2 2 0 0 1 19 21h-1a2 2 0 0 1-2-2v-3"),
		p("M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 2.636-6.364"),
	],
	monitorUp: [
		p("m9 10 3-3 3 3"),
		p("M12 13V7"),
		`<rect width="20" height="14" x="2" y="3" rx="2"/>`,
		p("M12 17v4"),
		p("M8 21h8"),
	],
	monitorX: [
		p("m14.5 12.5-5-5"),
		p("m9.5 12.5 5-5"),
		`<rect width="20" height="14" x="2" y="3" rx="2"/>`,
		p("M12 17v4"),
		p("M8 21h8"),
	],
	phoneOff: [
		p(
			"M10.1 13.9a14 14 0 0 0 3.732 2.668 1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2 18 18 0 0 1-12.728-5.272",
		),
		p("M22 2 2 22"),
		p(
			"M4.76 13.582A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 .244.473",
		),
	],
	volume: [
		p(
			"M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z",
		),
		p("M16 9a5 5 0 0 1 0 6"),
		p("M19.364 18.364a9 9 0 0 0 0-12.728"),
	],
	audioLines: [p("M2 10v3"), p("M6 6v11"), p("M10 3v18"), p("M14 8v7"), p("M18 5v13"), p("M22 10v3")],
	keyboard: [
		p("M10 8h.01"),
		p("M12 12h.01"),
		p("M14 8h.01"),
		p("M16 12h.01"),
		p("M18 8h.01"),
		p("M6 8h.01"),
		p("M7 16h10"),
		p("M8 12h.01"),
		`<rect width="20" height="16" x="2" y="4" rx="2"/>`,
	],
	radio: [
		p("M16.247 7.761a6 6 0 0 1 0 8.478"),
		p("M19.075 4.933a10 10 0 0 1 0 14.134"),
		p("M4.925 19.067a10 10 0 0 1 0-14.134"),
		p("M7.753 16.239a6 6 0 0 1 0-8.478"),
		`<circle cx="12" cy="12" r="2"/>`,
	],
	video: [
		p("m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"),
		`<rect x="2" y="6" width="14" height="12" rx="2"/>`,
	],
	videoOff: [
		p("M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196"),
		p("M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"),
		p("m2 2 20 20"),
	],
	megaphone: [
		p("M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"),
		p("M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14"),
		p("M8 6v8"),
	],
	bell: [
		p("M10.268 21a2 2 0 0 0 3.464 0"),
		p(
			"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326",
		),
	],
	bellDot: [
		p("M10.268 21a2 2 0 0 0 3.464 0"),
		p(
			"M11.68 2.009A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673c-.824-.85-1.678-1.731-2.21-3.348",
		),
		`<circle cx="18" cy="5" r="3"/>`,
	],
};

const NEUTRAL = "#1c1e27";
const RED = "#c93c3e";
const GREEN = "#1f9d55";

/**
 * Each action: its folder, the glyph in the actions list, and its key states
 * in manifest order. `caption` is a short word under the glyph, for keys whose
 * glyph alone would be mistaken for another's.
 */
const ACTIONS = [
	{
		name: "join-channel",
		list: "volume",
		states: [
			{ glyph: "volume", background: NEUTRAL },
			{ glyph: "volume", background: GREEN },
		],
	},
	{ name: "disconnect", list: "phoneOff", states: [{ glyph: "phoneOff", background: RED }] },
	{
		name: "stream",
		list: "monitorUp",
		states: [
			{ glyph: "monitorUp", background: NEUTRAL },
			{ glyph: "monitorX", background: RED },
		],
	},
	{
		name: "push-to-talk",
		list: "radio",
		states: [
			{ glyph: "radio", background: NEUTRAL, caption: "PTT" },
			{ glyph: "radio", background: GREEN, caption: "LIVE" },
		],
	},
	{
		name: "push-to-mute",
		list: "micOff",
		states: [
			{ glyph: "mic", background: NEUTRAL, caption: "PTM" },
			{ glyph: "micOff", background: RED, caption: "MUTED" },
		],
	},
	{
		name: "deafen",
		list: "headphones",
		states: [
			{ glyph: "headphones", background: NEUTRAL },
			{ glyph: "headphoneOff", background: RED },
		],
	},
	{
		name: "mute",
		list: "mic",
		states: [
			{ glyph: "mic", background: NEUTRAL },
			{ glyph: "micOff", background: RED },
		],
	},
	{
		name: "voice-mode",
		list: "audioLines",
		states: [
			{ glyph: "audioLines", background: NEUTRAL, caption: "VOICE" },
			{ glyph: "keyboard", background: NEUTRAL, caption: "PUSH" },
		],
	},
	{
		name: "camera",
		list: "video",
		states: [
			{ glyph: "videoOff", background: NEUTRAL },
			{ glyph: "video", background: GREEN },
		],
	},
	{
		name: "soundboard",
		list: "megaphone",
		states: [
			{ glyph: "megaphone", background: NEUTRAL },
			{ glyph: "megaphone", background: GREEN },
		],
	},
	{
		name: "notifications",
		list: "bell",
		states: [
			{ glyph: "bell", background: NEUTRAL },
			{ glyph: "bellDot", background: RED },
		],
	},
];

const STROKE = `fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;

/** a key image: 144 x 144, the glyph at three times its size, a little above centre so a title fits beneath */
function keySvg({ glyph, background, caption }, dimmed = false) {
	const top = caption ? 20 : 32;
	const opacity = dimmed ? ` opacity="0.28"` : "";
	const text = caption
		? `<text x="72" y="126" text-anchor="middle" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="22" font-weight="700" letter-spacing="1.5" fill="#FFFFFF"${opacity}>${caption}</text>`
		: "";
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
		`<rect width="144" height="144" fill="${dimmed ? NEUTRAL : background}"/>` +
		`<g transform="translate(36 ${top}) scale(3)" ${STROKE}${opacity}>${GLYPHS[glyph].join("")}</g>` +
		text +
		`</svg>`
	);
}

/** an actions-list icon: 20 x 20, white on nothing, as the guidelines ask */
function listSvg(glyph) {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" ${STROKE}>${GLYPHS[glyph].join("")}</svg>`;
}

/** the category's icon: a prism bending a ray, 28 x 28, white on nothing */
function categorySvg() {
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28" ${STROKE}>` +
		`<path d="M14 5 23.5 22h-19z"/><path d="M2 15.5l7.6-2.2"/><path d="M17.6 12.6 26 11"/><path d="M18.9 15.6 26 16.5"/>` +
		`</svg>`
	);
}

function write(file, contents) {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, contents);
}

const unavailable = {};
for (const action of ACTIONS) {
	const dir = path.join(pluginDir, "imgs", "actions", action.name);
	write(path.join(dir, "icon.svg"), listSvg(action.list));
	action.states.forEach((state, index) => write(path.join(dir, `key-${index}.svg`), keySvg(state)));
	// what the key shows while its control cannot be used: its resting glyph, dimmed
	unavailable[action.name] = `data:image/svg+xml,${encodeURIComponent(keySvg(action.states[0], true))}`;
}
write(path.join(pluginDir, "imgs", "plugin", "category-icon.svg"), categorySvg());

write(
	path.join(root, "src", "generated", "images.ts"),
	`// Generated by scripts/generate-icons.mjs (npm run icons). Do not edit by hand.\n\n` +
		`/** Each key's image while its control cannot be used: Refract is not running, or there is no call. */\n` +
		`export const UNAVAILABLE_IMAGES = {\n` +
		Object.entries(unavailable)
			.map(([name, url]) => `\t${JSON.stringify(name)}: ${JSON.stringify(url)},\n`)
			.join("") +
		`} as const;\n\n` +
		`export type ActionImageName = keyof typeof UNAVAILABLE_IMAGES;\n`,
);

console.log(`Drew ${ACTIONS.length} actions into ${path.relative(root, pluginDir)}`);
