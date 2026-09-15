// تهيئة ESLint المسطّحة (flat config) — المسار M0.04
//
// نطاق الفحص: الكود الفعلي فقط (src و tests و scripts وملفات الإعداد).
// الشجرة التنظيمية القالبية مستثناة لأنها تُحوَّل إلى بيانات أو تُحذف في المسار M1؛
// عند إغلاق بوابة G1 يُراجع هذا الاستثناء ويُقلَّص.
//
// القواعد الحاكمة المفروضة هنا مستمدة من كتاب التشغيل §4.3:
//   - لا `any` بلا مبرر        - لا فشل صامت
//   - لا `catch` فارغ           - لا تجاهل قيمة مُعادة من دالة غير متزامنة

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** القواعد المشتركة بين JavaScript و TypeScript */
const sharedRules = {
  // ── منع الفشل الصامت ──
  'no-empty': ['error', { allowEmptyCatch: false }],
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'no-fallthrough': 'error',
  'no-unsafe-finally': 'error',
  'require-atomic-updates': 'error',
  'no-return-await': 'off',

  // ── صرامة عامة ──
  eqeqeq: ['error', 'always'],
  'no-var': 'error',
  'prefer-const': 'error',
  'no-implicit-coercion': 'error',
  'no-throw-literal': 'error',
  'no-console': 'off',

  // ── حظر ممارسات خطرة في منظومة سيادية ──
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-proto': 'error',
  'no-extend-native': 'error',
  'no-param-reassign': ['error', { props: false }],
};

export default [
  {
    // الاستثناءات العامة
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      // الشجرة التنظيمية القالبية — تُعالج في المسار M1
      'civilization/**',
      'communications/**',
      'contracts/**',
      'data-platform/**',
      'engines/**',
      'facilities/**',
      'federation/**',
      'infrastructure/**',
      'institutions/**',
      'interfaces/**',
      'knowledge/**',
      'operations/**',
      'platform/**',
      'resources/**',
      'science/**',
      'agents/**',
      'security/**',
      // ── ناتج خطوة البناء (M2.01) ──
      // مصادر جذر الثقة صارت `.mts`، وهذه الملفات مولّدة عنها بـ tsc.
      // تُدقَّق مصادرها لا ناتجها، وإلا صار التحذير عن كود لم يكتبه أحد.
      'src/root-of-trust/*.mjs',
      'src/root-of-trust/*.d.mts',
      'src/root-of-trust/*.map',
      // ── أدوات المراجعة الخارجية المستقلة (M11.04+) ──
      // تقاريرُ مجلسِ النماذجِ الخامّةُ وسكربتاتُ إعادةِ الإنتاجِ التي يبنيها
      // كلُّ عضوٍ بنفسِه هي أدلّةُ مراجعةٍ لا كودَ مصدرٍ للمشروع، فلا تُفحَصُ بِقواعدِ
      // الكودِ الحاكمةِ (تُفحَصُ بِعقدِ المراجعةِ وحدَه). والتقريرُ الخامُّ هو الدليلُ.
      'docs/external-review/reports/**',
      // ── تجهيزات محاكي TPM غير الإنتاجية (تحقيق/محاكاة فقط) ──
      // أدوات تحقّق واختبارات محاكاة لا تتصل بـTPM حقيقي افتراضياً. تُفحَص
      // باختباراتها المضمّنة (tests/sim/**) لا بِقواعدِ الكودِ الحاكمة.
      'sim/**',
    ],
  },

  js.configs.recommended,

  // ── كود JavaScript الفعلي: النواة السيادية والاختبارات ──
  {
    files: ['src/**/*.mjs', 'tests/**/*.mjs', '*.js', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        structuredClone: 'readonly',
        // أُضيفت مع النواة التشغيلية (`M5`): الحلقة الدورية للنبضة وإلغاء
        // التنفيذ القسري. وهي عوالم Node قياسية، وإعلانها هنا صريحٌ كي لا
        // يُلتقط اسمٌ مطبعيّ خطأً على أنه عالمٌ موجود.
        setInterval: 'readonly',
        clearInterval: 'readonly',
        AbortController: 'readonly',
        // أُضيفَ في `WL-179` (‏إغلاقُ `LIVE-1`): فحصُ الإقلاعِ الذاتيُّ في
        // `scripts/serve-state.mjs` **يُنادي بابَه على السلكِ** لِيُثبِتَ أنّه
        // يُنصِتُ وأنّ إثباتَ الحيازةِ قائمٌ — ونداءٌ يُقاسُ خيرٌ من وصفٍ يُقرأُ.
        // وهو عالمُ Node قياسيٌّ منذُ الإصدارِ 18، ويُعلَنُ مُفرَداً لا بجملةٍ.
        // **ولا يفتحُ هذا باباً لِشبكةٍ في نواةِ الاستدلالِ:** حاجزُ
        // `guard:inference` يمنعُ `fetch(` في المُوائمِ الحتميِّ بنصِّه.
        fetch: 'readonly',
      },
    },
    rules: sharedRules,
  },

  // ── واجهةُ مشهدِ الدولةِ (`web/`) — سدادُ `D-1` ──
  //
  // عوالمُ متصفِّحٍ لا عوالمُ Node، وتُعلَنُ **مُعدَّدةً لا بجملةٍ واحدةٍ**: إعلانُ
  // «كلِّ عوالمِ المتصفِّحِ» كان سيَخفي اسماً مطبعيّاً في شفرةٍ تعملُ بجلسةِ قارئٍ.
  // ولا `process` ولا `Buffer` هنا: شفرةٌ في متصفِّحٍ تُنادي عالماً من Node خطأٌ
  // يظهرُ عندَ القارئِ لا عندَ الكاتبِ.
  {
    files: ['web/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        document: 'readonly',
        window: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        console: 'readonly',
        // العوالمُ الوسميّةُ تُعلَنُ لأنّ الشفرةَ تُصرِّحُ بأنواعِها في تعليقاتِ
        // النوعِ، فيَقرأُها المُدقِّقُ أسماءَ عوالمَ.
        HTMLInputElement: 'readonly',
        HTMLFormElement: 'readonly',
        HTMLButtonElement: 'readonly',
        HTMLParagraphElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLPreElement: 'readonly',
        HTMLDetailsElement: 'readonly',
        HTMLTableRowElement: 'readonly',
        HTMLTableSectionElement: 'readonly',
      },
    },
    rules: sharedRules,
  },

  // ── كود TypeScript ──
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['src/**/*.ts', 'src/**/*.mts', 'tests/**/*.ts'],
  })),
  {
    files: ['src/**/*.ts', 'src/**/*.mts', 'tests/**/*.ts'],
    rules: {
      ...sharedRules,
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `any` ممنوع إلا بتعليق يشرح الاضطرار (كتاب التشغيل §4.3)
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
];
