#!/usr/bin/env node
// مولِّد SBOM — M11.02
//
// يولِّد قائمة مكوّنات البرمجيات (SBOM) بصيغة CycloneDX باستخدام `npm sbom`.
// يُشغَّل في CI قبل حاجز سلسلة التوريد، ويُنتج `sbom.cdx.json` في جذر المستودع.

import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import process from 'node:process';

const rootIndex = process.argv.indexOf('--root');
const repoRoot = rootIndex === -1 ? process.cwd() : (process.argv[rootIndex + 1] ?? process.cwd());

console.log('═══ توليد SBOM (M11.02) ═══');

try {
  const output = execSync('npm sbom --sbom-format cyclonedx --json', {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const sbom = JSON.parse(output);
  const outPath = `${repoRoot}/sbom.cdx.json`;
  writeFileSync(outPath, JSON.stringify(sbom, null, 2) + '\n');
  console.log(`✅ SBOM مُولَّدٌ: ${outPath} (${sbom.components?.length ?? 0} مكوّن)`);
} catch (error) {
  console.error(
    '⛔ فشل توليد SBOM:',
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
}
