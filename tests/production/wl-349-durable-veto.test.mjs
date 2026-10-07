// @ts-nocheck — على حزامِ `production-sovereign-rig` (‏حزامُ `WL-304`) بلا أنواع.
// `WL-349`: النقضُ الملكيُّ دائمٌ — يُختَمُ قبلَ أن يتغيّرَ، ويُعيدُه الإقلاعُ من السجلِّ المختوم.
//
// قبلَ هذه المُدخلةِ كانَ `crown.veto` في ذاكرةِ العمليّةِ وحدَها: نقضٌ أصدرَه الملكُ من الديوانِ
// يسقطُ بإعادةِ التشغيلِ فتقبلُ البوابةُ ما نقضَه. والإقلاعُ هنا `createProductionSystem` نفسُه بحزامِ
// `WL-348` (‏مقبسُ حداثةٍ للاختبار — `EXT-6` مفتوح، وما يُثبَتُ هنا الدوامُ لا الحداثة).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

import {
  SOVEREIGN_CONSOLE_ERRORS,
  vetoFromSealedLog,
} from '../../src/production/sovereign-console.mjs';
import { CONSOLE_ERRORS, loadConsolePolicy } from '../../src/console/index.mjs';
import {
  TestFreshnessSocket,
  boot,
  crownCommand,
  fixedKeys,
  haltAuthority,
  session,
  testVault,
  tmpRoot,
} from '../helpers/production-sovereign-rig.mjs';

const VETO_EVENT = loadConsolePolicy().audit.vetoStateEvent;

function rig() {
  const root = tmpRoot();
  const keys = { ...fixedKeys(), socket: new TestFreshnessSocket(0n, 'wl349') };
  const { secret, factorSecrets } = testVault();
  return { root, keys, secret, factorSecrets };
}

async function issueVeto(system, token, reason) {
  const signed = crownCommand({ action: 'veto-commands', target: 'crown:gateway', reason });
  return system.royalConsole.issue({
    command: 'cmd:veto',
    royalCommand: signed.command,
    signature: signed.signature,
    sovereignSession: token,
  });
}

async function issueClear(system, token, reason) {
  const signed = crownCommand({ action: 'clear-veto', target: 'crown:gateway', reason });
  return system.royalConsole.issue({
    command: 'cmd:veto.clear',
    royalCommand: signed.command,
    signature: signed.signature,
    sovereignSession: token,
  });
}

/** أمرُ إيقافٍ بمسارِ التاج — يُرفَضُ بالنقضِ إن كانَ قائماً. */
async function issueHalt(system, token, reason) {
  const signed = crownCommand({ action: 'stop-state', target: 'state:sovereign', reason });
  return system.royalConsole.issue({
    command: 'cmd:halt',
    royalCommand: signed.command,
    signature: signed.signature,
    sovereignSession: token,
    haltCommand: haltAuthority(system.rootOfTrust.haltSwitch, 'halt', reason, signed.command.id),
  });
}

