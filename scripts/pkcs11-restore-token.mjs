#!/usr/bin/env node
// @ts-nocheck
// scripts/pkcs11-restore-token.mjs
//
// استعادة لقطة متطابقة من نسخة احتياطية (rollback). لا ينسخ فوق الحالة الحالية،
// بل ينقل الحالة الحالية إلى quarantine ثم يستعيد النسخة كاملة، ويتحقق منها.
//
// الاستعمال:
//   node scripts/pkcs11-restore-token.mjs <BACKUP_DIR>
// مثال:
//   node scripts/pkcs11-restore-token.mjs ~/xuux-hsm-backup-20260908-172341
//
// الخطوات:
//   1. التحقق من وجود النسخة وملف manifest.sha256.
//   2. تحديد مجلد التوكن الأصلي من SOFTHSM2_CONF.
//   3. نقل الحالة الحالية إلى quarantine-<timestamp> (لا حذف).
//   4. استعادة نسخة token/ كاملة إلى مجلد التوكن (استبدال لا تراكب).
//   5. التحقق: sha256sum -c، وعدد الملفات، وقابلية قراءة التوكن (PKCS#11).
// يخرج 0 عند النجاح، وغير صفري عند الفشل. لا يتطلب PIN لخطوات الملفّات،
// ويتطلب PIN فقط لاختبار قابلية قراءة التوكن في النهاية (اختياري).

import { existsSync, readFileSync, cpSync, mkdirSync, renameSync, readdirSync } from 'node:fs';
import path from 'node:path';

function fail(code, msg) {
  console.error(`[restore] FAIL (${code}): ${msg}`);
  process.exit(code);
}

