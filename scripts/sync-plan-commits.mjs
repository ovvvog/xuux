#!/usr/bin/env node
// scripts/sync-plan-commits.mjs — تحديثُ خططِ المراجعةِ بالكوميتِ المقيسِ الجديد
//
// ── لماذا هذا السكربت ──
//
// مسارُ النشرِ (publish-skip-baseline.yml) يضعُ الأثرَ الجديدَ في الشجرةِ ثم
// يُشغِّلُ حاجزَ `guard:skip-baseline`. والحاجزُ يتحقَّقُ (R5) أنَّ كلَّ خطّةٍ
// تُسمّي الكوميتَ المقيسَ. لكنَّ الخططَّ تُذكِرُ الكوميتَ المقيسَ القديمَ،
// فالخطّةُ لا تُحدَّثُ تلقائيّاً عندَ إنتاجِ أثرٍ جديد. هذا السكربتُ يُصلِحُ
// الفجوةَ: يقرأُ الأثرَ، ويُحدِّثُ كلَّ خطّةٍ لتذكرَ الكوميتَ المقيسَ الجديد.
//
// ── العقد ──
//
//   S1 — لكلِّ مُدخلةٍ في `measurements[]` يوجدُ ملفُّ خطّةٍ على القرصِ.
//   S2 — في كلِّ خطّةٍ سطرٌ واحدٌ يحوي «الكوميتُ المقيسُ» يليهُ كوميتٌ بـ8 محارف.
//   S3 — السطرُ نفسُهُ يحوي الأمرَ المقيسَ (`command`).
//   S4 — لا يُمَسُّ سطرُ «الكوميتُ المُراجَعُ» بحرف.
//   S5 — التاريخُ في السطرِ نفسهِ يُحدَّثُ لـ`measuredOn`.
//   S6 — الفشلُ مغلقٌ: أيُّ خرقٍ لـS1–S4 يُوقفُ السكربتَ برمزِ خروجٍ `1`.
//
// الوسائط: <artifact-path> [root]
//   artifact-path — مسارُ ملفِّ الأثر (skip-baseline.json)
//   root          — جذرُ المستودع (افتراضيّاً `.`)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ARTIFACT_PATH = process.argv[2];
const ROOT = process.argv[3] || '.';

if (!ARTIFACT_PATH) {
  console.error('SYNC_PLAN_USAGE: يُمرَّرُ مسارُ ملفِّ الأثر.');
  process.exit(1);
}

const artifactAbs = resolve(ARTIFACT_PATH);
if (!existsSync(artifactAbs)) {
  console.error(`SYNC_PLAN_ARTIFACT_MISSING: ملفُّ الأثرِ غيرُ موجودٍ: ${artifactAbs}`);
  process.exit(1);
}

/** @type {{ measurements: Array<{ engagement: string; plan: string; command: string; commit: string; measuredOn: string }> }} */
const artifact = JSON.parse(readFileSync(artifactAbs, 'utf8'));

if (!Array.isArray(artifact.measurements) || artifact.measurements.length === 0) {
  console.error('SYNC_PLAN_NO_MEASUREMENTS: الأثرُ بلا مُدخلاتِ قياسٍ.');
  process.exit(1);
}

let updated = 0;
const violations = [];

for (const m of artifact.measurements) {
  const planPath = join(ROOT, m.plan);
  if (!existsSync(planPath)) {
    violations.push(`S1/PLAN_MISSING: ${m.plan} غيرُ موجودٍ.`);
    continue;
  }

  const text = readFileSync(planPath, 'utf8');
  const lines = text.split('\n');

  // S2 — ابحث عن سطر «الكوميتُ المقيسُ». قد يكونُ هناكَ أكثرُ من سطرٍ
  // (سجلُّ قياساتٍ سابقةٍ)، فيُحدَّثُ الأخيرُ (الأحدثُ) فقط.
  const measuredIndices = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('الكوميتُ المقيسُ')) {
      measuredIndices.push(i);
    }
  }
  if (measuredIndices.length === 0) {
    violations.push(`S2/NO_MEASURED_LINE: ${m.plan} لا يحوي سطرَ «الكوميتُ المقيسُ».`);
    continue;
  }

  // السطرُ الأخيرُ هو الأحدثُ — هو الذي يُحدَّثُ.
  const lineIdx = measuredIndices[measuredIndices.length - 1];
  const line = lines[lineIdx];

  // S3 — السطرُ يحوي الأمرَ المقيس
  if (!line.includes(m.command)) {
    violations.push(
      `S3/COMMAND_MISSING: ${m.plan} السطرُ لا يحوي الأمرَ المقيس: \`${m.command}\`.`,
    );
    continue;
  }

  // S4 — لا يُمَسُّ «الكوميتُ المُراجَعُ»
  if (line.includes('الكوميتُ المُراجَعُ')) {
    violations.push(`S4/REVIEWED_LINE: ${m.plan} السطرُ يحوي «الكوميتُ المُراجَعُ» — لا يُمَسُّ.`);
    continue;
  }

  // استخرج الكوميتَ القديمَ (8 محارف hex)
  const hexMatch = line.match(/`([0-9a-f]{8})`/);
  if (!hexMatch) {
    violations.push(`S2/NO_HEX: ${m.plan} السطرُ لا يحوي كوميتاً بـ8 محارفٍ hex.`);
    continue;
  }

  const oldCommit = hexMatch[1];
  const newCommit = m.commit.slice(0, 8);

  // استخرج التاريخَ القديم
  const dateMatch = line.match(/(\d{4}-\d{2}-\d{2})/);
  const oldDate = dateMatch ? dateMatch[1] : null;
  const newDate = m.measuredOn;

  // S5 — حدِّث الكوميتَ والتاريخَ
  let newLine = line.replace(`\`${oldCommit}\``, `\`${newCommit}\``);
  if (oldDate && newDate && oldDate !== newDate) {
    newLine = newLine.replace(oldDate, newDate);
  }

  lines[lineIdx] = newLine;
  writeFileSync(planPath, lines.join('\n'));
  updated += 1;

  console.log(
    `✅ ${m.plan}: ${oldCommit} → ${newCommit}` +
      (oldDate && oldDate !== newDate ? ` · ${oldDate} → ${newDate}` : ''),
  );
}

if (violations.length > 0) {
  for (const v of violations) {
    console.error(`⛔ ${v}`);
  }
  process.exit(1);
}

console.log(`\nتمَّ تحديثُ ${updated} خطّةٍ.`);
