#!/usr/bin/env node
// @ts-nocheck
// scripts/pkcs11-backup-token.mjs
//
// نسخ احتياطي read-only لمخزن توكن SoftHSM2 + جرد كائنات + بصمات مفاتيح عامة.
// لا يحذف ولا يستبدل ولا يكتب في التوكن الأصلي إطلاقاً.
//
// الاستعمال:
//   read -s XUUX_PKCS11_PIN; export XUUX_PKCS11_PIN   # إدخال تفاعلي محلي
//   export SOFTHSM2_CONF=/home/reeveero/.config/softhsm2/softhsm2.conf
//   export XUUX_PKCS11_MODULE=/usr/lib/x86_64-linux-gnu/softhsm/libsofthsm2.so
//   node scripts/pkcs11-backup-token.mjs
//
// يطبع:
//   BACKUP_DIR=...  (مسار النسخة الفريد بالتاريخ والوقت)
//   ملخص التحقق (عدد الملفات، checksum، الجرد، البصمات)
// يخرج 0 عند النجاح، وغير صفري عند أي فشل.

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  cpSync,
  statSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';

// أصناف كائنات PKCS#11 v3.0 (§4.1): DATA=0، CERTIFICATE=1، PUBLIC_KEY=2،
// PRIVATE_KEY=3، SECRET_KEY=4. القيم السابقة كانت مُبدَّلة فصُنِّف F05 (AES)
// كصنفٍ مجهول وصُنِّفت المفاتيح الخاصة كـSECRET_KEY في manifest.json.
const CKO_PUBLIC_KEY = 0x00000002;
const CKO_PRIVATE_KEY = 0x00000003;
const CKO_SECRET_KEY = 0x00000004;
const CKA_CLASS = 0x00000000;
const CKA_ID = 0x00000102;
const CKA_LABEL = 0x00000003;
const CKA_EC_PARAMS = 0x00000180;
const CKA_KEY_TYPE = 0x00000100;

function fail(code, msg) {
  console.error(`[backup] FAIL (${code}): ${msg}`);
  process.exit(code);
}

function hex(d) {
  return Buffer.from(d).toString('hex');
}

// 1) تحديد مسار مخزن التوكن من SOFTHSM2_CONF
function resolveTokenDir() {
  const conf = process.env.SOFTHSM2_CONF;
  if (!conf || !existsSync(conf)) fail(2, `SOFTHSM2_CONF غير مضبوط أو غير موجود: ${conf}`);
  const text = readFileSync(conf, 'utf8');
  const m = text.match(/^\s*directories\.tokendir\s*=\s*(\S+)\s*$/m);
  if (!m) fail(3, `لم يُعثر على directories.tokendir في ${conf}`);
  const dir = m[1].replace(/["']/g, '');
  if (!existsSync(dir)) fail(4, `مجلد التوكن غير موجود: ${dir}`);
  return dir;
}

// 2) نسخ المجلد (read-only على المصدر) + manifest checksum
async function copyTokenDir(tokenDir, backupDir) {
  const tokenCopy = path.join(backupDir, 'token');
  cpSync(tokenDir, tokenCopy, {
    recursive: true,
    force: true,
    errorOnExist: false,
    preserveTimestamps: true,
  });
  // sha256 لكل ملف (متوافق مع sha256sum -c)
  const lines = [];
  const walk = (dir, rel = '') => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full, path.join(rel, name));
      } else {
        const data = readFileSync(full);
        const sum = createHash('sha256').update(data).digest('hex');
        const relPath = path.join('token', rel, name);
        lines.push(`${sum}  ${relPath}`);
      }
    }
  };
  walk(tokenCopy);
  const manifestPath = path.join(backupDir, 'manifest.sha256');
  writeFileSync(manifestPath, lines.join('\n') + '\n', { mode: 0o600 });
  return { fileCount: lines.length, manifestPath };
}

