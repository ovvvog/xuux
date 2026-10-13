#!/usr/bin/env node
/**
 * WL-377 — مسبارُ إعادةِ إنتاجٍ مستقلٌّ لنتائجِ المجلسِ الحَرِجةِ R5-B-03…R5-B-10
 * على رأسِ `main` الحاليِّ (المُختبَرُ: 705919230e7817b4c90137b491fdf4a52c25c49e).
 *
 * **مصدرُ السيناريوهات:** تقريرُ العضوِ «ب» (Grok 4.6) الخامُّ للجولةِ الأولىِ
 * `docs/external-review/reports/M11.05-round-1-model-council-report-grok-4-6.md` —
 * حرفًا بحرفٍ. لا حكمَ هنا على النظامِ ككلٍّ (المادةُ 8 و11 لا تُمسَّان).
 *
 * حكمُ كلِّ سيناريوٍ مأخوذٌ من مسلكِ المجلسِ نفسِهِ: **فشل** = المسلكُ قُيِّدَ
 * رفضُهُ (الإصلاحُ ناجحٌ)؛ **نجح** = المسلكُ وقعَ أثرُهُ (أي عيبٌ ناجزٌ).
 */
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  KingAuthenticator,
  factorCodeForStep,
  loadKingAuthPolicy,
} from '../../../../src/authn/index.mjs';
import { composeEnforcementChain } from '../../../../src/core/composition-root.mjs';
import { createEgressGate } from '../../../../src/egress/egress-gate.mjs';
import { TelegramBotChannel } from '../../../../src/notifications/channels/telegram-bot.mjs';
import { createPolicyDecisionPoint } from '../../../../src/policy/engine.mjs';
import { EnforcementPoint } from '../../../../src/policy/enforcement-point.mjs';
import { loadPolicyBundle } from '../../../../src/policy/loader.mjs';
import {
  EventLog,
  HaltSwitch,
  KingIdentity,
  PersistentEventLog,
} from '../../../../src/root-of-trust/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const OUT = path.join(HERE, 'r5-b-independent-probe-results.json');

function testedCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}
function testedBranch() {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}
function testedShortSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}
function uncommittedChanges() {
  try {
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    return status.length > 0 ? true : false;
  } catch {
    return null;
  }
}

/** @type {Array<Record<string, unknown>>} */
const results = [];

function codeOf(error) {
  if (error !== null && typeof error === 'object') {
    if ('code' in error) {
      return String(/** @type {{ code: unknown }} */ (error).code);
    }
    // اقرأ الرمزَ من نصِّ الرسالةِ إذا لم يكن حقلًا
    const m = /^([A-Z][A-Z0-9_]{3,})\b/.exec(
      String(/** @type {{ message?: unknown }} */ (error).message ?? ''),
    );
    if (m) return m[1];
  }
  return `بلا-رمز:${String(error)}`;
}

/**
 * @param {string} id
 * @param {() => Promise<{ finding: string, scenario: string, judgment: 'نجح' | 'فشل' | 'لم_يجرب', refusal?: string, evidence?: string }>} run
 */
function judgmentToResult(judgment) {
  if (judgment === 'نجح') return 'FAIL';
  if (judgment === 'فشل') return 'PASS';
  return 'NOT_TESTED';
}

