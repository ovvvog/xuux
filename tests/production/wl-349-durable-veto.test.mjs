// @ts-nocheck — على حزامِ `production-sovereign-rig` (‏حزامُ `WL-304`) بلا أنواع.
// `WL-349`: النقضُ الملكيُّ دائمٌ — يُختَمُ قبلَ أن يتغيّرَ، ويُعيدُه الإقلاعُ من السجلِّ المختوم.
//
// قبلَ هذه المُدخلةِ كانَ `crown.veto` في ذاكرةِ العمليّةِ وحدَها: نقضٌ أصدرَه الملكُ من الديوانِ
// يسقطُ بإعادةِ التشغيلِ فتقبلُ البوابةُ ما نقضَه. والإقلاعُ هنا `createProductionSystem` نفسُه بحزامِ
// `WL-348` (‏مقبسُ حداثةٍ للاختبار — `EXT-6` مفتوح، وما يُثبَتُ هنا الدوامُ لا الحداثة).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, statSync, truncateSync } from 'node:fs';
import { join } from 'node:path';

import {
  SOVEREIGN_CONSOLE_ERRORS,
  vetoFromSealedLog,
} from '../../src/production/sovereign-console.mjs';
import { CONSOLE_ERRORS, loadConsolePolicy } from '../../src/console/index.mjs';
import {
  TestFreshnessSocket,
  AUTHN_POLICY,
  boot,
  crownCommand,
  fixedKeys,
  freezeMonotonicNow,
  haltAuthority,
  session,
  testVault,
  tmpRoot,
  unfreezeMonotonicNow,
} from '../helpers/production-sovereign-rig.mjs';

const VETO_EVENT = loadConsolePolicy().audit.vetoStateEvent;

function rig() {
  const root = tmpRoot();
  const keys = { ...fixedKeys(), socket: new TestFreshnessSocket(0n, 'wl349') };
  const { secret, factorSecrets } = testVault();
  return { root, keys, secret, factorSecrets };
}

