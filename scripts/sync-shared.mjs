// Copies the files shared between the extension and the website.
// Sources of truth: extension/lib/core.js, extension/lib/catalog.js and web/src/styles/tokens.css.
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pairs = [
  ["extension/lib/core.js", "web/src/lib/core.js"],
  ["extension/lib/catalog.js", "web/src/lib/catalog-shared.js"],
  ["web/src/styles/tokens.css", "extension/tokens.css"],
];
for (const [from, to] of pairs) {
  copyFileSync(join(root, from), join(root, to));
  console.log(`${from} -> ${to}`);
}
