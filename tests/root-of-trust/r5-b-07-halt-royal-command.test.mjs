// R5-B-07 (تقرير: R5-B-05) — اختبارُ إثباتٍ: `HaltSwitch.halt` يتطلّبُ أمراً ملكيّاً.
//
// **المعيار:** النداءُ المباشرُ لـ`halt()` بلا أمرٍ ملكيٍّ موثَّقٍ يُرفضُ بـ
// `HALT_ROYAL_COMMAND_REQUIRED`. والنداءُ بأمرٍ موثَّقٍ ينجح. والنداءُ بأمرٍ
// غير موثَّقٍ يُرفض.
//
// **الحدُّ معلَن:** هذا إثباتُ إنفاذٍ لا إثباتُ إغلاقٍ. صلاحيّةُ الإغلاقِ للمجلس.

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HaltSwitch, KingIdentity } from '../../src/root-of-trust/index.mjs';

function makeHaltSwitch(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'halt-r5-b-07-'));
  const file = join(dir, 'directive.json');
  const king = new KingIdentity();
  return {
    dir,
    halt: new HaltSwitch(file, king, {
      fsync: false,
      // الاختباراتُ تُصرِّحُ بالمسارِ غير الموقَّع لأنّها تختبرُ HaltSwitch
      // في عزلةٍ لا في الإنتاج. الإنتاجُ لا يُمرِّرُ هذا الخيار.
      allowUnsignedTestHalt: true,
      ...opts,
    }),
  };
}

test('R5-B-07: halt() بلا أمرٍ ملكيٍّ يُرفضُ حين يكون المُحقِّقُ موصولاً', () => {
  const { halt, dir } = makeHaltSwitch({
    royalCommandVerifier: (cmd) => true,
  });
  try {
    assert.throws(
      () => halt.halt('probe-direct'),
      /HALT_ROYAL_COMMAND_REQUIRED/,
      'النداءُ المباشرُ بلا أمرٍ ملكيٍّ ممنوعٌ',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R5-B-07: halt() بأمرٍ ملكيٍّ موثَّقٍ ينجح', () => {
  const { halt, dir } = makeHaltSwitch({
    royalCommandVerifier: (cmd) => cmd.id === 'cmd:royal-halt-001' && cmd.operation === 'halt',
  });
  try {
    const directive = halt.halt('إيقاف سيادي', { id: 'cmd:royal-halt-001' });
    assert.ok(directive, 'التوجيهُ صدر');
    assert.equal(halt.isHalted(), true, 'الحالةُ موقوفة');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R5-B-07: halt() بأمرٍ غير موثَّقٍ يُرفض', () => {
  const { halt, dir } = makeHaltSwitch({
    royalCommandVerifier: (cmd) => cmd.id === 'cmd:real' && cmd.operation === 'halt',
  });
  try {
    assert.throws(
      () => halt.halt('probe', { id: 'cmd:forged' }),
      /HALT_ROYAL_COMMAND_REQUIRED/,
      'الأمرُ غيرُ الموثَّقُ مرفوض',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R5-B-07: resume() بلا أمرٍ ملكيٍّ يُرفضُ حين يكون المُحقِّقُ موصولاً', () => {
  const { halt, dir } = makeHaltSwitch({
    royalCommandVerifier: (cmd) =>
      cmd.id === 'cmd:royal-halt-001' || cmd.id === 'cmd:royal-resume-001',
  });
  try {
    halt.halt('إيقاف', { id: 'cmd:royal-halt-001' });
    // استئناف بلا أمر
    assert.throws(
      () => halt.resume('probe-resume'),
      /HALT_ROYAL_COMMAND_REQUIRED/,
      'الاستئنافُ بلا أمرٍ ملكيٍّ ممنوع',
    );
    // استئناف بأمرٍ موثَّق
    halt.resume('استئناف سيادي', { id: 'cmd:royal-resume-001' });
    assert.equal(halt.isHalted(), false, 'الحالةُ مستأنفة');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R5-B-07: halt() بلا مُحقِّقٍ و بلا allowUnsignedTestHalt يُرفضُ — fail-closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'halt-r5-b-07-strict-'));
  const file = join(dir, 'directive.json');
  const king = new KingIdentity();
  const halt = new HaltSwitch(file, king, { fsync: false });
  try {
    assert.throws(
      () => halt.halt('probe'),
      /HALT_ROYAL_COMMAND_REQUIRED/,
      'بلا مُحقِّقٍ و بلا allowUnsignedTestHalt يُرفضُ الإيقاف',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R5-B-07: allowUnsignedTestHalt يُرفضُ في الإنتاج', () => {
  const dir = mkdtempSync(join(tmpdir(), 'halt-r5-b-07-prod-'));
  const file = join(dir, 'directive.json');
  const king = new KingIdentity();
  try {
    assert.throws(
      () =>
        new HaltSwitch(file, king, {
          fsync: false,
          allowUnsignedTestHalt: true,
          env: { NODE_ENV: 'production' },
        }),
      /HALT_UNSIGNED_HALT_FORBIDDEN_IN_PRODUCTION/,
      'allowUnsignedTestHalt مرفوضٌ في الإنتاج',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R5-B-07: أمرُ إيقافٍ لا يُجيزُ استئنافاً', () => {
  const dir = mkdtempSync(join(tmpdir(), 'halt-r5-b-07-cross-'));
  const file = join(dir, 'directive.json');
  const king = new KingIdentity();
  const halt = new HaltSwitch(file, king, {
    fsync: false,
    royalCommandVerifier: (cmd) => cmd.id === 'cmd:halt-only' && cmd.operation === 'halt',
  });
  try {
    halt.halt('إيقاف', { id: 'cmd:halt-only' });
    // أمرُ الإيقافِ لا يُجيزُ الاستئناف
    assert.throws(
      () => halt.resume('استئناف', { id: 'cmd:halt-only' }),
      /HALT_ROYAL_COMMAND_REQUIRED/,
      'أمرُ الإيقافِ لا يُجيزُ الاستئناف',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
