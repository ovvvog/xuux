import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KingIdentity } from '../../src/root-of-trust/index.mjs';
import {
  ConstitutionStore,
  articleHash,
  documentRoot,
  loadConstitutionPolicy,
} from '../../src/constitution/constitution.mjs';

// هذه الاختباراتُ تقيس **حفظَ النصّ** لا مسارَ تعديله (ذاك في
// `amendment-path.test.mjs`): أن يُكشف تحريرُ الملفّ بعد الختم، وأن تُكشف
// الكتابةُ في المخزن، وأن يُكشف حذفُ عهدٍ منه.

const ROOT = path.resolve(import.meta.dirname, '..', '..');

/**
 * ينسخ النصَّ المؤسِّس إلى مجلَّدٍ مؤقّت كي تُحرَّر نسخةٌ منه بلا لمسِ المستودع.
 * @returns {{ dir: string, file: string }}
 */
function isolatedConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'constitution-'));
  const file = path.join(dir, 'constitution.yaml');
  fs.copyFileSync(path.join(ROOT, 'config', 'constitution.yaml'), file);
  return { dir, file };
}

test('تجزئةُ المادة تشمل كلَّ حقولها، وجذرُ النصّ لا يتأثّر بترتيب الموادّ', () => {
  const policy = loadConstitutionPolicy();
  const [first, second] = policy.articles;
  assert.ok(first !== undefined && second !== undefined);
  assert.notEqual(articleHash(first), articleHash(second));
  // تغييرُ الختم وحده تغييرٌ في المادة: فلا يُنزَع ختمٌ في صمت.
  assert.notEqual(articleHash(first), articleHash({ ...first, entrenched: !first.entrenched }));
  assert.notEqual(articleHash(first), articleHash({ ...first, lawRef: 'law:other' }));
  // الترتيبُ لا يغيّر الجذر، والحذفُ يغيّره.
  assert.equal(documentRoot([...policy.articles].reverse()), documentRoot([...policy.articles]));
  assert.notEqual(documentRoot(policy.articles.slice(1)), documentRoot([...policy.articles]));
});

test('المادةُ الناظمةُ لمسار التعديل يجب أن تكون مختومة، وإلا رُفض النصُّ كلُّه', () => {
  const { dir, file } = isolatedConfig();
  const text = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(
    file,
    text.replace(
      '    title: الدستور ومسار تعديله\n    entrenched: true',
      '    title: الدستور ومسار تعديله\n    entrenched: false',
    ),
    'utf8',
  );
  assert.throws(() => loadConstitutionPolicy({ dir }), /CONSTITUTION_CONFIG_INVALID/);
});

test('تحريرُ ملفّ الدستور بعد ختمه يُكشف ويُعطِّل قراءتَه', () => {
  const { dir, file } = isolatedConfig();
  const king = new KingIdentity();
  const policy = loadConstitutionPolicy({ dir });
  const store = new ConstitutionStore({ policy, signer: king, dir });
  assert.equal(store.epoch(), 1);
  assert.equal(store.current().foundingRoot, policy.foundingRoot);

  // تعديلٌ «خارج المسار»: تحريرٌ مباشرٌ لنصّ مادةٍ **غير مختومة** في الملف.
  const original = fs.readFileSync(file, 'utf8');
  assert.ok(original.includes('مفتاحُ الملك أصلُ كلِّ تحقُّقٍ في الدولة'));
  fs.writeFileSync(
    file,
    original.replace(
      'مفتاحُ الملك أصلُ كلِّ تحقُّقٍ في الدولة',
      'مفتاحُ الملك واحدٌ من مفاتيحَ كثيرة',
    ),
    'utf8',
  );
  const edited = loadConstitutionPolicy({ dir });
  assert.notEqual(edited.foundingRoot, policy.foundingRoot);

  const reopened = new ConstitutionStore({ policy: edited, signer: king, dir });
  assert.throws(() => reopened.assertIntact(), /CONSTITUTION_FOUNDING_TEXT_DRIFT/);
  assert.throws(() => reopened.effective(), /CONSTITUTION_FOUNDING_TEXT_DRIFT/);
});

