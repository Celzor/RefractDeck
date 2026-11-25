import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

/**
 * Builds the part of the plugin that talks to Refract, without the Stream Deck
 * SDK, into build/ for the tests to load (npm test).
 *
 * @type {import('rollup').RollupOptions}
 */
const config = {
	input: "src/refract/core.ts",
	output: {
		file: "build/refract-core.js",
		format: "es",
	},
	external: ["ws"],
	plugins: [
		typescript(),
		nodeResolve({
			browser: false,
			exportConditions: ["node"],
			preferBuiltins: true,
		}),
	],
};

export default config;
