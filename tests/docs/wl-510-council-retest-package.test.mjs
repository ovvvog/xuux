// tests/docs/wl-510-council-retest-package.test.mjs
//
// WL-510 — مصفوفةُ إعادةِ الاختبارِ في docs/decisions/WL-510-council-retest-package.md تساوي النتائجَ المفتوحةَ في
// config/external-review.yaml تمامًا (المعرّفُ والعقدُ والشدّة)، ولا تحوي حكمًا لم يصدر.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('../../', import.meta.url));
/** @type {{ findings: Array<{ id: string, status: string, engagement: string, severity: string }> }} */
const contract = parse(readFileSync(join(root, 'config/external-review.yaml'), 'utf8'));
const doc = readFileSync(join(root, 'docs/decisions/WL-510-council-retest-package.md'), 'utf8');
/** @type {Record<string, string>} */
const SEV = { high: 'عالية', medium: 'متوسطة', low: 'منخفضة' };

function matrixRows() {
  const start = doc.indexOf('## 2. مصفوفةُ إعادةِ الاختبار');
  const end = doc.indexOf('### 2.1', start);
  assert.ok(start > 0 && end > start, 'matrix section present');
  return doc
    .slice(start, end)
    .split('\n')
    .filter((l) => /^\| `[^`]+` \|/.test(l))
    .map((l) => {
      const cells = l.split(' | ');
      return {
        id: String(cells[0]).replace(/^\| `|`$/g, ''),
        engagement: cells[1],
        severity: cells[2],
      };
    });
}

test('المصفوفةُ = النتائجُ المفتوحةُ في العقد (المعرّف، العقد، الشدّة)، بلا زيادةٍ ولا نقص', () => {
  const open = contract.findings.filter((f) => f.status === 'open');
  const rows = matrixRows();
  assert.equal(rows.length, open.length);
  assert.deepEqual(rows.map((r) => r.id).sort(), open.map((f) => f.id).sort());
  for (const f of open) {
    const r = rows.find((x) => x.id === f.id);
    assert.ok(r, f.id);
    assert.equal(r.engagement, f.engagement, f.id);
    assert.equal(r.severity, SEV[f.severity], f.id);
  }
});

test('الحزمةُ لا تسجّلُ حكمًا لم يصدر: لا عمودَ حكمٍ ولا «closed» منسوبًا إلى هذه الجولة', () => {
  const rows = doc.split('\n').filter((l) => /^\| `[^`]+` \|/.test(l));
  for (const l of rows) assert.doesNotMatch(l, /`closed`/, l.slice(0, 40));
  assert.match(doc, /لم تُطلَقْ/);
});

test('CO55-M11.05-R3-01: الأحكامُ السابقةُ مفصولةٌ عن الحالةِ الرسميّة، والحالةُ في العقدِ ما زالت open', () => {
  const f = contract.findings.find((x) => x.id === 'CO55-M11.05-R3-01');
  assert.ok(f);
  assert.equal(f.status, 'open');
  assert.match(doc, /أحكامٌ سابقةٌ بالإغلاق ≠ إغلاقٌ رسميّ/);
  for (const p of [
    'docs/external-review/reports/M11.05-round-7-model-council-report-gpt-6-1-sol.md',
    'docs/external-review/reports/M11.05-round-7-model-council-report-claude-opus-5-5.md',
  ]) {
    assert.ok(readFileSync(join(root, p)).length > 0, p);
  }
});