test('الكتابةُ في مخزن الدستور تُكشف بالتوقيع', () => {
  const { dir } = isolatedConfig();
  const king = new KingIdentity();
  const policy = loadConstitutionPolicy({ dir });
  const store = new ConstitutionStore({ policy, signer: king, dir });
  const stateFile = path.join(dir, policy.integrity.stateFile);

  const chain = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  chain.push({
    revision: {
      epoch: 2,
      kind: 'amendment',
      foundingRoot: policy.foundingRoot,
      articleId: 'art:03',
      text: 'نصٌّ دُسَّ في المخزن بلا مسارٍ ولا توقيعٍ ولا مراجعةٍ قضائيّةٍ ولا مهلةِ تدبُّر.',
      amendmentId: 'forged',
      ratifiedBy: 'king:forged',
      at: new Date().toISOString(),
      previousHash: 'لا شيء',
    },
    signature: 'توقيعٌ مزعوم',
  });
  fs.writeFileSync(stateFile, JSON.stringify(chain, null, 2), 'utf8');
  assert.throws(() => store.assertIntact(), /CONSTITUTION_TAMPERED/);
});

test('حذفُ آخر عهدٍ لإرجاع النصّ يُكشف بعدّاد العهد', () => {
  const { dir } = isolatedConfig();
  const king = new KingIdentity();
  const policy = loadConstitutionPolicy({ dir });
  const store = new ConstitutionStore({ policy, signer: king, dir });
  const article = policy.articles.find((entry) => !entry.entrenched);
  assert.ok(article !== undefined);

  // إلحاقٌ مشروعٌ من داخل الحائز (وهذا ما يفعله مسارُ التعديل بعد استيفاء خطواته).
  const revision = store.appendAmendment({
    articleId: article.id,
    text: 'نصٌّ مُبرَمٌ يبلغ الحدَّ الأدنى المُعلَن من الطول كي يجتاز فحصَ المسار.',
    amendmentId: 'a1',
    ratifiedBy: king.id,
  });
  assert.equal(revision.epoch, 2);
  assert.equal(store.epoch(), 2);

  const stateFile = path.join(dir, policy.integrity.stateFile);
  const chain = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  fs.writeFileSync(stateFile, JSON.stringify(chain.slice(0, 1), null, 2), 'utf8');
  // السلسلةُ المقتطعةُ **صحيحةٌ في نفسها** (تأسيسٌ موقَّعٌ وحده)؛ ولا يكشفها إلا
  // عدّادُ أعلى عهدٍ بُلغ. وهذا هو الفرقُ بين سلسلةٍ متماسكةٍ وسلسلةٍ حقيقية.
  assert.throws(() => store.assertIntact(), /CONSTITUTION_EPOCH_ROLLBACK/);
});

test('النصُّ النافذ هو المؤسِّس مضافاً إليه ما أُبرم، ومخزنٌ بلا موقِّعٍ يُرفض', () => {
  const policy = loadConstitutionPolicy();
  const king = new KingIdentity();
  const store = new ConstitutionStore({ policy, signer: king });
  const article = policy.articles.find((entry) => !entry.entrenched);
  assert.ok(article !== undefined);
  const text = 'نصٌّ نافذٌ جديدٌ للمادة، طويلٌ بما يكفي ليجتاز الحدَّ الأدنى المُعلَن.';
  store.appendAmendment({ articleId: article.id, text, amendmentId: 'a1', ratifiedBy: king.id });

  assert.equal(store.articleOf(article.id).text, text);
  // الملفُّ المؤسِّس لم يتغيّر: التعديلُ في المخزن لا في النصّ الأصل.
  assert.notEqual(policy.articles.find((entry) => entry.id === article.id)?.text, text);
  assert.throws(() => store.articleOf('art:99'), /CONSTITUTION_ARTICLE_UNKNOWN/);
  assert.throws(() => new ConstitutionStore({ policy }), /CONSTITUTION_SIGNER_REQUIRED/);
});
