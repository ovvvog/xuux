#!/usr/bin/env node
// حاجز دورة الاحتفاظ والمحو — M7.06، بوابة G7
//
// الغرض: أن يفشل البناء إذا عاد **الطريق** الذي كان يجعل المحو يقع بلا شاهد.
// ومعيار القبول المعلَن («دورة احتفاظ كاملة تُمحى وتُسجَّل») يُقاس في
// `tests/data/retention-cycle.test.mjs`؛ وهذا الحاجز يحرس ما لا يحرسه اختبارُ
// سلوك: أن لا يُفتح المسارُ نفسه من جديد في موضعٍ آخر. وخمس قواعد:
//
//   R1 — السياسة تتماسك أو يسقط الحاجز: التحميل نفسه هو الفحص (ترتيبُ الأهداف،
//        وتطابقُ أدوار المطهِّر مع `config/memory.yaml`)، فلا تُكرَّر قواعده هنا كي
//        لا تنحرف نسخةُ الحاجز عن نسخة الكود.
//   R2 — كل قيدٍ معلَن للدفتر له قيدٌ في هجرة: قيدٌ في ملف YAML لا يردّ كتابةً
//        مباشرة في القاعدة، وإعلانٌ بلا قيد يُقرأ ضماناً وهو وعد.
//   R3 — كل مسارٍ محكوم موجودٌ **ويقيس الفاعل**، و**لا حذفَ في الوحدة بلا شاهد**:
//        كل طريقة في `guardedPaths` موجودة وتذكر `actor`، والوحدة تكتب في الدفتر
//        (`erasureLedger.record`) وتُثبت سلامته (`assertIntact`). وهذا نصّ العيب
//        الذي أُغلق: `retention.purge` كان يحذف بـ`DELETE` بلا شاهد ولا فاعل.
//   R4 — لا مسار جانبي: لا وحدة في `src/` تلمس مستودع الشواهد أو تُنشئ دفتراً إلا
//        الوحدات المعلَنة في `ledgerHolders`. فمن أراد محواً بلا شاهد لا يحتاج
//        ثغرةً في الدورة، بل مساراً أقصر: المستودع مباشرةً و`remove` فيه.
//   R6 — **المحوُ يمرُّ بقرارٍ لا بنصِّ دورٍ** (‏`R6-A-01`): مسارا المحوِ الفعليِّ
//        (`run` و`eraseDirected`) يجبُ أن يُناديا `#authorizeSweep`، وأن تكونَ فيه
//        نداءاتُ `authorize` و`verify` الفعليّةُ، وأن لا يبقى `assertSweeper` سلطةً
//        في مسارِ محوٍ. والتركيبُ المُشغَّلُ يجبُ أن يمرِّرَ `authorizer`. وهذا نصُّ
//        العيبِ المُغلَق: فاعلٌ غيرُ مسجَّلٍ محا صفَّينِ بصفرِ نداءاتِ تفويضٍ، لأنّ
//        الحارسَ الوحيدَ كان يقرأُ نصّاً يُرسلُه المُنادي.
//   R7 — **أدوارُ المطهِّرِ أهليّةٌ لا سلطةٌ** (‏`LIM-3`): كلُّ وحدةٍ في `src/`
//        تُنادي `isSweeper(` يجبُ أن تمرَّ بسلطةِ المحوِ في **الملفِّ نفسِه**
//        (‏`assertRoyalCommandForPurge` أو `#authorizeSweep`) — فحارسُ دورٍ وحدَه
//        كان مسارَ المحوِ الثاني الذي بقيَ مفتوحاً بعدَ `R6-A-01`. ويُقاسُ معه أنّ
//        العتبةَ السياديّةَ **تُقرأُ من البيانات** لا تُثبَّتُ في الكودِ، وأنّ
//        `purge-data` ما زالَ فوقَها؛ فلو أُنزِلَ عنها لصارَ ما تقولُه الوثيقةُ
//        عن أدوارِ المطهِّرِ خبراً كاذباً يجبُ أن يسقطَ لا أن يُقرأ.
//   R8 — **لا مسارَ محوٍ من سطرِ الأوامرِ** (‏`R6-A-11`): أداةُ المحوِ القديمةُ
//        `scripts/retention.mjs purge` كانت مسارَ حذفٍ رابعاً خارجَ سلطةِ `purge-data`.
//        المسارُ المحكومُ للمحوِ هو `RetentionCycle.run` في `src/data/retention-cycle.mjs`
//        وحده. فلا يَنبغي أن يَستوردَ أيُّ ملفٍّ في `scripts/` دالّةَ `purge` من
//        `src/persistence/retention.mjs` — فهي وحدةٌ منخفضةٌ يَختبرها
//        `tests/persistence/retention.test.mjs` لا تُفتَحُ من سطرِ الأوامرِ.
//   R5 — **فحص المخزون**: إن وُجدت `DATABASE_URL` فيُقاس أن سلسلة الشواهد متّصلة
//        بلا ثغرة تسلسل، وأن لا عقدَ بياناتٍ يتيماً في الفهرس. وبلا `DATABASE_URL`
//        يُعلَن الفحص **متروكاً** صراحةً ولا يُدّعى نجاحه: حاجزٌ يقول «✅» وهو لم
//        يقرأ قاعدةً هو ادّعاء دليل (المادة 2).
//
// رمز الخروج 1 عند أي مخالفة، ولا يُسكت الحاجز ببيئةٍ ولا بوسيط.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRetentionPolicy } from '../src/data/retention-cycle.mjs';

