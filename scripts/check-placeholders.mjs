// Lists every "[Placeholder]" string still in the content files and exits with an error while any remain.
// Usage: npm run check:placeholders            (checks every file in content/)
//        node scripts/check-placeholders.mjs path/to/file ...
// Comment lines (// ... and /* ... */) are ignored, so the editing notes at the top of a file do not count.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const TAG = '[Placeholder]';
const args = process.argv.slice(2);
const files = args.length ? args : readdirSync('content').map(f => join('content', f)).filter(f => statSync(f).isFile());

let found = 0;
for (const f of files) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) return;
    if (!line.includes(TAG)) return;
    // One entry per quoted string that carries the tag (a line can hold several), or the whole line if none is quoted.
    const quoted = [...line.matchAll(/(['"`])((?:(?!\1).)*\[Placeholder\](?:(?!\1).)*)\1/g)].map(m => m[2]);
    for (const text of quoted.length ? quoted : [t]) { found++; console.log(`${f}:${i + 1}: ${text}`); }
  });
}
if (found) { console.error(`\n${found} ${TAG} string${found === 1 ? '' : 's'} left. Replace the text and delete the ${TAG} tag.`); process.exit(1); }
console.log(`No ${TAG} strings left in ${files.length} file${files.length === 1 ? '' : 's'}.`);
