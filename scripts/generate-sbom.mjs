#!/usr/bin/env node
// مولِّد SBOM — M11.02
//
// يولِّد قائمة مكوّنات البرمجيات (SBOM) بصيغة CycloneDX باستخدام `npm sbom`.
// يُشغَّل في CI قبل حاجز سلسلة التوريد، ويُنتج `sbom.cdx.json` في جذر المستودع.
// ‏WL-575: يُزيلُ SBOM السابقَ قبلَ التوليد، ويختمُ الجديدَ ببصمةِ SHA-256 لبايتاتِ `package-lock.json` الخامِ في
// ‏`metadata.properties` (‏`xuux:lockfileSha256` — مسارُ الامتدادِ القياسيُّ في CycloneDX)، ويكتبُه ذرّيّاً (‏مؤقّتٌ ثمّ rename)،
// ‏ويفشلُ بلا SBOM إن تغيّرَ القفلُ أثناءَ التوليد؛ و R2 في guard:supply-chain يرفضُ SBOM غيرَ مربوطٍ بالقفلِ الحاليّ.

import { readFileSync, writeFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { lockDigest } from './audit-check.mjs';

/** WL-575: اسمُ خاصّيّةِ الربطِ في `metadata.properties`. */
export const SBOM_LOCK_PROPERTY = 'xuux:lockfileSha256';
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** @param {unknown} x @returns {x is Record<string, any>} */
const isObj = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * WL-575: يُضيفُ خاصّيّةَ الربطِ إلى `metadata.properties` دونَ مسِّ بقيّةِ SBOM (‏ولا الأصل)؛ ويرمي إن وُجدَت سابقاً.
 * @param {Record<string, any>} sbom ناتجُ `npm sbom` @param {Buffer} lockBytes بايتاتُ القفلِ الذي وُلِّدَ عليه
 */
export function stampSbom(sbom, lockBytes) {
  const metadata = isObj(sbom.metadata) ? sbom.metadata : {};
  const properties = Array.isArray(metadata.properties) ? metadata.properties : [];
  if (properties.some((p) => isObj(p) && p.name === SBOM_LOCK_PROPERTY)) {
    throw new Error(`SBOM يحملُ ${SBOM_LOCK_PROPERTY} قبلَ الختم`);
  }
  return {
    ...sbom,
    metadata: {
      ...metadata,
      properties: [...properties, { name: SBOM_LOCK_PROPERTY, value: lockDigest(lockBytes) }],
    },
  };
}

/**
 * WL-575: هل SBOM مربوطٌ بالقفلِ الحاليّ؟ '' أو سببُ الرفض. خاصّيّةٌ واحدةٌ بالضبطِ في `metadata.properties`.
 * @param {any} sbom @param {Buffer | null} lockBytes بايتاتُ `package-lock.json` الحاليّ (‏null إن غاب)
 * @returns {string}
 */
export function checkSbomBinding(sbom, lockBytes) {
  if (!isObj(sbom)) return 'SBOM ليس كائناً';
  if (!isObj(sbom.metadata)) return '`metadata` غائبةٌ أو ليست كائناً';
  const properties = sbom.metadata.properties;
  if (!Array.isArray(properties)) return '`metadata.properties` غائبةٌ أو ليست مصفوفة';
  if (!properties.every((p) => isObj(p) && typeof p.name === 'string')) {
    return '`metadata.properties` فيها عنصرٌ ليس كائناً باسمٍ نصّيّ';
  }
  const hits = properties.filter((p) => isObj(p) && p.name === SBOM_LOCK_PROPERTY);
  if (hits.length === 0) return `خاصّيّةُ \`${SBOM_LOCK_PROPERTY}\` غائبة`;
  if (hits.length > 1) return `خاصّيّةُ \`${SBOM_LOCK_PROPERTY}\` مكرّرة`;
  const value = hits[0]?.value;
  if (typeof value !== 'string' || !SHA256_HEX.test(value)) {
    return `قيمةُ \`${SBOM_LOCK_PROPERTY}\` ليست SHA-256 بـ 64 حرفاً hex صغيراً`;
  }
  if (lockBytes === null) return '`package-lock.json` غائبٌ فلا يُطابَق';
  if (value !== lockDigest(lockBytes)) {
    return 'بصمةُ SBOM لا تطابقُ `package-lock.json` الحاليّ (‏وُلِّدَ على قفلٍ آخر)';
  }
  return '';
}

function main() {
  const rootIndex = process.argv.indexOf('--root');
  const repoRoot =
    rootIndex === -1 ? process.cwd() : (process.argv[rootIndex + 1] ?? process.cwd());

  console.log('═══ توليد SBOM (M11.02) ═══');

  try {
    const outPath = path.join(repoRoot, 'sbom.cdx.json');
    // ‏WL-575: أبطِلِ السابقَ قبلَ أيِّ شيء — فشلٌ لاحقٌ لا يتركُ SBOM قديماً يبدو صالحاً.
    rmSync(outPath, { force: true });
    const lockPath = path.join(repoRoot, 'package-lock.json');
    /** @param {import('node:fs').Stats} s */
    const sig = (s) => `${s.size}:${s.mtimeMs}:${s.ino}`;
    const statBefore = sig(statSync(lockPath));
    const lockBytes = readFileSync(lockPath);
    const output = execSync('npm sbom --sbom-format cyclonedx --json', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const sbom = JSON.parse(output);
    // ‏WL-575: القفلُ قبلَ التوليدِ هو نفسُه بعدَه (‏بصمةً وحجماً ووقتَ تعديلٍ وinode) — وإلا فالـSBOM لا يُنسَبُ لقفل.
    /** @type {boolean} */
    let changed;
    try {
      changed =
        sig(statSync(lockPath)) !== statBefore ||
        lockDigest(readFileSync(lockPath)) !== lockDigest(lockBytes);
    } catch {
      changed = true;
    }
    if (changed) {
      console.error(
        '⛔ package-lock.json تغيّرَ أثناءَ توليدِ SBOM — لا SBOM. أعِدْ `npm run gen:sbom` بعدَ استقرارِ القفل.',
      );
      process.exit(1);
    }
    const tmpPath = `${outPath}.${process.pid}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(stampSbom(sbom, lockBytes), null, 2) + '\n');
    renameSync(tmpPath, outPath);
    console.log(`✅ SBOM مُولَّدٌ: ${outPath} (${sbom.components?.length ?? 0} مكوّن)`);
  } catch (error) {
    console.error('⛔ فشل توليد SBOM:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
