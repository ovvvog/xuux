// @ts-nocheck
// WL-302 — سلسلةُ الأمرِ الملكيِّ على مفتاحِ الإيقافِ: الأصالةُ ثمّ التفويض.
//
// كلُّ اختبارٍ هنا كانَ يسقطُ على `main@5222c40e` قبلَ هذه الدفعةِ:
//   - أمرُ استئنافٍ موقَّعٌ قديمٌ كانَ يُعادُ بعدَ إيقافٍ أحدثَ فيُلغيه (‏إعادةُ إرسالٍ).
//   - والأمرُ نفسُه كانَ يُقبَلُ بعدَ إعادةِ التشغيلِ.
//   - وأمرٌ موقَّعٌ قبلَ أيّامٍ كانَ يُقبَلُ (‏لا حداثة).
//   - والسببُ المختومُ في الأمرِ لم يكن مربوطاً بالسببِ المُسجَّل.
//   - ومتنٌ موقَّعٌ بالمفتاحِ نفسِه لغرضٍ آخرَ لم يكن مفصولاً بنطاق.
//   - والرفضُ لم يكن يُسجَّلُ في الأثر.
//   - و`createProductionRootOfTrust` كانَ يقبلُ مُحقِّقاً محقوناً `() => true`.
//   - و`ExecutionKernel.stop/resume` و`CrownGateway.stop/resume` كانت تُبدِّلُ
//     الوضعَ الآمنَ في الإنتاجِ بنداءِ دالّةٍ ونصِّ فاعل.

import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HaltSwitch, KingIdentity } from '../../src/root-of-trust/index.mjs';
import {
  ROYAL_COMMAND_DOMAIN,
  canonicalRoyalCommand,
  createRoyalCommandVerifier,
  trustedRoyalVerifierFingerprint,
} from '../../src/root-of-trust/royal-command.mjs';
import { ExecutionKernel } from '../../src/core/execution-kernel.mjs';
import { signRoyalCommand, kingIdOfPublicKey } from '../helpers/royal-halt-command.mjs';

const PROD = { NODE_ENV: 'production', STATE_ENV: 'production' };

