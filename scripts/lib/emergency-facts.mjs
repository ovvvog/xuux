// وقائعُ تمرينِ الطوارئ — الخطوة `M11.07`
//
// **هذا الملفُّ وحدَه** يلمس القرصَ ويُشغِّل العمليّاتِ ويقرأ الساعةَ في مسارِ
// تمرينِ الطوارئ؛ وحداتُ `src/emergency/` تحكم على ما يجمعه ولا تراه. والفصلُ
// مقصودٌ: حكمٌ يملك أن يكتب على ما يفحصه يملك أن يُصلِحه ثم يُثني عليه.
//
// **والضمانُ المُنفَّذُ هنا `G-EMERGENCY-ENFORCEMENT-MEASURED`:** كلُّ طورٍ لا
// يُقبَل بغيابِ خطأٍ في تنفيذِه، بل **بوقوعِ إنفاذِه المعلَنِ فعلاً**: الإيقافُ
// يُقبَل إذا رُدَّ به استئنافٌ برمزِه، والحجْرُ يُقبَل إذا رَدَّت بوابةُ الهويّةِ
// المحجورَ برمزِه، والتعافي يُقبَل إذا خرجت عمليّتُه الابنةُ بصفرٍ وحكمِ بلوغٍ،
// والاستئنافُ يُقبَل إذا تقدّم عهدُه وصدَّقه التحقّقُ، والتقريرُ يُقبَل إذا
// قُرِئ من القرصِ بزمنِ الأطوارِ الخمسةِ كلِّها.
//
// ولذلك تُبنى في كلِّ طورٍ **مكوّناتٌ حقيقيّةٌ**: مفتاحُ ملكٍ مُزوَّدٌ في مخزنٍ
// مشفَّرٍ، ومفتاحُ إيقافٍ على ملفِّ توجيهٍ حقيقيٍّ، وسجلُّ وكلاءَ وبوابةُ هويّةٍ
// وحاجبُ حجْرٍ، ومنفِّذُ التعافي **عمليّةً ابنةً** لا نداءَ دالّةٍ تُطمئن.

import { spawnSync } from 'node:child_process';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { EMERGENCY_ERRORS, EmergencyError } from '../../src/emergency/errors.mjs';
import { assertPhasesImplemented, orderedPhaseIds } from '../../src/emergency/phase-plan.mjs';
import { QuarantineWarden } from '../../src/governance/quarantine.mjs';
import { AgentRegistry, AgentState } from '../../src/identity/agent-registry.mjs';
import { CapabilityGrantLedger } from '../../src/identity/capability-grants.mjs';
import { loadCapabilityCatalog } from '../../src/identity/capability-catalog.mjs';
import { IdentityGate } from '../../src/identity/identity-gate.mjs';
import { IncidentRegister } from '../../src/identity/incident-register.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';
import {
  CertificateAuthority,
  EventLog,
  HaltSwitch,
  KingIdentity,
  LocalEncryptedKeyProvider,
  haltAckPayload,
  loadKingKeySet,
  provisionKingKey,
  signHaltAck,
} from '../../src/root-of-trust/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** جذرُ المستودعِ — منه يُنادى منفِّذُ التعافي عمليّةً ابنةً. */
export const REPO_ROOT = path.resolve(HERE, '..', '..');

/** معرَّفُ العقدةِ الحيّةِ في التمرينِ — من يجب أن يُقرَّ بالتوقّف. */
export const DRILL_NODE_ID = 'node:emergency-drill';

/** نوعُ الشذوذِ المستخدَمُ في طورِ الحجْرِ، وعتبتُه المعلَنةُ ثلاثٌ. */
export const DRILL_ANOMALY_KIND = 'egress-refused';

/**
 * مساراتُ التمرينِ مُشتقّةً من العقدِ لا مكتوبةً في منفِّذ.
 *
 * @param {string} root
 * @param {import('../../src/emergency/contract.mjs').EmergencyContract} contract
 * @returns {{ stateRoot: string, reportsDir: string, ledger: string, lastDrill: string, king: string, halt: string, recovery: string }}
 */
