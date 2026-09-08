// اختبار الساعة السيادية — حالة الفشل «انزياح الساعة» من P0 (الخطوة M2.09).
//
// لماذا ساعتان محقونتان لا ساعة النظام: تغيير ساعة الجهاز في اختبار يحتاج
// صلاحية جذر ويُفسد كل ما يعمل بالتوازي معه. والحقن يجعل الانزياح **مقصوداً
// ومقيساً**: ساعة حائط أُحرّكها كما شاء المهاجم، وعدّاد رتيب لا يملكه المهاجم.
// التشغيل: node --test tests/root-of-trust/clock.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CLOCK_STATE_VERSION,
  ClockError,
  ClockErrorCodes,
  SovereignClock,
  SystemClock,
} from '../../src/root-of-trust/index.mjs';

/** ساعتان مُسيطَر عليهما: الحائط يتحرك بالأمر، والرتيب يتقدم بمقدار معلوم. */
function controlled(startWallMs = 1_700_000_000_000) {
  const state = { wall: startWallMs, mono: 0n };
  return {
    state,
    /** @param {number} ms */
    advanceBoth(ms) {
      state.wall += ms;
      state.mono += BigInt(ms) * 1_000_000n;
    },
    /** @param {number} ms وثبة في ساعة الحائط وحدها — أي انزياح */
    jumpWall(ms) {
      state.wall += ms;
    },
    /** @param {number} ms تقدّم العدّاد الرتيب وحده */
    advanceMono(ms) {
      state.mono += BigInt(ms) * 1_000_000n;
    },
    wallClock: () => state.wall,
    monotonic: () => state.mono,
  };
}

/** @param {() => unknown} fn */
function capture(fn) {
  try {
    fn();
  } catch (error) {
    return /** @type {ClockError} */ (error);
  }
  throw new Error('كان يجب أن يفشل ولم يفشل');
}

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'clock-'));
  return { dir, path: join(dir, 'clock-state.json') };
}

test('رموز أخطاء الساعة مثبَّتة نصاً ولا تنحرف بلا قصد', () => {
  assert.deepEqual(
    [...ClockErrorCodes],
    [
      'CLOCK_SKEW_DETECTED',
      'CLOCK_REGRESSED',
      'CLOCK_UNTRUSTED',
      'CLOCK_REQUIRED_IN_PRODUCTION',
      'CLOCK_STATE_CORRUPT',
      'CLOCK_STATE_UNREADABLE',
      'CLOCK_STATE_UNWRITABLE',
      'CLOCK_ATTESTATION_REQUIRED',
    ],
  );
});

test('الساعة تتقدم بلا اعتراض حين يتقدّم القياسان معاً', () => {
  const clock = controlled();
  const sovereign = new SovereignClock({ ...clock, toleranceMs: 100 });
  const first = sovereign.now();
  clock.advanceBoth(5000);
  const second = sovereign.now();
  assert.equal(second - first, 5000);
  assert.equal(sovereign.describe().trusted, true);
  assert.ok(Math.abs(sovereign.describe().lastDriftMs) <= 1);
});

test('وثبة في ساعة الحائط بلا مقابل في العدّاد الرتيب تُكشف وتُبطل الثقة', () => {
  const clock = controlled();
  const sovereign = new SovereignClock({ ...clock, toleranceMs: 1000 });
  sovereign.now();
  clock.jumpWall(60_000);
  const error = capture(() => sovereign.now());
  assert.equal(error.code, 'CLOCK_SKEW_DETECTED');
  assert.equal(sovereign.describe().trusted, false);
  assert.equal(sovereign.describe().reason, 'CLOCK_SKEW_DETECTED');
});

test('انزياح داخل حدّ التسامح لا يُبطل الثقة — الحدّ إعدادٌ لا مزاج', () => {
  const clock = controlled();
  const sovereign = new SovereignClock({ ...clock, toleranceMs: 1000 });
  sovereign.now();
  clock.advanceMono(1000);
  clock.jumpWall(1500); // الفرق 500 ميلي ثانية: تحت الحدّ
  assert.equal(typeof sovereign.now(), 'number');
  assert.equal(sovereign.describe().trusted, true);
});

test('الثقة لا تشفى بنفسها: إعادة الساعة إلى مكانها لا تُلغي الإبطال', () => {
  const clock = controlled();
  const sovereign = new SovereignClock({ ...clock, toleranceMs: 500 });
  sovereign.now();
  clock.jumpWall(30_000);
  assert.equal(capture(() => sovereign.now()).code, 'CLOCK_SKEW_DETECTED');
  clock.jumpWall(-30_000); // المهاجم يُعيد الساعة كي يمرّ فعلُه بلا أثر
  const error = capture(() => sovereign.now());
  assert.equal(error.code, 'CLOCK_SKEW_DETECTED');
  assert.equal(capture(() => sovereign.assertTrusted()).code, 'CLOCK_SKEW_DETECTED');
});

