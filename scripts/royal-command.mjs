#!/usr/bin/env node
// خَتمُ الأمرِ الملكيِّ وإرسالُه — أداةُ جانبِ الملكِ، سدادُ الشطرِ الأخيرِ من `D-1`
//
// الغرض:      يُخْتَمُ الأمرُ **حيثُ المفتاحُ** ثم يُرسَلُ إلى بابِ الدولةِ، فالبابُ
//             يتحقَّقُ ولا يوقِّعُ. ولو وُقِّعَ عندَ البابِ لكانَ لمن مَلَكَ الخادمَ
//             أن يُصدِرَ أوامرَ الملكِ بلا ملكٍ — وذاك نقضُ السلطةِ من أصلِها.
// المدخلات:   --url <أصلُ البابِ> --command <معرّفُ الأمرِ> [--reason "سبب"]
//             --session <رمزُ الجلسةِ القويّةِ>            (إلزاميٌّ: `G-CONSOLE-STRONG-AUTH`)
//             --key <ملفُ مفتاحٍ خاصٍّ>                    (للتطويرِ وحدَه)
//             وفي الإنتاجِ لا يُقبَلُ `--key` بحالٍ: الموقِّعُ وحدةُ أمانٍ تُفتَحُ
//             من البيئةِ (`openProductionSigners`) ولا تُصدِّرُ مادّتَها.
// المخرجات:   JSON: `{ status, code?, body }` ورمزُ خروجٍ ‏0 للمقبولِ و‏1 للمردودِ.
//             ولا تُطبَعُ مادّةُ مفتاحٍ خاصٍّ ولا التوقيعُ كاملاً.
// التشغيل:    node scripts/royal-command.mjs --url http://127.0.0.1:4179 \
//               --command cmd:veto --session "$SESSION" --key /secure/king.pem
// الاختبار:   node --test tests/tooling/royal-command-cli.test.mjs
// الصلاحيات:  قراءةُ ملفِ المفتاحِ عندَ التطويرِ، وفتحُ توكنٍ عندَ الإنتاجِ، ونداءٌ
//             شبكيٌّ واحدٌ إلى البابِ. لا تكتبُ في قرصٍ ولا تلمسُ حالةَ دولةٍ.
// المالك:     مسؤول جذر الثقة.
//
// **ولماذا `console` هنا وسيطٌ شبكيٌّ؟** لأنّ `SovereignWriter` يُرفَضُ مُغلَقاً بلا
// ديوانٍ يُصدِرُ منه — وهذا شرطٌ صحيحٌ لا يُلتَفُّ عليه. والديوانُ في هذه الأداةِ
// **هو ديوانُ البابِ على السلكِ**: `issue` تُرسِلُ الظرفَ إليه وتُرجِعُ حكمَه. فلا
// يُنسَخُ منطقُ ديوانٍ ثانٍ هنا، ولا يُدَّعى ديوانٌ لا وجودَ له.

import { readFileSync } from 'node:fs';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SovereignWriter, loadConsolePolicy, moduleSignerFromHsm } from '../src/console/index.mjs';
import { compileCommandRoutes } from '../src/transport/index.mjs';
import {
  createRoyalCommand,
  isProductionRuntime,
  openProductionSigners,
} from '../src/root-of-trust/index.mjs';
import { createDevRoyalSigner } from './dev-royal-signer.mjs';

/** وثيقةُ الديوانِ تُقرأُ من المستودعِ لا من مجلدِ العملِ: أداةٌ تُنادى من أيِّ مكانٍ. */
const CONFIG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'config');