// `--root` يسمح بتشغيل الحاجز على شجرةٍ أخرى، وهو ما يجعل **الحاجز نفسه** قابلاً
// للاختبار. وكل قراءةٍ هنا تُحلّ على الشجرة المفحوصة لا على شجرة الحاجز.
const rootArg = process.argv.includes('--root')
  ? process.argv[process.argv.indexOf('--root') + 1]
  : undefined;
const ROOT = path.resolve(rootArg ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

/** @type {string[]} */
const violations = [];
/** @type {string[]} */
const skipped = [];

// ── R1: السياسة تُحمَّل أو يسقط الحاجز ──
const policy = loadRetentionPolicy({ dir: path.join(ROOT, 'config') });

// ── R2: كل قيدٍ معلَن له قيدٌ في هجرة ──
const migrationsDir = path.join(ROOT, 'migrations');
const sql = fs.existsSync(migrationsDir)
  ? fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => read(path.join(migrationsDir, file)))
      .join('\n')
  : '';
for (const constraint of policy.ledger.dbConstraints) {
  if (!sql.includes(constraint)) {
    violations.push(
      `R2: القيد «${constraint}» معلَنٌ في config/retention.yaml ولا وجود له في أي هجرة؛ قيدٌ في ملفٍ لا يردّ كتابةً مباشرة في القاعدة.`,
    );
  }
}
if (!sql.includes(policy.ledger.table)) {
  violations.push(
    `R2: جدول الشواهد «${policy.ledger.table}» معلَنٌ في الإعداد ولا تُنشئه أي هجرة؛ دفترٌ بلا جدول محوٌ بلا شاهد.`,
  );
}
// المانع الذي يفرض الترتيب هو مرجعُ القاعدة نفسه، فوجودُه شرطُ صحّة الترتيب
// المعلَن: بلا `RESTRICT` يصير عكسُ الترتيب ممكناً في القاعدة فيمحو الأصلَ قبل
// ذاكرته ويترك مدخلاً يشير إلى عقدٍ زائل.
if (!/dataset_id[^;]*ON DELETE RESTRICT/s.test(sql)) {
  violations.push(
    'R2: لا وجود لمرجع `state.memories.dataset_id … ON DELETE RESTRICT` في الهجرات؛ وهو الضمانُ الأخير خلف ترتيب الدورة (الذاكرة قبل عقدها) — والترتيبُ وحده في ملفٍ لا يمنع مساراً آخر من عكسه.',
  );
}