function rig({ clock = null, log = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wl302-'));
  const file = join(dir, 'directive.json');
  const signer = new KingIdentity();
  const pair = generateKeyPairSync('ed25519');
  const verifier = createRoyalCommandVerifier(
    String(pair.publicKey.export({ type: 'spki', format: 'pem' })),
  );
  const events = [];
  const sink = log ?? { append: (type, actor, data) => events.push({ type, actor, data }) };
  const open = () =>
    new HaltSwitch(file, signer, {
      fsync: false,
      royalCommandVerifier: verifier,
      log: sink,
      ...(clock ? { clock } : {}),
    });
  return { dir, pair, open, events, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function cmd(pair, halt, operation, reason, extra = {}) {
  return signRoyalCommand(pair, { operation, reason, targetEpoch: halt.read().epoch, ...extra });
}

test('WL-302: أمرُ استئنافٍ موقَّعٌ لا يُعادُ بعدَ إيقافٍ أحدث (إعادةُ إرسال)', () => {
  const r = rig();
  try {
    const halt = r.open();
    halt.halt('أوّل', cmd(r.pair, halt, 'halt', 'أوّل'));
    const resumeCmd = cmd(r.pair, halt, 'resume', 'استئناف');
    halt.resume('استئناف', resumeCmd);
    halt.halt('ثانٍ', cmd(r.pair, halt, 'halt', 'ثانٍ'));
    assert.throws(() => halt.resume('استئناف', resumeCmd), {
      code: 'HALT_ROYAL_COMMAND_STALE_EPOCH',
    });
    assert.equal(halt.read().state, 'halted', 'الإيقافُ الأحدثُ قائم');
  } finally {
    r.cleanup();
  }
});

test('WL-302: الأمرُ المنفَّذُ لا يُعادُ بعدَ إعادةِ التشغيل', () => {
  const r = rig();
  try {
    const first = r.open();
    const haltCmd = cmd(r.pair, first, 'halt', 'إيقاف');
    first.halt('إيقاف', haltCmd);
    const resumeCmd = cmd(r.pair, first, 'resume', 'استئناف');
    first.resume('استئناف', resumeCmd);
    const second = r.open(); // نسخةٌ جديدةٌ على القرصِ نفسِه = إعادةُ تشغيل
    assert.throws(() => second.halt('إيقاف', haltCmd), { code: 'HALT_ROYAL_COMMAND_STALE_EPOCH' });
    assert.equal(second.read().state, 'running');
  } finally {
    r.cleanup();
  }
});

test('WL-302: أمرٌ صحيحُ التوقيعِ قديمٌ يُرفَض، وأمرٌ من المستقبلِ يُرفَض', () => {
  const r = rig();
  try {
    const halt = r.open();
    const old = cmd(r.pair, halt, 'halt', 'قديم', { at: '2020-01-01T00:00:00.000Z' });
    assert.throws(() => halt.halt('قديم', old), { code: 'HALT_ROYAL_COMMAND_EXPIRED' });
    const future = cmd(r.pair, halt, 'halt', 'مستقبل', {
      at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    assert.throws(() => halt.halt('مستقبل', future), { code: 'HALT_ROYAL_COMMAND_FROM_FUTURE' });
    assert.equal(halt.read().state, 'running');
  } finally {
    r.cleanup();
  }
});

test('WL-302: الحداثةُ تُقاسُ بالساعةِ الموثوقةِ لا بساعةِ الجهاز', () => {
  // الساعةُ الموثوقةُ متأخّرةٌ ساعتين عن الجهاز: أمرٌ «حديثٌ» بساعةِ الجهازِ من المستقبلِ عندها.
  const r = rig({ clock: { now: () => Date.now() - 7_200_000 } });
  try {
    const halt = r.open();
    assert.throws(() => halt.halt('x', cmd(r.pair, halt, 'halt', 'x')), {
      code: 'HALT_ROYAL_COMMAND_FROM_FUTURE',
    });
  } finally {
    r.cleanup();
  }
});

test('WL-302: ساعةٌ موثوقةٌ تسقطُ (بلا برهان) ⇒ رفضٌ لا رجوعٌ إلى ساعةِ الجهاز', () => {
  const r = rig({
    clock: {
      now: () => {
        throw new Error('ATTESTED_TIME_REQUIRED');
      },
    },
  });
  try {
    const halt = r.open();
    assert.throws(() => halt.halt('x', cmd(r.pair, halt, 'halt', 'x')), {
      code: 'HALT_TRUSTED_CLOCK_REQUIRED',
    });
  } finally {
    r.cleanup();
  }
});

test('WL-302: السببُ المسجَّلُ هو المختومُ في الأمر', () => {
  const r = rig();
  try {
    const halt = r.open();
    assert.throws(() => halt.halt('سببٌ آخر', cmd(r.pair, halt, 'halt', 'السببُ الموقَّع')), {
      code: 'HALT_ROYAL_COMMAND_REASON_MISMATCH',
    });
  } finally {
    r.cleanup();
  }
});

test('WL-302: مفتاحٌ آخرُ — ولو بالمعرّفِ المُثبَّتِ — يُرفَض، ومتنٌ بلا فاصلِ النطاقِ يُرفَض', () => {
  const r = rig();
  try {
    const halt = r.open();
    const intruder = generateKeyPairSync('ed25519');
    const wrongSigner = signRoyalCommand(intruder, {
      operation: 'halt',
      reason: 'x',
      targetEpoch: 0,
      signerId: kingIdOfPublicKey(r.pair.publicKey),
    });
    assert.throws(() => halt.halt('x', wrongSigner), { code: 'HALT_ROYAL_COMMAND_REQUIRED' });
    // متنٌ موقَّعٌ بالمفتاحِ الصحيحِ بلا `domain` (كما كانَ قبلَ هذه الدفعة) لا يُقبَل.
    const body = {
      operation: 'halt',
      signerId: kingIdOfPublicKey(r.pair.publicKey),
      commandId: 'a'.repeat(32),
      targetEpoch: 0,
      reason: 'x',
      at: new Date().toISOString(),
    };
    const undomained = {
      ...body,
      signature: sign(null, Buffer.from(JSON.stringify(body)), r.pair.privateKey).toString(
        'base64url',
      ),
    };
    assert.throws(() => halt.halt('x', undomained), { code: 'HALT_ROYAL_COMMAND_REQUIRED' });
    assert.ok(canonicalRoyalCommand(body).includes(ROYAL_COMMAND_DOMAIN));
  } finally {
    r.cleanup();
  }
});

test('WL-302: حقلٌ زائدٌ أو نوعٌ مُلتبِسٌ يُرفَض قبلَ التوقيع', () => {
  const r = rig();
  try {
    const halt = r.open();
    const good = cmd(r.pair, halt, 'halt', 'x');
    assert.throws(() => halt.halt('x', { ...good, targetEpoch: '0' }), {
      code: 'HALT_ROYAL_COMMAND_REQUIRED',
    });
    assert.throws(() => halt.halt('x', { ...good, commandId: 'short' }), {
      code: 'HALT_ROYAL_COMMAND_REQUIRED',
    });
    assert.throws(() => halt.halt('x', { ...good, scope: 'all' }), {
      code: 'HALT_ROYAL_COMMAND_REQUIRED',
    });
    assert.equal(halt.read().state, 'running');
  } finally {
    r.cleanup();
  }
});

test('WL-302: كلُّ رفضٍ يُسجَّلُ في الأثرِ بلا توقيعٍ، والقبولُ يحملُ معرّفَ الأمر', () => {
  const r = rig();
  try {
    const halt = r.open();
    assert.throws(() => halt.halt('x'), { code: 'HALT_ROYAL_COMMAND_REQUIRED' });
    const old = cmd(r.pair, halt, 'halt', 'x', { at: '2020-01-01T00:00:00.000Z' });
    assert.throws(() => halt.halt('x', old));
    const good = cmd(r.pair, halt, 'halt', 'x');
    halt.halt('x', good);
    const rejected = r.events.filter((e) => e.type === 'halt.command.rejected');
    assert.deepEqual(
      rejected.map((e) => e.data.code),
      ['HALT_ROYAL_COMMAND_REQUIRED', 'HALT_ROYAL_COMMAND_EXPIRED'],
    );
    assert.equal(rejected[0].actor, 'unauthenticated');
    for (const e of rejected) assert.equal('signature' in e.data, false);
    const issued = r.events.find((e) => e.type === 'halt.issued');
    assert.equal(issued.data.commandId, good.commandId);
  } finally {
    r.cleanup();
  }
});

test('WL-302: في الإنتاجِ بلا ساعةٍ موثوقةٍ موصولةٍ يُرفَضُ كلُّ أمر', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wl302-prod-'));
  try {
    const pair = generateKeyPairSync('ed25519');
    const halt = new HaltSwitch(join(dir, 'd.json'), new KingIdentity(), {
      fsync: false,
      env: PROD,
      royalCommandVerifier: createRoyalCommandVerifier(
        String(pair.publicKey.export({ type: 'spki', format: 'pem' })),
      ),
      epochFloor: { read: () => 0, raise: () => undefined },
      logAsync: { appendSealed: async () => undefined },
    });
    assert.throws(() => halt.halt('x', cmd(pair, halt, 'halt', 'x')), {
      code: 'HALT_TRUSTED_CLOCK_REQUIRED',
    });
    halt.useTrustedClock({ now: () => Date.now() });
    assert.throws(() => halt.useTrustedClock({}), { code: 'HALT_TRUSTED_CLOCK_REQUIRED' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WL-302: المُتحقِّقُ المُرتجَلُ لا يحملُ علامةَ الثقة', () => {
  const pair = generateKeyPairSync('ed25519');
  const real = createRoyalCommandVerifier(
    String(pair.publicKey.export({ type: 'spki', format: 'pem' })),
  );
  assert.equal(typeof trustedRoyalVerifierFingerprint(real), 'string');
  assert.equal(
    trustedRoyalVerifierFingerprint(() => true),
    null,
  );
});

test('WL-302: الوضعُ الآمنُ للنواةِ في الإنتاجِ لا يُبدَّلُ بنداءِ دالّةٍ ونصِّ فاعل', async () => {
  const log = { append: () => undefined };
  const crown = { command: () => ({}) };
  const kernel = new ExecutionKernel({ crown, log, env: PROD });
  assert.throws(() => kernel.stop('x', 'crown'), /KERNEL_SAFE_MODE_REQUIRES_ROYAL_COMMAND/);
  assert.throws(() => kernel.resume('crown'), /KERNEL_SAFE_MODE_REQUIRES_ROYAL_COMMAND/);
  await assert.rejects(kernel.enterSafeMode('x', {}), /KERNEL_SAFE_MODE_HALT_SWITCH_REQUIRED/);
});

test('WL-302: الوضعُ الآمنُ للنواةِ يمرُّ بمفتاحِ الإيقافِ: أمرٌ صحيحٌ يُوقفُ ويدومُ، والمزوَّرُ والمُعادُ يُرفَضان', async () => {
  const r = rig();
  try {
    const halt = r.open();
    const log = { append: () => undefined };
    const crown = { command: () => ({ target: 't', action: 'a' }) };
    const kernel = new ExecutionKernel({ crown, log, haltSwitch: halt });
    await assert.rejects(kernel.enterSafeMode('x', { operation: 'halt' }), {
      code: 'HALT_ROYAL_COMMAND_REQUIRED',
    });
    const enter = cmd(r.pair, halt, 'halt', 'دخول');
    await kernel.enterSafeMode('دخول', enter);
    await assert.rejects(
      kernel.submit({ action: 'noop', target: 't' }, 'sig', () => 1),
      /SOVEREIGN_HALT/,
    );
    // إعادةُ تشغيلٍ: نواةٌ جديدةٌ على المفتاحِ نفسِه ما زالت موقوفة.
    const kernel2 = new ExecutionKernel({ crown, log, haltSwitch: r.open() });
    await assert.rejects(
      kernel2.submit({ action: 'noop', target: 't' }, 'sig', () => 1),
      /SOVEREIGN_HALT/,
    );
    // أمرُ الدخولِ نفسُه يُقدَّمُ للخروجِ ⇒ يسقطُ توقيعُه بالعملِ المختوم.
    await assert.rejects(kernel2.leaveSafeMode('دخول', enter), {
      code: 'HALT_ROYAL_COMMAND_REQUIRED',
    });
    await kernel2.leaveSafeMode('خروج', cmd(r.pair, halt, 'resume', 'خروج'));
    assert.equal(halt.read().state, 'running');
  } finally {
    r.cleanup();
  }
});

test('WL-302: مفتاحُ إيقافٍ في الإنتاجِ بمُحقِّقٍ مُرتجَلٍ يُرَدُّ عندَ البناء', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wl302-untrusted-'));
  try {
    assert.throws(
      () =>
        new HaltSwitch(join(dir, 'd.json'), new KingIdentity(), {
          fsync: false,
          env: PROD,
          royalCommandVerifier: () => true,
          epochFloor: { read: () => 0, raise: () => undefined },
          logAsync: { appendSealed: async () => undefined },
        }),
      { code: 'HALT_ROYAL_VERIFIER_UNTRUSTED' },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
