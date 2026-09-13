// R4-K3-03: ثباتُ سحبِ الشهاداتِ على القرصِ عبرَ إعادةِ التشغيل.
//
// العيب (R4-K3-03): مخزنُ السحبِ الافتراضيُّ (`MemoryRevocationStore`) لا يدومُ
// عبرَ إعادةِ التشغيل — في الإنتاجِ يُرفَضُ بناءُ السلطةِ به، لكنّه التنفيذُ
// الوحيدُ المتاح. فلا توجدُ طريقةٌ لإبقاءِ سجلِّ السحبِ بعدَ توقّفِ العمليةِ.
//
// الإصلاح: `FileRevocationStore` يخزّنُ سجلَّ السحبِ في ملفٍ JSONL على القرص،
// يحمّلُه عندَ البناءِ، ويُلحقُ به كلَّ سحبٍ جديد. الفشلُ مغلقٌ: ملفٌ تالفٌ
// أو غيرُ قابلٍ للقراءةِ يُعلنُ `ready() ← false` فترفضُ السلطةُ كلَّ شهادة.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CertificateAuthority,
  KingIdentity,
  FileRevocationStore,
  MemoryRevocationStore,
} from '../../src/root-of-trust/index.mjs';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'xuux-revocation-'));
}

test('FileRevocationStore: سحبٌ قبلَ إعادةِ التشغيلِ يبقى نافذاً بعدها', () => {
  const dir = tempDir();
  try {
    const storePath = join(dir, 'revoked.jsonl');
    const king = new KingIdentity();

    // العمليةُ الأولى: سلطةٌ بمخزنٍ دائم.
    const store1 = new FileRevocationStore(storePath);
    const ca1 = new CertificateAuthority(king, { revocationStore: store1 });
    const cert = ca1.issue('agent:x', 'minister', ['read']);
    assert.equal(ca1.isValid(cert), true, 'قبل السحب: مقبولة');
    const result = ca1.revoke(cert.id, 'compromised');
    assert.equal(result.persisted, true, 'السحب كُتب في الملف');
    assert.equal(ca1.isValid(cert), false, 'بعد السحب: مرفوضة');

    // «إعادةُ التشغيل»: مخزنٌ جديدٌ من نفسِ الملف — لا ذاكرةٌ مشتركة.
    const store2 = new FileRevocationStore(storePath);
    assert.equal(store2.ready(), true, 'المخزن الجديد جاهز');
    const ca2 = new CertificateAuthority(king, { revocationStore: store2 });
    assert.equal(ca2.isValid(cert), false, 'بعد إعادة التشغيل: ما زالت مسحوبة');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FileRevocationStore: مخزنٌ جديدٌ بلا ملفٍ جاهزٌ ويبدأُ فارغاً', () => {
  const dir = tempDir();
  try {
    const storePath = join(dir, 'revoked.jsonl');
    const store = new FileRevocationStore(storePath);
    assert.equal(store.ready(), true, 'جاهز حتى لو الملف غير موجود');
    assert.equal(store.isRevoked('cert-123'), false, 'لا سحب سابق');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FileRevocationStore: ملفٌ تالفٌ ← ready() ← false (فشل مغلق)', () => {
  const dir = tempDir();
  try {
    const storePath = join(dir, 'revoked.jsonl');
    writeFileSync(storePath, 'not valid json\n{broken\n', 'utf8');
    const store = new FileRevocationStore(storePath);
    assert.equal(store.ready(), false, 'ملف تالف: غير جاهز');
    assert.equal(store.isRevoked('anything'), false, 'لا يقرأ من ملف تالف');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FileRevocationStore: مخزنٌ غيرُ جاهزٍ لا يكتبُ ويرفضُ السحب', () => {
  const dir = tempDir();
  try {
    const storePath = join(dir, 'revoked.jsonl');
    writeFileSync(storePath, 'corrupt\n', 'utf8');
    const store = new FileRevocationStore(storePath);
    assert.equal(store.ready(), false, 'غير جاهز');
    const result = store.revoke('cert-1', 'king', 'compromised');
    assert.equal(result, false, 'لم يكتب في مخزن غير جاهز');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FileRevocationStore: سحبُ شهادتين يُسجَّلان ويُحمَّلان معاً', () => {
  const dir = tempDir();
  try {
    const storePath = join(dir, 'revoked.jsonl');
    const king = new KingIdentity();

    const store1 = new FileRevocationStore(storePath);
    const ca1 = new CertificateAuthority(king, { revocationStore: store1 });
    const cert1 = ca1.issue('agent:a', 'minister', ['read']);
    const cert2 = ca1.issue('agent:b', 'minister', ['read']);
    ca1.revoke(cert1.id, 'compromised');
    ca1.revoke(cert2.id, 'rotated');

    // إعادةُ التشغيل.
    const store2 = new FileRevocationStore(storePath);
    const ca2 = new CertificateAuthority(king, { revocationStore: store2 });
    assert.equal(ca2.isValid(cert1), false, 'الشهادة الأولى ما زالت مسحوبة');
    assert.equal(ca2.isValid(cert2), false, 'الشهادة الثانية ما زالت مسحوبة');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FileRevocationStore: لا تكرار — سحبُ نفسِ الشهادةِ مرتين لا يضاعف', () => {
  const dir = tempDir();
  try {
    const storePath = join(dir, 'revoked.jsonl');
    const store = new FileRevocationStore(storePath);
    assert.equal(store.revoke('cert-1', 'king', 'compromised'), true, 'السحب الأول نجح');
    assert.equal(
      store.revoke('cert-1', 'king', 'compromised'),
      true,
      'السحب الثاني نجح (idempotent)',
    );

    // إعادةُ التشغيل: سطرّان للشهادة نفسها لكنها مرة واحدة في المجموعة.
    const store2 = new FileRevocationStore(storePath);
    assert.equal(store2.isRevoked('cert-1'), true, 'مسحوبة مرة واحدة');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FileRevocationStore لا يُقبلُ في الإنتاجِ بجانب MemoryRevocationStore', () => {
  // هذا اختبارٌ سلوكيٌّ: التأكدُ من أنّ FileRevocationStore ليس MemoryRevocationStore
  // — فالإنتاجُ يرفضُ MemoryRevocationStore تحديداً.
  const dir = tempDir();
  try {
    const storePath = join(dir, 'revoked.jsonl');
    const fileStore = new FileRevocationStore(storePath);
    const memStore = new MemoryRevocationStore();
    assert.ok(fileStore instanceof FileRevocationStore, 'FileRevocationStore');
    assert.ok(!(fileStore instanceof MemoryRevocationStore), 'ليس MemoryRevocationStore');
    assert.ok(memStore instanceof MemoryRevocationStore, 'MemoryRevocationStore');
    assert.ok(!(memStore instanceof FileRevocationStore), 'ليس FileRevocationStore');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FileRevocationStore: سجلٌّ ناقصُ الحقولِ يُعدُّ تالفاً (فشل مغلق)', () => {
  const dir = tempDir();
  try {
    const storePath = join(dir, 'revoked.jsonl');
    // سجلٌّ JSON صحيحٌ نحويّاً لكنّه ناقصُ الحقولِ.
    writeFileSync(storePath, JSON.stringify({ certificateId: 'cert-1' }) + '\n', 'utf8');
    const store = new FileRevocationStore(storePath);
    assert.equal(store.ready(), false, 'سجل ناقص الحقول: غير جاهز');
    assert.equal(store.isRevoked('cert-1'), false, 'لا يقرأ من سجل تالف');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FileRevocationStore: سجلٌّ بحقولٍ بأنواعٍ خاطئةٍ يُعدُّ تالفاً', () => {
  const dir = tempDir();
  try {
    const storePath = join(dir, 'revoked.jsonl');
    const badEntry = JSON.stringify({
      certificateId: 123,
      revokedBy: 'king',
      reason: 'compromised',
      at: '2026-01-01',
    });
    writeFileSync(storePath, badEntry + '\n', 'utf8');
    const store = new FileRevocationStore(storePath);
    assert.equal(store.ready(), false, 'certificateId ليس نصاً: غير جاهز');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FileRevocationStore: سجلٌّ صحيحٌ ثمّ سجلٌّ تالفٌ يُسقِطُ الكلّ', () => {
  const dir = tempDir();
  try {
    const storePath = join(dir, 'revoked.jsonl');
    const good = JSON.stringify({
      certificateId: 'cert-1',
      revokedBy: 'king',
      reason: 'compromised',
      at: '2026-01-01T00:00:00.000Z',
    });
    const bad = JSON.stringify({ certificateId: 'cert-2' }); // ناقص
    writeFileSync(storePath, good + '\n' + bad + '\n', 'utf8');
    const store = new FileRevocationStore(storePath);
    assert.equal(store.ready(), false, 'سجل تالف في المنتصف: الكل مرفوض');
    assert.equal(store.isRevoked('cert-1'), false, 'حتى الصحيح لا يُقرأ');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FileRevocationStore: fsync=false يكتبُ بلا فتحِ مقبضٍ (مسارٌ سريعٌ للاختبار)', () => {
  const dir = tempDir();
  try {
    const storePath = join(dir, 'revoked.jsonl');
    const store = new FileRevocationStore(storePath, { fsync: false });
    assert.equal(store.ready(), true, 'جاهز');
    const result = store.revoke('cert-1', 'king', 'compromised');
    assert.equal(result, true, 'كُتب بنجاح');
    assert.equal(store.isRevoked('cert-1'), true, 'مسحوبة');
    // إعادةُ تحميلٍ من القرص.
    const store2 = new FileRevocationStore(storePath, { fsync: false });
    assert.equal(store2.isRevoked('cert-1'), true, 'بُقيت على القرص');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
