#!/usr/bin/env node
// تدوير مفتاح الملك — الخطوة M2.04
//
// الغرض:      أداة التشغيل الحقيقية لتدوير مفتاح الملك: عرض الحالة، وإصدار
//             مفتاح جديد بفترة تعايش، وإبطال إصدار قديم. تحلّ محل القالب
//             `scripts/rotate_keys.sh` الذي كان ثلاثة تعليقات بلا منطق
//             (وحُذف مع 13,645 ملفاً قالبياً في M1.07 — راجع WL-003).
// المدخلات:   status | rotate [--coexist-hours <س>] | revoke --version <ن> --reason <نص>
//             والمخزن يُقرأ من البيئة (‏KING_KEY_STORE_ENDPOINT/TOKEN للإنتاج،
//             أو KING_KEY_DIR/KING_KEY_MASTER للتطوير) — لا يُختار في الكود.
// المخرجات:   تقرير نصي أو JSON بـ‏`--json`. **لا تُطبع مادة مفتاح خاص أبداً**،
//             ولا عنوان المخزن ولا توكنه. المفاتيح العامة وحدها تُعرض.
// التشغيل:    node scripts/rotate-king-key.mjs status
// الاختبار:   node --test tests/tooling/rotate-king-key-cli.test.mjs
// الصلاحيات:  قراءة وكتابة في مخزن المفاتيح فقط. لا يمرّ ببوابة التاج.
// المالك:     مسؤول جذر الثقة.
//
// لماذا أداةٌ لا نداءٌ في الكود: التدوير فعلٌ تشغيلي يقع تحت ضغط — بعد تسرّب
// مشتبه به مثلاً — ومن ينفّذه ليلاً لا يكتب كوداً. وأخطر ما في التدوير أن
// يُبطل القديم قبل إعادة توقيع ما صدر عنه، فالأداة تفصل الفعلين فصلاً صريحاً
// وتُظهر بين الأمرين مهلة التعايش وما بقي منها.

import {
  describeKingKeyRotation,
  kingKeyProviderFromEnv,
  loadKingKeySet,
  revokeKingKeyVersion,
  rotateKingKey,
} from '../src/root-of-trust/index.mjs';

/** الاستعمال المطبوع عند الخطأ أو عند `--help`. */
const USAGE = `الاستعمال:
  node scripts/rotate-king-key.mjs status [--json]
  node scripts/rotate-king-key.mjs rotate [--coexist-hours <ساعات>] [--json]
  node scripts/rotate-king-key.mjs revoke --version <رقم> --reason <نص> [--json]

المخزن يُعلَن في البيئة لا في الأمر:
  الإنتاج:  KING_KEY_STORE_ENDPOINT و KING_KEY_STORE_TOKEN
  التطوير:  KING_KEY_DIR و KING_KEY_MASTER`;

/**
 * يفكّ وسائط سطر الأوامر إلى أمرٍ وخيارات.
 * @param {string[]} argv - الوسائط بعد اسم السكربت
 * @returns {{ command: string, json: boolean, coexistHours: number | null, version: number | null, reason: string | null }}
 */
export function parseArgs(argv) {
  /** @type {{ command: string, json: boolean, coexistHours: number | null, version: number | null, reason: string | null }} */
  const parsed = {
    command: argv[0] ?? 'status',
    json: false,
    coexistHours: null,
    version: null,
    reason: null,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') parsed.json = true;
    else if (argument === '--coexist-hours') parsed.coexistHours = Number(argv[++index]);
    else if (argument === '--version') parsed.version = Number(argv[++index]);
    else if (argument === '--reason') parsed.reason = argv[++index] ?? null;
    else throw new Error(`وسيط غير معروف: ${argument}`);
  }
  return parsed;
}

/**
 * يصوغ سطر إصدار واحد للعرض.
 * @param {{ version: number, status: string, kingId: string, createdAt: string, coexistUntil?: string, revokedAt?: string, revocationReason?: string, materialPresent: boolean, acceptedNow: boolean }} record - سجل الإصدار
 * @param {Date} now - اللحظة المرجعية
 * @returns {string} سطر العرض
 */
function formatVersion(record, now) {
  /** @type {Record<string, string>} */
  const marks = {
    active: '👑 فعّال (يوقّع)',
    retiring: '🕒 متعايش (للتحقق فقط)',
    revoked: '⛔ مُبطَل',
  };
  const lines = [
    `  الإصدار ${record.version}: ${marks[record.status] ?? record.status}`,
    `      هوية الملك: ${record.kingId}`,
    `      أُنشئ: ${record.createdAt}`,
    `      المادة في المخزن: ${record.materialPresent ? 'موجودة' : 'ممحوّة'}`,
    `      مقبول الآن للتحقق: ${record.acceptedNow ? 'نعم' : 'لا'}`,
  ];
  if (record.coexistUntil) {
    const remaining = Date.parse(record.coexistUntil) - now.getTime();
    lines.push(
      `      التعايش حتى: ${record.coexistUntil}` +
        (remaining > 0
          ? ` (بقي ${(remaining / 3600000).toFixed(1)} ساعة)`
          : ' (انتهى — يجوز الإبطال)'),
    );
  }
  if (record.revokedAt) {
    lines.push(`      أُبطل: ${record.revokedAt} — السبب: ${record.revocationReason ?? '—'}`);
  }
  return lines.join('\n');
}

