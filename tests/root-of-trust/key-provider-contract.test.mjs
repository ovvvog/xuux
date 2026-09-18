// اختبار عقد مخزن المفاتيح — معيار قبول الخطوة M2.02.
//
// المعيار نصّه: «اختبار عقد يمرّ على كلا التطبيقين بنفس النتيجة». ولذلك لا
// يكتفي هذا الملف بأن ينجح كل تطبيق على حدة: كل حالة عقد تُنفَّذ على التطبيقين،
// وتُسجَّل نتيجتها المُطبَّعة نصاً، ثم يُوازن السجلّان حرفاً بحرف في آخر اختبار.
// فلو انحرف تطبيق عن الآخر — رمز خطأ مختلف، أو ترتيب جرد مختلف، أو قَبول اسم
// يرفضه الآخر — كُشف الانحراف بدل أن يظهر يوم استبدال المخزن في الإنتاج.
//
// والتطبيق الخارجي يُختبر ضد **مخزن أسرار حقيقي يعمل بـ HTTP** مُشغَّل في هذه
// العملية، لا ضد كائن مُزيَّف. فالمُختبَر هو عميل HTTP فعلاً: ترميز المسار،
// وترجمة 404 و409، والتوكن في الترويسة، وفرض الترتيب على استجابة غير مرتَّبة.
// ولا شبكة خارجية في الاختبار.
// التشغيل: node --test tests/root-of-trust/key-provider-contract.test.mjs

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

/** @typedef {import('../../src/root-of-trust/index.mjs').KeyProvider} KeyProvider */

import { startSecretStore } from '../helpers/secret-store.mjs';
import {
  KeyProviderError,
  KeyProviderErrorCodes,
  LocalEncryptedKeyProvider,
  RemoteSecretStoreKeyProvider,
} from '../../src/root-of-trust/index.mjs';

// التوكن والمفتاح الرئيسي مولَّدان لكل تشغيل: لا سرّ ثابت في المستودع ولو للاختبار.
const storeToken = randomUUID();
const store = await startSecretStore(storeToken);
const keyDirectory = registerTmpRoot(mkdtempSync(join(tmpdir(), 'key-provider-')));

const local = new LocalEncryptedKeyProvider(keyDirectory, randomUUID());
const remote = new RemoteSecretStoreKeyProvider({
  endpoint: `${store.origin}`,
  token: storeToken,
  allowInsecureTransport: true,
});

after(async () => {
  await store.close();
  rmSync(keyDirectory, { recursive: true, force: true });
});

// ───────────────────────────── حالات العقد ─────────────────────────────

/** مادة فيها عربية وسطر جديد ومحارف تحكّم؛ ترميز ناقص في أي طبقة يُفسدها. */
const TRICKY_MATERIAL = 'مفتاح-الملك\n-----BEGIN-----\r\n\t"quoted" \\ / % + = ✅ 0x00-free';

/**
 * @param {unknown} error - الخطأ الملقى
 * @returns {string} تطبيع النتيجة نصاً حتى تُوازن بين التطبيقين
 */
function normalizeError(error) {
  if (!(error instanceof KeyProviderError)) return `unexpected:${String(error)}`;
  return `error:${error.code}`;
}

/**
 * @param {() => Promise<unknown>} action - العمل المراد قياسه
 * @returns {Promise<string>} نتيجة مُطبَّعة: قيمة أو رمز خطأ
 */
async function outcome(action) {
  try {
    return `ok:${JSON.stringify(await action())}`;
  } catch (error) {
    return normalizeError(error);
  }
}