// ── R3: المسارات المحكومة قائمة وتقيس الفاعل ولا تمحو بلا شاهد ──
for (const guarded of policy.guardedPaths) {
  const file = path.join(ROOT, guarded.module);
  if (!fs.existsSync(file)) {
    violations.push(
      `R3: الوحدة «${guarded.module}» معلَنة مساراً محكوماً ولا وجود لها؛ إعلانُ حكمٍ على مسارٍ غائب حكمٌ لا يُطبَّق.`,
    );
    continue;
  }
  const source = read(file);
  if (!source.includes('erasureLedger.record(')) {
    violations.push(
      `R3: الوحدة «${guarded.module}» لا تكتب في دفتر الشواهد (لا وجود لـ«erasureLedger.record»)؛ ومحوٌ بلا شاهد هو العيب الذي أُغلق في M7.06 — ومعيار القبول شطرُه الثاني «وتُسجَّل».`,
    );
  }
  if (!source.includes('assertIntact(')) {
    violations.push(
      `R3: الوحدة «${guarded.module}» لا تُثبت سلامة السلسلة («assertIntact»)؛ دفترٌ يُكتب فيه ولا يُتحقَّق منه يُقرأ ضماناً وهو ادّعاء.`,
    );
  }
  if (!source.includes('assertSweeper(')) {
    violations.push(
      `R3: الوحدة «${guarded.module}» لا تقيس دور المطهِّر («assertSweeper»)؛ فمن يمحو ما انتهت مدّته يمحو دليلاً، ومحوٌ بلا دورٍ مُعلَن محوٌ لا يُراجَع.`,
    );
  }
  for (const method of guarded.methods) {
    const declaration = new RegExp(`\\n\\s+async ${method}\\s*\\(([^)]*)\\)`).exec(source);
    if (declaration === null) {
      violations.push(
        `R3: الطريقة «${method}» معلَنة مساراً محكوماً في «${guarded.module}» ولا وجود لها؛ فمن أراد الدورة سيذهب إلى المستودع مباشرةً.`,
      );
      continue;
    }
    const body = source.slice(declaration.index, source.indexOf('\n  }', declaration.index));
    if (!body.includes('actor')) {
      violations.push(
        `R3: «${method}» في «${guarded.module}» لا تذكر الفاعل «actor» في متنها؛ فقرارُ المحو فيها مقيسٌ على غير الفاعل.`,
      );
    }
  }
}

// ── R4: لا مسار جانبي إلى دفتر الشواهد ──
const allowed = new Set(policy.ledgerHolders.map((entry) => entry.replaceAll('\\', '/')));
for (const file of walk(path.join(ROOT, 'src'))) {
  const relative = path.relative(ROOT, file).replaceAll('\\', '/');
  if (allowed.has(relative)) continue;
  const source = read(file);
  const touches = [
    'repositories.erasureRecords',
    'ERASURE_RECORD_SPEC)',
    'new ErasureLedger(',
  ].filter((needle) => source.includes(needle));
  if (touches.length > 0) {
    violations.push(
      `R4: الوحدة «${relative}» تلمس دفتر الشواهد (${touches.join('، ')}) وليست في ledgerHolders؛ مسارٌ جانبي إلى المستودع يكتب شاهداً بلا سلسلةٍ أو يمحو بلا شاهد.`,
    );
  }
}
for (const holder of allowed) {
  if (!fs.existsSync(path.join(ROOT, holder))) {
    violations.push(
      `R4: «${holder}» معلَنٌ حاملاً للدفتر ولا وجود له؛ قائمةُ إذنٍ فيها اسمٌ ميّت تُوسّع الإذن بلا حاجة.`,
    );
  }
}