/** الاستعمالُ المطبوعُ عندَ `--help` أو عندَ خطأِ وسائطٍ. */
export const USAGE = `الاستعمال:
  node scripts/royal-command.mjs --url <أصل> --command <معرّف> --session <رمز> [--reason "سبب"] [--key <ملف>]

الأوامرُ المُعلَنةُ تُقرأُ من \`config/royal-console.yaml\` — لا تُختلَقُ هنا.
والجلسةُ القويّةُ إلزاميّةٌ: أمرٌ بلا جلسةٍ يُرَدُّ من الديوانِ لا من هذه الأداةِ.
وفي الإنتاجِ يُرفَضُ \`--key\` مُغلَقاً: الموقِّعُ وحدةُ أمانٍ لا ملفٌّ.`;

/**
 * يفكّ الوسائط. يُرجِعُ خطأً مُسمَّىً ولا يُخمِّنُ قيمةً ناقصةً.
 * @param {string[]} argv - الوسائط بعد اسم السكربت
 * @returns {{ url: string | null, command: string | null, reason: string | null, session: string | null, keyFile: string | null, help: boolean }} الوسائطُ المفكوكةُ
 */
export function parseArgs(argv) {
  /** @type {{ url: string | null, command: string | null, reason: string | null, session: string | null, keyFile: string | null, help: boolean }} */
  const parsed = {
    url: null,
    command: null,
    reason: null,
    session: null,
    keyFile: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      parsed.help = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`ROYAL_COMMAND_ARG_WITHOUT_VALUE:${String(argument)}`);
    }
    index += 1;
    if (argument === '--url') parsed.url = value;
    else if (argument === '--command') parsed.command = value;
    else if (argument === '--reason') parsed.reason = value;
    else if (argument === '--session') parsed.session = value;
    else if (argument === '--key') parsed.keyFile = value;
    else throw new Error(`ROYAL_COMMAND_UNKNOWN_ARG:${String(argument)}`);
  }
  return parsed;
}

/**
 * يبني موقِّعاً: وحدةَ أمانٍ في الإنتاجِ، وموقِّعَ تطويرٍ مُعلَنَ الحدِّ سواه.
 * @param {{ keyFile: string | null }} args - الوسائطُ
 * @param {NodeJS.ProcessEnv} env - البيئةُ
 * @returns {Promise<import('../src/console/sovereign-writer.mjs').ModuleSigner>} الموقِّعُ
 */
export async function signerFor(args, env) {
  if (isProductionRuntime(env)) {
    // **في الإنتاجِ لا خِيارَ:** ملفُّ مفتاحٍ يُرَدُّ هنا صريحاً، ولا يُترَكُ
    // ليُرَدَّ ضِمناً في مكانٍ آخرَ — فرفضٌ بعيدٌ عن موضعِه رفضٌ لا يُقرأُ.
    if (args.keyFile !== null) throw new Error('ROYAL_COMMAND_KEY_FILE_IN_PRODUCTION');
    const signers = await openProductionSigners(env);
    // موقّعُ التثبيتِ والتوجيهاتِ (F06) هو موقّعُ الملكِ: `moduleSignerFromHsm`
    // يَرُدُّ ما دورُه غيرُ `kingSigning` مُغلَقاً، فلا يُختَمُ أمرٌ بمفتاحِ دفترٍ.
    return moduleSignerFromHsm(signers.anchorSigner);
  }
  if (args.keyFile === null) throw new Error('ROYAL_COMMAND_SIGNER_REQUIRED');
  const privateKey = createPrivateKey(readFileSync(args.keyFile, 'utf8'));
  return createDevRoyalSigner({ privateKey, publicKey: createPublicKey(privateKey) });
}

/**
 * ديوانُ البابِ على السلكِ: يُرسِلُ الظرفَ ويُرجِعُ حكمَ البابِ كما هو.
 * @param {string} origin - أصلُ البابِ
 * @param {string} path - مسارُ الأمرِ المُشتقُّ من السياسةِ
 * @returns {{ issue: (envelope: Record<string, unknown>) => Promise<{ status: number, code: string | null, body: unknown }> }} ديوانٌ شبكيٌّ
 */
