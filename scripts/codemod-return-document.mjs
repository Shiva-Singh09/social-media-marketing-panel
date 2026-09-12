/**
 * One-off codemod: Mongoose 9 deprecates the `new: true` query option in
 * favour of `returnDocument: "after"`. Rewrites every occurrence under src/
 * so the runtime stops emitting:
 *   "the `new` option for findOneAndUpdate() ... is deprecated"
 *
 * Usage: node scripts/codemod-return-document.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "src");
let changed = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      walk(full);
      continue;
    }
    if (!full.endsWith(".ts")) continue;
    const before = fs.readFileSync(full, "utf8");
    const after = before.replaceAll("new: true", 'returnDocument: "after"');
    if (after !== before) {
      fs.writeFileSync(full, after);
      changed += 1;
      console.log("updated:", path.relative(process.cwd(), full));
    }
  }
}

walk(ROOT);
console.log(`done — ${changed} file(s) updated`);