// ── R6: المحوُ يمرُّ بقرارٍ لا بنصِّ دورٍ (`R6-A-01`) ──
const cycleFile = path.join(ROOT, 'src/data/retention-cycle.mjs');
if (!fs.existsSync(cycleFile)) {
  violations.push('R6: `src/data/retention-cycle.mjs` غير موجود؛ فلا يُقاس مسارُ المحوِ أصلاً.');
} else {
  const cycleSource = read(cycleFile);
  if (!cycleSource.includes("PURGE_ACTION = 'purge-data'")) {
    violations.push(
      "R6: الوحدةُ لا تُعلن الفعلَ المحكومَ `PURGE_ACTION = 'purge-data'`؛ ومحوٌ لا يُسمّي فعلَه لا تعرفُه السياسةُ ولا تبلغُه العتبةُ السياديّة.",
    );
  }
  // متنُ كلِّ مسارِ محوٍ يُقتطعُ من ترويسته إلى الترويسةِ التالية: فحصُ الملفِّ
  // كلِّه لا يكفي — نداءُ تفويضٍ في طريقةٍ أخرى لا يحكمُ هذه الطريقة، وهذا بعينُه
  // ما تجاوزتْه الطفرةُ M16 حين بقيَ `#authorizeSweep` في الملفِّ بلا مُنادٍ.
  for (const method of ['async run(', 'async eraseDirected(']) {
    const start = cycleSource.indexOf(method);
    if (start === -1) {
      violations.push(
        `R6: مسارُ المحوِ \`${method}\` غير موجود؛ فإمّا أُزيل أو غُيّر اسمُه بلا تحديثِ الحاجز.`,
      );
      continue;
    }
    const rest = cycleSource.slice(start + method.length);
    const nextHeader = rest.search(/\n {2}(?:async |#|\/\*\*)/);
    const body = nextHeader === -1 ? rest : rest.slice(0, nextHeader);
    if (!body.includes('#authorizeSweep(')) {
      violations.push(
        `R6: \`${method}\` يمحو بلا نداءِ \`#authorizeSweep\`؛ فالحارسُ عادَ نصَّ دورٍ يُرسلُه المُنادي، وهو نصُّ \`R6-A-01\`.`,
      );
    }
    if (body.includes('assertSweeper(')) {
      violations.push(
        `R6: \`${method}\` ينادي \`assertSweeper\` مباشرةً؛ وحارسُ الدورِ مُرشِّحٌ ثانٍ لا سلطةٌ، والسلطةُ قرارُ نقطةِ التفويض.`,
      );
    }
  }
  const sweepStart = cycleSource.indexOf('async #authorizeSweep(');
  if (sweepStart === -1) {
    violations.push('R6: `#authorizeSweep` غير موجودة؛ فلا موضعَ للقرارِ في مسارِ المحو.');
  } else {
    const rest = cycleSource.slice(sweepStart);
    const nextHeader = rest.slice(1).search(/\n {2}(?:async |\/\*\*)/);
    const body = nextHeader === -1 ? rest : rest.slice(0, nextHeader + 1);
    /** @type {ReadonlyArray<readonly [string, string]>} */
    const required = [
      ['this.authorizer.authorize(', 'نداءُ التفويضِ الفعليُّ'],
      ['this.authorizer.verify(', 'استهلاكُ تذكرةِ القرارِ قبلَ الحذف'],
      ['identityGate', 'اشتراطُ بوابةِ الهويةِ في نقطةِ التفويض'],
      ['AUTHORIZER_REQUIRED', 'الرفضُ المُسمّى عند غيابِ نقطةِ التفويض'],
      ['NOT_AUTHORIZED', 'الرفضُ المُسمّى عند رفضِ القرار'],
    ];
    for (const [needle, why] of required) {
      if (!body.includes(needle)) {
        violations.push(
          `R6: \`#authorizeSweep\` بلا \`${needle}\` — ${why} مفقود، فالنداءُ صورةٌ لا قرار.`,
        );
      }
    }
  }
}
// والتركيبُ المُشغَّلُ: دورةٌ تُبنى بلا `authorizer` تُرفَض في التشغيلِ برمزٍ
// مُسمّىً، لكنّ حاجزاً يسكتُ عنها يجعل الدولةَ عاجزةً عن المحوِ بلا أن يُقال.
const compositionFile = path.join(ROOT, 'src/persistence/composition.mjs');
if (fs.existsSync(compositionFile)) {
  const composition = read(compositionFile);
  const built = composition.indexOf('new RetentionCycle(');
  if (built !== -1 && !composition.slice(built, built + 600).includes('authorizer:')) {
    violations.push(
      'R6: التركيبُ المُشغَّلُ يبني `RetentionCycle` بلا `authorizer`؛ فالمحوُ في الدولةِ المُشغَّلةِ يُرفَض دائماً أو — إن سقطَ الشرطُ — يقعُ بلا قرار.',
    );
  }
}

// ── R7: أدوارُ المطهِّرِ أهليّةٌ لا سلطةٌ (`LIM-3`) ──
// العتبةُ تُقرأُ من البيانات: الحاجزُ لا يُثبِّتُ «purge-data فوقَ العتبةِ» في
// نصِّه، بل يُحمِّلُها من `config/royal-authority.yaml` بنفسِ الوحدةِ التي
// يُحمِّلُها بها الكودُ المُشغَّلُ — فحاجزٌ يحملُ نسخةً ثانيةً يفترقُ عن الكودِ.
const { loadPurgeAuthority } = await import('../src/data/purge-authority.mjs');
const purgeAuthority = loadPurgeAuthority({ dir: path.join(ROOT, 'config') });
if (!purgeAuthority.royalCommandRequired) {
  violations.push(
    'R7: `purge-data` لم يبقَ فوقَ العتبةِ السياديّةِ في `config/royal-authority.yaml`؛ وهذا **قرارُ مالكٍ** لا عيبُ شفرةٍ، لكنّ الوثائقَ (`docs/RETENTION.md` §أدوارُ المطهِّر) تُعلنُ أنّ الدورَ لا يبلغُ العتبةَ — فأحدُهما كاذبٌ الآن، ولا يمرُّ الحاجزُ على خبرٍ كاذبٍ.',
  );
}
const purgeAuthorityFile = path.join(ROOT, 'src/data/purge-authority.mjs');
if (!fs.existsSync(purgeAuthorityFile)) {
  violations.push(
    'R7: `src/data/purge-authority.mjs` غير موجود؛ فالإعلانُ أنّ الدورَ أهليّةٌ لا سلطةٌ عادَ نصّاً في وثيقةٍ بلا مُنفِّذٍ، وهو نصُّ الدَينِ `LIM-3`.',
  );
} else if (!read(purgeAuthorityFile).includes('royal-authority.yaml')) {
  violations.push(
    'R7: `purge-authority.mjs` لا يقرأُ `royal-authority.yaml`؛ فعتبةٌ منسوخةٌ في الكودِ تفترقُ عن أصلِها السياديِّ بلا أن يُقال.',
  );
}
// وكلُّ قارئٍ لأدوارِ المطهِّرِ يمرُّ بالسلطةِ في ملفِّه: لا يكفي أن تكونَ
// السلطةُ موجودةً في المستودعِ، فمسارٌ لا يُناديها مسارُ محوٍ بحارسِ دورٍ.
for (const file of walk(path.join(ROOT, 'src'))) {
  const source = read(file);
  if (!source.includes('isSweeper(')) continue;
  const relative = path.relative(ROOT, file);
  // مُعلِنُ الدالّةِ نفسِه (`memory-limits.mjs`) يُقاسُ بإعلانِ الحدِّ في موضعِ
  // قراءتِه لا بنداءِ سلطةٍ: هو سياسةٌ تُجيب، لا مسارٌ يمحو.
  if (relative.endsWith('memory-limits.mjs')) {
    if (!source.includes('أهليّةً لا سلطةً')) {
      violations.push(
        `R7: \`${relative}\` يُعلن \`isSweeper\` بلا إعلانِ الحدِّ في موضعِ قراءتِه؛ ومن قرأَ الدالّةَ وحدَها حسِبَ صدقَها إذناً بالمحوِ — وهو نصفُ الشرطِ.`,
      );
    }
    continue;
  }
  if (!source.includes('assertRoyalCommandForPurge') && !source.includes('#authorizeSweep')) {
    violations.push(
      `R7: \`${relative}\` ينادي \`isSweeper\` ولا يمرُّ بسلطةِ المحوِ في الملفِّ نفسِه؛ فالدورُ صارَ سلطةً، وهو مسارُ المحوِ الذي أُغلق في \`LIM-3\`.`,
    );
  }
}

// وتركيبُ المُشغَّلِ يمرِّرُ نقطةَ التفويضِ إلى المطهِّرِ كما يمرِّرُها إلى
// الدورةِ: سلطةٌ موصولةٌ في الشفرةِ وغيرُ ممرَّرةٍ في التركيبِ تعني أنّ التطهيرَ
// **لا يقعُ أصلاً** في المسارِ الواقعِ — فشلٌ مغلقٌ لكنّه عطلٌ صامتٌ.
const memoryCompositionFile = path.join(ROOT, 'src/persistence/composition.mjs');
if (fs.existsSync(memoryCompositionFile)) {
  const composition = read(memoryCompositionFile);
  const start = composition.indexOf('new AgentMemoryStore({');
  if (start === -1) {
    violations.push(
      'R7: تركيبُ `src/persistence/composition.mjs` لا يبني `AgentMemoryStore`؛ فمخزنُ الذاكرةِ صارَ بلا مسارٍ في التشغيلِ.',
    );
  } else {
    const block = composition.slice(start, composition.indexOf('\n    }),', start));
    if (!block.includes('authorizer')) {
      violations.push(
        'R7: التركيبُ المُشغَّلُ يبني `AgentMemoryStore` بلا تمريرِ نقطةِ التفويضِ؛ فالتطهيرُ يُرفَض دائماً في المسارِ الواقعِ — عطلٌ صامتٌ لا حمايةٌ.',
      );
    }
  }
}

// ── R8: لا مسارَ محوٍ من سطرِ الأوامرِ (`R6-A-11`) ──
// `purge()` في `src/persistence/retention.mjs` وحدةٌ منخفضةٌ يَختبرها
// `tests/persistence/retention.test.mjs`. ولا يَنبغي أن يَستوردَها سطرُ الأوامرِ —
// فالمسارُ المحكومُ للمحوِ هو `RetentionCycle.run` وحده. فأيُّ ملفٍّ في `scripts/`
// يَستوردُ `purge` من `retention.mjs` يَفتحُ مسارَ حذفٍ رابعاً خارجَ السلطة.
const scriptsDir = path.join(ROOT, 'scripts');
for (const file of walk(scriptsDir)) {
  const source = read(file);
  const relative = path.relative(ROOT, file).replaceAll('\\', '/');
  // نَكْشِفُ كُلَّ مسَارٍ يَفْتَحُ الوُصُولَ إِلىَ `purge` مِن `retention.mjs` فِي `scripts/`.
  // لا نَكْشِفُ `tests/` — الاختِباراتُ تَخْتَبِرُ الوَحْدَةَ المُنْخَفِضَةَ بلا سُلْطَةٍ، وهو ما تُرَادُ.
  // وَالأَنْمَاطُ المَكْشُوفَةُ:
  //   1. استِيرادٌ مُسَمٌّ تَشْمَلُ `purge`
  //   2. استِيرادُ فَضاءِ الأَسْماءِ (X.purge)
  //   3. إِعادَةُ تَصْدِيرِ `purge`
  //   4. إِعادَةُ تَصْدِيرٍ شَامِلٍ (يُصَدِّرُ purge)
  //   5. استِيرادٌ دِينَامِيكِيٌ (ثَمَّ purge)
  /** @type {[RegExp, string][]} */
  const patterns = [
    [
      /import\s*\{[^}]*\bpurge\b[^}]*\}\s*from\s*['"][^'"]*retention\.mjs['"]/,
      'استِيرادٌ مُسَمٌّ تَشْمَلُ purge',
    ],
    [
      /import\s*\*\s*as\s+\w+\s*from\s*['"][^'"]*retention\.mjs['"]/,
      'استِيرادُ فَضاءِ أَسْماءِ (يَفْتَحُ purge)',
    ],
    [
      /export\s*\{[^}]*\bpurge\b[^}]*\}\s*from\s*['"][^'"]*retention\.mjs['"]/,
      'إِعادَةُ تَصْدِيرِ purge',
    ],
    [
      /export\s*\*\s*from\s*['"][^'"]*retention\.mjs['"]/,
      'إِعادَةُ تَصْدِيرٍ شَامِلٍ (يُصَدِّرُ purge)',
    ],
    [/import\s*\(\s*['"][^'"]*retention\.mjs['"]/, 'استِيرادٌ دِينَامِيكِيٌ (يَفْتَحُ purge)'],
  ];
  for (const [pattern, description] of patterns) {
    if (pattern.test(source)) {
      violations.push(
        `R8: \`${relative}\` ${description} \u0645\u0650\u0646 \`src/persistence/retention.mjs\`\u061b \u0648\u0647\u0630\u0627 \u0645\u0633\u064e\u0627\u0631\u064f \u0645\u064e\u062d\u0652\u0648\u064c \u0645\u0650\u0646 \u0633\u064e\u0637\u0652\u0631\u0650 \u0627\u0644\u0623\u064e\u0648\u0627\u0645\u0650\u0631\u0650 \u062e\u064e\u0627\u0631\u0650\u062c\u064e \u0633\u064f\u0644\u0652\u0637\u064e\u0629\u0650 \`purge-data\` (\u0646\u064e\u062a\u0650\u064a\u062c\u064e\u0629\u064f R6-A-11). \u0627\u0644\u0645\u0633\u064e\u0627\u0631\u064f \u0627\u0644\u0645\u064e\u062d\u0652\u0643\u064f\u0648\u0645\u064f \u0644\u0650\u0644\u0645\u064e\u062d\u0652\u0648\u0650 \u0647\u064f\u0648 \`RetentionCycle.run\` \u0641\u0650\u062a \`src/data/retention-cycle.mjs\` \u0648\u064e\u062d\u0652\u062f\u064e\u0647\u064f.`,
      );
      break;
    }
  }
}
// ── R5: فحص المخزون ──
const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl.trim() === '') {
  skipped.push(
    'R5: فحص المخزون متروك — لا DATABASE_URL. اتّصالُ سلسلة الشواهد وخلوُّها من شاهدٍ يناقض مشهودَه لم يُقاسا على قاعدة في هذا التشغيل، ويُقاسان في CI حيث القاعدة قائمة.',
  );
} else {
  const { Pool } = await import('pg');
  const { resolveDatabaseConfig } = await import('../src/persistence/db.mjs');
  resolveDatabaseConfig({ url: databaseUrl });
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const chain = await pool.query(
      `SELECT count(*)::int AS total, coalesce(max(seq), 0)::int AS head FROM state.erasure_records`,
    );
    const total = chain.rows[0]?.total ?? 0;
    const head = chain.rows[0]?.head ?? 0;
    if (total !== head) {
      violations.push(
        `R5: دفتر الشواهد يحمل ${total} شاهداً ورأسُ تسلسله ${head}؛ الفرقُ ثغرةٌ في السلسلة — شاهدٌ حُذف أو أُدرج بتسلسلٍ مُخترَع، وكلاهما يُبطل الدفتر كدليل.`,
      );
    }
    // شاهدٌ يقول «مُحي» ومشهودُه قائمٌ في الجدول: تناقضٌ يُبطل الدفتر كدليل، وهو
    // ما يقع لو كُتب الشاهد في وصلةٍ غير وصلة المحو فتراجعت معاملةُ المحو وحدها.
    const contradicted = await pool.query(
      `SELECT count(*)::int AS total
         FROM state.erasure_records e
         JOIN state.data_assets a ON a.id::text = e.target_id
        WHERE e.target = 'data_assets'`,
    );
    const stale = contradicted.rows[0]?.total ?? 0;
    if (stale > 0) {
      violations.push(
        `R5: ${stale} شاهدَ محوٍ لعقد بياناتٍ ما زال قائماً في state.data_assets؛ شهادةٌ على محوٍ لم يقع تُبطل الدفتر كدليل — والسبب المعروف كتابةُ الشاهد في وصلةٍ غير وصلة المحو.`,
      );
    }
    console.log(`   • فُحص ${total} شاهداً في السلسلة و${stale} شاهداً متناقضاً.`);
  } finally {
    await pool.end();
  }
}

if (violations.length > 0) {
  console.error('⛔ حاجز الاحتفاظ: طريقٌ إلى محوٍ بلا شاهد أو إلى شاهدٍ بلا سلسلة.');
  for (const violation of violations) console.error(`   - ${violation}`);
  process.exit(1);
}

for (const note of skipped) console.log(`⚠️  ${note}`);
console.log(
  `✅ حاجز الاحتفاظ: ترتيبٌ معلَن (${policy.cycle.order.join(' → ')})، و${policy.ledger.dbConstraints.length} قيداً في القاعدة، و${policy.guardedPaths.reduce((sum, entry) => sum + entry.methods.length, 0)} مساراً محكوماً يكتب شاهده، و${policy.ledgerHolders.length} وحدةً وحدها تلمس الدفتر.`,
);

/**
 * @param {string} file
 * @returns {string}
 */
function read(file) {
  return fs.readFileSync(file, 'utf8');
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  /** @type {string[]} */
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.name.endsWith('.mjs')) files.push(full);
  }
  return files;
}
