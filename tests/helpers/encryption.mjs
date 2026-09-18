// معِين اختبارات التشفير — M7.03.
//
// كل اختبار يحتاج مغلِّفاً يحتاج مزوّد مفاتيح، ومزوّدٌ مشترك بين الاختبارات يجعل
// اختباراً يقرأ مفتاحاً كتبه آخر فيمرّان معاً ويسقطان منفردين. فلكل نداءٍ **مجلد
// مؤقّت جديد**، وله مفتاح رئيسي خاصّ به.
//
// ولا يُخترع هنا تشفير: المزوّد هو `LocalEncryptedKeyProvider` نفسه المستعمل في
// التطوير، فما تقيسه الاختبارات هو المسار القائم لا محاكاةً له.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registerTmpRoot } from './tmp-roots.mjs';

import { loadClassificationLattice } from '../../src/data/classification.mjs';
import { DataEncryptor, loadEncryptionPolicy } from '../../src/data/encryption.mjs';
import { LocalEncryptedKeyProvider } from '../../src/root-of-trust/key-provider-local.mjs';

/**
 * @typedef {object} EncryptionFixture
 * @property {DataEncryptor} encryptor
 * @property {import('../../src/data/encryption.mjs').EncryptionPolicy} policy
 * @property {import('../../src/data/classification.mjs').ClassificationLattice} lattice
 * @property {LocalEncryptedKeyProvider} keyProvider
 * @property {string} directory
 * @property {() => void} cleanup يُزيل المجلد المؤقّت ومادة المفاتيح فيه.
 */

/**
 * مغلِّفٌ حقيقي على مزوّدٍ محلي في مجلد مؤقّت، ومفاتيح المراتب المُشفَّرة منشأة.
 * @param {{ tiers?: string[], environment?: string }} [options]
 * @returns {Promise<EncryptionFixture>}
 */
export async function createTestEncryptor(options = {}) {
  const lattice = loadClassificationLattice();
  const policy = loadEncryptionPolicy({ lattice });
  const directory = registerTmpRoot(mkdtempSync(path.join(tmpdir(), 'state-data-keys-')));
  // المفتاح الرئيسي عشوائيٌّ لكل نداء ولا يُكتب في المستودع: مفتاحٌ ثابت في ملف
  // اختبار مفتاحٌ منشور، ويكشفه `npm run scan:secrets`.
  const keyProvider = new LocalEncryptedKeyProvider(
    directory,
    `test-master-${Math.random().toString(36).slice(2)}${Date.now()}`,
  );
  const encryptor = new DataEncryptor({
    policy,
    lattice,
    keyProvider,
    environment: options.environment ?? 'test',
  });
  // الإنشاء **صريح** كما في التمهيد: لا يُنشئ المغلِّف مفتاحاً عند أول كتابة،
  // فاختبارٌ يعتمد على إنشاءٍ تلقائي كان سيقيس سلوكاً غير قائم.
  const tiers = options.tiers ?? ['internal', 'sensitive', 'sovereign'];
  for (const tier of tiers) await encryptor.ensureTierKey(tier);
  return {
    encryptor,
    policy,
    lattice,
    keyProvider,
    directory,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}
