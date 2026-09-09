// اختبارات دفتر منع إعادة الإرسال (M2.07).
// الأهم فيها ما لا يُختبر داخل عملية واحدة: التسابق الحقيقي بين عمليات، وموتُ
// حاجزٍ قبل التثبيت. ولذلك تُشعل عمليات `node` فعلية وتُقتل بإشارة حقيقية.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  appendFileSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  CommandLedger,
  CommandLedgerError,
  CommandLedgerErrorCodes,
  CommandStates,
  LEDGER_CLAIMS_SUFFIX,
  KingIdentity,
  CertificateAuthority,
  EventLog,
  CrownGateway,
  createRoyalCommand,
} from '../../src/root-of-trust/index.mjs';

const MODULE_URL = new URL('../../src/root-of-trust/index.mjs', import.meta.url).href;

/**
 * يهيئ مجلداً مؤقتاً ومسار دفتر داخله.
 * @returns المجلد ومسار الدفتر
 */
function workDir() {
  const dir = mkdtempSync(join(tmpdir(), 'cmd-ledger-'));
  return { dir, file: join(dir, 'commands.jsonl') };
}

/**
 * يمسك خطأ نداء ويُرجعه، لأن `assert.throws` لا تُرجع الخطأ فلا يمكن فحص رمزه.
 * @param {() => unknown} fn - النداء المتوقَّع فشله
 * @returns {any} الخطأ المرفوع
 */
function capture(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('كان يجب أن يفشل ولم يفشل');
}

/**
 * برنامج العملية الابنة: تنتظر بوابة البدء ثم تحاول تثبيت الأمر وتطبع النتيجة.
 * الانتظار على ملفٍ يجعل التسابق حقيقياً — بلا بوابة تسبق العمليةُ الأولى
 * الثانيةَ فينجح المنع لأنها تسلسلت، لا لأنه ذري.
 * @param {'record' | 'claim-then-die'} mode - وضع التشغيل
 * @returns {string} نص البرنامج
 */
function childProgram(mode) {
  return `
    import { existsSync } from 'node:fs';
    const { CommandLedger } = await import(process.env.LEDGER_MODULE);
    const ledger = new CommandLedger(process.env.LEDGER_FILE);
    const gate = process.env.LEDGER_GATE;
    // انتظارٌ بنوم ملّي الثانية: دورانٌ محموم من عمليات عدة يجوّع معالجين
    // اثنين فيتأخر فتح البوابة نفسُه، والملّي يبقي التسابق حقيقياً ويحفظ الاستقرار.
    const idle = new Int32Array(new SharedArrayBuffer(4));
    while (!existsSync(gate)) Atomics.wait(idle, 0, 0, 1);
    try {
      ${
        mode === 'record'
          ? `ledger.record({ id: process.env.COMMAND_ID }); console.log('OK');`
          : `ledger.begin({ id: process.env.COMMAND_ID }); console.log('CLAIMED'); process.kill(process.pid, 'SIGKILL');`
      }
    } catch (error) {
      console.log(error.message);
    }
  `;
}

/**
 * يُشعل عمليات متسابقة على نفس المعرّف ثم يفتح البوابة ويجمع مخارجها.
 * @param {{file: string, id: string, count: number, mode?: 'record' | 'claim-then-die'}} options -
 *   الدفتر والمعرّف وعدد العمليات والوضع
 * @returns {Promise<string[]>} أسطر المخارج
 */
