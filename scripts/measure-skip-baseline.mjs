#!/usr/bin/env node
// مقياسُ خطِّ أساسِ التخطّي — يُولَّدُ من مُخرَجِ TAP حقيقيٍّ، ولا يُكتَبُ بيدٍ.
//
// **لماذا هذا الملفُّ:** النتيجةُ `R5-A-06` من مجلسِ `M11.05` كشفَت أنَّ خطّةَ الجولةِ
// أعلنَت «تتخطّى الحزمةُ ١٢١ اختباراً» رقماً **مكتوباً بيدٍ** ووُصِفَ بأنّه «ثابتٌ»
// (‏`WL-139`) — فلمّا نمَتِ الحزمةُ صارَ الرقمُ لا يُطابقُ أيَّ تشغيلةٍ. والعلّةُ ليست
// في الرقمِ بل في **كتابةِ قياسٍ بيدٍ بلا أمرٍ يُنتِجُه ولا كوميتٍ يُنسَبُ إليه**.
// فصارَ الرقمُ يُولَّدُ من مُخرَجِ TAP بهذا الأمرِ، ويحرسُه `guard:skip-baseline`.
//
// **الاستعمالُ:**
//   env -u DATABASE_URL npm test > /tmp/nodb.tap 2>&1
//   node scripts/measure-skip-baseline.mjs /tmp/nodb.tap \
//     --engagement M11.05 --plan docs/external-review/M11.05-round-1-plan.md \
//     --command 'env -u DATABASE_URL npm test'
//
// **ثلاثةُ مقاييسَ مختلفةٍ لا مقياسٌ واحدٌ** — وخلطُها هو نصفُ العطبِ:
//   - `skipped`: عدّادُ `# skipped` الختاميُّ من node (يَعُدُّ نقاطَ الاختبارِ المتداخلةَ).
//   - `skipLines`: كلُّ سطرٍ فيه `# SKIP` على أيِّ عمقٍ.
//   - `topLevelSkipPoints`: نقاطُ التخطّي في المستوى الأعلى وحدَها.
// ولا واحدٌ منها «عددُ ما تتخطّاهُ الحزمةُ بسببِ `DATABASE_URL`» — ذاكَ
// `attributedToDatabaseUrl` وحدَه.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ARTIFACT = 'docs/external-review/skip-baseline.json';

/** @param {string} s */
function fail(s) {
  process.stderr.write(`⛔ ${s}\n`);
  process.exit(1);
}

/**
 * يَقرأُ وسائطَ سطرِ الأمرِ بلا تبعيّةٍ خارجيّةٍ.
 * @param {string[]} argv
 * @returns {{ tap: string, flags: Record<string, string> }}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const flags = {};
  /** @type {string[]} */
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? '';
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        fail(`الوسيطُ --${key} بلا قيمةٍ.`);
        throw new Error('unreachable');
      }
      flags[key] = next;
      i += 1;
    } else {
      positional.push(a);
    }
  }
  const tap = positional[0];
  if (positional.length !== 1 || tap === undefined) {
    fail('يلزمُ مسارُ ملفِّ TAP واحداً بلا زيادةٍ.');
    throw new Error('unreachable');
  }
  return { tap, flags };
}

/**
 * يَستخرجُ المقاييسَ من نصِّ TAP — **قراءةٌ لا تخمينٌ**.
 * @param {string} tapText
 * @returns {{ tests: number, pass: number, fail: number, skipped: number, skipLines: number,
 *   topLevelSkipPoints: number, attributedToDatabaseUrl: number,
 *   otherReasons: { reason: string, count: number }[] }}
 */
