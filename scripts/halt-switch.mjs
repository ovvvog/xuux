#!/usr/bin/env node
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
import { createPublicKey } from 'node:crypto';
import {
  HaltSwitch,
  haltAckPayload,
  isProductionRuntime,
  kingKeyProviderFromEnv,
  loadKingKeySet,
  openProductionSigners,
  royalVerifierFromPublicKey,
  signHaltAck,
} from '../src/root-of-trust/index.mjs';

/** الاستعمال المطبوع عند الخطأ أو عند `--help`. */
const USAGE = `الاستعمال:
  node scripts/halt-switch.mjs status  [--json]
  node scripts/halt-switch.mjs halt    [--reason "سبب"] [--json]
  node scripts/halt-switch.mjs resume  [--reason "سبب"] [--json]
  node scripts/halt-switch.mjs confirm --node-key <pem> [--json]
  node scripts/halt-switch.mjs verify  [--json]

البيئة:
  HALT_SWITCH_FILE      ملف التوجيه الدائم (إلزامي)
  HALT_NODE_ID          معرّف العقدة (إلزامي لأمر confirm)
  HALT_NODE_KEY_FILE    مفتاح العقدة الخاص (إلزامي لأمر confirm — GPT-F05)
  HALT_PUBLIC_KEY_FILE  مفتاح الملك العام: قراءة وإقرار بلا قدرة إصدار
  مخزن المفاتيح:        KING_KEY_STORE_ENDPOINT/TOKEN أو KING_KEY_DIR/KING_KEY_MASTER`;

/**
 * يفكّ وسائط سطر الأوامر إلى أمرٍ وخيارات.
 * @param {string[]} argv - الوسائط بعد اسم السكربت
 * @returns {{ command: string, json: boolean, reason: string | null, nodeKeyFile: string | null }} الأمر وخياراته
 */
export function parseArgs(argv) {
  /** @type {{ command: string, json: boolean, reason: string | null, nodeKeyFile: string | null }} */
  const parsed = { command: argv[0] ?? 'status', json: false, reason: null, nodeKeyFile: null };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') parsed.json = true;
    else if (argument === '--reason') {
      const value = argv[index + 1];
      if (!value) throw new Error('--reason بلا قيمة');
      parsed.reason = value;
      index += 1;
    } else if (argument === '--node-key') {
      const value = argv[index + 1];
      if (!value) throw new Error('--node-key بلا قيمة');
      parsed.nodeKeyFile = value;
      index += 1;
    } else throw new Error(`وسيط غير معروف: ${argument}`);
  }
  return parsed;
}

/**
 * يقرأ الإعداد من البيئة ويرفض ما ينقص، فلا يُخترع مسار افتراضي لزرّ إيقاف.
 * @param {NodeJS.ProcessEnv} env - البيئة
 * @returns {{ file: string, nodeId: string | null, publicKeyFile: string | null, nodeKeyFile: string | null }} الإعداد
 */
export function readConfig(env) {
  const file = env['HALT_SWITCH_FILE'];
  if (!file) throw new Error('HALT_SWITCH_FILE غير معلَن');
  return {
    file,
    nodeId: env['HALT_NODE_ID'] ?? null,
    publicKeyFile: env['HALT_PUBLIC_KEY_FILE'] ?? null,
    nodeKeyFile: env['HALT_NODE_KEY_FILE'] ?? null,
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
  // ترتيبُ الاختيارِ مقصود: وضعُ «القراءةِ والإقرار» بمفتاحٍ عامٍّ أولاً — فمن
  // أعطى مفتاحاً عامّاً طلبَ عقدةً لا مُصدِراً. ثم الإنتاجُ على التوكن
  // (WL-092): كانت الأداةُ تفشلُ هنا لأن المخزنَ البرمجيَّ مرفوضٌ في الإنتاج،
  // فصار الإصدارُ يقعُ بمفتاحِ F06 داخلَ التوكن. ثم المخزنُ البرمجيُّ للتطوير.
  let signers = null;
  let king;
  if (config.publicKeyFile) {
    king = royalVerifierFromPublicKey(readFileSync(config.publicKeyFile, 'utf8'));
  } else if (production) {
    signers = await openProductionSigners(env, deps);
    king = signers.anchorSigner;
  } else {
    king = await loadKingKeySet(kingKeyProviderFromEnv(env));
  }
  try {
    // R5-B-07: الإصدارُ من الأداةِ أمرٌ ملكيٌّ تُنشئُه الأداةُ وتُمرِّرُه — فلا
    // إيقافَ بنداءٍ مجرّدٍ. والأداةُ لا تُصدِرُ إلّا لمن حملَ مفتاحَ الملكِ
    // (التوكنَ في الإنتاجِ أو المخزنَ في التطويرِ)، وأما وضعُ المفتاحِ العامِّ
    // فيَعبرُ البوّابةَ ويُرَدُّ عندَ التوقيعِ برمزِه المعلَن `HALT_SIGNER_REQUIRED`.
    const royalCommand = { id: `cmd:halt-cli-${new Date().toISOString()}` };
    const halt = new HaltSwitch(config.file, king, {
      royalCommandVerifier: (command) => command.id === royalCommand.id,
    });

    if (args.command === 'status') {
      const description = halt.describe();
      return args.json ? JSON.stringify(description, null, 2) : formatDescription(description);
    }

    if (args.command === 'halt') {
      // في الإنتاج التوقيعُ نداءٌ غيرُ متزامنٍ إلى التوكن، ولا نظيرَ متزامنٌ له:
      // `HsmSigner.sign` يرفعُ `HSM_SYNC_SIGN_UNSUPPORTED` عن قصد.
      const directive = production
        ? await halt.haltAsync(args.reason ?? 'royal sovereign halt', royalCommand)
        : halt.halt(args.reason ?? 'royal sovereign halt', royalCommand);
      return args.json
        ? JSON.stringify({ halted: true, directive }, null, 2)
        : `⛔ صدر الإيقاف في العهد ${directive.epoch} بإصدار المفتاح ${directive.keyVersion}\nالسبب: ${directive.reason}\nالتجزئة: ${directive.hash}`;
    }

    if (args.command === 'resume') {
      const directive = production
        ? await halt.resumeAsync(args.reason ?? 'royal resume', royalCommand)
        : halt.resume(args.reason ?? 'royal resume', royalCommand);
      return args.json
        ? JSON.stringify({ resumed: true, directive }, null, 2)
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
    // جلسةُ التوكنِ تُغلقُ دائماً: أداةُ إيقافٍ تُنادى في لحظةِ أزمةٍ لا تصحُّ
    // أن تتركَ دخولاً مفتوحاً على المفتاحِ السياديّ.
    if (signers) await signers.close();
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