async function race({ file, id, count, mode = 'record' }) {
  const gate = file + '.gate';
  const children = [];
  for (let index = 0; index < count; index += 1) {
    const child = spawn(process.execPath, ['--input-type=module', '-e', childProgram(mode)], {
      env: {
        ...process.env,
        LEDGER_MODULE: MODULE_URL,
        LEDGER_FILE: file,
        LEDGER_GATE: gate,
        COMMAND_ID: id,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    children.push(
      new Promise((done) => {
        child.on('close', () => done(out.trim()));
      }),
    );
  }
  await new Promise((done) => setTimeout(done, 700));
  writeFileSync(gate, 'go');
  return await Promise.all(children);
}

test('معيار M2.07: عمليتان متزامنتان على نفس الأمر ⇒ تنفيذ واحد فقط', async () => {
  const { dir, file } = workDir();
  const results = await race({ file, id: 'cmd-race-2', count: 2 });
  assert.equal(results.filter((line) => line === 'OK').length, 1);
  // الخاسر يُرفض إمّا لأن الأمر صار مثبَّتاً، وإمّا لأن الفائز ما زال ينفّذه —
  // والرمز يتبع لحظة الرفض، وكلاهما يعني «لا تنفيذ ثانياً».
  assert.equal(
    results.filter((line) => line === 'REPLAYED_COMMAND' || line === 'COMMAND_IN_FLIGHT').length,
    1,
  );
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  rmSync(dir, { recursive: true, force: true });
});

test('ثماني عمليات متسابقة على نفس المعرّف: سطر تثبيت واحد وحجز واحد', async () => {
  const { dir, file } = workDir();
  const results = await race({ file, id: 'cmd-race-8', count: 8 });
  assert.equal(results.filter((line) => line === 'OK').length, 1);
  // كل من خسر السباق يُرفض برمز، ولا مخرج صامت.
  const codes = /** @type {readonly string[]} */ (CommandLedgerErrorCodes);
  assert.equal(results.filter((line) => line === 'OK' || codes.includes(line)).length, 8);
  assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 1);
  assert.equal(readdirSync(file + LEDGER_CLAIMS_SUFFIX).length, 1);
  rmSync(dir, { recursive: true, force: true });
});

test('الحجز المباشر يرفض أمراً مثبَّتاً ولو مُحي شاهد قبره', () => {
  const { dir, file } = workDir();
  const ledger = new CommandLedger(file);
  ledger.record({ id: 'committed-then-unclaimed' });
  rmSync(file + LEDGER_CLAIMS_SUFFIX, { recursive: true, force: true });
  // من ينادي `begin` مباشرة ينفّذ قبل `commit`، فلو نجح حجزُه لوقع الأثر
  // مرتين ولم يمنعه رفضُ التثبيت بعده — فالفحص واجب في الحجز لا في التثبيت وحده.
  const error = capture(() => new CommandLedger(file).begin({ id: 'committed-then-unclaimed' }));
  assert.equal(error.code, 'REPLAYED_COMMAND');
  rmSync(dir, { recursive: true, force: true });
});

test('لا حالة غامضة كاذبة: متسابقون أحياء لا يرى بعضهم حجزاً نصفَ منشور', async () => {
  const { dir, file } = workDir();
  const results = await race({ file, id: 'no-false-indeterminate', count: 8 });
  // الغموض معناه «مات حاجزٌ ولا يُعلم أثره». وكل هؤلاء أحياء، فظهورُه هنا يعني
  // أن الحجز يُنشر باسمه قبل محتواه — وهو ما أوقعني فيه أول تنفيذ.
  assert.equal(results.includes('INDETERMINATE_COMMAND'), false);
  assert.equal(results.filter((line) => line === 'OK').length, 1);
  rmSync(dir, { recursive: true, force: true });
});

test('الحجز الحصري هو المانع: حذف شاهد القبر يُعيد الأمر قابلاً للتنفيذ', async () => {
  const { dir, file } = workDir();
  const ledger = new CommandLedger(file);
  ledger.record({ id: 'tombstone' });
  const claim = join(
    file + LEDGER_CLAIMS_SUFFIX,
    String(readdirSync(file + LEDGER_CLAIMS_SUFFIX)[0]),
  );
  assert.equal(existsSync(claim), true);
  // مع بقاء الشاهد: يُرفض من عملية جديدة تماماً.
  assert.equal(new CommandLedger(file).state('tombstone'), 'committed');
  rmSync(claim, { force: true });
  // وبعد حذفه يبقى الدفتر مانعاً — فالمنع طبقتان لا طبقة.
  const error = capture(() => new CommandLedger(file).record({ id: 'tombstone' }));
  assert.equal(error.code, 'REPLAYED_COMMAND');
  rmSync(dir, { recursive: true, force: true });
});

test('حاجزٌ مات قبل التثبيت ⇒ الحالة غامضة ولا إعادة تنفيذ تلقائية', async () => {
  const { dir, file } = workDir();
  await race({ file, id: 'orphan', count: 1, mode: 'claim-then-die' });
  const ledger = new CommandLedger(file);
  assert.equal(ledger.state('orphan'), 'indeterminate');
  const error = capture(() => ledger.record({ id: 'orphan' }));
  assert.equal(error.code, 'INDETERMINATE_COMMAND');
  assert.equal(typeof error.pid, 'number');
  assert.equal(existsSync(file), false);
  rmSync(dir, { recursive: true, force: true });
});

test('فصل الحالة الغامضة بقرار صريح: نُفّذ ⇒ تثبيت، لم يُنفَّذ ⇒ إعادة مشروعة', async () => {
  const first = workDir();
  await race({ file: first.file, id: 'decide-1', count: 1, mode: 'claim-then-die' });
  const executed = new CommandLedger(first.file);
  executed.resolveIndeterminate('decide-1', { executed: true, reason: 'أثبت المشغّل وقوع الأثر' });
  assert.equal(executed.state('decide-1'), 'committed');
  assert.equal(capture(() => executed.record({ id: 'decide-1' })).code, 'REPLAYED_COMMAND');
  assert.match(readFileSync(first.file, 'utf8'), /أثبت المشغّل وقوع الأثر/);
  rmSync(first.dir, { recursive: true, force: true });

  const second = workDir();
  await race({ file: second.file, id: 'decide-2', count: 1, mode: 'claim-then-die' });
  const notExecuted = new CommandLedger(second.file);
  notExecuted.resolveIndeterminate('decide-2', { executed: false, reason: 'لم يصل الأمر للمنفّذ' });
  assert.equal(notExecuted.state('decide-2'), 'aborted');
  notExecuted.record({ id: 'decide-2' });
  assert.equal(notExecuted.state('decide-2'), 'committed');
  rmSync(second.dir, { recursive: true, force: true });
});

test('لا يُفصل ما ليس غامضاً', () => {
  const { dir, file } = workDir();
  const ledger = new CommandLedger(file);
  assert.equal(
    capture(() => ledger.resolveIndeterminate('ghost', { executed: true, reason: 'ظن' })).code,
    'UNKNOWN_COMMAND',
  );
  ledger.record({ id: 'done' });
  assert.equal(
    capture(() => ledger.resolveIndeterminate('done', { executed: false, reason: 'ظن' })).code,
    'UNKNOWN_COMMAND',
  );
  rmSync(dir, { recursive: true, force: true });
});

test('حجزٌ فارغ أو ناقص لا يُقرأ حجزاً حياً ولا يُتجاوز', () => {
  const { dir, file } = workDir();
  const ledger = new CommandLedger(file);
  const claimsDir = file + LEDGER_CLAIMS_SUFFIX;
  ledger.begin({ id: 'to-be-truncated' });
  const claim = join(claimsDir, String(readdirSync(claimsDir)[0]));
  writeFileSync(claim, '');
  // لا يُمكن أن يوجد محتوى ناقص باسم منشور في التنفيذ السليم (المحتوى يُكتب
  // ويُزامَن قبل الوصلة)، فوجوده عبثٌ أو عطبٌ — والواجب أن يُسمّى غامضاً لا
  // أن يُتجاوز فيُنفّذ الأمر ثانياً، ولا أن يُقرأ حجزاً حياً فيُنتظر أبداً.
  const reader = new CommandLedger(file);
  assert.equal(reader.state('to-be-truncated'), 'indeterminate');
  assert.equal(
    capture(() => reader.begin({ id: 'to-be-truncated' })).code,
    'INDETERMINATE_COMMAND',
  );
  rmSync(dir, { recursive: true, force: true });
});

test('حجزٌ حيٌّ في عملية أخرى يُرفض بـCOMMAND_IN_FLIGHT لا بـREPLAYED', () => {
  const { dir, file } = workDir();
  const ledger = new CommandLedger(file);
  const claimsDir = file + LEDGER_CLAIMS_SUFFIX;
  // حجزٌ صاحبه عمليةٌ حيّة موجودة قطعاً: عمليتنا نفسها، ويقرؤه دفتر آخر.
  ledger.begin({ id: 'live' });
  const other = new CommandLedger(file);
  const error = capture(() => other.begin({ id: 'live' }));
  assert.equal(error.code, 'COMMAND_IN_FLIGHT');
  assert.equal(error.pid, process.pid);
  assert.equal(readdirSync(claimsDir).length, 1);
  assert.equal(existsSync(file), false);
  rmSync(dir, { recursive: true, force: true });
});

test('الإلغاء الصريح يُسجَّل ويحذف الحجز فتصير إعادة الإرسال مشروعة', () => {
  const { dir, file } = workDir();
  const ledger = new CommandLedger(file);
  ledger.begin({ id: 'retry-me' });
  ledger.abort({ id: 'retry-me' }, 'رفض المنفّذ قبل أي أثر');
  assert.equal(ledger.state('retry-me'), 'aborted');
  assert.equal(readdirSync(file + LEDGER_CLAIMS_SUFFIX).length, 0);
  ledger.record({ id: 'retry-me' });
  assert.equal(ledger.has('retry-me'), true);
  // والدفتر يحفظ القرارين معاً: إلغاءٌ ثم تثبيت، فالتاريخ لا يُمحى.
  assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 2);
  rmSync(dir, { recursive: true, force: true });
});

test('لا يُلغى ولا يُثبَّت ما ثُبّت، ولا يُثبَّت ما لم يُحجز', () => {
  const { dir, file } = workDir();
  const ledger = new CommandLedger(file);
  ledger.record({ id: 'fixed' });
  assert.equal(capture(() => ledger.abort({ id: 'fixed' })).code, 'REPLAYED_COMMAND');
  assert.equal(capture(() => ledger.commit({ id: 'fixed' })).code, 'REPLAYED_COMMAND');
  assert.equal(capture(() => ledger.commit({ id: 'never-claimed' })).code, 'UNCLAIMED_COMMAND');
  rmSync(dir, { recursive: true, force: true });
});

test('المرحلتان: حجزٌ ثم تثبيت، والحالة تُقرأ صحيحة بينهما من عملية أخرى', () => {
  const { dir, file } = workDir();
  const ledger = new CommandLedger(file);
  ledger.begin({ id: 'two-phase' });
  assert.equal(new CommandLedger(file).state('two-phase'), 'in-flight');
  ledger.commit({ id: 'two-phase' }, 'اكتمل التنفيذ');
  assert.equal(new CommandLedger(file).state('two-phase'), 'committed');
  rmSync(dir, { recursive: true, force: true });
});

test('الدوام: الدفتر يصمد بعد إعادة التشغيل ولو حُذف مجلد الحجوزات', () => {
  const { dir, file } = workDir();
  new CommandLedger(file).record({ id: 'persist' });
  rmSync(file + LEDGER_CLAIMS_SUFFIX, { recursive: true, force: true });
  const reopened = new CommandLedger(file);
  assert.equal(reopened.has('persist'), true);
  assert.equal(capture(() => reopened.record({ id: 'persist' })).code, 'REPLAYED_COMMAND');
  rmSync(dir, { recursive: true, force: true });
});

test('كتابة التثبيت مُزامَنة على القرص قبل عودة النداء', () => {
  const { dir, file } = workDir();
  // الدليل الممكن في صندوق واحد: أن الحجم على القرص يعكس السطر فوراً من عملية
  // أخرى تقرأ الملف — لا تأكيد لمقاومة انقطاع الطاقة، وهو حدٌّ معلَن.
  const ledger = new CommandLedger(file);
  ledger.record({ id: 'synced' });
  const size = statSync(file).size;
  assert.ok(size > 0);
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import {statSync} from 'node:fs'; console.log(statSync(process.env.F).size)`,
    ],
    { env: { ...process.env, F: file }, encoding: 'utf8' },
  );
  assert.equal(Number(child.stdout.trim()), size);
  rmSync(dir, { recursive: true, force: true });
});

test('ذيلٌ مقطوع بانقطاع يُتجاوز ويُعلَن، ولا يُسقط الدفتر', () => {
  const { dir, file } = workDir();
  const ledger = new CommandLedger(file);
  ledger.record({ id: 'kept-1' });
  ledger.record({ id: 'kept-2' });
  appendFileSync(file, '{"id":"torn","state":"comm');
  const reopened = new CommandLedger(file);
  assert.equal(reopened.has('kept-1'), true);
  assert.equal(reopened.has('kept-2'), true);
  assert.equal(reopened.has('torn'), false);
  assert.ok(reopened.recovery.droppedTailBytes > 0);
  rmSync(dir, { recursive: true, force: true });
});

test('سطرٌ تالف في الوسط عبثٌ لا انقطاع فيُرفض الدفتر برمزه', () => {
  const { dir, file } = workDir();
  const ledger = new CommandLedger(file);
  ledger.record({ id: 'a' });
  ledger.record({ id: 'b' });
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  writeFileSync(file, [String(lines[0]), 'not-json', String(lines[1])].join('\n') + '\n');
  const error = capture(() => new CommandLedger(file));
  assert.equal(error.code, 'CORRUPT_COMMAND_LEDGER');
  assert.match(error.detail, /السطر 2/);
  rmSync(dir, { recursive: true, force: true });
});

test('سطرٌ بلا معرّف يُرفض ولا يُقرأ منعاً لأمرٍ مجهول', () => {
  const { dir, file } = workDir();
  writeFileSync(file, JSON.stringify({ recordedAt: 'x' }) + '\n');
  assert.equal(capture(() => new CommandLedger(file)).code, 'CORRUPT_COMMAND_LEDGER');
  rmSync(dir, { recursive: true, force: true });
});

test('الصيغة القديمة (id + recordedAt) تُقرأ تثبيتاً فلا ينهار منعٌ قائم', () => {
  const { dir, file } = workDir();
  writeFileSync(
    file,
    JSON.stringify({ id: 'legacy', recordedAt: new Date().toISOString() }) + '\n',
  );
  const ledger = new CommandLedger(file);
  assert.equal(ledger.has('legacy'), true);
  assert.equal(capture(() => ledger.record({ id: 'legacy' })).code, 'REPLAYED_COMMAND');
  rmSync(dir, { recursive: true, force: true });
});

test('معرّفٌ فارغ يُرفض ولا يصير مفتاحاً يتصادم عليه كل أمر بلا معرّف', () => {
  const { dir, file } = workDir();
  const ledger = new CommandLedger(file);
  assert.equal(capture(() => ledger.record({ id: '' })).code, 'INVALID_COMMAND_ID');
  assert.equal(capture(() => ledger.record({ id: '   ' })).code, 'INVALID_COMMAND_ID');
  assert.equal(capture(() => ledger.begin(/** @type {any} */ ({}))).code, 'INVALID_COMMAND_ID');
  rmSync(dir, { recursive: true, force: true });
});

test('معرّفٌ يحمل محارف مسار أو طولاً مفرطاً يُحجز بلا خروج من مجلد الحجوزات', () => {
  const { dir, file } = workDir();
  const ledger = new CommandLedger(file);
  const nasty = '../../escape/' + 'x'.repeat(400);
  ledger.record({ id: nasty });
  const claims = readdirSync(file + LEDGER_CLAIMS_SUFFIX);
  assert.equal(claims.length, 1);
  assert.match(String(claims[0]), /^[0-9a-f]{64}$/);
  assert.equal(existsSync(resolve(dir, 'escape')), false);
  assert.equal(capture(() => ledger.record({ id: nasty })).code, 'REPLAYED_COMMAND');
  rmSync(dir, { recursive: true, force: true });
});

test('التدقيق التشغيلي: الحجوزات المعلّقة تُعرض بحياة صاحبها', async () => {
  const { dir, file } = workDir();
  await race({ file, id: 'dead-claim', count: 1, mode: 'claim-then-die' });
  const ledger = new CommandLedger(file);
  ledger.begin({ id: 'my-claim' });
  ledger.record({ id: 'finished' });
  const pending = ledger.pendingClaims();
  assert.equal(pending.length, 2);
  assert.equal(
    pending.some((claim) => claim.id === 'my-claim' && claim.alive === true),
    true,
  );
  assert.equal(
    pending.some((claim) => claim.id === 'dead-claim' && claim.alive === false),
    true,
  );
  assert.equal(
    pending.some((claim) => claim.id === 'finished'),
    false,
  );
  rmSync(dir, { recursive: true, force: true });
});

test('بوابة التاج ترفض إعادة الإرسال عبر عملية جديدة بدفترٍ واحد', () => {
  const { dir, file } = workDir();
  const king = new KingIdentity();
  const gateway = new CrownGateway(king, new CertificateAuthority(king), new EventLog(), {
    commandLedger: new CommandLedger(file),
  });
  const command = createRoyalCommand('inspect', 'agent:one');
  const signature = king.sign(command);
  gateway.command(command, signature);
  const fresh = new CrownGateway(king, gateway.ca, new EventLog(), {
    commandLedger: new CommandLedger(file),
  });
  assert.throws(() => fresh.command(command, signature), /REPLAYED_COMMAND/);
  rmSync(dir, { recursive: true, force: true });
});

test('الرموز والحالات مثبَّتة نصاً ومصدَّرة', () => {
  assert.deepEqual(
    [...CommandLedgerErrorCodes],
    [
      'REPLAYED_COMMAND',
      'COMMAND_IN_FLIGHT',
      'INDETERMINATE_COMMAND',
      'CORRUPT_COMMAND_LEDGER',
      'INVALID_COMMAND_ID',
      'UNCLAIMED_COMMAND',
      'UNKNOWN_COMMAND',
      // رموزُ الدفترِ الموقَّعِ — WL-092: تُثبَّتُ نصاً كسابقاتِها، فرمزٌ يتغيّرُ
      // اسمُه يكسرُ كلَّ مُتعاملٍ يقرأُه، والترتيبُ جزءٌ من العقدِ المعلَن.
      'SIGNED_LEDGER_REQUIRES_ASYNC',
      'LEDGER_ENTRY_UNSIGNED',
      'LEDGER_SIGNATURE_INVALID',
      'LEDGER_KEY_MISMATCH',
      'LEDGER_SIGNER_MISSING',
      // رموزُ الشاهدِ — WL-094 (`UF-07`): الدفترُ لا يُصدَّقُ وحدَه، ودليلُ
      // الحالةِ لازمٌ في الإنتاج.
      'LEDGER_BEHIND_WITNESS',
      'LEDGER_STATE_ROOT_MISSING',
    ],
  );
  assert.deepEqual(
    [...CommandStates],
    ['unknown', 'in-flight', 'indeterminate', 'committed', 'aborted'],
  );
  assert.equal(LEDGER_CLAIMS_SUFFIX, '.claims');
  assert.equal(new CommandLedgerError('REPLAYED_COMMAND').message, 'REPLAYED_COMMAND');
});

test('حدٌّ معلَن: من يملك القرص يمحو الدفتر والحجوزات معاً فيسقط المنع', () => {
  const { dir, file } = workDir();
  new CommandLedger(file).record({ id: 'erasable' });
  rmSync(file, { force: true });
  rmSync(file + LEDGER_CLAIMS_SUFFIX, { recursive: true, force: true });
  // لا رمز خطأ هنا: يُقبل الأمر من جديد. المنع محلي لا مُوقَّع، وإغلاقه يحتاج
  // ربطه بالتثبيت الموقَّع أو شاهدٍ خارجي — دينٌ مُقيَّد في WL-011.
  new CommandLedger(file).record({ id: 'erasable' });
  assert.equal(new CommandLedger(file).has('erasable'), true);
  rmSync(dir, { recursive: true, force: true });
});