/** ما تتحقّقُ به الاستعادةُ من سلطةِ القيد (‏`WL-352`): المفتاحُ العامُّ ودفترُ الأوامرِ والأوامرُ المُعلَنة. */
function authorityOf(system) {
  return {
    king: system.crown.king,
    ledger: system.rootOfTrust.ledger,
    commands: loadConsolePolicy().commands,
  };
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
      const restored = await vetoFromSealedLog(third.auditLog, VETO_EVENT, authorityOf(third));
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

  test('V5 — الاستعادةُ لا تنشئُ أثرًا ثانيًا أو event مكررًا', async () => {
    const { root, keys, secret, factorSecrets } = rig();
    const reason = 'نقضٌ يُختَمُ ولا يُكرَّرُ';
    const first = await boot(root, { keys, factorSecrets });
    try {
      const { opened } = await session(first, secret);
      await issueVeto(first, opened.token, reason);
    } finally {
      await first.close();
    }
    const second = await boot(root, { keys, factorSecrets });
    try {
      // قبلَ أيِّ أمرٍ جديدٍ: عددُ قيودِ حالةِ النقضِ ما زالَ ١ — الاستعادةُ تقرأُ ولا تكتبُ.
      const vetoEvents = second.auditLog.events.filter((event) => event.type === VETO_EVENT);
      assert.equal(vetoEvents.length, 1, 'الاستعادةُ أنشأتْ قيدًا مكررًا.');
      assert.equal(second.crown.veto.enabled, false);
      assert.equal(second.crown.veto.reason, reason);
    } finally {
      await second.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('V6 — سجلٌّ مبتورٌ لا يؤدي إلى استعادةِ حالةٍ كاذبة', async () => {
    const { root, keys, secret, factorSecrets } = rig();
    const first = await boot(root, { keys, factorSecrets });
    try {
      const { opened } = await session(first, secret);
      await issueVeto(first, opened.token, 'نقضٌ قبلَ البتر');
    } finally {
      await first.close();
    }
    // بترُ آخرِ ١٠ بايتاتٍ من السجلِّ الدائم — لا يُقرأُ النقضُ المختومُ ولا يُستعاد.
    const logPath = join(root, 'events.log');
    const size = statSync(logPath).size;
    truncateSync(logPath, Math.max(0, size - 10));
    await assert.rejects(boot(root, { keys, factorSecrets }), (error) =>
      /TRUNCATED_EVENT_LOG|CORRUPT_EVENT_LOG|PRODUCTION_VETO_RECORD_UNREADABLE/.test(String(error)),
    );
    rmSync(root, { recursive: true, force: true });
  });
});

// `WL-352` (‏`R12-ASTRA-01`): مُحوِّلُ السجلِّ يحملُه كلُّ مكوِّنٍ مركَّبٍ في الإنتاج (‏التاجُ والنواةُ والسلسلةُ
// والمصادقةُ والديوان) ويُرجَعُ `auditLog` لحاملِ النظام. فقيدُ حالةٍ يكتبُه أيُّ حاملٍ لا يرفعُ نقضاً:
// السلطةُ من الأمرِ الموقَّعِ المحمولِ في القيدِ والمُثبَّتِ في الدفتر، والإعادةُ لا تُعيدُ أمراً.
describe('WL-352 — R12-ASTRA-01: قيدُ النقضِ لا يُستعادُ بلا سلطةٍ ملكيّة', () => {
  async function vetoThenForge(forge) {
    const { root, keys, secret, factorSecrets } = rig();
    const first = await boot(root, { keys, factorSecrets });
    try {
      const { opened } = await session(first, secret);
      await forge(first, opened.token);
    } finally {
      await first.close();
    }
    return { root, keys, factorSecrets };
  }
  async function bootRefusedUnauthorized(ctx) {
    await assert.rejects(
      boot(ctx.root, { keys: ctx.keys, factorSecrets: ctx.factorSecrets }),
      new RegExp(SOVEREIGN_CONSOLE_ERRORS.VETO_RECORD_UNAUTHORIZED),
    );
    rmSync(ctx.root, { recursive: true, force: true });
  }
  async function lastVetoBody(system) {
    await system.rootOfTrust.log.flush?.();
    const events = system.auditLog.events.filter((event) => event.type === VETO_EVENT);
    return system.auditLog.openEvent(events[events.length - 1]);
  }

  test('A1 — قيدُ رفعٍ بلا أمرٍ موقَّعٍ (‏مسارُ المسبار) يمنعُ الإقلاعَ ولا يرفعُ النقض', async () => {
    const ctx = await vetoThenForge(async (system, token) => {
      await issueVeto(system, token, 'نقضٌ قبلَ قيدٍ مُصطنَع');
      await system.auditLog.appendSealed(VETO_EVENT, 'agent:log-writer', { vetoed: false });
    });
    await bootRefusedUnauthorized(ctx);

    // ضابطُ عزلٍ: التوقيعُ صالحٌ لأمرٍ حقيقيٍّ ومُثبَّتٍ، لكنّ القيدَ يحذفُ royalCommand وحدَه.
    // ينبغي أن يرفضَ حارسُ غيابِ الأمر قبل استدعاءِ المتحقِّق؛ وإذا عُطِّل هذا الحارسُ يصلُ التنفيذُ
    // إلى فحصِ التوقيع، فيختلفُ سببُ الرفضِ ويفشلُ هذا الاختبارُ بدلاً من أن يُخفي الطفرةَ.
    const { root, keys, factorSecrets } = rig();
    const system = await boot(root, { keys, factorSecrets });
    try {
      const signed = crownCommand({
        action: 'clear-veto',
        target: 'crown:gateway',
        reason: 'أمرٌ موقَّعٌ صالحٌ لا يُدرَجُ في القيد',
      });
      const verify = system.crown.king.verify.bind(system.crown.king);
      let verifierCalls = 0;
      const authority = {
        ...authorityOf(system),
        king: {
          verify(command, signature) {
            verifierCalls += 1;
            return verify(command, signature);
          },
        },
        ledger: { has: () => true },
      };
      const log = {
        sealed: false,
        events: [
          {
            id: 'a1-missing-royal-command',
            type: VETO_EVENT,
            data: {
              vetoed: false,
              reason: null,
              commandId: signed.command.id,
              signature: signed.signature,
            },
          },
        ],
      };
      await assert.rejects(vetoFromSealedLog(log, VETO_EVENT, authority), (error) => {
        assert.match(error.message, /— لا أمرَ ملكيَّ في القيد$/);
        return true;
      });
      assert.equal(verifierCalls, 0, 'غيابُ الأمرِ يجبُ أن يُرفَضَ قبلَ فحصِ التوقيع');
    } finally {
      await system.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('A2 — قيدُ رفعٍ بمعرّفِ أمرِ نقضٍ مُثبَّتٍ وتوقيعِه مقلوبَ الحالةِ يُرفَض', async () => {
    const ctx = await vetoThenForge(async (system, token) => {
      await issueVeto(system, token, 'نقضٌ يُنسَخُ أمرُه');
      const genuine = await lastVetoBody(system);
      await system.auditLog.appendSealed(VETO_EVENT, 'agent:log-writer', {
        ...genuine,
        vetoed: false,
        reason: null,
      });
    });
    await bootRefusedUnauthorized(ctx);
  });

  test('A3 — إعادةُ قيدِ رفعٍ صحيحٍ بعدَ نقضٍ أحدثَ تُرفَض (‏لا يُعادُ أمرٌ)', async () => {
    const ctx = await vetoThenForge(async (system, token) => {
      await issueVeto(system, token, 'نقضٌ أوّل');
      await issueClear(system, token, 'رفعٌ صحيح');
      const genuineClear = await lastVetoBody(system);
      assert.equal(genuineClear.vetoed, false);
      await issueVeto(system, token, 'نقضٌ أحدث');
      await system.auditLog.appendSealed(VETO_EVENT, 'agent:log-writer', genuineClear);
    });
    await bootRefusedUnauthorized(ctx);
  });

  test('A4 — أمرُ رفعٍ موقَّعٌ صحيحاً لم يُقبَل في الدفترِ قطّ لا يرفعُ النقض', async () => {
    const ctx = await vetoThenForge(async (system, token) => {
      await issueVeto(system, token, 'نقضٌ قبلَ أمرٍ لم يُقبَل');
      const signed = crownCommand({
        action: 'clear-veto',
        target: 'crown:gateway',
        reason: 'لم يُقبَل',
      });
      await system.auditLog.appendSealed(VETO_EVENT, 'agent:log-writer', {
        vetoed: false,
        reason: null,
        commandId: signed.command.id,
        royalCommand: signed.command,
        signature: signed.signature,
      });
    });
    await bootRefusedUnauthorized(ctx);
  });

  test('A5 — قيدُ نقضٍ بسببٍ غيرِ سببِ الأمرِ الموقَّعِ يُرفَض، وبسببِه يُقبَل', async () => {
    // على سجلٍّ اصطناعيٍّ: قيدٌ بسببٍ مُبدَّلٍ لا يبلغُه مسارٌ مشروعٌ (‏كلُّ أمرٍ مقبولٍ يُختَمُ قيدُه
    // مرّةً، والإعادةُ مرفوضةٌ في A3)؛ فيُقاسُ ربطُ السببِ وحدَه، والمفتاحُ مفتاحُ الإنتاجِ نفسُه.
    const { root, keys, factorSecrets } = rig();
    const system = await boot(root, { keys, factorSecrets });
    try {
      const signed = crownCommand({
        action: 'veto-commands',
        target: 'crown:gateway',
        reason: 'السببُ الموقَّع',
      });
      const logOf = (reason) => ({
        sealed: false,
        openEvent: async () => ({}),
        events: [
          {
            id: 'e1',
            type: VETO_EVENT,
            data: {
              vetoed: true,
              reason,
              commandId: signed.command.id,
              royalCommand: signed.command,
              signature: signed.signature,
            },
          },
        ],
      });
      const authority = { ...authorityOf(system), ledger: { has: () => true } };
      await assert.rejects(
        vetoFromSealedLog(logOf('سببٌ مُبدَّل'), VETO_EVENT, authority),
        new RegExp(SOVEREIGN_CONSOLE_ERRORS.VETO_RECORD_UNAUTHORIZED),
      );
      const restored = await vetoFromSealedLog(logOf('السببُ الموقَّع'), VETO_EVENT, authority);
      assert.deepEqual(restored, {
        vetoed: true,
        reason: 'السببُ الموقَّع',
        commandId: signed.command.id,
      });
    } finally {
      await system.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('A8 — توقيعُ أمرٍ آخرَ على أمرِ رفعٍ مُصطنَعٍ لا يُقبَل، والفعلُ غيرُ فعلِ الحالةِ لا يُقبَل', async () => {
    // سجلٌّ اصطناعيٌّ ودفترٌ يُثبِتُ كلَّ معرّف: يُعزَلُ فحصا التوقيعِ والفعلِ عن فحصِ الدفتر.
    const { root, keys, factorSecrets } = rig();
    const system = await boot(root, { keys, factorSecrets });
    try {
      const authority = { ...authorityOf(system), ledger: { has: () => true } };
      const record = (royalCommand, signature) => ({
        sealed: false,
        openEvent: async () => ({}),
        events: [
          {
            id: 'e1',
            type: VETO_EVENT,
            data: {
              vetoed: false,
              reason: null,
              commandId: royalCommand.id,
              royalCommand,
              signature,
            },
          },
        ],
      });
      const halt = crownCommand({
        action: 'stop-state',
        target: 'state:sovereign',
        reason: 'إيقاف',
      });
      // (أ) أمرُ رفعٍ لم يوقّعه الملكُ يحملُ توقيعَ أمرٍ آخرَ صحيحاً.
      const forged = { ...halt.command, action: 'clear-veto', target: 'crown:gateway' };
      await assert.rejects(
        vetoFromSealedLog(record(forged, halt.signature), VETO_EVENT, authority),
        new RegExp(SOVEREIGN_CONSOLE_ERRORS.VETO_RECORD_UNAUTHORIZED),
      );
      // (ب) أمرٌ موقَّعٌ صحيحاً لكنّه ليس أمرَ رفعِ النقض.
      await assert.rejects(
        vetoFromSealedLog(record(halt.command, halt.signature), VETO_EVENT, authority),
        new RegExp(SOVEREIGN_CONSOLE_ERRORS.VETO_RECORD_UNAUTHORIZED),
      );
      const rejects = (log) =>
        assert.rejects(
          vetoFromSealedLog(log, VETO_EVENT, authority),
          new RegExp(SOVEREIGN_CONSOLE_ERRORS.VETO_RECORD_UNAUTHORIZED),
        );
      // (ج) الهدفُ صحيحٌ والفعلُ فعلُ النقضِ لا رفعِه: الفعلُ وحدَه يُفرِّق.
      const veto = crownCommand({
        action: 'veto-commands',
        target: 'crown:gateway',
        reason: 'نقض',
      });
      await rejects(record(veto.command, veto.signature));
      // (د) الفعلُ فعلُ الرفعِ والهدفُ غيرُ البوابة: الهدفُ وحدَه يُفرِّق.
      const elsewhere = crownCommand({
        action: 'clear-veto',
        target: 'state:sovereign',
        reason: 'رفع',
      });
      await rejects(record(elsewhere.command, elsewhere.signature));
      // (هـ) أمرُ رفعٍ صحيحٌ وقيدُه يُسمّي معرّفاً غيرَه: المعرّفُ وحدَه يُفرِّق.
      const named = crownCommand({ action: 'clear-veto', target: 'crown:gateway', reason: 'رفع' });
      const misnamed = record(named.command, named.signature);
      misnamed.events[0].data.commandId = 'another-committed-command-id';
      await rejects(misnamed);
      // والضابطُ: أمرُ رفعٍ موقَّعٌ يُقبَلُ على السجلِّ نفسِه.
      const clear = crownCommand({ action: 'clear-veto', target: 'crown:gateway', reason: 'رفع' });
      const restored = await vetoFromSealedLog(
        record(clear.command, clear.signature),
        VETO_EVENT,
        authority,
      );
      assert.equal(restored?.vetoed, false);
    } finally {
      await system.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('A6 — الاستعادةُ بلا مُتحقِّقٍ من السلطةِ رفضٌ مُسمّى لا قراءةٌ صامتة', async () => {
    await assert.rejects(
      vetoFromSealedLog({ events: [], sealed: false, openEvent: async () => ({}) }, VETO_EVENT),
      new RegExp(SOVEREIGN_CONSOLE_ERRORS.VETO_RECORD_UNAUTHORIZED),
    );
  });

  test('A7 — المسارُ المشروعُ باقٍ: نقضٌ ثمّ رفعٌ ثمّ نقضٌ بأوامرَ مُثبَّتةٍ يعودُ آخرُها بعدَ الإقلاع', async () => {
    const reason = 'النقضُ الأخيرُ المشروع';
    const ctx = await vetoThenForge(async (system, token) => {
      await issueVeto(system, token, 'نقضٌ أوّل');
      await issueClear(system, token, 'رفعٌ مشروع');
      await issueVeto(system, token, reason);
    });
    const second = await boot(ctx.root, { keys: ctx.keys, factorSecrets: ctx.factorSecrets });
    try {
      assert.equal(second.crown.veto.enabled, false);
      assert.equal(second.crown.veto.reason, reason);
      const restored = await vetoFromSealedLog(second.auditLog, VETO_EVENT, authorityOf(second));
      assert.equal(restored?.vetoed, true);
    } finally {
      await second.close();
      rmSync(ctx.root, { recursive: true, force: true });
    }
  });

  test('عبورُ حدِّ الخطوةِ لا يعيدُ رمزًا مستهلَكًا — الحزامُ حتميٌّ لا انتظارَ جدارٍ (‏WL-367)', async () => {
    // **تأسيسُ الحتميّةِ:** الفشلُ الذي رُئيَ في CI (تشغيلةُ 38090807348، المُدخلةُ 1230)
    // كانَ نداءانِ من `session()` وقعا في الخطوةِ نفسِها بعدَ أن تقدَّمَتِ الساعةُ خطوةً
    // بينَهما (إزاحةٌ 0 عندَ S ثمّ إزاحةٌ -1 عندَ S+1 ⇐ كلاهُما S). هذا الاختبارُ يُثبِتُ
    // المسارَ **حتميّاً**: ساعةٌ مضبوطةٌ يراها مولِّدُ الرمزِ والمصادِقُ معاً، وعبورُ حدٍّ
    // مقصودٌ، لا انتظارُ جدارٍ أو حسنُ حظٍّ في التوقيتِ.
    const { stepSeconds } = AUTHN_POLICY.secondFactor;
    const { root, keys, secret, factorSecrets } = rig();
    // بدايةُ خطوةٍ بعيدةٌ عنَ الجدارِ الحقيقيّ — كي لا يتساربَ جدارُ العدّاءِ.
    const stepMs = Math.ceil(Date.now() / 1000 / stepSeconds) * stepSeconds * 1000 + 60_000;
    const first = await boot(root, { keys, factorSecrets });
    try {
      freezeMonotonicNow(stepMs); // داخلَ الخطوةِ S
      const firstOpened = await session(first, secret);
      assert.ok(typeof firstOpened.opened.token === 'string', 'لم تُفتَحْ الجلسةُ الأولى.');
      // تقدُّمٌ مقصودٌ إلى الخطوةِ S+1 (عبورُ الحدِّ) — إعادةُ تشغيلٍ بينَ النداءَينِ.
      await first.close();
    } finally {
      unfreezeMonotonicNow();
    }
    freezeMonotonicNow(stepMs + stepSeconds * 1000); // الخطوةُ S+1
    try {
      const second = await boot(root, { keys, factorSecrets });
      try {
        // بإزاحةٍ -1: المطلوبُ S — وقد استُهلَكَ في الجولةِ الأولى. الحزامُ يجبُ أن
        // يختارَ خطوةً أُخرى غيرَ مستهلَكةٍ داخلَ نافذةِ القبولِ (S أو S+1 من S+1)
        // ويُمرِّرَ المصادقةَ، لا أن يُقدِّمَ رمزَ S المستهلَكَ فيُرفَضَ بالإعادةِ.
        const secondOpened = await session(second, secret, -1);
        assert.ok(typeof secondOpened.opened.token === 'string', 'لم تُفتَحْ الجلسةُ الثانية.');
      } finally {
        await second.close();
      }
    } finally {
      unfreezeMonotonicNow();
    }
    rmSync(root, { recursive: true, force: true });
  });

  test('نافذةُ القبولِ إذا استُهلَكَت كلُّها فالبندُ صريحٌ لا رمزٌ خارجَها (‏WL-367)', async () => {
    // الحزامُ لا يولِّدُ رمزًا لخطوةٍ خارجَ نافذةِ المصادِقِ (وإلّا رُدَّ بـ
    // `AUTHN_FACTOR_INVALID` وصارَ الاختبارُ أعمى عن عطلِهِ) — بل يفشلُ بنصٍّ صريحٍ.
    const { stepSeconds } = AUTHN_POLICY.secondFactor;
    const { root, keys, secret, factorSecrets } = rig();
    const stepMs = Math.ceil(Date.now() / 1000 / stepSeconds) * stepSeconds * 1000 + 60_000;
    freezeMonotonicNow(stepMs); // الخطوةُ S
    try {
      const system = await boot(root, { keys, factorSecrets });
      try {
        // استهلِكْ كلَّ خطواتِ النافذةِ [S-1..S+1] بالإزاحاتِ -1 و0 و+1.
        await session(system, secret, -1);
        await session(system, secret, 0);
        await session(system, secret, 1);
        // الرابعةُ لا خطوةً لها داخلَ النافذةِ — رفضٌ صريحٌ لا رمزٌ خارجُها.
        await assert.rejects(session(system, secret, 0), /نافذةُ القبولِ \[.*\] كلُّها مستهلَكةٌ/);
      } finally {
        await system.close();
      }
    } finally {
      unfreezeMonotonicNow();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
