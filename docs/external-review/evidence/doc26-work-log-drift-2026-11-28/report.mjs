// DOC-26 (WL-631): يُصنِّفُ ناتجَ measure.mjs ويكتبُ لكلِّ مُدخلةٍ متغيّرةٍ فرقَها الصافي (أوّلُ نصٍّ دُمِجَ ⇐ نصُّها الآن).
// التشغيل: node measure.mjs origin/main /tmp/changed.json && node report.mjs /tmp/changed.json <dir>
import fs from 'node:fs';
import path from 'node:path';
const [input, out] = process.argv.slice(2);
const d = JSON.parse(fs.readFileSync(input, 'utf8'));
fs.mkdirSync(path.join(out, 'diffs'), { recursive: true });
const rows = [];
for (const e of d.changed) {
  const a = (e.first ?? '').split('\n');
  const b = (e.final ?? '').split('\n');
  const ca = new Map(); for (const l of a) ca.set(l, (ca.get(l) ?? 0) + 1);
  const cb = new Map(); for (const l of b) cb.set(l, (cb.get(l) ?? 0) + 1);
  const del = []; const add = [];
  for (const [l, n] of ca) for (let i = 0; i < n - (cb.get(l) ?? 0); i += 1) del.push(l);
  for (const [l, n] of cb) for (let i = 0; i < n - (ca.get(l) ?? 0); i += 1) add.push(l);
  const net = e.final === e.first ? 'unchanged-net' : e.final === null ? 'removed' : del.length && add.length ? 'replace' : del.length ? 'delete-only' : 'add-only';
  rows.push({ id: e.id, first_commit: e.firstCommit, change_commits: e.changes.map((c) => c.commit), net, deleted_lines: del.length, added_lines: add.length });
  if (net !== 'unchanged-net')
    fs.writeFileSync(path.join(out, 'diffs', `${e.id}.txt`), `# ${e.id} — first merged at ${e.firstCommit}; changed at ${e.changes.map((c) => c.commit).join(', ')}\n# multiset line diff (first-merged ⇒ ${d.ref}@${d.head})\n${del.map((l) => `- ${l}`).join('\n')}\n${add.map((l) => `+ ${l}`).join('\n')}\n`);
}
fs.writeFileSync(path.join(out, 'measured.json'), JSON.stringify({ ref: d.ref, head: d.head, first_parent_commits_touching_log: d.commits, changed_entries: rows.length, rows }, null, 1) + '\n');
console.log(rows.length);