describe('WL-349 — النقضُ الملكيُّ الدائم', () => {
  test('V1 — نقضٌ من الديوانِ يُختَمُ قبلَ الأثر، ويعودُ بعدَ إعادةِ التشغيلِ فيردُّ أمرَ التاج', async () => {
    const { root, keys, secret, factorSecrets } = rig();
    const reason = 'نقضٌ سياديٌّ يصمدُ لإعادةِ التشغيل';
    const first = await boot(root, { keys, factorSecrets });
    try {
      const { opened } = await session(first, secret);
      const vetoed = await issueVeto(first, opened.token, reason);
      assert.equal(vetoed.status, 'executed');
      assert.equal(first.crown.veto.enabled, false);
      // القيدُ مختومٌ في السجلِّ الخامِ لحظةَ الإرجاع — لا في طابورٍ ينتظرُ التفريغ.
      const sealed = first.auditLog.events.filter((event) => event.type === VETO_EVENT);
      assert.equal(sealed.length, 1, 'قيدُ حالةِ النقضِ غيرُ مختومٍ عندَ الإرجاع.');
      assert.notEqual(sealed[0]?.data?.vetoed, true, 'جسمُ القيدِ مكشوفٌ لا مختوم.');
    } finally {
      await first.close();
    }
    const second = await boot(root, { keys, factorSecrets });
    try {
      assert.equal(second.crown.veto.enabled, false, 'سقطَ النقضُ بإعادةِ التشغيل.');
      assert.equal(second.crown.veto.reason, reason);
      const { opened } = await session(second, secret, 1);
      await assert.rejects(
        issueHalt(second, opened.token, 'إيقافٌ على بوابةٍ منقوضة'),
        (error) =>
          error.code === CONSOLE_ERRORS.COMMAND_REJECTED && /CROWN_VETO/.test(error.message),
      );
      assert.equal(second.rootOfTrust.haltSwitch.read().state, 'running');
    } finally {
      await second.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('V2 — رفعُ النقضِ بعدَ إعادةِ التشغيلِ يدومُ هو أيضاً، والبوابةُ تقبلُ بعدَه', async () => {
    const { root, keys, secret, factorSecrets } = rig();
    const first = await boot(root, { keys, factorSecrets });
    try {
      const { opened } = await session(first, secret);
      await issueVeto(first, opened.token, 'نقضٌ يُرفَعُ بعدَ الإقلاع');
    } finally {
      await first.close();
    }
    const second = await boot(root, { keys, factorSecrets });
    try {
      assert.equal(second.crown.veto.enabled, false);
      const { opened } = await session(second, secret, 1);
      const cleared = await issueClear(second, opened.token, 'رفعُ النقض');
      assert.equal(cleared.status, 'executed');
      assert.equal(cleared.path, 'sovereign-recovery');
      assert.equal(second.crown.veto.enabled, true);
    } finally {
      await second.close();
    }
    const third = await boot(root, { keys, factorSecrets });
    try {
      assert.equal(third.crown.veto.enabled, true, 'عادَ النقضُ بعدَ رفعِه.');
      const restored = await vetoFromSealedLog(third.auditLog, VETO_EVENT);
      assert.deepEqual(
        { vetoed: restored?.vetoed, reason: restored?.reason },
        { vetoed: false, reason: null },
      );
      const { opened } = await session(third, secret, -1);
      const halted = await issueHalt(third, opened.token, 'إيقافٌ بعدَ رفعِ النقض');
      assert.equal(halted.status, 'executed');
    } finally {
      await third.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('V3 — قيدُ نقضٍ تالفٌ يمنعُ الإقلاعَ برفضٍ مُسمّى، لا يفتحُ البوابة', async () => {
    const { root, keys, secret, factorSecrets } = rig();
    const first = await boot(root, { keys, factorSecrets });
    try {
      await session(first, secret);
      await first.auditLog.appendSealed(VETO_EVENT, 'tamper', { vetoed: 'yes' });
    } finally {
      await first.close();
    }
    await assert.rejects(
      boot(root, { keys, factorSecrets }),
      new RegExp(SOVEREIGN_CONSOLE_ERRORS.VETO_RECORD_UNREADABLE),
    );
    rmSync(root, { recursive: true, force: true });
  });

  test('V4 — إخفاقُ ختمِ القيدِ لا يُغيِّرُ النقضَ في الذاكرة، والسجلُّ يبقى مسموماً حتى الإغلاق', async () => {
    const { root, keys, secret, factorSecrets } = rig();
    const system = await boot(root, { keys, factorSecrets });
    let closeError = null;
    try {
      const { opened } = await session(system, secret);
      const log = system.auditLog;
      const original = log.appendSealed.bind(log);
      log.appendSealed = async (type, actor, data) => {
        if (type === VETO_EVENT) throw new Error('TEST_SEAL_FAILURE');
        return original(type, actor, data);
      };
      await assert.rejects(
        issueVeto(system, opened.token, 'نقضٌ لا يُختَم'),
        (error) =>
          error.code === CONSOLE_ERRORS.EFFECT_REFUSED && /TEST_SEAL_FAILURE/.test(error.message),
      );
      assert.equal(system.crown.veto.enabled, true, 'تغيّرَ النقضُ في الذاكرةِ بلا قيدٍ مختوم.');
      // `sealedAudit` لا يمضي بثقبٍ صامت: كلُّ أمرٍ تالٍ يُرَدّ.
      await assert.rejects(issueHalt(system, opened.token, 'أمرٌ بعدَ ثقبٍ في السجل'));
      assert.equal(system.rootOfTrust.haltSwitch.read().state, 'running');
    } finally {
      try {
        await system.close();
      } catch (error) {
        closeError = error;
      }
      rmSync(root, { recursive: true, force: true });
    }
    assert.match(String(closeError?.message), /TEST_SEAL_FAILURE/, 'الإغلاقُ ابتلعَ فشلَ الختم.');
  });
});
