#!/usr/bin/env node
// @ts-nocheck
// مفتاح الإيقاف الشامل — أداة التشغيل، الخطوة M2.08
//
// الغرض:      إصدار الإيقاف السيادي واستئنافه من سطر الأوامر، وإظهار من أقرّ
//             بالتوقف ومن بقي حياً لم يُقرّ — لأن إيقافاً لا يُرى لا يُوثق به.
// المدخلات:   status | halt | resume | confirm | verify   [--json] [--reason "…"]
//             الإعداد من البيئة لا من الأمر:
//               HALT_SWITCH_FILE       ملف التوجيه الدائم (إلزامي)
//               HALT_NODE_ID           معرّف العقدة، إلزامي لأمر confirm
//               HALT_PUBLIC_KEY_FILE   مفتاح الملك العام: وضع قراءة وإقرار فقط
//               ومخزن المفاتيح كما في rotate-king-key.mjs، لأمر halt/resume
// المخرجات:   تقرير نصي أو JSON بـ‏`--json`. لا تُطبع مادة مفتاح خاص أبداً.
// التشغيل:    HALT_SWITCH_FILE=… node scripts/halt-switch.mjs halt --reason "سبب"
// الاختبار:   node --test tests/tooling/halt-switch-cli.test.mjs
// الصلاحيات:  قراءة وكتابة ملف التوجيه ومجلداته، وقراءة مخزن المفاتيح عند
//             الإصدار. لا تمرّ ببوابة التاج — فهي التي تُوقفها.
// المالك:     مسؤول جذر الثقة.
//
// لماذا وضع «القراءة والإقرار» بمفتاح عام: العقدة في التشغيل تُقرّ بتوقفها ولا
// يجوز أن تملك ما تستأنف به الدولة. فمن يشغّل الأداة على عقدة يعطيها المفتاح
// العام وحده، فتُقرّ ويُرفض عليها الإصدار برمز `HALT_SIGNER_REQUIRED`.