export function parseTap(tapText) {
  const lines = tapText.split('\n');
  /** @param {string} key */
  const summary = (key) => {
    const re = new RegExp(`^# ${key} (\\d+)\\s*$`);
    for (const l of lines) {
      const m = re.exec(l);
      if (m?.[1] !== undefined) return Number(m[1]);
    }
    return null;
  };
  const tests = summary('tests');
  const pass = summary('pass');
  const failed = summary('fail');
  const skipped = summary('skipped');
  if (tests === null || pass === null || failed === null || skipped === null) {
    fail(
      'مُخرَجُ TAP بلا مُلخَّصٍ ختاميٍّ (`# tests`/`# pass`/`# fail`/`# skipped`) — لم تكتملِ التشغيلةُ.',
    );
  }
  const skipLines = lines.filter((l) => l.includes('# SKIP')).length;
  const topLevelSkipPoints = lines.filter((l) => /^(ok|not ok) .*# SKIP/.test(l)).length;
  /** @type {Map<string, number>} */
  const reasons = new Map();
  for (const l of lines) {
    const m = /# SKIP (.*)$/.exec(l);
    if (!m) continue;
    const reason = (m[1] ?? '').trim();
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  let attributedToDatabaseUrl = 0;
  /** @type {{ reason: string, count: number }[]} */
  const otherReasons = [];
  for (const [reason, count] of reasons) {
    if (reason.includes('DATABASE_URL')) attributedToDatabaseUrl += count;
    else otherReasons.push({ reason, count });
  }
  otherReasons.sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  return {
    tests: /** @type {number} */ (tests),
    pass: /** @type {number} */ (pass),
    fail: /** @type {number} */ (failed),
    skipped: /** @type {number} */ (skipped),
    skipLines,
    topLevelSkipPoints,
    attributedToDatabaseUrl,
    otherReasons,
  };
}

function main() {
  const { tap, flags } = parseArgs(process.argv.slice(2));
  if (!existsSync(tap)) fail(`ملفُّ TAP غيرُ موجودٍ: ${tap}`);
  for (const required of ['engagement', 'plan', 'command']) {
    if (!flags[required]) fail(`يلزمُ الوسيطُ --${required}.`);
  }
  const root = process.cwd();
  const planRel = flags.plan ?? '';
  if (!existsSync(path.join(root, planRel))) fail(`ملفُّ الخطّةِ غيرُ موجودٍ: ${planRel}`);
  const measured = parseTap(readFileSync(tap, 'utf8'));
  if (measured.fail !== 0) {
    fail(`تشغيلةٌ فيها ${measured.fail} إخفاقاً لا تُصلُحُ خطَّ أساسٍ — أصلِحِ الإخفاقَ أوّلاً.`);
  }
  const commit =
    flags.commit ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const measuredOn = flags.date ?? new Date().toISOString().slice(0, 10);

  const artifactPath = path.join(root, ARTIFACT);
  /** @type {{ generatedBy: string, measurements: any[] }} */
  const artifact = existsSync(artifactPath)
    ? JSON.parse(readFileSync(artifactPath, 'utf8'))
    : { generatedBy: 'npm run measure:skip-baseline', measurements: [] };
  artifact.generatedBy = 'npm run measure:skip-baseline';
  const entry = {
    engagement: flags.engagement,
    plan: flags.plan,
    command: flags.command,
    commit,
    measuredOn,
    ...measured,
  };
  const at = artifact.measurements.findIndex(
    (/** @type {any} */ m) => m.engagement === entry.engagement && m.plan === entry.plan,
  );
  if (at === -1) artifact.measurements.push(entry);
  else artifact.measurements[at] = entry;
  artifact.measurements.sort((/** @type {any} */ a, /** @type {any} */ b) =>
    a.plan.localeCompare(b.plan),
  );
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `✅ خطُّ أساسِ التخطّي مُقاسٌ ومُقيَّدٌ في ${ARTIFACT}\n` +
      `   الارتباطُ: ${entry.engagement} · الكوميتُ: ${commit.slice(0, 8)} · التاريخُ: ${measuredOn}\n` +
      `   الاختباراتُ: ${measured.tests} · الناجحُ: ${measured.pass} · الفاشلُ: ${measured.fail}\n` +
      `   عدّادُ التخطّي الختاميُّ: ${measured.skipped} · أسطرُ # SKIP: ${measured.skipLines} · نقاطُ المستوى الأعلى: ${measured.topLevelSkipPoints}\n` +
      `   بسببِ DATABASE_URL: ${measured.attributedToDatabaseUrl} · أسبابٌ أُخرى: ${measured.otherReasons
        .map((r) => `${r.count}× ${r.reason.slice(0, 40)}`)
        .join(' | ')}\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