/** @type {{ name: string, run: (provider: KeyProvider) => Promise<string> }[]} */
const CONTRACT = [
  {
    name: 'الكتابة ثم القراءة تُرجع المادة حرفاً بحرف',
    run: async (provider) => {
      await provider.put('roundtrip', TRICKY_MATERIAL);
      const read = await provider.get('roundtrip');
      assert.equal(read, TRICKY_MATERIAL);
      return `len:${read.length}`;
    },
  },
  {
    name: 'سجل الكتابة يحمل الاسم وزمناً صالحاً ولا يحمل المادة',
    run: async (provider) => {
      const record = await provider.put('record', 'material-for-record');
      assert.equal(record.name, 'record');
      assert.ok(!Number.isNaN(Date.parse(record.createdAt)), 'زمن الإنشاء غير صالح');
      assert.ok(!JSON.stringify(record).includes('material-for-record'), 'السجل يحمل المادة');
      return `keys:${Object.keys(record).sort().join(',')}`;
    },
  },
  {
    name: 'الكتابة على اسم قائم مرفوضة، وبالطمس الصريح مقبولة',
    run: async (provider) => {
      await provider.put('overwrite-me', 'first');
      const rejected = await outcome(() => provider.put('overwrite-me', 'second'));
      assert.equal(await provider.get('overwrite-me'), 'first', 'المادة تغيّرت رغم رفض الكتابة');
      await provider.put('overwrite-me', 'second', { overwrite: true });
      assert.equal(await provider.get('overwrite-me'), 'second');
      return rejected;
    },
  },
  {
    name: 'قراءة مفتاح غائب ترفع KEY_NOT_FOUND',
    run: (provider) => outcome(() => provider.get('absent-key')),
  },
  {
    name: 'has يميّز الموجود من الغائب',
    run: async (provider) => {
      await provider.put('present', 'x-material');
      return `${await provider.has('present')}/${await provider.has('missing')}`;
    },
  },
  {
    name: 'الجرد مرتَّب بالاسم ولا يحمل أي مادة',
    run: async (provider) => {
      for (const name of ['zeta', 'alpha', 'mid'])
        await provider.put(`list.${name}`, `secret-of-${name}`);
      const listed = await provider.list();
      const names = listed.filter((r) => r.name.startsWith('list.')).map((r) => r.name);
      assert.deepEqual(names, ['list.alpha', 'list.mid', 'list.zeta'], 'الجرد غير مرتَّب بالاسم');
      const dump = JSON.stringify(listed);
      for (const name of ['zeta', 'alpha', 'mid']) {
        assert.ok(!dump.includes(`secret-of-${name}`), 'الجرد يسيل مادة سرية');
      }
      return names.join('|');
    },
  },
  {
    name: 'الحذف يُبطل الوجود، وحذف الغائب خطأ لا لا-عملية',
    run: async (provider) => {
      await provider.put('to-destroy', 'material-to-destroy');
      await provider.destroy('to-destroy');
      assert.equal(await provider.has('to-destroy'), false);
      const afterGet = await outcome(() => provider.get('to-destroy'));
      const afterDestroy = await outcome(() => provider.destroy('to-destroy'));
      return `${afterGet}|${afterDestroy}`;
    },
  },
  {
    name: 'الأسماء غير المقبولة تُرفض قبل أي لمس للتخزين',
    run: async (provider) => {
      const rejected = [];
      for (const name of ['../escape', 'Upper', 'with space', '', 'a'.repeat(65), 'sub/dir']) {
        rejected.push(await outcome(() => provider.put(name, 'material')));
      }
      const reads = [];
      for (const name of ['../escape', 'sub/dir']) {
        reads.push(await outcome(() => provider.get(name)));
      }
      return [...rejected, ...reads].join('|');
    },
  },
  {
    name: 'المادة الفارغة مرفوضة',
    run: (provider) => outcome(() => provider.put('empty-material', '')),
  },
  {
    name: 'كل خطأ في العقد رمزه معلَن ورسالته لا تحمل سرًّا',
    run: async (provider) => {
      const errors = [];
      const attempts = [
        () => provider.get('never-written'),
        () => provider.put('bad name', 'material'),
        () => provider.put('empty', ''),
      ];
      for (const attempt of attempts) {
        try {
          await attempt();
          errors.push('no-error');
        } catch (error) {
          assert.ok(error instanceof KeyProviderError, 'خطأ خارج نوع العقد');
          assert.ok(KeyProviderErrorCodes.includes(error.code), `رمز غير معلَن: ${error.code}`);
          assert.equal(error.message, error.code, 'الرسالة تحمل أكثر من الرمز');
          errors.push(error.code);
        }
      }
      return errors.join('|');
    },
  },
];

/** @type {{ local: string[], remote: string[] }} */
const transcripts = { local: [], remote: [] };