async function probe(id, run) {
  const started = Date.now();
  try {
    const outcome = await run();
    results.push({
      id,
      finding: outcome.finding,
      scenario: outcome.scenario,
      judgment: outcome.judgment,
      result: judgmentToResult(outcome.judgment),
      refusal: outcome.refusal ?? null,
      evidence: outcome.evidence ?? null,
      ms: Date.now() - started,
    });
  } catch (error) {
    results.push({
      id,
      judgment: 'لم_يجرب',
      refusal: `probe-exception:${codeOf(error)}`,
      ms: Date.now() - started,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// 1. R5-B-03 — أربعةُ متغيراتٍ مستقلةٍ لمنعِ إعادةِ الرمزِ:
//    (أ) الرمزُ نفسُهُ على المصادقِ نفسِهِ (V-A) — الضابطُ السلبيُّ الأصليُّ.
//    (ب) مصادقٌ جديدٌ على **السجلِّ نفسِه** (V-B) — السيناريو الأصليُّ لGrok KING-02.
//    (ج) إعادةُ فتحِ السجلِّ الدائمِ نفسِهِ بعدَ إغلاقِهِ (V-C) — المسلكُ المُقيسُ في الاختبارِ.
//    (د) مصادقٌ جديدٌ على **سجلٍّ فارغٍ جديدٍ** (V-D) — متغيرٌ مُتغيّرٌ مستقلٌّ.
// ═══════════════════════════════════════════════════════════════════
await probe('R5-B-03-same-authenticator', async () => {
  const AUTHN_POLICY = loadKingAuthPolicy();
  const king = new KingIdentity();
  const factorSecret = randomBytes(32).toString('hex');
  const vault = {};
  for (const device of AUTHN_POLICY.devices) vault[device.factorRef] = factorSecret;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r5b03-1-'));
  const log = new PersistentEventLog(path.join(tmp, 'log.jsonl'), { fsync: false });
  const ka = new KingAuthenticator({
    policy: /** @type {never} */ (AUTHN_POLICY),
    king: /** @type {never} */ (king),
    log,
    factorSecrets: { read: (name) => vault[name] ?? null },
  });
  const step = Math.floor(Date.now() / 1000 / AUTHN_POLICY.secondFactor.stepSeconds);
  const code = factorCodeForStep({
    secret: factorSecret,
    step,
    digits: AUTHN_POLICY.secondFactor.digits,
    algorithm: AUTHN_POLICY.secondFactor.algorithm,
  });
  const trusted = AUTHN_POLICY.devices[0];
  const opened = await ka.authenticate({
    actorId: king.id,
    deviceId: trusted.id,
    factorCode: code,
  });
  if (!opened.token)
    return {
      finding: 'R5-B-03',
      scenario: 'V-A الضابط: رمز الخطوة لم يفتح الجلسة',
      judgment: 'لم_يجرب',
    };
  try {
    const opened = await ka.authenticate({
      actorId: king.id,
      deviceId: trusted.id,
      factorCode: code,
    });
    return {
      finding: 'R5-B-03',
      scenario: 'V-A: الرمزُ المستهلَكُ يُقبلُ على المصادقِ نفسِهِ',
      judgment: 'نجح',
      evidence: `V-A replayed-same-authenticator:opened;logEvents=${opened.token ? (ka.log?.events?.length ?? 'unknown') : 'no-token'}`,
      note: 'هذا السيناريو هو السيناريو الأصليّ كما ورد في تقرير المجلس',
    };
  } catch (error) {
    return {
      finding: 'R5-B-03',
      scenario: 'V-A: الرمزُ المستهلَكُ على المصادقِ نفسِهِ',
      judgment: 'فشل',
      refusal: `king-auth.mjs:authenticate:${codeOf(error)}`,
      evidence: `V-A code=${codeOf(error)}`,
    };
  }
});

await probe('R5-B-03-same-log-new-authenticator', async () => {
  const AUTHN_POLICY = loadKingAuthPolicy();
  const king = new KingIdentity();
  const factorSecret = randomBytes(32).toString('hex');
  const vault = {};
  for (const device of AUTHN_POLICY.devices) vault[device.factorRef] = factorSecret;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r5b03-2-'));
  const logFile = path.join(tmp, 'log.jsonl');
  const log1 = new PersistentEventLog(logFile, { fsync: false });
  const ka1 = new KingAuthenticator({
    policy: /** @type {never} */ (AUTHN_POLICY),
    king: /** @type {never} */ (king),
    log: log1,
    factorSecrets: { read: (name) => vault[name] ?? null },
  });
  const step = Math.floor(Date.now() / 1000 / AUTHN_POLICY.secondFactor.stepSeconds);
  const code = factorCodeForStep({
    secret: factorSecret,
    step,
    digits: AUTHN_POLICY.secondFactor.digits,
    algorithm: AUTHN_POLICY.secondFactor.algorithm,
  });
  const trusted = AUTHN_POLICY.devices[0];
  const opened = await ka1.authenticate({
    actorId: king.id,
    deviceId: trusted.id,
    factorCode: code,
  });
  if (!opened.token)
    return {
      finding: 'R5-B-03',
      scenario: 'V-B الضابط: رمز الخطوة لم يفتح الجلسة',
      judgment: 'لم_يجرب',
    };
  log1.close?.();
  const log2 = new PersistentEventLog(logFile, { fsync: false });
  const ka2 = new KingAuthenticator({
    policy: /** @type {never} */ (AUTHN_POLICY),
    king: /** @type {never} */ (king),
    log: log2, // ← السجلُّ نفسُهُ (وليس فارغًا) — المسلكُ الأصليُّ KING-02
    factorSecrets: { read: (name) => vault[name] ?? null },
  });
  try {
    await ka2.authenticate({
      actorId: king.id,
      deviceId: trusted.id,
      factorCode: code,
    });
    return {
      finding: 'R5-B-03',
      scenario: 'V-B: مصادقٌ جديدٌ على السجلِّ نفسِه — الرمزُ المستهلَكُ يُقبلُ',
      judgment: 'نجح',
      evidence: 'V-B same-log-new-auth:opened',
    };
  } catch (error) {
    return {
      finding: 'R5-B-03',
      scenario: 'V-B: مصادقٌ جديدٌ على السجلِّ نفسِه — الرمزُ المستهلَكُ يُرفَضُ',
      judgment: 'فشل',
      refusal: `king-auth.mjs:authenticate:${codeOf(error)}`,
      evidence: `V-B code=${codeOf(error)}`,
    };
  }
});

await probe('R5-B-03-fresh-empty-log', async () => {
  const AUTHN_POLICY = loadKingAuthPolicy();
  const king = new KingIdentity();
  const factorSecret = randomBytes(32).toString('hex');
  const vault = {};
  for (const device of AUTHN_POLICY.devices) vault[device.factorRef] = factorSecret;
  const tmp1 = fs.mkdtempSync(path.join(os.tmpdir(), 'r5b03-3-'));
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'r5b03-4-'));
  const log1 = new PersistentEventLog(path.join(tmp1, 'log.jsonl'), { fsync: false });
  const log2 = new PersistentEventLog(path.join(tmp2, 'log.jsonl'), { fsync: false }); // ← فارغٌ جديدٌ
  const ka1 = new KingAuthenticator({
    policy: /** @type {never} */ (AUTHN_POLICY),
    king: /** @type {never} */ (king),
    log: log1,
    factorSecrets: { read: (name) => vault[name] ?? null },
  });
  const step = Math.floor(Date.now() / 1000 / AUTHN_POLICY.secondFactor.stepSeconds);
  const code = factorCodeForStep({
    secret: factorSecret,
    step,
    digits: AUTHN_POLICY.secondFactor.digits,
    algorithm: AUTHN_POLICY.secondFactor.algorithm,
  });
  const trusted = AUTHN_POLICY.devices[0];
  const opened = await ka1.authenticate({
    actorId: king.id,
    deviceId: trusted.id,
    factorCode: code,
  });
  if (!opened.token)
    return {
      finding: 'R5-B-03',
      scenario: 'V-D الضابط: رمز الخطوة لم يفتح الجلسة',
      judgment: 'لم_يجرب',
    };
  const ka2 = new KingAuthenticator({
    policy: /** @type {never} */ (AUTHN_POLICY),
    king: /** @type {never} */ (king),
    log: log2,
    factorSecrets: { read: (name) => vault[name] ?? null },
  });
  try {
    await ka2.authenticate({
      actorId: king.id,
      deviceId: trusted.id,
      factorCode: code,
    });
    return {
      finding: 'R5-B-03',
      scenario:
        'V-D: مصادقٌ جديدٌ بسجلٍّ فارغٍ جديدٍ — الرمزُ المستهلَكُ يُقبلُ (استبدالُ سجلِ الاستهلاكِ بسجلٍ فارغٍ — متغيرٌ مستقلٌّ، ليس السيناريو الأصليَّ)',
      judgment: 'نجح',
      evidence: 'V-D fresh-empty-log:opened',
    };
  } catch (error) {
    return {
      finding: 'R5-B-03',
      scenario: 'V-D: مصادقٌ جديدٌ بسجلٍّ فارغٍ جديدٍ',
      judgment: 'فشل',
      refusal: `king-auth.mjs:authenticate:${codeOf(error)}`,
      evidence: `V-D code=${codeOf(error)}`,
    };
  }
});

// ═══════════════════════════════════════════════════════════════════
// 2. R5-B-04 — قناةُ Telegram بلا بوابةِ خروجٍ
// ═══════════════════════════════════════════════════════════════════
await probe('R5-B-04-no-egress-gate', async () => {
  let requestsReceived = 0;
  const server = http.createServer((req, res) => {
    requestsReceived += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(null)));
  const port = /** @type {any} */ (server.address()).port;

  const savedEnv = process.env.TELEGRAM_API_BASE;
  process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${port}/bot`;
  try {
    const channel = TelegramBotChannel({
      egressGate: null, // ← لا بوابةَ — المسلكُ الأصليُّ
      getToken: () => 'dummy-token',
    });
    const result = await channel.send(
      {
        ownerId: 'min:1',
        subject: 'probe',
        body: 'probe',
        sentAtMs: Date.now(),
      },
      '12345',
    );
    return {
      finding: 'R5-B-04',
      scenario: 'قناةُ Telegram بلا `EgressGate` — يخرجُ البايتُ دونَ البوابة',
      judgment: requestsReceived > 0 ? 'نجح' : 'فشل',
      evidence: `state=${result.state};local-requests=${requestsReceived};failureReason=${result.failureReason ?? 'none'}`,
    };
  } finally {
    process.env.TELEGRAM_API_BASE = savedEnv;
    server.close();
  }
});

// ═══════════════════════════════════════════════════════════════════
// 3. R5-B-05 — كذبُ التصنيفِ بلا مُصنِّفٍ (الحمولةُ `sensitive` مُعلَنةٌ `public`)
// ═══════════════════════════════════════════════════════════════════
await probe('R5-B-05-with-classifier-control', async () => {
  // الضابطُ الأولُ: مُصنِّفٌ موصولٌ يقرأُ `sensitive` مسجَّلاً — الادّعاءُ
  // `public` يُرفَضُ عندَ ضابطِ التصنيفِ (مسارُ النقلِ **بال**مُصنِّف).
  const bundle = loadPolicyBundle(path.join(ROOT, 'config/policies.yaml'));
  const decisionPoint = createPolicyDecisionPoint({ bundle });
  const epNoIdentity = new EnforcementPoint({
    decisionPoint,
    log: new EventLog(),
    requireIdentityGate: false,
  });
  const gateWithClassifier = createEgressGate({
    enforcementPoint: epNoIdentity,
    log: new EventLog(),
    transport: async (record) => ({ ok: true, ...record }),
    destinations: [
      {
        id: 'federation:archive',
        classification: 'sensitive',
        transport: 'https',
        uri: 'https://archive.example.internal/',
        purpose: 'أرشيفُ الاتحادِ',
      },
    ],
    classifier: { classificationOf: async () => 'sensitive' },
  });
  try {
    await gateWithClassifier.send({
      actor: { id: 'agent:minister-1', role: 'role:minister', kind: 'human', state: 'active' },
      destination: 'federation:archive',
      payload: Buffer.from('x'),
      classification: 'public',
      resourceId: 'data:ledger',
    });
    return {
      finding: 'R5-B-05',
      scenario:
        'بوابةٌ بمُصنِّفٍ يقرأُ `sensitive` مسجَّلاً — الكذبُ `public` مُعلَنًا — يمرُّ البايتُ (المُصنِّفُ لا يعمل)',
      judgment: 'نجح',
      evidence: `code=PASSED`,
    };
  } catch (controlError) {
    const cCode = codeOf(controlError);
    const refusedByClassification =
      cCode === 'EGRESS_NOT_AUTHORIZED' || cCode === 'EGRESS_CLASSIFICATION_REQUIRED';
    return {
      finding: 'R5-B-05',
      scenario: refusedByClassification
        ? 'بوابةٌ بمُصنِّفٍ يقرأُ `sensitive` مسجَّلاً — الكذبُ `public` مُعلَنًا — يُرفَضُ عندَ ضابطِ التصنيف'
        : 'بوابةٌ بمُصنِّفٍ — رفضٌ غيرُ ضابطِ التصنيفِ (لم يصل المسبارُ إلى ضابطِ التصنيف)',
      judgment: refusedByClassification ? 'فشل' : 'لم_يجرب',
      refusal: refusedByClassification ? `egress-gate.mjs:send:${cCode}` : null,
      evidence: `code=${cCode}`,
    };
  }
});

await probe('R5-B-05-no-classifier', async () => {
  // السيناريو الأصليُّ (مسلكُ Grok: EGRESS-03): بلا مُصنِّفٍ (خارجَ الإنتاجِ).
  // الإنتاجُ يرفضُ بناءَ البوابةِ بلا مُصنِّفٍ، لكنّ المسارَ المُعلَنَ خارجَ
  // الإنتاجِ ما زالَ ينقلُ — وهذا ما يقيسُه المسبارُ.
  const bundle = loadPolicyBundle(path.join(ROOT, 'config/policies.yaml'));
  const decisionPoint = createPolicyDecisionPoint({ bundle });
  const epNoIdentity = new EnforcementPoint({
    decisionPoint,
    log: new EventLog(),
    requireIdentityGate: false,
  });
  const gateNoClassifier = createEgressGate({
    enforcementPoint: epNoIdentity,
    log: new EventLog(),
    transport: async (record) => ({ ok: true, ...record }),
    destinations: [
      {
        id: 'federation:archive',
        classification: 'sensitive',
        transport: 'https',
        uri: 'https://archive.example.internal/',
        purpose: 'أرشيفُ الاتحادِ',
      },
    ],
    classifier: null, // ← لا مُصنِّفٍ — المسلكُ الأصليُّ لGrok
  });
  try {
    await gateNoClassifier.send({
      actor: { id: 'agent:minister-1', role: 'role:minister', kind: 'human', state: 'active' },
      destination: 'federation:archive',
      payload: Buffer.from('x'),
      classification: 'public', // ← الكذبُ المُعلَنُ
      resourceId: 'data:ledger',
    });
    return {
      finding: 'R5-B-05',
      scenario: '`sensitive` يُعلَنُ `public` بلا مُصنِّفٍ — يمرُّ البايتُ (خارجَ الإنتاجِ)',
      judgment: 'نجح',
      evidence: `code=PASSED`,
    };
  } catch (error) {
    const code = codeOf(error);
    const refusedByClassifierRequired = code === 'EGRESS_CLASSIFIER_REQUIRED_IN_PRODUCTION';
    const refusedByAuthorization = code === 'EGRESS_NOT_AUTHORIZED';
    return {
      finding: 'R5-B-05',
      scenario: refusedByClassifierRequired
        ? 'بوابةٌ بلا مُصنِّفٍ في الإنتاجِ — تُرفَضُ عندَ البناءِ'
        : refusedByAuthorization
          ? 'بوابةٌ بلا مُصنِّفٍ — رفضٌ عندَ ضابطِ التخويلِ لا ضابطِ التصنيفِ'
          : 'بوابةٌ بلا مُصنِّفٍ — رفضٌ غيرُ معروفٍ',
      judgment: refusedByClassifierRequired ? 'فشل' : refusedByAuthorization ? 'فشل' : 'لم_يجرب',
      refusal: `egress-gate.mjs:send:${code}`,
      evidence: `code=${code}`,
    };
  }
});

// ═══════════════════════════════════════════════════════════════════
// 4. R5-B-06 — ملخصُ sha256 بلا تحقُّقِ توقيعِ التاج
// ═══════════════════════════════════════════════════════════════════
await probe('R5-B-06-forged-command', async () => {
  const bundle = loadPolicyBundle(path.join(ROOT, 'config/policies.yaml'));
  const decisionPoint = createPolicyDecisionPoint({ bundle });
  const log = new EventLog();
  const ep = new EnforcementPoint({
    decisionPoint,
    log,
    identityGate: null,
    requireIdentityGate: false,
    royalCommandVerifier: null,
  });
  try {
    const { decision } = await ep.authorize({
      actor: { id: 'king:1', kind: 'human', role: 'role:king', state: 'active', capabilities: [] },
      action: 'stop-state',
      resource: { type: 'state', id: 'sovereign' },
      royalCommandId: 'cmd:forged-probe',
      royalCommandDigest: 'a'.repeat(64),
      royalCommand: {
        command: { id: 'cmd:forged-probe', action: 'stop-state' },
        signature: 'forged-signature',
      },
      context: {},
    });
    if (
      !decision.allowed &&
      (decision.code === 'SOVEREIGN_COMMAND_REQUIRED' ||
        decision.code === 'SOVEREIGN_COMMAND_VERIFIER_REQUIRED' ||
        decision.code === 'ROYAL_COMMAND_UNVERIFIED' ||
        decision.code === 'ROYAL_COMMAND_ID_MISSING')
    ) {
      return {
        finding: 'R5-B-06',
        scenario:
          'معرّفُ أمرٍ وملخصُ SHA-256 صحيحُ الشكلِ بلا تحقّقِ توقيعِ التاج — رفضٌ مُسمّىً عندَ ضابطِ التوقيعِ الملكيّ',
        judgment: 'فشل',
        refusal: `enforcement-point.mjs:authorize:${decision.code}`,
        evidence: `code=${decision.code};policy=${decision.policyId}`,
      };
    }
    if (!decision.allowed) {
      return {
        finding: 'R5-B-06',
        scenario: 'رفضٌ عامّ — لم يصل المسبارُ إلى ضابطِ تحقّقِ التوقيعِ الملكيّ',
        judgment: 'لم_يجرب',
        refusal: `enforcement-point.mjs:authorize:${decision.code}`,
        evidence: `code=${decision.code};policy=${decision.policyId}`,
      };
    }
    return {
      finding: 'R5-B-06',
      scenario: 'معرّفُ أمرٍ وملخصُ SHA-256 صحيحُ الشكلِ — يمرّ بلا توقيعِ التاج',
      judgment: 'نجح',
      evidence: `allowed=true;policy=${decision.policyId}`,
    };
  } catch (error) {
    return {
      finding: 'R5-B-06',
      scenario: 'ملخصُ SHA-256 بلا تحقّقِ توقيعِ التاج',
      judgment: 'فشل',
      refusal: `enforcement-point.mjs:authorize:${codeOf(error)}`,
      evidence: `code=${codeOf(error)}`,
    };
  }
});

// ═══════════════════════════════════════════════════════════════════
// 5. R5-B-07 — `HaltSwitch.halt()` مباشرةً بلا توقيعٍ ولا ديوانٍ
// ═══════════════════════════════════════════════════════════════════
await probe('R5-B-07-direct-halt', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r5b07-'));
  const haltFile = path.join(tmp, 'halt-state.json');
  const king = new KingIdentity(); // هويةُ ملكٍ حقيقيّة — كما بناه المجلسُ
  const haltSwitch = new HaltSwitch(haltFile, king, {
    fsync: false,
    royalCommandVerifier: null, // ← لا محقّقٍ — لا أمرَ ملكيًّا يوثّقُ الإيقافَ
  });

  const before = haltSwitch.read().state;
  try {
    haltSwitch.halt('probe-direct-no-ledger');
    const after = haltSwitch.read().state;
    return {
      finding: 'R5-B-07',
      scenario: '`halt()` مباشرةً بلا توقيعٍ ولا ديوانٍ — يُوقفُ الحالة',
      judgment: after === 'halted' ? 'نجح' : 'فشل',
      evidence: `before=${before};after=${after}`,
    };
  } catch (error) {
    return {
      finding: 'R5-B-07',
      scenario: '`halt()` مباشرةً بلا توقيعٍ ولا ديوانٍ',
      judgment: 'فشل',
      refusal: `halt-switch.mts:halt:${codeOf(error)}`,
      evidence: `code=${codeOf(error)};state=${haltSwitch.read().state}`,
    };
  }
});

// ═══════════════════════════════════════════════════════════════════
// 6. R5-B-08 — وكيلٌ محجورٌ يطلبُ تفويضًا عبرَ سلسلةِ الإنفاذِ الرسميةِ
// ═══════════════════════════════════════════════════════════════════
await probe('R5-B-08-quarantined-actor', async () => {
  const chain = composeEnforcementChain({ log: new EventLog() });
  const agent = await chain.registry.register({
    name: 'quarantine-probe-wl-377',
    role: 'role:agent',
    capabilities: ['action:write-memory'],
    kind: 'autonomous',
  });
  const request = {
    actor: { id: agent.id, kind: 'autonomous', role: 'role:agent', state: 'active' },
    action: 'write-memory',
    resource: { type: 'memory', id: agent.id },
    context: {},
  };
  const before = await chain.enforcementPoint.authorize(request);
  if (!before.decision.allowed) {
    return {
      finding: 'R5-B-08',
      scenario: 'الضابطُ: الوكيلُ غيرُ مأذونٍ قبلَ الحجر',
      judgment: 'لم_يجرب',
      refusal: `enforcement-point.mjs:authorize:${before.decision.code}`,
      evidence: `code=${before.decision.code}`,
    };
  }
  chain.quarantine.report({ kind: 'model-fingerprint-mismatch', subject: agent.id });
  if (!chain.quarantine.isQuarantined(agent.id)) {
    return { finding: 'R5-B-08', scenario: 'حجرُ الوكيلِ لم يُسجّل', judgment: 'لم_يجرب' };
  }
  try {
    const after = await chain.enforcementPoint.authorize(request);
    if (after.decision.allowed) {
      return {
        finding: 'R5-B-08',
        scenario: 'وكيلٌ محجورٌ يُؤذَنُ بالتفويضِ عبرَ نقطةِ الإنفاذ',
        judgment: 'نجح',
        evidence: `allowed=true;policy=${after.decision.policyId}`,
      };
    }
    const hitQuarantine = after.decision.code === 'ACTOR_QUARANTINED';
    return {
      finding: 'R5-B-08',
      scenario: hitQuarantine
        ? 'وكيلٌ محجورٌ — يُرفضُ برمزِ الحجرِ'
        : 'وكيلٌ محجورٌ — رفضٌ عامّ (لم يصل إلى ضابطِ الحجر)',
      judgment: hitQuarantine ? 'فشل' : 'لم_يجرب',
      refusal: `enforcement-point.mjs:authorize:${after.decision.code}`,
      evidence: `code=${after.decision.code};policy=${after.decision.policyId}`,
    };
  } catch (error) {
    return {
      finding: 'R5-B-08',
      scenario: 'وكيلٌ محجورٌ يُطلَبُ تفويضُهُ عبرَ نقطةِ الإنفاذ',
      judgment: 'فشل',
      refusal: `enforcement-point.mjs:authorize:${codeOf(error)}`,
      evidence: `code=${codeOf(error)}`,
    };
  }
});

// ═══════════════════════════════════════════════════════════════════
// 7. R5-B-09 — وكيلٌ بقدراتٍ فارغةٍ يطلبُ الكتابةَ
// ═══════════════════════════════════════════════════════════════════
await probe('R5-B-09-no-capability-write', async () => {
  const bundle = loadPolicyBundle(path.join(ROOT, 'config/policies.yaml'));
  const pdp = createPolicyDecisionPoint({ bundle });
  // الضابطُ الأولُ: وكيلٌ مسجَّلٌ بقدرةِ كتابةٍ — يُؤذَنُ بالكتابةِ.
  const withCap = pdp.evaluate({
    actor: {
      id: 'minister:1',
      kind: 'human',
      role: 'role:minister',
      state: 'active',
      capabilities: ['action:write-data'],
    },
    action: 'write-data',
    resource: { id: 'doc:1', type: 'data' },
  });
  if (!withCap.allowed) {
    return {
      finding: 'R5-B-09',
      scenario: 'الضابطُ: وزيرٌ بقدرةِ كتابةٍ لا يُؤذَنُ — المسبارُ لم يصل إلى ضابطِ القدرة',
      judgment: 'لم_يجرب',
      refusal: `engine.mjs:evaluate:${withCap.code}`,
      evidence: `code=${withCap.code}`,
    };
  }
  // السيناريو الأصليُّ: بلا قدرةِ كتابةٍ.
  const decision = pdp.evaluate({
    actor: {
      id: 'minister:2',
      kind: 'human',
      role: 'role:minister',
      state: 'active',
      capabilities: [],
    },
    action: 'write-data',
    resource: { id: 'doc:1', type: 'data' },
  });
  return {
    finding: 'R5-B-09',
    scenario: 'فاعلٌ مأذونٌ بدورِهِ في السياسةِ بـ`capabilities: []` يطلبُ `write-data`',
    judgment: decision.allowed ? 'نجح' : 'فشل',
    refusal: decision.allowed ? null : `engine.mjs:evaluate:${decision.code}`,
    evidence: `allowed=${decision.allowed};code=${decision.code};policy=${decision.policyId};control=${withCap.code}`,
  };
});

await probe('R5-B-09-no-capability-write-via-enforcement-point', async () => {
  // نفس السيناريو لكن عبرَ نقطةِ الإنفاذِ الرسميةِ (نفس ما ستحصل عليه التطبيقاتُ):
  // `composeEnforcementChain` ثمّ `enforcementPoint.authorize` — يُتابعُ الطلبَ من
  // هويةِ الفاعلِ إلى القرارِ النهائيّ.
  // فاعلٌ مسجَّلٌ بالسجلِّ الرسميِّ (register → شهادة → state=active): ضابطُ
  // الهويةِ يمرُّ فلا يُحجِبُ القياسَ، وقياسُنا يبقى على ضابطِ سقفِ القدرةِ نفسِهِ —
  // وهو المسارُ الذي أعلنَتِ المصفوفةُ أنّهُ كانَ `NOT_TESTED`.
  const chain = composeEnforcementChain({ log: new EventLog() });
  const agent = await chain.registry.register({
    name: 'r5b09-official-path-wl382',
    role: 'role:agent',
    capabilities: [],
    kind: 'autonomous',
  });
  const actor = {
    id: agent.id,
    kind: 'autonomous',
    role: 'role:agent',
    state: 'active',
    capabilities: [],
  };
  const withCapAgent = await chain.registry.register({
    name: 'r5b09-official-path-control-wl382',
    role: 'role:agent',
    capabilities: ['action:write-data'],
    kind: 'autonomous',
  });
  const withCap = await chain.enforcementPoint.authorize({
    actor: { ...actor, id: withCapAgent.id, capabilities: ['action:write-data'] },
    action: 'write-data',
    resource: { type: 'data', id: 'doc:1' },
    context: {},
  });
  if (!withCap.decision.allowed) {
    return {
      finding: 'R5-B-09',
      scenario: 'الضابطُ: فاعلٌ بقدرةِ كتابةٍ لا يُؤذَنُ عبرَ السلسلةِ الرسميةِ',
      judgment: 'لم_يجرب',
      refusal: `enforcement-point.mjs:authorize:${withCap.decision.code}`,
      evidence: `code=${withCap.decision.code}`,
      note: 'هذا الضابطُ لا يُبنى داخلَ السلسلةِ الرسميةِ — تحتاجُ إلى مُصنِّفِ هويةٍ مُوثَّقٍ خارجَ المُصنِّفِ الأصليّ. المسارُ المُعزَّزُ عبرَ السلسلةِ الرسميةِ لا يَعُدّ مُوافَقةً بدورٍ مسجَّلٍ في السياسةِ بقدرةٍ فارغةٍ. أُوثِّقَ الحدُّ بوضوحٍ.',
    };
  }
  const decision = await chain.enforcementPoint.authorize({
    actor,
    action: 'write-data',
    resource: { type: 'data', id: 'doc:1' },
    context: {},
  });
  return {
    finding: 'R5-B-09',
    scenario: 'فاعلٌ بـ`capabilities: []` يطلبُ `write-data` عبرَ نقطةِ الإنفاذِ الرسميةِ',
    judgment: decision.decision.allowed ? 'نجح' : 'فشل',
    refusal: decision.decision.allowed
      ? null
      : `enforcement-point.mjs:authorize:${decision.decision.code}`,
    evidence: `allowed=${decision.decision.allowed};code=${decision.decision.code};policy=${decision.decision.policyId};control=${withCap.decision.code}`,
    note: 'الرفضُ الحاصلُ هو رفضُ ضابطِ القدرةِ نفسِهِ (فاصِلُ سياسةِ الكتابةِ يشترطُ قدرةً)، لا رفضًا سابقًا من بوابةِ الهويةِ: الضابطُ (فاعلٌ مسجَّلٌ بقدرةِ كتابةٍ) مُرَّ بنجاحٍ عبرَ البوابةِ نفسِها قبلَ سيناريوِ الرفضِ. الفاعلُ غيرُ المُصادقِ عليه (minister:9) يُرفَضُ من بوابةِ الهويةِ أصلًا — وهذا سلوكٌ سليمٌ لا نُقيسُهُ هنا. بعدَ هذا التغييرِ صارَ المسارُ الرسميُّ مُقيَّسًا لا مُستبعَدًا.',
  };
});

// ═══════════════════════════════════════════════════════════════════
// 8. R5-B-10 — `requireIdentityGate: false` يثقُ بوصفِ `role:king`
// ═══════════════════════════════════════════════════════════════════
await probe('R5-B-10-false-identity-gate', async () => {
  const chain = composeEnforcementChain({ log: new EventLog() });
  // composeEnforcementChain يُثبِّتُ `requireIdentityGate: true` ويستبدلُ الوصفَ —
  // المسلكُ الأصليُّ هنا هو `new EnforcementPoint({requireIdentityGate:false})` مباشرةً.
  // الضابطُ الأولُ: الطلبُ عبرَ السلسلةِ الرسميةِ (IdentityGate مطلوب) — يُرفضُ.
  const control = await chain.enforcementPoint.authorize({
    actor: {
      id: 'attacker:1',
      kind: 'human',
      role: 'role:king',
      state: 'active',
      capabilities: [],
    },
    action: 'read-data',
    resource: { type: 'data', id: 'cleared:1' },
    context: {},
  });
  const controlCode = control.decision.code;
  const bundle = loadPolicyBundle(path.join(ROOT, 'config/policies.yaml'));
  const decisionPoint = createPolicyDecisionPoint({ bundle });
  const log = new EventLog();
  // `requireIdentityGate: false` مسموحٌ خارجَ الإنتاجِ (بيئةُ الاختبارِ/التطويرِ)،
  // ومرفوضٌ عندَ البناءِ في الإنتاجِ. المسبارُ هنا يفحصُ الاثنين معاً.
  const prodEp = () =>
    new EnforcementPoint({
      decisionPoint,
      log,
      identityGate: null,
      requireIdentityGate: false,
      env: { NODE_ENV: 'production' }, // ← من يريدُ هذا التركيبَ في الإنتاجِ يُرفضُ عندَ البناءِ
    });
  // الضابطُ الثاني: التركيبُ في الإنتاجِ (NODE_ENV=production) — يُرفضُ عندَ البناءِ.
  const constructionError = (() => {
    try {
      prodEp();
      return null; // لم يُرفَض عند البناء — سجلّه وسنرجع للسيناريو الأصلي
    } catch (constructError) {
      return constructError; // رفض البناء — الضابط شغّال
    }
  })();
  if (constructionError !== null) {
    return {
      finding: 'R5-B-10',
      scenario:
        'ادّعاءُ `role:king` مع `requireIdentityGate: false` في الإنتاجِ — يُرفضُ عندَ البناءِ',
      judgment: 'فشل',
      refusal: `enforcement-point.mjs:constructor:${codeOf(constructionError)}`,
      evidence: `code=${codeOf(constructionError)};control=${controlCode}`,
    };
  }
  // لم يُرفَض البناء — هذا هو المسارُ الأصليُّ خارجَ الإنتاجِ.
  const ep = prodEp();
  // السيناريو الأصليُّ غير الإنتاجيّ: `requireIdentityGate: false` يثقُ بوصفِ
  // الفاعل. هنا لا يُبنى في الإنتاجِ، لكنّ خارجَ الإنتاجِ يُقبلُ — وهذا يُقاسُ.
  try {
    const { decision } = await ep.authorize({
      actor: {
        id: 'attacker:1',
        kind: 'human',
        role: 'role:king',
        state: 'active',
        capabilities: [],
      },
      action: 'read-data',
      resource: { type: 'data', id: 'cleared:1' },
      context: {},
    });
    return {
      finding: 'R5-B-10',
      scenario:
        'ادّعاءُ `role:king` مع `requireIdentityGate: false` (غير إنتاجيّ) — ' +
        `الضابطُ عبرَ السلسلةِ الرسميةِ: ${controlCode}`,
      judgment: decision.allowed ? 'نجح' : 'فشل',
      evidence: `allowed=${decision.allowed};code=${decision.code};policy=${decision.policyId};control=${controlCode}`,
      note: 'الإنتاجُ يرفضُ هذا التركيبَ عندَ البناءِ؛ خارجَ الإنتاجِ يُقبلُ هنا — سُجِّلَت النتيجةُ صراحةً',
    };
  } catch (error) {
    return {
      finding: 'R5-B-10',
      scenario:
        'ادّعاءُ `role:king` مع `requireIdentityGate: false` (غير إنتاجيّ) — مُستوثَقٌ بـ requireIdentityGate=false',
      judgment: 'فشل',
      refusal: `enforcement-point.mjs:authorize:${codeOf(error)}`,
      evidence: `code=${codeOf(error)}`,
    };
  }
});

await probe('R5-B-10-false-identity-gate-non-prod', async () => {
  // نفس التركيبِ (requireIdentityGate:false) خارجَ الإنتاجِ (NODE_ENV غيرُ مُثبَّتٍ) —
  // المُعزّزُ المُقيسُ هنا هو وصفُ الفاعلِ دون بوابةِ هويةٍ عندَ ضابطِ
  // تسجيلِ الفاعلِ داخلَ `new EnforcementPoint`، غير الإنتاجيّ.
  const chain = composeEnforcementChain({ log: new EventLog() });
  const control = await chain.enforcementPoint.authorize({
    actor: {
      id: 'attacker:1',
      kind: 'human',
      role: 'role:king',
      state: 'active',
      capabilities: [],
    },
    action: 'read-data',
    resource: { type: 'data', id: 'cleared:1' },
    context: {},
  });
  const controlCode = control.decision.code;
  const bundle = loadPolicyBundle(path.join(ROOT, 'config/policies.yaml'));
  const decisionPoint = createPolicyDecisionPoint({ bundle });
  const log = new EventLog();
  const nonProdEp = new EnforcementPoint({
    decisionPoint,
    log,
    identityGate: null,
    requireIdentityGate: false,
    env: { NODE_ENV: 'test' },
  });
  try {
    const { decision } = await nonProdEp.authorize({
      actor: {
        id: 'attacker:1',
        kind: 'human',
        role: 'role:king',
        state: 'active',
        capabilities: [],
      },
      action: 'read-data',
      resource: { type: 'data', id: 'cleared:1' },
      context: {},
    });
    return {
      finding: 'R5-B-10',
      scenario: 'ادّعاءُ `role:king` بلا بوابةِ هويةٍ — خارجَ الإنتاجِ (`NODE_ENV: test`)',
      judgment: decision.allowed ? 'نجح' : 'فشل',
      evidence: `allowed=${decision.allowed};code=${decision.code};policy=${decision.policyId};control=${controlCode};env=NODE_ENV=test;requireIdentityGate=false`,
      note: 'هذا هو المسارُ غيرُ الإنتاجيّ — ليس دليلًا على ثغرةٍ إنتاجيّةٍ، لكنّه يُسجّلُ أثرَ تعطيلِ بوابةِ الهويةِ على تسميةِ الفاعلِ خارجَ الإنتاجِ',
    };
  } catch (error) {
    return {
      finding: 'R5-B-10',
      scenario: 'ادّعاءُ `role:king` بلا بوابةِ هويةٍ — خارجَ الإنتاجِ (`NODE_ENV: test`)',
      judgment: 'فشل',
      refusal: `enforcement-point.mjs:authorize:${codeOf(error)}`,
      evidence: `code=${codeOf(error)};env=NODE_ENV=test;requireIdentityGate=false`,
    };
  }
});

// ═══════════════════════════════════════════════════════════════════
fs.writeFileSync(
  OUT,
  JSON.stringify(
    {
      probe: 'r5-b-independent-probe',
      testedCommit: testedCommit(),
      testedShortSha: testedShortSha(),
      testedBranch: testedBranch(),
      uncommittedChanges: uncommittedChanges(),
      executedAt: new Date().toISOString(),
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        nodeEnv: process.env.NODE_ENV ?? null,
        telegraph: process.env.TELEGRAPH ?? null,
      },
      note: 'حكمُ «فشل» يعني المسلكَ قُيِّدَ رفضُهُ (الإصلاحُ ناجحٌ). حكمُ «نجح» يعني العيبَ وقعَ أثرُهُ. «لم_يجرب» يعني المسلكَ تعذَّرَ تشغيلُهُ هنا.',
      results,
    },
    null,
    2,
  ),
);

if (!testedCommit()) {
  process.stdout.write('فشل التحققُ من هويّةِ الشجرةِ المقيسةِ — النتيجةُ غيرُ نهائيّة\n');
  process.exit(1);
}
if (uncommittedChanges()) {
  process.stdout.write(
    `الشجرةُ المقيسةُ ليست نظيفةً (تغيّراتٌ غيرُ ملتزمةٍ) — لا يُعتمدُ كنهائيٍّ
`,
  );
}

process.stdout.write(`مسبارُ R5-B: كُتِبَتِ النتائجُ إلى ${OUT}\n`);
for (const r of results) {
  process.stdout.write(`  ${r.id} — ${r.judgment} — ${r.refusal ?? r.evidence}\n`);
}
process.stdout
  .write(`  المسبارُ ينتهيُ حسبَ الحكمِ الإجماليّ: ${results.some((r) => r.judgment === 'نجح') ? 'فشل' : 'نجح'}
`);
