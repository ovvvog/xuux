// اختبارُ حاجزِ العقدِ المنشورِ — `WL-194` (إغلاقُ الدَينِ `D-2`)، أُضيفَ مع الحاجزِ نفسِه.
//
// **العيبُ الذي يُغلَقُ:** `docs/API_CONTRACT.json` ملفٌّ مُقيَّدٌ يقرأُه مستهلِكٌ
// خارجيٌّ. وملفٌّ يُولَّدُ مرّةً ثمّ يُنسى **يكذبُ بصمتٍ**، فيُبنى العميلُ على وعدٍ
// لا يُخدَمُ. والحاجزُ يُعيدُ التوليدَ ويُقارِنُ.
//
// **وحاجزٌ يُقاسُ بقراءةِ سطورِه قد يكونُ كلُّه رسائلَ:** فهنا يُشغَّلُ **عمليّةً
// منفصلةً** على جذورٍ مصنوعةٍ ويُقاسُ **رمزُ خروجِه**. وأربعُ حالاتٍ:
//   ① جذرٌ مطابقٌ → `0`.
//   ② عقدٌ مُحرَّفٌ (مسارٌ بُدِّلَ) → `1` ويُسمّى الانزياحُ.
//   ③ عقدٌ مفقودٌ → `1`.
//   ④ عقدٌ يحملُ ما يُشبِهُ مادّةَ مفتاحٍ → `1`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const guard = path.join(repoRoot, 'scripts', 'guard-api-contract.mjs');
const CONTRACT = path.join('docs', 'API_CONTRACT.json');

/**
 * يبني جذراً مصنوعاً بأقلِّ ما يقرأُه الحاجزُ: وثيقةُ الطبقةِ، والعقدُ المُقيَّدُ،
 * والمولِّدُ المُعلَنُ.
 * @returns {string}
 */
function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'api-contract-'));
  fs.cpSync(path.join(repoRoot, 'config'), path.join(root, 'config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, CONTRACT), path.join(root, CONTRACT));
  fs.copyFileSync(
    path.join(repoRoot, 'scripts', 'api-contract.mjs'),
    path.join(root, 'scripts', 'api-contract.mjs'),
  );
  return root;
}

/**
 * @param {string} root
 * @returns {{ status: number, output: string }}
 */
function runGuard(root) {
  const result = spawnSync(process.execPath, [guard, '--root', root], { encoding: 'utf8' });
  return { status: result.status ?? -1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

test('جذرٌ مطابقٌ يُقبَلُ برمزِ خروجٍ صفرٍ', (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const verdict = runGuard(root);
  assert.equal(verdict.status, 0, verdict.output);
});

test('عقدٌ مُحرَّفٌ يُفشِلُ الحاجزَ ويُسمّى انزياحُه', (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, CONTRACT);
  const contract = JSON.parse(fs.readFileSync(file, 'utf8'));
  contract.routes[0].path = '/state/not-declared';
  fs.writeFileSync(file, `${JSON.stringify(contract, null, 2)}\n`);
  const verdict = runGuard(root);
  assert.equal(verdict.status, 1, verdict.output);
  assert.match(verdict.output, /R2/);
});

test('ترويسةٌ مُبدَّلةٌ في العقدِ تُفشِلُ الحاجزَ — فالعميلُ يُوقِّعُ حيثُ لا يُقرأُ', (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, CONTRACT);
  const contract = JSON.parse(fs.readFileSync(file, 'utf8'));
  contract.headers.popSignature = 'x-state-signature';
  fs.writeFileSync(file, `${JSON.stringify(contract, null, 2)}\n`);
  const verdict = runGuard(root);
  assert.equal(verdict.status, 1, verdict.output);
  assert.match(verdict.output, /R2/);
});

test('عقدٌ مفقودٌ يُفشِلُ الحاجزَ لا يُتجاوَزُ', (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.rmSync(path.join(root, CONTRACT));
  const verdict = runGuard(root);
  assert.equal(verdict.status, 1, verdict.output);
  assert.match(verdict.output, /R1/);
});

test('عقدٌ يحملُ ما يُشبِهُ مادّةَ مفتاحٍ يُفشِلُ الحاجزَ', (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, CONTRACT);
  const contract = JSON.parse(fs.readFileSync(file, 'utf8'));
  // **تُركَّبُ العَلامةُ من شَطرَينِ لا تُكتَبُ كتلةً واحدةً**: فاحصُ الأسرارِ
  // يقرأُ الشجرةَ كلَّها ويَرفضُ كتلةَ مفتاحٍ خاصٍّ حيثُ وُجِدَتْ — ولو في تزويرٍ
  // اختباريٍّ. والمقصودُ قياسُ القاعدةِ `R4` لا إدخالُ نصٍّ يُشبِهُ السرَّ في المستودعِ،
  // ولا استثناءُ الملفِّ من الفحصِ (فاستثناءٌ يُكتَبُ اليومَ يُنسى غداً).
  contract.leaked = `-----BEGIN ${'PRIVATE'} KEY-----`;
  fs.writeFileSync(file, `${JSON.stringify(contract, null, 2)}\n`);
  const verdict = runGuard(root);
  assert.equal(verdict.status, 1, verdict.output);
  assert.match(verdict.output, /R4/);
});