export function emergencyPaths(root, contract) {
  const stateRoot = path.resolve(root, contract.source.stateRoot);
  return {
    stateRoot,
    reportsDir: path.resolve(root, contract.source.reportsDir),
    ledger: path.resolve(root, contract.ledger.path),
    lastDrill: path.resolve(root, contract.ledger.lastDrillPath),
    king: path.join(stateRoot, 'king'),
    halt: path.join(stateRoot, 'halt', 'directive.json'),
    recovery: path.join(stateRoot, 'recovery-root'),
  };
}

/**
 * يُضيف واقعةً إلى دفترِ الطوارئ: سطرٌ واحدٌ بتاريخٍ صالحٍ — فدفترٌ بلا تاريخٍ
 * لا يُقرأ منه ترتيبُ ما جرى في لحظةٍ حرجة.
 *
 * @param {{ ledger: string }} paths
 * @param {{ type: string, at: number, detail?: Record<string, unknown> }} event
 * @returns {void}
 */
export function appendEmergencyEvent(paths, event) {
  fs.mkdirSync(path.dirname(paths.ledger), { recursive: true });
  const line = JSON.stringify({
    type: event.type,
    at: event.at,
    isoDate: new Date(event.at).toISOString(),
    detail: event.detail ?? {},
  });
  fs.appendFileSync(paths.ledger, `${line}\n`, 'utf8');
}

/**
 * يقرأ دفترَ الطوارئ سطراً سطراً.
 *
 * @param {{ ledger: string }} paths
 * @returns {Record<string, unknown>[]}
 */
export function readEmergencyLedger(paths) {
  if (!fs.existsSync(paths.ledger)) {
    return [];
  }
  return fs
    .readFileSync(paths.ledger, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => /** @type {Record<string, unknown>} */ (JSON.parse(line)));
}

/**
 * يكتب سجلَّ آخرِ تمرينٍ — ومنه يُعرَف متى وقع آخرُ تمرينٍ لا من ذاكرةِ أحد.
 *
 * @param {{ lastDrill: string }} paths
 * @param {{ verdict: string, at: number, totalMs: number }} record
 * @returns {void}
 */
export function writeLastDrill(paths, record) {
  fs.mkdirSync(path.dirname(paths.lastDrill), { recursive: true });
  fs.writeFileSync(
    paths.lastDrill,
    `${JSON.stringify({ ...record, isoDate: new Date(record.at).toISOString() }, null, 2)}\n`,
    'utf8',
  );
}

