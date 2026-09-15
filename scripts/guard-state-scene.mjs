#!/usr/bin/env node
/**
 * حاجزُ المشهدِ المُعمَّمِ — سدادُ الدَينِ `D-10`.
 *
 * الدَينُ كان: «المشهدُ غيرُ معمَّمٍ على بقيةِ قرّاءِ المستودعِ (لا حجرَ عامّاً
 * بعدُ)». والمشهدُ هو وكيلُ المراقبةِ (`MonitorAgent`) بمشاهدِهِ المقروءةِ
 * المُجمَّدةِ (`createReadOnlyView`) — القراءةُ الوحيدةُ المُدقَّقةُ بلا سلطةِ
 * كتابةٍ. وكان حاجزُ المراقبةِ (`guard-monitoring.mjs`) يقولُ صراحةً: «لا يَزعُمُ
 * أنّ كلَّ قارئٍ في المستودعِ يمرُّ من هذا المسار». فهذا الحاجزُ هو تلك الخطوةُ
 * اللاحقة: يَزعُمُ ما لم يَزعُمْهُ سابقُه، ويَرفضُ قارئاً يتجاوزُ المشهدَ.
 *
 * ستُّ قواعدَ:
 *
 *   R1: لا قارئاً يَستوردُ نمطَ تجاوزٍ في أسطحِ القرّاءِ السبعةِ.
 *   R2: جذرُ التركيبِ يَوصِلُ المشهدَ للبوابةِ.
 *   R3: جذرُ التركيبِ يَوصِلُ البوابةَ للقارئين.
 *   R4: خادمُ الدولةِ يَأخذُ بوابةً لا مستودعاتٍ.
 *   R5: المُشغِّلُ يَبني سلسلةَ المشهدِ.
 *   R6: ملفُّ اختبارِ الحاجزِ موجودٌ ويَقيسُ الرفضَ.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const rootIndex = argv.indexOf('--root');
const rootArg = rootIndex >= 0 ? argv[rootIndex + 1] : undefined;
const ROOT =
  rootArg !== undefined && rootArg !== ''
    ? path.resolve(rootArg)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const violations = [];

function readFile(relative) {
  const full = path.join(ROOT, relative);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
}

function listMjs(dir) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return [];
  return fs
    .readdirSync(full)
    .filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))
    .map((f) => path.join(dir, f));
}

// ═══ R1: لا قارئاً يستورد نمط تجاوز ═══

const READER_SURFACES = [
  { dir: 'src/api', label: 'البوابة الداخليّة' },
  { dir: 'src/transport', label: 'طبقة النقل' },
  { dir: 'src/operations', label: 'مركز العمليات' },
  { dir: 'src/console', label: 'الديوان الملكيّ' },
  { dir: 'src/crisis', label: 'غرفة الأزمات' },
  { dir: 'src/audit-viewer', label: 'عارض التدقيق' },
];

const BYPASS_PATTERNS = [
  'createMemoryRepositories',
  'createPostgresRepositories',
  'createMemoryRepository',
  'createPostgresRepository',
  "from 'pg'",
  'from "pg"',
  'createPool',
  'persistence/db',
  'persistence/repository-',
  'MonitorAgent',
  'createReadOnlyView',
  'persistence/composition',
];

for (const { dir, label } of READER_SURFACES) {
  for (const file of listMjs(dir)) {
    const source = readFile(file);
    if (source === '') continue;
    // نفحص أسطر الاستيراد فقط — فالنمط في تعليقٍ ليس استيراداً.
    const importLines = source.split('\n').filter((l) => l.trim().startsWith('import '));
    for (const line of importLines) {
      for (const needle of BYPASS_PATTERNS) {
        if (line.includes(needle)) {
          violations.push(
            'R1: ' + label + ' في ' + file + ' يَستوردُ نمطَ تجاوزٍ — وكلُّ قارئٍ يَمرُّ بالمشهدِ.',
          );
          break;
        }
      }
    }
  }
}

// ═══ R2: المشهد موصول للبوابة ═══

const composition = readFile('src/persistence/composition.mjs');
if (composition === '') {
  violations.push('R2: src/persistence/composition.mjs غير مقروء.');
} else {
  const gwMatch = composition.match(/new\s+ApiGateway\s*\(\s*\{([\s\S]*?)\n\s*\}\s*\)/);
  if (gwMatch === null || !/monitor\s*[:,}]/.test(gwMatch[1])) {
    violations.push('R2: البوابةُ لا تَأخذُ monitor في جذرِ التركيبِ.');
  }
  if (gwMatch !== null && gwMatch[1].includes('repositories')) {
    violations.push('R2: البوابةُ تَأخذُ repositories مباشرةً.');
  }
}

// ═══ R3: البوابة موصولة للقارئين ═══

if (composition !== '') {
  const opsMatch = composition.match(/new\s+OperationsCenter\s*\(\s*\{([\s\S]*?)\n\s*\}\s*\)/);
  if (opsMatch === null || !/gateway\s*:\s*api/.test(opsMatch[1])) {
    violations.push('R3: مركزُ العملياتِ لا يَأخذُ gateway: api.');
  }
  const consoleMatch = composition.match(/new\s+RoyalConsole\s*\(\s*\{([\s\S]*?)\n\s*\}\s*\)/);
  if (consoleMatch === null || !/gateway\s*:\s*api/.test(consoleMatch[1])) {
    violations.push('R3: الديوانُ الملكيُّ لا يَأخذُ gateway: api.');
  }
}

// ═══ R4: الخادم يأخذ بوابة لا مستودعات ═══

const serverSource = readFile('src/transport/server.mjs');
if (serverSource === '') {
  violations.push('R4: src/transport/server.mjs غير مقروء.');
} else {
  if (!/gateway\s*:/.test(serverSource)) {
    violations.push('R4: خادمُ الدولةِ لا يَأخذُ gateway.');
  }
}

// ═══ R5: المشغّل يبني سلسلة المشهد ═══

const serveState = readFile('scripts/serve-state.mjs');
if (serveState === '') {
  violations.push('R5: scripts/serve-state.mjs غير مقروء.');
} else {
  if (!/new\s+MonitorAgent\s*\(/.test(serveState)) {
    violations.push('R5: المُشغِّلُ لا يَبني مراقباً.');
  }
  if (!/new\s+ApiGateway\s*\(/.test(serveState)) {
    violations.push('R5: المُشغِّلُ لا يَبني بوابةً.');
  }
  if (!/createStateServer\s*\(/.test(serveState)) {
    violations.push('R5: المُشغِّلُ لا يَبني خادمَ حالةٍ.');
  }
  const monitorPos = serveState.search(/new\s+MonitorAgent\s*\(/);
  const gatewayPos = serveState.search(/new\s+ApiGateway\s*\(/);
  if (monitorPos >= 0 && gatewayPos >= 0 && monitorPos > gatewayPos) {
    violations.push('R5: المراقبُ يُبنَى بعدَ البوابةِ.');
  }
  const serverPos = serveState.search(/createStateServer\s*\(/);
  if (gatewayPos >= 0 && serverPos >= 0 && gatewayPos > serverPos) {
    violations.push('R5: البوابةُ تُبنَى بعدَ الخادمِ.');
  }
}

// ═══ R6: الاختبار موجود ═══

const testFile = readFile('tests/tooling/guard-state-scene.test.mjs');
if (testFile === '') {
  violations.push('R6: tests/tooling/guard-state-scene.test.mjs غائب.');
} else {
  if (!testFile.includes('reject') && !testFile.includes('rejects') && !testFile.includes('يرفض') && !testFile.includes('مرفوض')) {
    violations.push('R6: اختبارُ الحاجزِ لا يَقيسُ الرفضَ.');
  }
}

// ═══ النتيجة ═══

if (violations.length > 0) {
  console.error('⛔ حاجز المشهد المعمم رفض:');
  for (const violation of violations) {
    console.error('   • ' + violation);
  }
  process.exit(1);
}

console.log('✅ حاجز المشهد المعمم مر: كلُّ قارئٍ يَمرُّ بالمشهدِ، ولا قارئَ يَتجاوزُه.');
process.exit(0);