/** @type {['local' | 'remote', KeyProvider][]} */
const PROVIDERS = [
  ['local', local],
  ['remote', remote],
];

for (const [label, provider] of PROVIDERS) {
  for (const contractCase of CONTRACT) {
    test(`العقد [${label}] — ${contractCase.name}`, async () => {
      const result = await contractCase.run(provider);
      transcripts[label].push(`${contractCase.name} ⇒ ${result}`);
    });
  }
}

test('التطبيقان أعطيا نفس النتيجة في كل حالة عقد', () => {
  assert.equal(transcripts.local.length, CONTRACT.length, 'لم تُنفَّذ كل الحالات محلياً');
  assert.deepEqual(
    transcripts.remote,
    transcripts.local,
    'انحراف بين التطبيقين: استبدال المخزن في الإنتاج سيغيّر السلوك',
  );
});

// ─────────────────── ما يخصّ كل تطبيق وحده، ولا يُدَّعى أنه عقد ───────────────────

test('التطبيق المحلي: لا مادة صريحة على القرص، ويُعلن أنه غير إنتاجي', async () => {
  await local.put('at-rest', 'plaintext-must-not-appear');
  const files = readdirSync(keyDirectory);
  assert.ok(files.includes('at-rest.key.json'), 'ملف المفتاح غائب');
  for (const file of files) {
    const raw = readFileSync(join(keyDirectory, file), 'utf8');
    assert.ok(!raw.includes('plaintext-must-not-appear'), `المادة صريحة في ${file}`);
  }
  const described = local.describe();
  assert.equal(described.kind, 'local-encrypted-file');
  assert.equal(described.productionReady, false, 'قرص الخدمة يُعلَن إنتاجياً وهو الفجوة G1 نفسها');
});

test('التطبيق الخارجي: يرفض الإعداد الناقص وغير المشفَّر، ويُعلن جاهزيته بـ https فقط', () => {
  const cases = [
    { endpoint: '', token: storeToken },
    { endpoint: store.origin, token: '' },
    { endpoint: 'not-a-url', token: storeToken },
    { endpoint: 'http://example.com', token: storeToken },
    { endpoint: 'http://example.com', token: storeToken, allowInsecureTransport: true },
  ];
  for (const config of cases) {
    assert.throws(
      () => new RemoteSecretStoreKeyProvider(config),
      (error) => error instanceof KeyProviderError && error.code === 'PROVIDER_NOT_CONFIGURED',
      `إعداد يجب أن يُرفض قُبل: ${JSON.stringify({ ...config, token: '<محجوب>' })}`,
    );
  }
  assert.equal(remote.describe().productionReady, false, 'نقل غير مشفَّر أُعلن إنتاجياً');
  assert.equal(
    new RemoteSecretStoreKeyProvider({
      endpoint: 'https://secrets.example.com/v1',
      token: storeToken,
    }).describe().productionReady,
    true,
  );
});

test('التطبيق الخارجي: توكن خاطئ أو مخزن ساقط يُترجَم إلى PROVIDER_UNAVAILABLE', async () => {
  const wrongToken = new RemoteSecretStoreKeyProvider({
    endpoint: store.origin,
    token: randomUUID(),
    allowInsecureTransport: true,
  });
  await assert.rejects(() => wrongToken.get('roundtrip'), /PROVIDER_UNAVAILABLE/);

  const unreachable = new RemoteSecretStoreKeyProvider({
    endpoint: 'http://127.0.0.1:1',
    token: storeToken,
    timeoutMs: 250,
    allowInsecureTransport: true,
  });
  await assert.rejects(() => unreachable.list(), /PROVIDER_UNAVAILABLE/);
});

test('التطبيق الخارجي: المادة لا تقيم على قرص الخدمة إطلاقاً', async () => {
  const before = readdirSync(keyDirectory).length;
  await remote.put('remote-only', 'material-kept-outside');
  assert.equal(readdirSync(keyDirectory).length, before, 'المخزن الخارجي كتب على القرص المحلي');
  assert.equal(await remote.get('remote-only'), 'material-kept-outside');
  assert.ok(store.count() > 0, 'المخزن الخارجي لم يستلم شيئاً');
});