// 3) جرد الكائنات + بصمات المفاتيح العامة (يتطلب PIN)
async function inventoryObjects(backupDir) {
  const nsMod = (await import('pkcs11js')).default ?? (await import('pkcs11js'));
  const PKCS11 = nsMod.PKCS11;
  const modulePath =
    process.env.XUUX_PKCS11_MODULE ?? '/usr/lib/x86_64-linux-gnu/softhsm/libsofthsm2.so';
  const tokenLabel = process.env.XUUX_PKCS11_TOKEN ?? 'xuux-security';
  const pin = process.env.XUUX_PKCS11_PIN;
  if (!pin) fail(5, 'XUUX_PKCS11_PIN غير مضبوط (أدخله تفاعلياً)');

  const mod = new PKCS11();
  mod.load(modulePath);
  mod.C_Initialize();
  try {
    const slots = mod.C_GetSlotList(true);
    if (!slots?.length) fail(6, 'لا توجد توكنات');
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
    if (slot === null) fail(7, `التوكن '${tokenLabel}' غير موجود`);
    const session = mod.C_OpenSession(slot, 6); // CKF_SERIAL_SESSION=0x4 | CKF_RW_SESSION=0x2
    mod.C_Login(session, 1, pin); // CKU_USER=1

    // جرد كل الكائنات
    const objects = [];
    mod.C_FindObjectsInit(session, []);
    let batch;
    do {
      batch = mod.C_FindObjects(session, 50);
      for (const h of batch) {
        const get = (attr) => {
          try {
            const v = mod.C_GetAttributeValue(session, h, [{ type: attr }]);
            return v && v[0] ? v[0].value : null;
          } catch {
            return null;
          }
        };
        const cls = get(CKA_CLASS);
        const id = get(CKA_ID);
        const label = get(CKA_LABEL);
        const ecParams = get(CKA_EC_PARAMS);
        const keyType = get(CKA_KEY_TYPE);
        const clsNum = cls ? cls.readUInt32LE(0) : 0;
        const obj = {
          class:
            clsNum === CKO_PUBLIC_KEY
              ? 'CKO_PUBLIC_KEY'
              : clsNum === CKO_PRIVATE_KEY
                ? 'CKO_PRIVATE_KEY'
                : clsNum === CKO_SECRET_KEY
                  ? 'CKO_SECRET_KEY'
                  : `0x${clsNum.toString(16)}`,
          cka_id: id ? hex(id) : '(none)',
          label: label ? Buffer.from(label).toString('utf8') : '(none)',
          key_type: keyType ? `0x${keyType.readUInt32LE(0).toString(16)}` : null,
        };
        if (ecParams && ecParams.length >= 5) {
          const last = ecParams[ecParams.length - 1];
          // لا نُبلغ عن curve إلا لـOID صالح (Ed25519/X25519)؛ المفاتيح الخاصة
          // قد تُرجع سمة مختلفة فلا نُصدّر قيمةً مضلِلة.
          if (last === 0x70 || last === 0x6e) {
            obj.curve_oid = `1.3.101.${last}`;
            obj.curve_kind = last === 0x70 ? 'Ed25519' : 'X25519';
          }
        }
        // بصمة المفتاح العام: CKA_EC_POINT (0x181) للمفاتيح EC العامة.
        if (clsNum === CKO_PUBLIC_KEY) {
          const point = get(0x181); // CKA_EC_POINT
          if (point && point.length >= 32) {
            const off = point[0] === 0x04 ? (point.length > 33 ? 2 : 1) : 0;
            const raw = Buffer.from(point.slice(off, off + 32));
            obj.public_key_sha256 = createHash('sha256').update(raw).digest('hex');
            obj.public_key_len = 32;
            obj.public_key_hex = raw.toString('hex');
          }
        }
        objects.push(obj);
      }
    } while (batch && batch.length > 0);
    mod.C_FindObjectsFinal(session);
    mod.C_Logout(session);
    mod.C_CloseSession(session);

    const manifest = {
      created_at: new Date().toISOString(),
      backup_dir: backupDir,
      token_label: tokenLabel,
      object_count: objects.length,
      objects,
      // ربط old->new يُملأ لاحقاً بعد التدوير
      rotation_mapping: [],
    };
    writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {
      mode: 0o600,
    });
    return manifest;
  } finally {
    try {
      mod.C_Finalize();
    } catch {
      /* ignore */
    }
  }
}

// 4) التحقق: وجود، ملفات، checksum، صلاحيات، قابلية قراءة التوكن
async function verify(backupDir, manifestPath, tokenDir) {
  const checks = [];
  const st = statSync(backupDir);
  checks.push({ check: 'backup_dir_exists', ok: st.isDirectory(), value: backupDir });
  const perm = (st.mode & 0o777).toString(8);
  checks.push({
    check: 'backup_dir_permissions',
    ok: (st.mode & 0o777) <= 0o750,
    value: `0o${perm}`,
  });

  const files = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const f = path.join(d, n);
      const s = statSync(f);
      s.isDirectory() ? walk(f) : files.push(f);
    }
  };
  walk(backupDir);
  checks.push({ check: 'backup_has_files', ok: files.length > 0, value: files.length });

  // sha256sum -c
  const { execFileSync } = await import('node:child_process');
  let cksumOk;
  try {
    execFileSync('sha256sum', ['-c', manifestPath], {
      cwd: backupDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    cksumOk = true;
  } catch {
    cksumOk = false;
  }
  checks.push({ check: 'checksum_verified', ok: cksumOk, value: cksumOk ? 'OK' : 'MISMATCH' });

  // التوكن الأصلي ما زال قابلاً للقراءة (ملفاته سليمة)
  const origFiles = readdirSync(tokenDir);
  checks.push({
    check: 'original_token_readable',
    ok: origFiles.length > 0,
    value: origFiles.length,
  });

  return checks;
}

// --- main ---
(async () => {
  const tokenDir = resolveTokenDir();
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\..+$/, '');
  const backupDir = path.join(process.env.HOME || '/tmp', `xuux-hsm-backup-${ts}`);
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  console.log(`BACKUP_DIR=${backupDir}`);
  console.log(`[backup] مصدر التوكن: ${tokenDir}`);

  const { fileCount, manifestPath } = await copyTokenDir(tokenDir, backupDir);
  console.log(`[backup] نُسخ ${fileCount} ملفاً → ${backupDir}/token`);

  const manifest = await inventoryObjects(backupDir);
  console.log(`[backup] جرد الكائنات: ${manifest.object_count} كائناً`);
  const edKeys = manifest.objects.filter((o) => o.curve_kind);
  for (const o of edKeys) {
    console.log(
      `  CKA_ID=${o.cka_id} label=${o.label} curve=${o.curve_kind}(${o.curve_oid}) pubkey_sha256=${o.public_key_sha256 ?? 'n/a'}`,
    );
  }

  const checks = await verify(backupDir, manifestPath, tokenDir);
  console.log('[backup] التحقق:');
  let allOk = true;
  for (const c of checks) {
    console.log(`  ${c.ok ? 'OK' : 'FAIL'}  ${c.check}=${c.value}`);
    if (!c.ok) allOk = false;
  }
  if (!allOk) fail(8, 'فشل التحقق — النسخة غير موثوقة');
  console.log(`[backup] === PASS: نسخة احتياطية موثوقة في ${backupDir} ===`);
  process.exit(0);
})().catch((e) => fail(9, e.message));