/** @param {unknown} error @returns {string} */
function errorText(error) {
  if (error instanceof Error) {
    const code = /** @type {{ code?: unknown }} */ (error).code;
    return typeof code === 'string' ? `${code}: ${error.message}` : error.message;
  }
  return String(error);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorCode(error) {
  const code = /** @type {{ code?: unknown }} */ (error).code;
  return typeof code === 'string' ? code : '';
}

// ══════════════════════════════════════════════════════════════════════════
// الطورُ ١ — الإيقافُ: يُقبَل إذا رُدَّ به استئنافٌ قبل إقرارِ العقدةِ الحيّة
// ══════════════════════════════════════════════════════════════════════════

/**
 * @param {DrillContext} context
 * @returns {Promise<PhaseFacts>}
 */
async function runHaltPhase(context) {
  const master = randomUUID();
  fs.mkdirSync(context.paths.king, { recursive: true });
  await provisionKingKey(new LocalEncryptedKeyProvider(context.paths.king, master), {
    requireProductionReady: false,
  });
  const king = await loadKingKeySet(new LocalEncryptedKeyProvider(context.paths.king, master));
  // R5-B-07: أمرُ التمرينِ الملكيُّ يولِّدُه التمرينُ بنفسِه من مفتاحِ الملكِ
  // الذي ولَّده للتوِّ — فلا إيقافَ ولا استئنافَ بنداءٍ مجرّدٍ حتى في التمرين.
  const drillCommand = { id: `cmd:emergency-drill-${randomUUID()}` };
  const halt = new HaltSwitch(context.paths.halt, king, {
    fsync: false,
    royalCommandVerifier: (command) => command.id === drillCommand.id,
  });
  Object.assign(context.state, { drillCommand, halt });

  // GPT-F05: عقدةُ التمرينِ لها مفتاحها (Ed25519) كأيِّ عقدةٍ في التشغيل. المفتاحُ
  // العامُّ يُسجَّل، والإقرارُ يُوقَّعُ به فوق (التجزئة، العهد، المعرّف) — فلا يُنتحَل.
  const drillPair = generateKeyPairSync('ed25519');
  const drillPrivateKeyPem = drillPair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const drillPublicKeyPem = drillPair.publicKey.export({ type: 'spki', format: 'pem' });
  context.state.drillNodeKey = String(drillPrivateKeyPem);
  halt.registerNode(DRILL_NODE_ID, {
    pid: process.pid,
    nodeKey: {
      publicKeyPem: String(drillPublicKeyPem),
      sign: (payload) => signHaltAck(String(drillPrivateKeyPem), payload),
    },
  });
  const directive = halt.halt(
    'تمرين الطوارئ M11.07 — إيقاف سيادي مقيس',
    /** @type {{ id: string }} */ (context.state.drillCommand),
  );
  const reading = halt.read();
  if (reading.state !== 'halted' || reading.epoch <= 0) {
    return {
      enforced: false,
      failureCode: EMERGENCY_ERRORS.HALT_NOT_ENFORCED,
      evidence: `الحالةُ المقروءةُ بعد الإيقافِ «${reading.state}» بعهدٍ ${reading.epoch}.`,
      event: 'emergency.halt.issued',
      detail: { state: reading.state, epoch: reading.epoch },
    };
  }
  context.state.haltEpoch = reading.epoch;

  // الإنفاذُ المقيسُ: استئنافٌ يُطلَب الآن **يجب أن يُرَدَّ**.
  /** @type {string} */
  let refusal = '';
  try {
    halt.resume(
      'محاولةُ استئنافٍ قبل الإقرارِ — يجب أن تُرَدَّ',
      /** @type {{ id: string }} */ (context.state.drillCommand),
    );
  } catch (error) {
    refusal = errorCode(error);
  }
  if (refusal !== 'HALT_NOT_CONFIRMED') {
    return {
      enforced: false,
      failureCode: EMERGENCY_ERRORS.HALT_NOT_ENFORCED,
      evidence:
        refusal === ''
          ? 'الاستئنافُ قُبِل قبل إقرارِ العقدةِ الحيّةِ — فالإيقافُ كتابةٌ على قرصٍ لا إيقافُ دولة.'
          : `الاستئنافُ رُدَّ برمزٍ غيرِ متوقَّعٍ: ${refusal}.`,
      event: 'emergency.halt.issued',
      detail: { refusal },
    };
  }

  return {
    enforced: true,
    evidence: `الحالةُ «halted» بعهدٍ ${reading.epoch}، والاستئنافُ قبل الإقرارِ رُدَّ برمزِ HALT_NOT_CONFIRMED.`,
    event: 'emergency.halt.issued',
    detail: { epoch: reading.epoch, kingId: directive.kingId, refusal },
  };
}

// ══════════════════════════════════════════════════════════════════════════
// الطورُ ٢ — الحجْرُ: يُقبَل إذا رَدَّت بوابةُ الهويّةِ المحجورَ برمزِه
// ══════════════════════════════════════════════════════════════════════════

/**
 * @param {DrillContext} context
 * @returns {Promise<PhaseFacts>}
 */
async function runQuarantinePhase(context) {
  const now = () => new Date(context.clock());
  const kingIdentity = new KingIdentity();
  const authority = new CertificateAuthority(kingIdentity);
  const log = new EventLog();
  const catalog = loadCapabilityCatalog();
  const incidents = new IncidentRegister({ log, now });
  const grants = new CapabilityGrantLedger({ catalog, log, incidents, now });
  const registry = new AgentRegistry({
    ca: authority,
    log,
    repository: createMemoryRepository(AgentRegistry.spec),
    catalog,
    grants,
    incidents,
  });
  const gate = new IdentityGate({ registry, ca: authority, catalog, grants, incidents, log });
  const warden = new QuarantineWarden({ incidents, log, now });

  const agent = await registry.register({
    name: 'emergency-drill-subject',
    role: 'role:agent',
    capabilities: ['action:read-registry'],
  });

  // قبل الشذوذِ: الوكيلُ نشطٌ وتُصدِّقه البوابةُ — وإلا كان «الرفضُ» بعدَه رفضاً
  // لسببٍ آخرَ لا للحجْر.
  const before = await gate.verify(agent.id);
  if (before.ok !== true) {
    return {
      enforced: false,
      failureCode: EMERGENCY_ERRORS.QUARANTINE_NOT_ENFORCED,
      evidence: `الوكيلُ مرفوضٌ قبل الحجْرِ برمزِ ${String(before.code)} — فرفضٌ بعدَه لا يُنسَب إلى الحجْر.`,
      event: 'emergency.subject.quarantined',
      detail: { before: before.code },
    };
  }

  const threshold = warden.thresholdFor(DRILL_ANOMALY_KIND);
  /** @type {{ count: number, threshold: number, isolated: boolean, incidentId?: string | null }} */
  let last = { count: 0, threshold, isolated: false };
  for (let attempt = 0; attempt < threshold; attempt += 1) {
    last = warden.report({
      kind: DRILL_ANOMALY_KIND,
      subject: agent.id,
      detail: { attempt: attempt + 1, drill: 'M11.07' },
    });
  }
  await warden.settle();

  if (last.isolated !== true || !warden.isQuarantined(agent.id)) {
    return {
      enforced: false,
      failureCode: EMERGENCY_ERRORS.QUARANTINE_NOT_ENFORCED,
      evidence: `بلغت الإشاراتُ ${last.count} والعتبةُ ${threshold} ولم يُعلن الحاجبُ عزلاً.`,
      event: 'emergency.subject.quarantined',
      detail: { count: last.count, threshold },
    };
  }

  // الحجْرُ لا يكون تسميةً في ذاكرةٍ: يُنقَل الوكيلُ في السجلِّ ثم **تُسأل
  // البوابةُ** — والرفضُ المقروءُ منها هو الإنفاذ.
  await registry.transition(agent.id, AgentState.QUARANTINED, 'تمرين الطوارئ M11.07 — شذوذ مقيس');
  const after = await gate.verify(agent.id);
  if (after.ok !== false || after.code !== 'IDENTITY_NOT_ACTIVE') {
    return {
      enforced: false,
      failureCode: EMERGENCY_ERRORS.QUARANTINE_NOT_ENFORCED,
      evidence: `بوابةُ الهويّةِ لم تَرُدَّ المحجورَ برمزِ IDENTITY_NOT_ACTIVE بل ${String(after.code ?? 'قبولاً')}.`,
      event: 'emergency.subject.quarantined',
      detail: { after: after.code ?? null, ok: after.ok },
    };
  }

  return {
    enforced: true,
    evidence: `بلغت الإشاراتُ العتبةَ ${threshold} فعُزِل الوكيلُ بحادثٍ ${String(last.incidentId)}، ورَدَّته بوابةُ الهويّةِ برمزِ IDENTITY_NOT_ACTIVE.`,
    event: 'emergency.subject.quarantined',
    detail: {
      subject: agent.id,
      threshold,
      incidentId: last.incidentId ?? null,
      gateRefusal: after.code,
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════
// الطورُ ٣ — التعافي: عمليّةٌ ابنةٌ حقيقيّةٌ، ورمزُ خروجِها هو الحكم
// ══════════════════════════════════════════════════════════════════════════

/**
 * @param {DrillContext} context
 * @returns {Promise<PhaseFacts>}
 */
async function runRecoveryPhase(context) {
  fs.mkdirSync(context.paths.recovery, { recursive: true });
  const script = path.join(context.repoRoot, 'scripts', 'recovery-drill.mjs');
  if (!fs.existsSync(script)) {
    return {
      enforced: false,
      failureCode: EMERGENCY_ERRORS.RECOVERY_FAILED,
      evidence: `منفِّذُ التعافي غائبٌ: ${script} — ولا يُحاكى تعافٍ بنداءِ دالّةٍ تُطمئن.`,
      event: 'emergency.state.recovered',
      detail: { script },
    };
  }
  const outcome = spawnSync(
    process.execPath,
    [script, '--json', '--root', context.paths.recovery],
    { encoding: 'utf8', shell: false },
  );
  /** @type {Record<string, unknown>} */
  let report;
  try {
    report = JSON.parse(String(outcome.stdout ?? ''));
  } catch {
    report = {};
  }
  const verdict = String(report.verdict ?? '');
  if (outcome.status !== 0 || verdict !== 'recovery:met') {
    return {
      enforced: false,
      failureCode: EMERGENCY_ERRORS.RECOVERY_FAILED,
      evidence: `عمليّةُ التعافي خرجت برمزِ ${String(outcome.status)} وحكمِ «${verdict || 'بلا حكم'}»: ${String(outcome.stderr ?? '').slice(0, 400)}`,
      event: 'emergency.state.recovered',
      detail: { status: outcome.status, verdict },
    };
  }
  return {
    enforced: true,
    evidence: `عمليّةُ التعافي الابنةُ خرجت بصفرٍ وحكمِ recovery:met في ${String(report.totalMs)}ms على ${String(report.files)} ملفاً.`,
    event: 'emergency.state.recovered',
    detail: {
      status: outcome.status,
      verdict,
      recoveryMs: report.totalMs ?? null,
      files: report.files ?? null,
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════
// الطورُ ٤ — الاستئنافُ: يُقبَل إذا تقدّم العهدُ وصدَّقه التحقّق
// ══════════════════════════════════════════════════════════════════════════

/**
 * @param {DrillContext} context
 * @returns {Promise<PhaseFacts>}
 */
async function runResumePhase(context) {
  const halt = /** @type {HaltSwitch | undefined} */ (context.state.halt);
  if (halt === undefined) {
    return {
      enforced: false,
      failureCode: EMERGENCY_ERRORS.RESUME_NOT_ENFORCED,
      evidence: 'لا مفتاحَ إيقافٍ من الطورِ الأوّلِ — ولا يُستأنف ما لم يُوقَف.',
      event: 'emergency.halt.resumed',
      detail: {},
    };
  }
  const haltEpoch = Number(context.state.haltEpoch ?? 0);
  // GPT-F05: يُوقّع الإقرارُ بمفتاح العقدة فوق (التجزئة، العهد، المعرّف).
  const drillReading = halt.read();
  const drillProof = signHaltAck(
    String(context.state.drillNodeKey),
    haltAckPayload(drillReading.directive?.hash ?? '', drillReading.epoch, DRILL_NODE_ID),
  );
  halt.confirmHalt(DRILL_NODE_ID, drillProof, 'تمرين الطوارئ M11.07 — إقرارُ العقدةِ بالإيقاف');
  const directive = halt.resume(
    'تمرين الطوارئ M11.07 — استئناف بعد إقرار العقدة',
    /** @type {{ id: string }} */ (context.state.drillCommand),
  );
  const reading = halt.read();
  const historyOk = halt.verifyHistory().ok === true;
  if (reading.state !== 'running' || reading.epoch <= haltEpoch || !historyOk) {
    return {
      enforced: false,
      failureCode: EMERGENCY_ERRORS.RESUME_NOT_ENFORCED,
      evidence: `الحالةُ «${reading.state}» بعهدٍ ${reading.epoch} وعهدُ الإيقافِ ${haltEpoch}، وتصديقُ السجلِّ ${String(historyOk)}.`,
      event: 'emergency.halt.resumed',
      detail: { state: reading.state, epoch: reading.epoch, haltEpoch, historyOk },
    };
  }
  return {
    enforced: true,
    evidence: `أقرّت العقدةُ ${DRILL_NODE_ID} بالتوقّفِ، فعادت الحالةُ «running» بعهدٍ ${reading.epoch} أكبرَ من عهدِ الإيقافِ ${haltEpoch}، وصدَّق التحقّقُ السجلَّ.`,
    event: 'emergency.halt.resumed',
    detail: { epoch: reading.epoch, haltEpoch, kingId: directive.kingId },
  };
}

// ══════════════════════════════════════════════════════════════════════════
// الطورُ ٥ — التقريرُ: يُقبَل إذا قُرِئ من القرصِ بزمنِ الأطوارِ الخمسةِ كلِّها
// ══════════════════════════════════════════════════════════════════════════

/**
 * @param {DrillContext} context
 * @returns {Promise<PhaseFacts>}
 */
async function runReportPhase(context) {
  fs.mkdirSync(context.paths.reportsDir, { recursive: true });
  const at = context.clock();
  const selfMs = Math.max(0, Math.round(at - Number(context.state.phaseStartedAt ?? at)));
  const measured = [
    ...context.completed.map((entry) => ({
      id: entry.phase,
      ms: entry.ms,
      enforced: entry.enforced,
      evidence: entry.evidence,
    })),
    {
      id: 'phase:report',
      ms: selfMs,
      enforced: true,
      evidence: 'زمنُ كتابةِ التقريرِ مقيسٌ لحظةَ كتابتِه لا مُقدَّرٌ بعدَها.',
    },
  ];
  const file = path.join(context.paths.reportsDir, `drill-${String(at)}.json`);
  const body = {
    drill: 'M11.07',
    contractVersion: context.contract.version,
    at,
    isoDate: new Date(at).toISOString(),
    objectiveMs: context.contract.objective.maxDrillMs,
    phases: measured,
    limits: [
      'هذا التقريرُ يُثبت جاهزيّةَ الآلةِ لا سلامةَ النظامِ ولا اعتمادَه.',
      'ولا يُقرأ مراجعةً مستقلّةً (M11.04–M11.06) ولا قراراً ملكيّاً (M11.09) ولا إذناً بإطلاق.',
    ],
  };
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  const markdown = [
    `# تقريرُ تمرينِ الطوارئ — ${body.isoDate}`,
    '',
    `- عقدُ التمرينِ: \`${context.contract.version}\`  |  عهدُ الزمنِ: ${body.objectiveMs}ms`,
    '',
    '| الطور | الزمن (ms) | الإنفاذ | الدليل |',
    '| --- | --- | --- | --- |',
    ...measured.map(
      (entry) =>
        `| \`${entry.id}\` | ${entry.ms} | ${entry.enforced ? 'وقع' : 'لم يقع'} | ${entry.evidence} |`,
    ),
    '',
    '## حدودٌ معلَنة',
    '',
    ...body.limits.map((limit) => `- ${limit}`),
    '',
  ].join('\n');
  const markdownFile = file.replace(/\.json$/u, '.md');
  fs.writeFileSync(markdownFile, markdown, 'utf8');

  // يُقرأ من القرصِ بعد كتابتِه: تقريرٌ في ذاكرةٍ لا يُقرأ دليلاً بعد انتهاءِ
  // العمليّة.
  /** @type {string[]} */
  let reportPhaseIds = [];
  try {
    const reread = /** @type {{ phases: { id: string, ms: number }[] }} */ (
      JSON.parse(fs.readFileSync(file, 'utf8'))
    );
    reportPhaseIds = reread.phases
      .filter((entry) => Number.isFinite(entry.ms))
      .map((entry) => entry.id);
  } catch (error) {
    return {
      enforced: false,
      failureCode: EMERGENCY_ERRORS.REPORT_INCOMPLETE,
      evidence: `تعذّر إعادةُ قراءةِ التقريرِ من القرصِ: ${errorText(error)}`,
      event: 'emergency.report.published',
      detail: { file },
    };
  }
  context.state.reportPhaseIds = reportPhaseIds;
  context.state.reportFile = file;
  context.state.reportMarkdownFile = markdownFile;

  const missing = orderedPhaseIds(context.contract).filter((id) => !reportPhaseIds.includes(id));
  if (missing.length > 0) {
    return {
      enforced: false,
      failureCode: EMERGENCY_ERRORS.REPORT_INCOMPLETE,
      evidence: `التقريرُ المقروءُ ينقصه زمنُ الأطوارِ: ${missing.join('، ')}.`,
      event: 'emergency.report.published',
      detail: { file, missing },
    };
  }
  return {
    enforced: true,
    evidence: `التقريرُ مكتوبٌ ومقروءٌ من القرصِ بزمنِ الأطوارِ الخمسةِ: ${path.basename(file)}.`,
    event: 'emergency.report.published',
    detail: { file, markdownFile, phases: reportPhaseIds.length },
  };
}

/**
 * @typedef {object} PhaseFacts
 * @property {boolean} enforced
 * @property {string} evidence
 * @property {string} event
 * @property {string} [failureCode]
 * @property {Record<string, unknown>} [detail]
 */

/**
 * @typedef {object} DrillContext
 * @property {string} root
 * @property {string} repoRoot
 * @property {ReturnType<typeof emergencyPaths>} paths
 * @property {import('../../src/emergency/contract.mjs').EmergencyContract} contract
 * @property {() => number} clock
 * @property {Record<string, unknown>} state
 * @property {{ phase: string, ms: number, enforced: boolean, evidence: string }[]} completed
 */

/**
 * مُنفِّذو الأطوارِ بأسمائِهم المعلَنةِ في العقد.
 *
 * @returns {Record<string, (context: DrillContext) => Promise<PhaseFacts>>}
 */
export function createPhaseRunners() {
  return {
    'phase:halt': runHaltPhase,
    'phase:quarantine': runQuarantinePhase,
    'phase:recovery': runRecoveryPhase,
    'phase:resume': runResumePhase,
    'phase:report': runReportPhase,
  };
}

/**
 * يُجري التمرينَ كاملاً: الأطوارُ الخمسةُ بترتيبِها في نداءٍ واحدٍ، بلا مُدخلَةِ
 * إنسانٍ بين طورٍ وطورٍ، وبقياسِ زمنِ كلِّ طورٍ على حِدة.
 *
 * لا يحكم هذا الملفُّ على ما جمعه: يُعيد الوقائعَ لتحكم عليها
 * `src/emergency/judgement.mjs`.
 *
 * @param {{ root: string, contract: import('../../src/emergency/contract.mjs').EmergencyContract, clock?: () => number, repoRoot?: string }} options
 * @returns {Promise<{ paths: ReturnType<typeof emergencyPaths>, phases: import('../../src/emergency/judgement.mjs').PhaseOutcome[], reportPhaseIds: string[] | undefined, state: Record<string, unknown> }>}
 */
export async function collectEmergencyFacts(options) {
  const { root, contract } = options;
  const clock = options.clock ?? (() => Date.now());
  const runners = createPhaseRunners();
  assertPhasesImplemented(contract, runners);

  const paths = emergencyPaths(root, contract);
  // جذرُ التمرينِ يُفرَّغ قبل كلِّ تمرينٍ: بقاءُ حالةٍ سابقةٍ يجعل التمرينَ
  // يُنجِح نفسَه بما لم يُنفِّذه.
  fs.rmSync(paths.stateRoot, { recursive: true, force: true });
  fs.mkdirSync(paths.stateRoot, { recursive: true });

  /** @type {DrillContext} */
  const context = {
    root,
    repoRoot: options.repoRoot ?? REPO_ROOT,
    paths,
    contract,
    clock,
    state: {},
    completed: [],
  };

  /** @type {import('../../src/emergency/judgement.mjs').PhaseOutcome[]} */
  const outcomes = [];
  for (const phase of [...contract.phases].sort((left, right) => left.order - right.order)) {
    const startedAt = clock();
    context.state.phaseStartedAt = startedAt;
    /** @type {PhaseFacts} */
    let facts;
    const runner = runners[phase.id];
    try {
      if (runner === undefined) {
        throw new EmergencyError(
          EMERGENCY_ERRORS.PHASE_UNIMPLEMENTED,
          `الطورُ «${phase.id}» معلَنٌ بلا مُنفِّذٍ — ووعدُ عملٍ لا يقع.`,
        );
      }
      facts = await runner(context);
    } catch (error) {
      facts = {
        enforced: false,
        failureCode: EMERGENCY_ERRORS.PHASE_SKIPPED,
        evidence: `الطورُ انقطع بخطأٍ: ${errorText(error)}`,
        event: 'emergency.drill.refused',
        detail: { phase: phase.id },
      };
    }
    const ms = Math.max(0, Math.round(clock() - startedAt));
    const outcome = {
      phase: phase.id,
      ms,
      enforced: facts.enforced,
      evidence: facts.evidence,
      ...(facts.failureCode === undefined ? {} : { failureCode: facts.failureCode }),
    };
    outcomes.push(outcome);
    context.completed.push({
      phase: phase.id,
      ms,
      enforced: facts.enforced,
      evidence: facts.evidence,
    });
    appendEmergencyEvent(paths, {
      type: facts.event,
      at: clock(),
      detail: { phase: phase.id, ms, enforced: facts.enforced, ...(facts.detail ?? {}) },
    });
  }

  return {
    paths,
    phases: outcomes,
    reportPhaseIds: /** @type {string[] | undefined} */ (context.state.reportPhaseIds),
    state: context.state,
  };
}