export function remoteConsole(origin, path) {
  return {
    issue: async (envelope) => {
      const response = await fetch(new URL(path, origin), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
      });
      const text = await response.text();
      /** @type {unknown} */
      let body = text;
      try {
        body = JSON.parse(text);
      } catch {
        // نصٌّ غيرُ JSON يُعادُ كما هو: ادّعاءُ شكلٍ لم يأتِ تحريفٌ للشهادةِ.
      }
      const code =
        typeof body === 'object' && body !== null && 'code' in body
          ? String(/** @type {{ code: unknown }} */ (body).code)
          : null;
      return { status: response.status, code, body };
    },
  };
}

/**
 * يختِمُ الأمرَ ويُرسِلُه.
 * @param {string[]} argv - الوسائطُ
 * @param {NodeJS.ProcessEnv} [env] - البيئةُ
 * @returns {Promise<{ text: string, ok: boolean }>} النصُّ المطبوعُ وحكمُه
 */
export async function run(argv, env = process.env) {
  const args = parseArgs(argv);
  if (args.help) return { text: USAGE, ok: true };
  if (args.url === null || args.command === null) throw new Error('ROYAL_COMMAND_ARGS_INCOMPLETE');
  const policy = loadConsolePolicy({ dir: CONFIG_DIR });
  const spec = policy.commands.find(
    (/** @type {{ id: string }} */ candidate) => candidate.id === args.command,
  );
  // **الأمرُ يُقرأُ من السياسةِ لا يُختلَقُ:** معرّفٌ غيرُ مُعلَنٍ يُرَدُّ هنا بأسماءِ
  // المُعلَنِ، فلا يُرسَلُ إلى البابِ ما يعلمُ المُنادي أنّه مردودٌ.
  if (spec === undefined) {
    throw new Error(
      `ROYAL_COMMAND_UNDECLARED:${String(args.command)}:${policy.commands
        .map((/** @type {{ id: string }} */ candidate) => candidate.id)
        .join(',')}`,
    );
  }
  // **والعنوانُ على السلكِ لا يُبنى هنا بيدٍ:** `path` في الوثيقةِ مسارُ سلطةٍ
  // (`crown`) لا عنوانٌ، والعنوانُ يُشتَقُّ في `src/transport/router.mjs` من
  // الوثيقةِ نفسِها. فيُقرأُ منه — ولو بُني هنا لتفارقَ عنوانُ الأداةِ وعنوانُ
  // البابِ عندَ أوّلِ تعديلِ وثيقةٍ، وذاك خلافٌ لا يظهرُ إلا في الإنتاج.
  const route = compileCommandRoutes().find(
    (/** @type {{ id: string }} */ candidate) => candidate.id === spec.id,
  );
  if (route === undefined) throw new Error(`ROYAL_COMMAND_WITHOUT_ROUTE:${String(spec.id)}`);
  const signer = await signerFor(args, env);
  const writer = new SovereignWriter({
    console: /** @type {never} */ (remoteConsole(args.url, String(route.path))),
    signer,
    env,
  });
  const verdict = await writer.issue({
    command: spec.id,
    royalCommand: /** @type {Record<string, unknown>} */ (
      /** @type {unknown} */ (
        createRoyalCommand(
          String(spec.action),
          String(spec.target),
          args.reason === null ? {} : { reason: args.reason },
        )
      )
    ),
    ...(args.session === null ? {} : { sovereignSession: args.session }),
  });
  const shape = /** @type {{ status: number, code: string | null, body: unknown }} */ (
    /** @type {unknown} */ (verdict)
  );
  return {
    text: JSON.stringify(
      { signer: signer.describe().kind, command: spec.id, path: route.path, ...shape },
      null,
      2,
    ),
    ok: shape.status >= 200 && shape.status < 300,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2))
    .then(({ text, ok }) => {
      process.stdout.write(`${text}\n`);
      process.exit(ok ? 0 : 1);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`);
      process.exit(2);
    });
}