/**
 * ينفّذ الأمر المطلوب.
 * @param {string[]} argv - الوسائط بعد اسم السكربت
 * @returns {Promise<number>} رمز الخروج
 */
export async function run(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return 0;
  }
  const options = parseArgs(argv);
  const provider = kingKeyProviderFromEnv();
  const now = new Date();

  if (options.command === 'status') {
    const state = await describeKingKeyRotation(provider, { now });
    if (options.json) {
      console.log(JSON.stringify(state, null, 2));
      return 0;
    }
    console.log('═══ حالة تدوير مفتاح الملك (M2.04) ═══');
    console.log(
      `المخزن: ${provider.describe().kind} · إنتاجي: ${provider.describe().productionReady ? 'نعم' : 'لا'}`,
    );
    if (!state.initialized) {
      console.log(
        state.activeVersion === null
          ? 'لا مفتاح ملك مزوَّد بعد. زوّده عبر provisionKingKey (‏M2.03) قبل التدوير.'
          : 'مفتاح مزوَّد بلا بيان إصدارات: أول تدوير يُنشئ البيان ويجعله الإصدار 1.',
      );
      return 0;
    }
    console.log(`الإصدار الفعّال: ${state.activeVersion}`);
    for (const record of state.versions) console.log(formatVersion(record, now));
    const keySet = await loadKingKeySet(provider, { now });
    console.log(`الإصدارات المقبولة للتحقق الآن: ${keySet.acceptedVersions.join(' · ')}`);
    return 0;
  }

  if (options.command === 'rotate') {
    const coexistenceMs =
      options.coexistHours === null ? undefined : options.coexistHours * 3600000;
    const result = await rotateKingKey(provider, {
      ...(coexistenceMs !== undefined && { coexistenceMs }),
      now,
    });
    if (options.json) {
      console.log(JSON.stringify({ ...result, manifest: undefined }, null, 2));
      return 0;
    }
    console.log('✅ تمّ التدوير.');
    console.log(`  الإصدار الجديد: ${result.version} (كان ${result.previousVersion})`);
    console.log(`  هوية الملك الجديدة: ${result.kingId}`);
    console.log(`  الإصدار السابق يتعايش حتى: ${result.coexistUntil}`);
    console.log('');
    console.log('الخطوة التالية **قبل** انتهاء التعايش: أعد توقيع الشهادات القائمة عبر');
    console.log('reissueCertificates (‏src/root-of-trust/king-key-rotation.mts)، ثم أبطل');
    console.log(
      `الإصدار السابق: node scripts/rotate-king-key.mjs revoke --version ${result.previousVersion} --reason "<سبب>"`,
    );
    return 0;
  }

  if (options.command === 'revoke') {
    if (options.version === null || !Number.isInteger(options.version)) {
      console.error('⛔ يلزم --version <رقم صحيح>.');
      return 2;
    }
    if (!options.reason) {
      // السبب إلزامي: إبطال مفتاح ملك بلا سبب مسجَّل يترك تدقيقاً أعمى.
      console.error('⛔ يلزم --reason <نص>: إبطالٌ بلا سبب مسجَّل لا يُقبل.');
      return 2;
    }
    const record = await revokeKingKeyVersion(provider, options.version, options.reason, { now });
    if (options.json) {
      console.log(JSON.stringify(record, null, 2));
      return 0;
    }
    console.log(`⛔ أُبطل الإصدار ${record.version} ومُحيت مادته من المخزن.`);
    console.log(`  السبب: ${record.revocationReason}`);
    console.log('  كل توقيع بهذا الإصدار مرفوض من الآن، ولا رجعة في الإبطال.');
    return 0;
  }

  console.error(`⛔ أمر غير معروف: ${options.command}\n`);
  console.error(USAGE);
  return 2;
}

// عند التشغيل المباشر فقط، ليبقى الملف قابلاً للاستيراد في الاختبار.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(await run(process.argv.slice(2)));
  } catch (error) {
    // الرسالة وحدها تُطبع: أخطاء هذه الطبقة رموزٌ بلا مادة (M2.02/M2.03)،
    // وطبع كامل الخطأ قد يجرّ نصاً من مخزن أو من مادة في إصدار مستقبلي.
    console.error(`⛔ فشل: ${error instanceof Error ? error.message : 'خطأ غير متوقع'}`);
    process.exit(1);
  }
}