import { readFileSync } from 'node:fs';
import { createPublicKey, randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import {
  awaitRootIntentResult,
  registerPossessionPayload,
  registerRotationPayload,
  submitRootIntent,
  HaltSwitch,
  haltAckPayload,
  isProductionRuntime,
  kingKeyProviderFromEnv,
  loadKingKeySet,
  openProductionSigners,
  royalVerifierFromPublicKey,
  signHaltAck,
} from '../src/root-of-trust/index.mjs';
import {
  createRoyalCommandVerifier,
  canonicalRoyalCommand,
} from '../src/root-of-trust/royal-command.mjs';
import { sign as softwareSign } from 'node:crypto';

/** الاستعمال المطبوع عند الخطأ أو عند `--help`. */
const USAGE = `الاستعمال:
  node scripts/halt-switch.mjs status  [--json]
  node scripts/halt-switch.mjs halt    [--reason "سبب"] [--json]
  node scripts/halt-switch.mjs resume  [--reason "سبب"] [--json]
  node scripts/halt-switch.mjs confirm --node-key <pem> [--json]
  node scripts/halt-switch.mjs verify  [--json]

الإنتاج (‏\`D6\`، \`WL-326\`): الأداةُ ليست كاتباً للحالة. halt/resume/confirm تُودِعُ قصداً
مُصادَقاً في صندوقِ عمليةِ الجذرِ (‏XUUX_STATE_ROOT) وتنتظرُ نتيجتَها بعدَ الدوام:
  halt|resume --command-file <أمرٌ ملكيٌّ موقَّعٌ JSON> [--timeout-ms N]
  confirm     --node-key <pem>                      [--timeout-ms N]
  confirm     --node-key <pem> --old-node-key <pem> [--timeout-ms N]
    تدويرُ مفتاحِ عقدةٍ قائمةٍ (‏\`LIVE-40\` أ): المفتاحُ الجديدُ يُثبتُ الحيازةَ،
    والمفتاحُ القديمُ المسجَّلُ يُوقّعُ إذنَ التدوير — فلا يُقبَلُ بأحدهما وحدَه.

البيئة:
  HALT_SWITCH_FILE       ملف التوجيه الدائم (إلزامي)
  HALT_NODE_ID           معرّف العقدة (إلزامي لأمر confirm)
  HALT_NODE_KEY_FILE     مفتاح العقدة الخاص (إلزامي لأمر confirm — GPT-F05)
  HALT_OLD_NODE_KEY_FILE مفتاح العقدة القديم (تدويرُ مفتاحِ عقدةٍ قائمة — LIVE-40)
  HALT_PUBLIC_KEY_FILE   مفتاح الملك العام: قراءة وإقرار بلا قدرة إصدار
  مخزن المفاتيح:         KING_KEY_STORE_ENDPOINT/TOKEN أو KING_KEY_DIR/KING_KEY_MASTER`;

/**
 * يفكّ وسائط سطر الأوامر إلى أمرٍ وخيارات.
 * @param {string[]} argv - الوسائط بعد اسم السكربت
 * @returns {{ command: string, json: boolean, reason: string | null, nodeKeyFile: string | null, oldNodeKeyFile: string | null }} الأمر وخياراته
 */
export function parseArgs(argv) {
  /** @type {{ command: string, json: boolean, reason: string | null, nodeKeyFile: string | null, oldNodeKeyFile: string | null }} */
  const parsed = {
    command: argv[0] ?? 'status',
    json: false,
    reason: null,
    nodeKeyFile: null,
    oldNodeKeyFile: null,
    commandFile: null,
    timeoutMs: 30_000,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') parsed.json = true;
    else if (argument === '--reason') {
      const value = argv[index + 1];
      if (!value) throw new Error('--reason بلا قيمة');
      parsed.reason = value;
      index += 1;
    } else if (argument === '--command-file') {
      const value = argv[index + 1];
      if (!value) throw new Error('--command-file بلا قيمة');
      parsed.commandFile = value;
      index += 1;
    } else if (argument === '--timeout-ms') {
      const value = Number(argv[index + 1]);
      if (!Number.isSafeInteger(value) || value <= 0)
        throw new Error('--timeout-ms بلا قيمة صحيحة');
      parsed.timeoutMs = value;
      index += 1;
    } else if (argument === '--node-key') {
      const value = argv[index + 1];
      if (!value) throw new Error('--node-key بلا قيمة');
      parsed.nodeKeyFile = value;
      index += 1;
    } else if (argument === '--old-node-key') {
      const value = argv[index + 1];
      if (!value) throw new Error('--old-node-key بلا قيمة');
      parsed.oldNodeKeyFile = value;
      index += 1;
    } else throw new Error(`وسيط غير معروف: ${argument}`);
  }
  return parsed;
}

/**
 * يقرأ الإعداد من البيئة ويرفض ما ينقص، فلا يُخترع مسار افتراضي لزرّ إيقاف.
 * @param {NodeJS.ProcessEnv} env - البيئة
 * @returns {{ file: string, nodeId: string | null, publicKeyFile: string | null, nodeKeyFile: string | null, oldNodeKeyFile: string | null }} الإعداد
 */
export function readConfig(env) {
  const file = env['HALT_SWITCH_FILE'];
  if (!file) throw new Error('HALT_SWITCH_FILE غير معلَن');
  return {
    file,
    nodeId: env['HALT_NODE_ID'] ?? null,
    publicKeyFile: env['HALT_PUBLIC_KEY_FILE'] ?? null,
    nodeKeyFile: env['HALT_NODE_KEY_FILE'] ?? null,
    oldNodeKeyFile: env['HALT_OLD_NODE_KEY_FILE'] ?? null,
  };
}

/**
 * يصوغ الخلاصة نصاً مقروءاً.
 * @param {import('../src/root-of-trust/halt-switch.mjs').HaltDescription} description - الخلاصة
 * @returns {string} التقرير
 */
export function formatDescription(description) {
  const lines = [
    description.state === 'halted' ? '⛔ الدولة موقوفة' : '✅ الدولة تعمل',
    `العهد: ${description.epoch}`,
    `السبب: ${description.reason}`,
    `الوقت: ${description.at ?? '—'}`,
    `عقد مسجَّلة: ${description.nodes.length}`,
    `أقرّت بالتوقف: ${description.confirmed.join('، ') || '—'}`,
    `لم تُقرّ: ${description.pending.map((node) => `${node.nodeId}${node.alive ? ' (حيّة)' : ' (ميتة)'}`).join('، ') || '—'}`,
    `التحقق تام: ${description.fullyConfirmed ? 'نعم' : 'لا'}`,
  ];
  if (description.problem) lines.push(`العطب (فشل مغلق): ${description.problem}`);
  return lines.join('\n');
}

/**
 * يُودِعُ قصداً وينتظرُ نتيجتَه؛ رفضُ الجذرِ يُرفَعُ برمزِه.
 * @param {string} root - جذرُ الحالة
 * @param {string} kind - نوعُ القصد
 * @param {object} payload - الحمولة
 * @param {number} timeoutMs - المهلة
 * @returns {Promise<unknown>} نتيجةُ الجذر
 */
async function submitAndAwait(root, kind, payload, timeoutMs) {
  const intent = submitRootIntent(root, /** @type {never} */ (kind), payload);
  const outcome = await awaitRootIntentResult(root, intent.id, { timeoutMs });
  if (!outcome.ok) {
    const error = new Error(`${outcome.code}: ${outcome.detail ?? ''}`);
    /** @type {Error & { code?: string }} */ (error).code = outcome.code;
    throw error;
  }
  return outcome.result;
}

/**
 * المسارُ الإنتاجيّ (‏`D6`، `WL-326`، `LIVE-34`): الأداةُ **قارئةٌ** — `HaltSwitch` بـ`readOnly`
 * وبالبيئةِ المُعطاةِ نفسِها (‏كانت تُركَّبُ ببيئةِ العمليةِ فتكتبُ بلا حدٍّ ولا سجلٍّ مختوم) —
 * وكلُّ تبديلٍ قصدٌ مُصادَقٌ يُودَعُ في صندوقِ الجذرِ فيُطبِّقُه الكاتبُ الواحدُ عبرَ الحاجز.
 * والأمرُ الملكيُّ لا يُوقَّعُ هنا بمفتاحِ المرساة: يُعطى موقَّعاً بالمفتاحِ الملكيِّ، ويتحقّقُ
 * منه مُحقِّقُ الجذرِ لا مُحقِّقٌ تبنيه الأداةُ من مفتاحِها.
 * @param {ReturnType<typeof parseArgs>} args - الأمرُ وخياراته
 * @param {ReturnType<typeof readConfig>} config - الإعداد
 * @param {NodeJS.ProcessEnv} env - البيئة
 * @param {object} deps - حقنُ مصدرِ المفاتيح
 * @returns {Promise<string>} المخرج
 */
async function runProduction(args, config, env, deps) {
  const root = env['XUUX_STATE_ROOT'];
  if (!root) throw new Error('HALT_STATE_ROOT_REQUIRED: XUUX_STATE_ROOT غير معلَن');
  if (resolve(config.file) !== resolve(join(root, 'halt', 'directive.json'))) {
    throw new Error('HALT_SWITCH_FILE_NOT_ROOT_DIRECTIVE: HALT_SWITCH_FILE ليس توجيهَ جذرِ الحالة');
  }
  let signers = null;
  let king;
  if (config.publicKeyFile) {
    king = royalVerifierFromPublicKey(readFileSync(config.publicKeyFile, 'utf8'));
  } else {
    signers = await openProductionSigners(env, deps);
    king = signers.anchorSigner;
  }
  try {
    const halt = new HaltSwitch(config.file, king, { env, readOnly: true });
    if (args.command === 'status') {
      const description = halt.describe();
      return args.json ? JSON.stringify(description, null, 2) : formatDescription(description);
    }
    if (args.command === 'verify') {
      const result = halt.verifyHistory();
      if (args.json) return JSON.stringify(result, null, 2);
      return result.ok ? '✅ سلسلة التوجيهات متصلة وموقَّعة' : `❌ ${result.problem}`;
    }
    if (args.command === 'halt' || args.command === 'resume') {
      if (!args.commandFile) {
        throw new Error(
          'HALT_ROYAL_COMMAND_FILE_REQUIRED: في الإنتاجِ يُعطى الأمرُ موقَّعاً بالمفتاحِ الملكيِّ (‏--command-file)',
        );
      }
      const royalCommand = JSON.parse(readFileSync(args.commandFile, 'utf8'));
      if (royalCommand?.operation !== args.command) {
        throw new Error(`HALT_ROYAL_COMMAND_OPERATION_MISMATCH: ${royalCommand?.operation}`);
      }
      const reason = args.reason ?? royalCommand.reason;
      const directive = await submitAndAwait(
        root,
        args.command,
        { royalCommand, reason },
        args.timeoutMs,
      );
      return args.json
        ? JSON.stringify(
            { [args.command === 'halt' ? 'halted' : 'resumed']: true, directive },
            null,
            2,
          )
        : args.command === 'halt'
          ? `⛔ صدر الإيقاف في العهد ${directive.epoch}\nالسبب: ${directive.reason}`
          : `✅ استُؤنف التشغيل في العهد ${directive.epoch}\nالسبب: ${directive.reason}`;
    }
    if (args.command === 'confirm') {
      if (!config.nodeId) throw new Error('HALT_NODE_ID غير معلَن');
      const nodeKeyFile = args.nodeKeyFile ?? config.nodeKeyFile;
      if (!nodeKeyFile)
        throw new Error('HALT_NODE_KEY_FILE غير معلَن (مطلوب لأمر confirm — GPT-F05)');
      const privateKeyPem = readFileSync(nodeKeyFile, 'utf8');
      const publicKeyPem = String(
        createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' }),
      );
      const registered = halt.nodes().find((node) => node.nodeId === config.nodeId);
      if (registered?.nodeKeyPem !== publicKeyPem) {
        const registerPayload = {
          nodeId: config.nodeId,
          publicKeyPem,
          possession: signHaltAck(
            privateKeyPem,
            registerPossessionPayload(config.nodeId, publicKeyPem),
          ),
        };
        // `LIVE-40` (أ): عقدةٌ قائمةٌ بمفتاحٍ آخرَ: التسجيلُ لا يُقبَلُ بالمفتاحِ
        // الجديدِ وحدَه، بل بإذنٍ من المفتاحِ **القديمِ المسجَّلِ** فوقَ مادةِ التدوير.
        // غيابُه رفضٌ مغلقٌ بذكرِ سببِه لا بصمتٍ يُدّعي نجاحاً.
        if (registered !== undefined) {
          const oldNodeKeyFile = args.oldNodeKeyFile ?? config.oldNodeKeyFile;
          if (!oldNodeKeyFile) {
            throw new Error(
              'HALT_NODE_KEY_ROTATION_OLD_KEY_REQUIRED: العقدةُ مسجَّلةٌ بمفتاحٍ آخرَ — ' +
                'تدويرُ مفتاحِها يلزمُه مفتاحُها القديمُ المسجَّلُ (--old-node-key أو HALT_OLD_NODE_KEY_FILE)',
            );
          }
          registerPayload.rotation = signHaltAck(
            readFileSync(oldNodeKeyFile, 'utf8'),
            registerRotationPayload(config.nodeId, publicKeyPem),
          );
        }
        await submitAndAwait(root, 'register', registerPayload, args.timeoutMs);
      }
      const reading = halt.read();
      const proof = signHaltAck(
        privateKeyPem,
        haltAckPayload(reading.directive?.hash ?? '', reading.epoch, config.nodeId),
      );
      const confirmation = await submitAndAwait(
        root,
        'confirm',
        { nodeId: config.nodeId, proof, detail: 'إقرار من أداة التشغيل' },
        args.timeoutMs,
      );
      return args.json
        ? JSON.stringify({ confirmed: true, confirmation }, null, 2)
        : `✅ أقرّت العقدة ${confirmation.nodeId} بالتوقف في العهد ${confirmation.epoch}`;
    }
    throw new Error(`أمر غير معروف: ${args.command}\n\n${USAGE}`);
  } finally {
    if (signers) await signers.close();
  }
}

/**
 * ينفّذ الأمر ويرجع ما يُطبع، بلا مسّ `process`، كي يُختبر نداءً لا عملية.
 * @param {string[]} argv - الوسائط
 * @param {NodeJS.ProcessEnv} env - البيئة
 * @param {import('../src/root-of-trust/index.mjs').ProductionRuntimeDeps} [deps] - حقنُ مصدرِ المفاتيحِ للاختبار (الإنتاج فقط)
 * @returns {Promise<string>} المخرج المطبوع
 */
export async function run(argv, env, deps = {}) {
  const args = parseArgs(argv);
  if (args.command === '--help' || args.command === 'help') return USAGE;
  const config = readConfig(env);
  const production = isProductionRuntime(env);
  if (production) return runProduction(args, config, env, deps);
  // ترتيبُ الاختيارِ مقصود: وضعُ «القراءةِ والإقرار» بمفتاحٍ عامٍّ أولاً — فمن
  // أعطى مفتاحاً عامّاً طلبَ عقدةً لا مُصدِراً. ثم الإنتاجُ على التوكن
  // (WL-092): كانت الأداةُ تفشلُ هنا لأن المخزنَ البرمجيَّ مرفوضٌ في الإنتاج،
  // فصار الإصدارُ يقعُ بمفتاحِ F06 داخلَ التوكن. ثم المخزنُ البرمجيُّ للتطوير.
  // ما بعدَ هذا مسارُ التطويرِ وحدَه: الإنتاجُ رجعَ أعلاه إلى مسارِ القصود (‏`D6`).
  let king;
  let publicKeyPem = null;
  if (config.publicKeyFile) {
    publicKeyPem = readFileSync(config.publicKeyFile, 'utf8');
    king = royalVerifierFromPublicKey(publicKeyPem);
  } else {
    king = await loadKingKeySet(kingKeyProviderFromEnv(env));
  }
  try {
    // R5-B-07: الإصدارُ من الأداةِ أمرٌ ملكيٌّ موقَّعٌ تشفيرياً — لا مقارنةَ معرّفٍ.
    // الأداةُ تَبني جسمَ الأمرِ (operation, signerId, reason, at) وتوقّعُهُ بمفتاحِ
    // الملكِ، ثمَّ تُمرِّرُهُ إلى `HaltSwitch` الذي يَتحقَّقُ منه بالمفتاحِ العامِّ.
    // وضعُ المفتاحِ العامِّ وحدَهُ لا يستطيعُ التوقيعَ — فهو يَرفضُ halt/resume
    // بـ`HALT_SIGNER_REQUIRED` ويُسمحُ له بـ status/verify/confirm فقط.
    const kingId = king.id;
    const pem =
      publicKeyPem ?? king.publicKeyPem ?? king.publicKey.export({ type: 'spki', format: 'pem' });
    const halt = new HaltSwitch(config.file, king, {
      royalCommandVerifier: createRoyalCommandVerifier(pem),
    });

    if (args.command === 'status') {
      const description = halt.describe();
      return args.json ? JSON.stringify(description, null, 2) : formatDescription(description);
    }

    if (args.command === 'halt' || args.command === 'resume') {
      // إن لم يكن الموقِّعُ قادراً على التوقيع (مفتاحٌ عامٌّ فقط)، فالإصدارُ مستحيلٌ.
      const canSign = Boolean(king.privateKey);
      if (!canSign) {
        throw new Error('HALT_SIGNER_REQUIRED');
      }
      // بناءُ الأمرِ الملكيِّ الموقَّعِ — لا يُكتفى بمقارنةِ المعرّفِ.
      const operation = args.command;
      const reason =
        args.reason ?? (operation === 'halt' ? 'royal sovereign halt' : 'royal resume');
      const at = new Date().toISOString();
      // `WL-302`: الأمرُ يُختَمُ بالعهدِ الحاضرِ وبمعرّفٍ عشوائيٍّ — فيُنفَّذُ مرّةً
      // واحدةً على هذا العهدِ ولا يُعادُ بعدَه، ولو بعدَ إعادةِ التشغيل.
      const body = {
        operation,
        signerId: kingId,
        commandId: randomBytes(16).toString('hex'),
        targetEpoch: halt.read().epoch,
        reason,
        at,
      };
      const canonical = canonicalRoyalCommand(body);
      // التطويرُ: التوقيعُ البرمجيُّ المتزامنُ على الجسمِ الأساسيِّ المتسلسَلِ.
      const signature = softwareSign(null, Buffer.from(canonical), king.privateKey).toString(
        'base64url',
      );
      const royalCommand = { ...body, signature };

      const directive =
        operation === 'halt' ? halt.halt(reason, royalCommand) : halt.resume(reason, royalCommand);
      return args.json
        ? JSON.stringify(
            { [operation === 'halt' ? 'halted' : 'resumed']: true, directive },
            null,
            2,
          )
        : operation === 'halt'
          ? `⛔ صدر الإيقاف في العهد ${directive.epoch} بإصدار المفتاح ${directive.keyVersion}\nالسبب: ${directive.reason}\nالتجزئة: ${directive.hash}`
          : `✅ استُؤنف التشغيل في العهد ${directive.epoch}\nالسبب: ${directive.reason}`;
    }

    if (args.command === 'confirm') {
      // GPT-F05: لا يُقبل إقرارٌ إلا أن يكون موقَّعاً من مفتاح العقدة. فالأداة
      // تُحمّل مفتاح العقدة الخاصّ، وتُسجّل بالمفتاح العامّ، وتوقّع الإقرار فوق
      // (تجزئة التوجيه، العهد، المعرّف). من لا يملك مفتاح العقدة لا يُقرّ بها.
      if (!config.nodeId) throw new Error('HALT_NODE_ID غير معلَن');
      const nodeKeyFile = args.nodeKeyFile ?? config.nodeKeyFile;
      if (!nodeKeyFile)
        throw new Error('HALT_NODE_KEY_FILE غير معلَن (مطلوب لأمر confirm — GPT-F05)');
      const privateKeyPem = readFileSync(nodeKeyFile, 'utf8');
      const publicKeyPem = createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' });
      halt.registerNode(config.nodeId, {
        nodeKey: {
          publicKeyPem: String(publicKeyPem),
          sign: (payload) => signHaltAck(privateKeyPem, payload),
        },
      });
      const reading = halt.read();
      const directiveHash = reading.directive?.hash ?? '';
      const proof = signHaltAck(
        privateKeyPem,
        haltAckPayload(directiveHash, reading.epoch, config.nodeId),
      );
      const confirmation = halt.confirmHalt(config.nodeId, proof, 'إقرار من أداة التشغيل');
      return args.json
        ? JSON.stringify({ confirmed: true, confirmation }, null, 2)
        : `✅ أقرّت العقدة ${confirmation.nodeId} بالتوقف في العهد ${confirmation.epoch}`;
    }

    if (args.command === 'verify') {
      const result = halt.verifyHistory();
      if (args.json) return JSON.stringify(result, null, 2);
      const lines = [
        result.ok ? '✅ سلسلة التوجيهات متصلة وموقَّعة' : '❌ سلسلة التوجيهات منكسرة',
        `توجيهات: ${result.directives}`,
      ];
      if (result.problem)
        lines.push(`العطب: ${result.problem}${result.problemAt ? ` عند ${result.problemAt}` : ''}`);
      return lines.join('\n');
    }

    throw new Error(`أمر غير معروف: ${args.command}\n\n${USAGE}`);
  } finally {
    // لا جلسةَ توكنٍ في مسارِ التطوير؛ جلسةُ الإنتاجِ تُغلَقُ في `runProduction`.
  }
}

// التشغيل المباشر فقط؛ الاستيراد للاختبار لا يُنفّذ شيئاً.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2), process.env)
    .then((output) => {
      process.stdout.write(output + '\n');
    })
    .catch((error) => {
      process.stderr.write(`خطأ: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
