#!/usr/bin/env node
// فاحص الثغرات — M11.02
//
// يُشغّل `npm audit` ويُخرج تقريرًا بتنسيق JSON إلى `audit-report.json`.
// يُفشل البناء عند وجود ثغرات حرجة أو عالية.

import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import process from 'node:process';

const rootIndex = process.argv.indexOf('--root');
const repoRoot = rootIndex === -1 ? process.cwd() : (process.argv[rootIndex + 1] ?? process.cwd());

console.log('═══ فحص الثغرات (M11.02) ═══');

try {
  const output = execSync('npm audit --json', {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const audit = JSON.parse(output);
  const outPath = `${repoRoot}/audit-report.json`;
  writeFileSync(outPath, JSON.stringify(audit, null, 2) + '\n');

  const vulns = audit.vulnerabilities ?? {};
  const critical = Object.entries(vulns).filter(([, v]) => {
    return (
      typeof v === 'object' &&
      v !== null &&
      'severity' in v &&
      (v.severity === 'critical' || v.severity === 'high')
    );
  });

  if (critical.length > 0) {
    console.error(`\n⛔ ${critical.length} ثغرةٌ حرجة/عالية:`);
    for (const [name, v] of critical) {
      console.error(`   - ${name}: ${v.severity}`);
      if (v.via) {
        const via = Array.isArray(v.via) ? v.via : [v.via];
        const desc = via.map((x) => (typeof x === 'string' ? x : x.title)).join(', ');
        console.error(`     عبر: ${desc}`);
      }
    }
    process.exit(1);
  }

  const total = Object.keys(vulns).length;
  console.log(`\n✅ لا ثغراتٍ حرجة/عالية (${total} ثغرة منخفضة/متوسطة).`);
} catch (error) {
  // npm audit returns non-zero exit when vulnerabilities found
  const err = /** @type {Error & { stdout?: string }} */ (error);
  if (err.stdout) {
    try {
      const audit = JSON.parse(err.stdout);
      const outPath = `${repoRoot}/audit-report.json`;
      writeFileSync(outPath, JSON.stringify(audit, null, 2) + '\n');
      const vulns = audit.vulnerabilities ?? {};
      const critical = Object.entries(vulns).filter(([, v]) => {
        return (
          typeof v === 'object' &&
          v !== null &&
          'severity' in v &&
          (v.severity === 'critical' || v.severity === 'high')
        );
      });
      if (critical.length > 0) {
        console.error(`\n⛔ ${critical.length} ثغرةٌ حرجة/عالية:`);
        for (const [name, v] of critical) {
          console.error(`   - ${name}: ${v.severity}`);
        }
        process.exit(1);
      }
    } catch {
      console.error('⛔ فشل تحليل تقرير npm audit:', err.message);
      process.exit(1);
    }
  } else {
    console.error('⛔ فشل npm audit:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
