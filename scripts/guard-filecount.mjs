#!/usr/bin/env node
// حاجز عدد الملفات — بوابة G1
//
// المرجع: docs/roadmap/03-roadmap-to-100.md — البوابة G1.
// السبب: المستودع كان يحوي 33,456 ملفاً، 99.77% منها قوالب فارغة. بعد
// تصفية M1 صار 201 ملفاً. هذا الحاجز يمنع عودة الانتفاخ: أي نمو يجب أن
// يكون نمواً في محتوى حقيقي، لا في عُقد فارغة مولَّدة.
//
// الحد ليس رقماً تعسفياً: 3,200 هو ما نصّت عليه البوابة G1 بعد قرار المالكِ في
// WL-429 (رفعٌ موثَّقٌ من 3,000): القائمةُ الحاليةُ 3,000 ملفٍ بالضبطِ، وتثبيتُ أدلةِ
// الجولاتِ الخامّةِ فوقَها (تقريرا الجولةِ السادسةِ والسابعةِ ومجسّاتُها — 39 ملفًا
// وفقَ جردِ WL-428) يحتاجُ سقفًا يستوعبُها دونَ كسرِ البوابةِ. الحدُّ لا يعيقُ أيَّ
// بناءٍ حقيقيٍّ متوقَّعٍ في المساراتِ M2–M11، ويصرخُ فقط إذا عادَ أحدهم إلى توليدِ
// شجرةِ قوالب.
//
// WL-532 (رفعٌ موثَّقٌ من 3,200 إلى 3,211 — معروضٌ على المالكِ في طلبِ الدمجِ لا مُقَرٌّ عنه):
// سياجُ القاعدةِ يضيفُ 11 ملفاً بالضبطِ كلُّها كودٌ يعملُ أو اختبارٌ أو بياناتٌ لها قارئٌ أو
// دليلٌ مقيس — الهجرةُ 0024 (up/down)، وsrc/fence/ (3)، وtests/fence/ (3)، وconfig/fence-effects.yaml،
// وscripts/fence-lab.mjs، وتقريرُ المختبرِ في docs/external-review/evidence/. الرفعُ بقدرِها لا أكثر،
// فلا هامشَ يُستهلَكُ صامتاً. ورفضُ المالكِ له يعني ضغطَ الملفّاتِ لا تعطيلَ البوابة.
//
// WL-532، المراجعةُ المعدَّلة (3,211 ⇒ 3,220، +9 — معروضٌ على المالكِ أيضاً): اختبارا Ed25519 ودورةِ
// الحياة، وحزامُ الاختبارِ المشترك، ومتّجها Wycheproof/speccheck (بايتاً ببايتٍ لتطابقَ البصمةُ
// المصدر)، وكاتبُ المختبرِ (عزلٌ أمنيّ: مستخدمُ العاملِ لا يقرأُ كودَ المختبر)، وخريطةُ مساراتِ
// الاتصالِ واختبارُها، وسجلُّ المختبرِ النهائيّ. السببُ لكلِّ ملفٍّ في مُدخلةِ WL-532.
//
// المالكُ أقرَّ 3,220 لحزمةِ WL-532 (تعليقُه على #545، 2026-11-12) ونصَّ على أنّه ليس إذناً مفتوحاً.
// WL-533 (مراجعةُ #546): لا زيادة — المالكُ لم يُقِرَّ +6، فدُمجت الملفّاتُ في قائمةٍ (المُقلِعُ في
// scripts/worker.mjs، والاختبارُ في tests/execution/worker-isolation.test.mjs، والمصفوفةُ وADR في
// docs/THREAT_MODEL.md §9) والتقريرُ والسجلّاتُ الخامّ خارجَ المستودع. 3,220 إقرارٌ لـWL-532 وحدَها.
//
// ولا مسارَ للتجاوزِ بمتغيرِ بيئةٍ: القيمةُ ثابتةٌ في الشيفرةِ (قُدِّمَ رفعُها
// بقرارٍ موثَّقٍ في WL-429 لا بمتغيرِ FILE_COUNT_LIMIT الذي أُزيلَ)، فلا يرفعُ سيرُ
// عملٍ ولا مشغِّلٌ السقفَ من خارجِ الشيفرةِ.
//
// عند الحاجة إلى رفع الحد: يُرفع بقرار موثّق في سجل WL مع بيان السبب،
// لا بتعديل صامت لهذا الملف.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const LIMIT = 3220;
// الوسيط يُقرأ في متغيّر ثم يُفحص صراحةً: `--root` قد يُمرَّر بلا قيمة بعده،
// وحينها تكون القراءة بمؤشّر undefined، فالسقوط إلى مجلد العمل هو السلوك الصحيح.
const rootArg = process.argv.includes('--root')
  ? process.argv[process.argv.indexOf('--root') + 1]
  : undefined;
const ROOT = rootArg ?? process.cwd();

const SKIP = new Set(['.git', 'node_modules', 'dist', 'coverage', '.next']);

/**
 * يعدّ ما يتعقّبه Git فعلاً. صُحّح في M2.01: كان الترويسة تَدّعي عدّ المتعقَّب
 * بينما التنفيذ يمشي على نظام الملفات، فيَعُدّ المولَّد والمتجاهَل معه. صار
 * ناتج خطوة البناء يقع بجوار المصادر داخل src/root-of-trust، فبقاء الخلل
 * يعني تضخيم العدد بملفات لا تدخل المستودع أصلاً.
 * @param {string} dir
 * @returns {number | null} العدد، أو `null` إن لم يكن المسار مستودع Git
 */
function countTrackedFiles(dir) {
  try {
    const out = execFileSync('git', ['-C', dir, 'ls-files', '--cached', '--exclude-standard'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return out.split('\n').filter(Boolean).length;
  } catch {
    // لا مستودع Git (أرشيف منسوخ مثلاً): يسقط النداء إلى مسح نظام الملفات.
    return null;
  }
}

/**
 * يعدّ ملفات الشجرة على نظام الملفات — بديل احتياطي حين لا يتوفر Git.
 * @param {string} dir
 * @returns {number}
 */
function countFiles(dir) {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) n += countFiles(abs);
    else if (entry.isFile()) n += 1;
  }
  return n;
}

const tracked = countTrackedFiles(ROOT);
const total = tracked ?? countFiles(ROOT);
const basis = tracked === null ? 'مسح نظام الملفات (لا مستودع Git)' : 'ملفات Git المتعقَّبة';
const pct = ((total / LIMIT) * 100).toFixed(1);

console.log('═══ حاجز عدد الملفات (البوابة G1) ═══');
console.log(`الجذر المفحوص: ${ROOT}`);
console.log(`أساس العدّ:    ${basis}`);
console.log(`عدد الملفات:   ${total}`);
console.log(`الحد المسموح:  ${LIMIT}  (الاستهلاك: ${pct}%)`);

if (total > LIMIT) {
  console.error('');
  console.error(`❌ البوابة G1 مغلقة: ${total} ملفاً يتجاوز الحد ${LIMIT}.`);
  console.error('   إن كان النمو محتوى حقيقياً فارفع الحد بقرار موثّق في سجل WL.');
  console.error(
    '   وإن كان قوالب مولَّدة فهذا ارتداد — راجع docs/roadmap/03-roadmap-to-100.md §M1.',
  );
  process.exit(1);
}

console.log('');
console.log('✅ البوابة G1 مفتوحة: حجم المستودع تحت الحد.');
