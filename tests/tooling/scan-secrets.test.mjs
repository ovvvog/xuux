// اختبار فاحص الأسرار — يثبت معيار قبول الخطوة M0.08
// التشغيل: node --test tests/tooling/scan-secrets.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scanText, scanRepository, redact, PATTERNS } from '../../scripts/scan-secrets.mjs';

/** يبني مستودعًا مؤقتًا للفحص. */
function makeRepo(files) {
  const root = mkdtempSync(join(tmpdir(), 'secret-scan-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
  return root;
}

test('يقبل مستودعًا نظيفًا بلا مخالفات', () => {
  const root = makeRepo({
    'src/a.mjs': "export const greet = () => 'مرحبًا';\n",
    'config/policy.yaml': 'roles:\n  - name: auditor\n',
    'README.md': '# مشروع\n\nنص عادي بلا أسرار.\n',
  });
  try {
    assert.deepEqual(scanRepository(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('يكشف توكن GitHub المزروع ويفشل', () => {
  const planted = `ghp_${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'}`;
  const root = makeRepo({ '.env.local': `GITHUB_TOKEN=${planted}\n` });
  try {
    const findings = scanRepository(root);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].id, 'GITHUB_PAT_CLASSIC');
    assert.equal(findings[0].file, '.env.local');
    assert.equal(findings[0].line, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('يكشف كتلة مفتاح خاص — أخطر حالة على جذر الثقة', () => {
  const findings = scanText('-----BEGIN OPENSSH PRIVATE KEY-----', 'keys.txt');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].id, 'PRIVATE_KEY_BLOCK');
});

test('يرفض ملفات مواد المفاتيح بامتدادها وحده', () => {
  const root = makeRepo({ 'certs/king.pem': 'أي محتوى\n', 'certs/agent.key': 'أي محتوى\n' });
  try {
    const ids = scanRepository(root).map((f) => f.id);
    assert.deepEqual(new Set(ids), new Set(['FORBIDDEN_KEY_FILE']));
    assert.equal(ids.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('يكشف مفاتيح AWS و Slack و JWT وسلاسل الاتصال', () => {
  const cases = [
    ['AKIAIOSFODNN7EXAMPLE', 'AWS_ACCESS_KEY_ID'],
    ['xoxb-123456789012-abcdefghijklmnop', 'SLACK_TOKEN'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop', 'JWT'],
    ['postgresql://admin:sup3rs3cret@db.internal:5432/state', 'CONNECTION_STRING_WITH_PASSWORD'],
  ];
  for (const [sample, expectedId] of cases) {
    const ids = scanText(sample, 'x').map((f) => f.id);
    assert.ok(ids.includes(expectedId), `لم يُكشف ${expectedId} في: ${sample}`);
  }
});

test('يكشف إسناد سر بقيمة حرفية طويلة', () => {
  const findings = scanText("const api_key = 'abcdefghijklmnopqrstuvwxyz012345';", 'x.mjs');
  assert.equal(findings[0].id, 'GENERIC_SECRET_ASSIGNMENT');
});

test('يتجاوز السطر المُعلَّم صراحةً كمثال توثيقي', () => {
  const planted = `ghp_${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'}`;
  assert.deepEqual(scanText(`مثال: ${planted} secret-scan:allow`, 'doc.md'), []);
});

test('يحجب السر في التقرير ولا يطبعه كاملًا', () => {
  const planted = `ghp_${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'}`;
  const excerpt = scanText(`TOKEN=${planted}`, 'x')[0].excerpt;
  assert.ok(!excerpt.includes(planted), 'يجب ألا يظهر السر كاملًا في التقرير');
  assert.ok(excerpt.includes('*'), 'يجب أن يكون المقتطف محجوبًا');
  assert.equal(redact('abc'), '***');
});

test('يتخطى التبعيات والبناء فلا يُبطئ ولا يُنبّه زورًا', () => {
  const planted = `ghp_${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'}`;
  const root = makeRepo({
    'node_modules/pkg/index.js': `const t='${planted}';\n`,
    'dist/bundle.js': `const t='${planted}';\n`,
  });
  try {
    assert.deepEqual(scanRepository(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('كل نمط له معرّف وسبب — حتى يكون التقرير مفهومًا', () => {
  assert.ok(PATTERNS.length >= 10);
  for (const p of PATTERNS) {
    assert.ok(p.id && p.id === p.id.toUpperCase(), `معرّف غير صالح: ${p.id}`);
    assert.ok(p.reason && p.reason.length > 5, `سبب ناقص للنمط ${p.id}`);
    assert.ok(p.re instanceof RegExp);
  }
});