test('الشهادة الصريحة تُعيد الثقة، وبلا سبب تُرفض', () => {
  const clock = controlled();
  const sovereign = new SovereignClock({ ...clock, toleranceMs: 500 });
  sovereign.now();
  clock.jumpWall(30_000);
  capture(() => sovereign.now());
  assert.equal(capture(() => sovereign.attest({ reason: '' })).code, 'CLOCK_ATTESTATION_REQUIRED');
  const described = sovereign.attest({ reason: 'ضبط زمن بعد صيانة، شهد به المالك' });
  assert.equal(described.trusted, true);
  assert.equal(described.attestations, 1);
  clock.advanceBoth(1000);
  assert.equal(typeof sovereign.now(), 'number');
});

test('رجوع الساعة إلى الوراء يُكشف بالحدّ الأعلى ولو أُعيد تشغيل العملية', () => {
  const { dir, path } = workspace();
  try {
    const first = controlled();
    const clockOne = new SovereignClock({ ...first, statePath: path, persistEveryMs: 1 });
    clockOne.now();
    first.advanceBoth(10_000);
    const high = clockOne.now();
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).highWaterMs, high);
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).version, CLOCK_STATE_VERSION);

    // «إعادة تشغيل» بعملية جديدة وساعة حائط أُرجعت ساعةً كاملة إلى الوراء.
    // العدّاد الرتيب يبدأ من الصفر فلا يكشف شيئاً — والحدّ الأعلى هو الكاشف.
    const second = controlled(high - 3_600_000);
    const clockTwo = new SovereignClock({ ...second, statePath: path, toleranceMs: 1000 });
    const error = capture(() => clockTwo.now());
    assert.equal(error.code, 'CLOCK_REGRESSED');
    assert.equal(clockTwo.describe().trusted, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('بلا مسار حالة لا يُكشف الرجوع بين تشغيلين — والنقص مُعلن لا مخفي', () => {
  const clock = controlled();
  const sovereign = new SovereignClock({ ...clock });
  assert.equal(sovereign.describe().statePath, null);
});

test('حالة تالفة على القرص تُرفض ولا تُقرأ حدّاً صفرياً', () => {
  const { dir, path } = workspace();
  try {
    writeFileSync(path, '{ليس JSON');
    assert.equal(
      capture(() => new SovereignClock({ statePath: path })).code,
      'CLOCK_STATE_CORRUPT',
    );
    writeFileSync(path, JSON.stringify({ version: 99, highWaterMs: 1 }));
    assert.equal(
      capture(() => new SovereignClock({ statePath: path })).code,
      'CLOCK_STATE_CORRUPT',
    );
    writeFileSync(path, JSON.stringify({ version: CLOCK_STATE_VERSION, highWaterMs: 'أمس' }));
    assert.equal(
      capture(() => new SovereignClock({ statePath: path })).code,
      'CLOCK_STATE_CORRUPT',
    );
    writeFileSync(path, JSON.stringify({ version: CLOCK_STATE_VERSION, highWaterMs: -5 }));
    assert.equal(
      capture(() => new SovereignClock({ statePath: path })).code,
      'CLOCK_STATE_CORRUPT',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('مسار حالة لا يُقرأ يُرفض ولا يُقرأ غياباً', () => {
  const { dir, path } = workspace();
  try {
    mkdirSync(path); // مجلد مكان ملف: القراءة تفشل بـ EISDIR لا بـ ENOENT
    assert.equal(
      capture(() => new SovereignClock({ statePath: path })).code,
      'CLOCK_STATE_UNREADABLE',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('فشل كتابة الحدّ الأعلى يُبطل الثقة ولا يُتجاوز بصمت', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clock-ro-'));
  const locked = join(dir, 'locked');
  mkdirSync(locked);
  const path = join(locked, 'state.json');
  const clock = controlled();
  const sovereign = new SovereignClock({ ...clock, statePath: path, persistEveryMs: 1 });
  try {
    chmodSync(locked, 0o500); // لا كتابة في المجلد
    const error = capture(() => sovereign.now());
    assert.equal(error.code, 'CLOCK_STATE_UNWRITABLE');
    assert.equal(sovereign.describe().trusted, false);
    // ولا يعود التشغيل بمجرد أن تُصلح الصلاحيات: الإبطال لاصق حتى تشهد شهادة.
    chmodSync(locked, 0o700);
    assert.equal(capture(() => sovereign.now()).code, 'CLOCK_STATE_UNWRITABLE');
    assert.equal(sovereign.attest({ reason: 'أُصلح التخزين وشُهد له' }).trusted, true);
  } finally {
    chmodSync(locked, 0o700);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ساعة النظام العارية تُعلن أنها لا تزعم ثقة', () => {
  const system = new SystemClock();
  const before = Date.now();
  const reading = system.now();
  assert.ok(reading >= before);
  assert.equal(system.assertTrusted(), undefined);
  assert.ok(!(system instanceof SovereignClock));
});

test('خطأ الساعة يحمل رمزه ومقدار انزياحه لا نصاً حرّاً', () => {
  const clock = controlled();
  const sovereign = new SovereignClock({ ...clock, toleranceMs: 100 });
  sovereign.now();
  clock.jumpWall(9000);
  const error = capture(() => sovereign.now());
  assert.ok(error instanceof ClockError);
  assert.equal(error.message, 'CLOCK_SKEW_DETECTED');
  assert.ok(error.driftMs !== null && error.driftMs > 8000);
});