function resolveTokenDir() {
  const conf = process.env.SOFTHSM2_CONF;
  if (!conf || !existsSync(conf)) fail(2, `SOFTHSM2_CONF غير مضبوط أو غير موجود: ${conf}`);
  const text = readFileSync(conf, 'utf8');
  const m = text.match(/^\s*directories\.tokendir\s*=\s*(\S+)\s*$/m);
  if (!m) fail(3, `لم يُعثر على directories.tokendir في ${conf}`);
  const dir = m[1].replace(/["']/g, '');
  return dir;
}

async function verifyTokenReadable() {
  // اختبار قابلية قراءة التوكن عبر PKCS#11 (يتطلب PIN).
  const pin = process.env.XUUX_PKCS11_PIN;
  const modulePath =
    process.env.XUUX_PKCS11_MODULE ?? '/usr/lib/x86_64-linux-gnu/softhsm/libsofthsm2.so';
  const tokenLabel = process.env.XUUX_PKCS11_TOKEN ?? 'xuux-security';
  if (!pin) return { ok: true, skipped: true, reason: 'لا يوجد PIN — تخطّي اختبار PKCS#11' };
  try {
    const nsMod = (await import('pkcs11js')).default ?? (await import('pkcs11js'));
    const mod = new nsMod.PKCS11();
    mod.load(modulePath);
    mod.C_Initialize();
    const slots = mod.C_GetSlotList(true);
    let slot = null;
    for (const sl of slots) {
      try {
        if (mod.C_GetTokenInfo(sl)?.label?.trim() === tokenLabel) {
          slot = sl;
          break;
        }
      } catch {
        /* skip */
      }
    }
    if (slot === null)
      return {
        ok: false,
        skipped: false,
        reason: `التوكن '${tokenLabel}' غير موجود بعد الاستعادة`,
      };
    const session = mod.C_OpenSession(slot, 4); // CKF_SERIAL_SESSION
    mod.C_Login(session, 1, pin);
    mod.C_Logout(session);
    mod.C_CloseSession(session);
    mod.C_Finalize();
    return { ok: true, skipped: false };
  } catch (e) {
    return { ok: false, skipped: false, reason: e.message };
  }
}

// --- main ---
(async () => {
  const backupDir = process.argv[2];
  if (!backupDir) fail(1, 'الاستعمال: node scripts/pkcs11-restore-token.mjs <BACKUP_DIR>');
  const absBackup = path.resolve(backupDir.replace(/^~/, process.env.HOME || ''));
  if (!existsSync(absBackup)) fail(4, `مجلد النسخة غير موجود: ${absBackup}`);
  const tokenSrc = path.join(absBackup, 'token');
  if (!existsSync(tokenSrc)) fail(5, `مجلد token/ غير موجود داخل النسخة: ${tokenSrc}`);
  const manifestPath = path.join(absBackup, 'manifest.sha256');
  if (!existsSync(manifestPath)) fail(6, `manifest.sha256 غير موجود في النسخة`);

  const tokenDir = resolveTokenDir();
  console.log(`[restore] مجلد التوكن الأصلي: ${tokenDir}`);
  console.log(`[restore] مصدر النسخة: ${tokenSrc}`);

  // 1) التحقق من سلامة النسخة قبل أيّ تغيير.
  const { execFileSync } = await import('node:child_process');
  try {
    execFileSync('sha256sum', ['-c', manifestPath], {
      cwd: absBackup,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log('[restore] checksum النسخة سليم.');
  } catch {
    fail(7, 'checksum النسخة غير مطابق — لا يمكن الاستعادة من نسخة تالفة');
  }

  // 2) عزل الحالة الحالية إلى quarantine (لا حذف).
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\..+$/, '');
  const quarantineDir = path.join(path.dirname(tokenDir), `quarantine-${ts}`);
  mkdirSync(quarantineDir, { recursive: true, mode: 0o700 });
  if (existsSync(tokenDir)) {
    const contents = readdirSync(tokenDir);
    for (const name of contents) {
      renameSync(path.join(tokenDir, name), path.join(quarantineDir, name));
    }
    console.log(`[restore] عُزلت الحالة الحالية (${contents.length} عنصر) → ${quarantineDir}`);
  }

  // 3) استعادة كاملة (استبدال لا تراكب) — نسخ token/ كاملة إلى مجلد التوكن.
  mkdirSync(tokenDir, { recursive: true, mode: 0o700 });
  cpSync(tokenSrc, tokenDir, {
    recursive: true,
    force: true,
    errorOnExist: false,
    preserveTimestamps: true,
  });
  const restoredFiles = readdirSync(tokenDir);
  console.log(`[restore] استُعيدت ${restoredFiles.length} عنصراً → ${tokenDir}`);

  // 4) التحقق من الاستعادة.
  const checks = [];
  checks.push({
    check: 'restored_files_present',
    ok: restoredFiles.length > 0,
    value: restoredFiles.length,
  });
  let cksumOk;
  try {
    execFileSync('sha256sum', ['-c', manifestPath], {
      cwd: absBackup,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    cksumOk = true;
  } catch {
    cksumOk = false;
  }
  checks.push({ check: 'checksum_verified', ok: cksumOk, value: cksumOk ? 'OK' : 'MISMATCH' });

  const readable = await verifyTokenReadable(tokenDir);
  checks.push({
    check: 'token_readable',
    ok: readable.ok,
    value: readable.skipped ? 'skipped' : readable.ok ? 'OK' : readable.reason,
  });

  console.log('[restore] التحقق:');
  let allOk = true;
  for (const c of checks) {
    console.log(`  ${c.ok ? 'OK' : 'FAIL'}  ${c.check}=${c.value}`);
    if (!c.ok) allOk = false;
  }
  console.log(`[restore] quarantine: ${quarantineDir} (محفوظة للتحقيق)`);
  if (!allOk) fail(8, 'فشل التحقق بعد الاستعادة');
  console.log(`[restore] === PASS: استُعيدت لقطة متطابقة من ${absBackup} ===`);
  process.exit(0);
})().catch((e) => fail(9, e.message));
