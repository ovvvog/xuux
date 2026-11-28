// DOC-26 (WL-631). التشغيل من جذرِ المستودع: node <هذا الملف> origin/main /tmp/changed.json
// DOC-26: لكلِّ مُدخلةٍ في سجلِّ الأعمال: نصُّها أوّلَ ظهورِها على الأبِ الأوّلِ لـmain، وكلُّ تغييرٍ لاحق.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { historyEntries, historyFingerprint } from '../../../../scripts/lib/project-state.mjs';
const repo = new URL('../../../../', import.meta.url).pathname;
const ref = process.argv[2] ?? 'origin/main';
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 1 << 30 });
const commits = git('rev-list', '--first-parent', '--reverse', ref, '--', 'docs/roadmap/05-work-log.md').trim().split('\n');
const state = new Map(); // id -> {first, firstCommit, cur, changes:[]}
for (const c of commits) {
  let text;
  try { text = git('show', `${c}:docs/roadmap/05-work-log.md`); } catch { continue; }
  const seen = new Map();
  for (const e of historyEntries(text)) if (!seen.has(e.id)) seen.set(e.id, historyFingerprint(e.text));
  for (const [id, fp] of seen) {
    const s = state.get(id);
    if (!s) { state.set(id, { first: fp, firstCommit: c, cur: fp, changes: [] }); continue; }
    if (s.cur !== fp) { s.changes.push({ commit: c, before: s.cur, after: fp }); s.cur = fp; }
  }
  for (const [id, s] of state) if (!seen.has(id) && s.cur !== null) { s.changes.push({ commit: c, before: s.cur, after: null }); s.cur = null; }
}
const out = [];
for (const [id, s] of state) if (s.changes.length) out.push({ id, firstCommit: s.firstCommit, first: s.first, final: s.cur, changes: s.changes.map((x) => ({ commit: x.commit, removed: x.after === null })) });
fs.writeFileSync(process.argv[3] ?? 'changed.json', JSON.stringify({ ref, head: git('rev-parse', ref).trim(), commits: commits.length, changed: out }, null, 1));
console.log(commits.length, out.length, out.map((x) => x.id).join(' '));
