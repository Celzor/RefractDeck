/**
 * Builds docs/REFRACT_PROMPT.md: the brief for whoever adds local control to
 * the Refract desktop app, with the protocol appended so it stands alone when
 * pasted somewhere that cannot read this folder.
 *
 *   npm run prompt
 *
 * Run it again after changing docs/PROTOCOL.md or docs/refract-prompt.head.md.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "docs");
const head = readFileSync(path.join(docs, "refract-prompt.head.md"), "utf8").trimEnd();
// the protocol's headings sit one level down, under the appendix's own
const protocol = readFileSync(path.join(docs, "PROTOCOL.md"), "utf8")
	.trim()
	.replace(/^(#{1,5}) /gm, "#$1 ");

writeFileSync(path.join(docs, "REFRACT_PROMPT.md"), `${head}\n\n${protocol}\n`);
console.log("Wrote docs/REFRACT_PROMPT.md");
