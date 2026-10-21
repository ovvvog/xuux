import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const file = '/tmp/council-wl437-r3/gpt_6_1_sol/report.md';
const s = readFileSync(file, 'utf8');
const items = [...s.matchAll(/^## البند (\d): الحكم (holds|open)/gm)].map(m => [Number(m[1]), m[2]]);
assert.deepEqual(items, [[1,'holds'],[2,'holds'],[3,'holds'],[4,'holds'],[5,'open'],[6,'open']]);
const rows = [...s.matchAll(/^\| `(WL437-gpt_6_1_sol-(?:R2-)?\d{2})` \| \*\*(addressed|partially|not-addressed)\*\*/gm)];
assert.equal(rows.length, 11);
assert.equal(new Set(rows.map(m => m[1])).size, 11);
assert.equal(rows.filter(m => m[2] === 'addressed').length, 10);
assert.equal(rows.filter(m => m[2] === 'partially').length, 1);
const fresh = [...s.matchAll(/^### (WL437-gpt_6_1_sol-R3-\d{2}) — (critical|high|medium|low)/gm)];
assert.equal(fresh.length, 5);
assert.equal(fresh.filter(m => m[2] === 'medium').length, 4);
assert.equal(fresh.filter(m => m[2] === 'low').length, 1);
assert(!/\b(verified|approved|secure|ready|passed)\b/i.test(s));
assert(!/يُثبّت أدناه/.test(s));
const local = [...s.matchAll(/\]\((file:\/\/\/[^)]+)\)/g)].map(m => m[1]);
for (const link of new Set(local)) {
  const u = new URL(link);
  const line = /^#L(\d+)/.exec(u.hash);
  u.hash = '';
  const p = fileURLToPath(u);
  assert(existsSync(p), `Missing citation target: ${p}`);
  if (line) {
    assert(Number(line[1]) <= readFileSync(p,'utf8').split('\n').length, `Line beyond file: ${link}`);
  }
}
console.log(JSON.stringify({
  report: file,
  items,
  previous: rows.map(m => ({id:m[1],status:m[2]})),
  newFindings: fresh.map(m => ({id:m[1],severity:m[2]})),
  localCitationCount: local.length,
  allLocalTargetsExist: true,
  forbiddenJudgmentTokens: 0,
  reportBytes: Buffer.byteLength(s),
}, null, 2));
