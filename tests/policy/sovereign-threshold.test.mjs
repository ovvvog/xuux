// اختبار العتبة السيادية — M4.04.
//
// نصّ المعيار: «اختبار يُثبت أن كل فعل مُدرَج يُرفض بلا أمر ملكي». فالاختبار هنا
// لا يفحص فعلاً أو فعلين مختارين، بل **يمرّ على كل بند في `royal-authority.yaml`
// بالتكرار**، ويطلبه بأعلى فاعل في الدولة (الملك، نشطاً) وبلا أمر ملكي. فلو
// أُضيف فعلٌ جديد إلى العتبة غداً دخل هذا الاختبار تلقائياً، ولو نُسي له سماحٌ
// مفتوح انكشف بلا كتابة اختبار جديد.
//
// وسبب اختيار الملك فاعلاً: لو اختُبرت العتبة بفاعل ضعيف لكان الرفض راجعاً إلى
// نقص صلاحيته لا إلى العتبة، فيمرّ الاختبار وهو لا يقيس شيئاً.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPolicyBundle } from '../../src/policy/loader.mjs';
import { createPolicyDecisionPoint } from '../../src/policy/engine.mjs';

const bundle = loadPolicyBundle();
const pdp = createPolicyDecisionPoint({ bundle });

/**
 * @param {string} action
 * @param {{ royalCommandId?: string, royalCommandDigest?: string }} [extra]
 * @returns {import('../../src/policy/model.mjs').PolicyRequest}
 */
function kingRequest(action, extra = {}) {
  return {
    actor: {
      id: 'king',
      kind: 'human',
      role: 'role:king',
      state: 'active',
      scope: 'institution:crown',
    },
    action,
    resource: { type: 'state', id: 'all', scope: 'institution:crown' },
    context: { evaluationPassed: true },
    ...extra,
  };
}

test('العتبة السيادية بيانات لا كود، وكل بند فيها مسبَّب وغير قابل للتفويض', () => {
  assert.ok(bundle.threshold.length >= 8, 'عتبة بأقل من ثمانية أفعال ليست عتبة دولة');
  for (const entry of bundle.threshold) {
    assert.ok(bundle.actions.has(entry.action), `فعل عتبة غير معلَن: ${entry.action}`);
    assert.ok(entry.reason.length >= 10, `بند عتبة بلا سبب مقروء: ${entry.action}`);
    assert.equal(entry.delegable, false, `بندٌ سيادي قابل للتفويض: ${entry.action}`);
  }
});

test('كل فعل فوق العتبة يُرفض بلا أمر ملكي — بالتكرار على البيانات كلها', () => {
  /** @type {string[]} */
  const escaped = [];
  for (const entry of bundle.threshold) {
    const decision = pdp.evaluate(kingRequest(entry.action));
    if (decision.allowed) escaped.push(`${entry.action} (${decision.code})`);
    assert.equal(
      decision.requiresRoyalCommand,
      true,
      `فعلٌ في العتبة لا يُعلن حاجته لأمر ملكي: ${entry.action}`,
    );
    assert.ok(decision.reason.length > 12, `رفضٌ بلا سبب مقروء: ${entry.action}`);
  }
  assert.deepEqual(escaped, [], `أفعال فوق العتبة نُفّذت بلا أمر ملكي: ${escaped.join(', ')}`);
});

test('رمز الرفض يفرّق بين «يلزمه أمر ملكي» و«ممنوع أصلاً»', () => {
  // الفرق ليس تجميلاً: من يقرأ POLICY_NO_MATCH يطلب سياسة، ومن يقرأ
  // SOVEREIGN_COMMAND_REQUIRED يطلب أمراً ملكياً، ومن يقرأ POLICY_DENY لا يطلب
  // شيئاً. فخلطُها يدفع إلى توسيع صلاحيات لا يحتاجها.
  /** @type {Record<string, string[]>} */
  const byCode = {};
  for (const entry of bundle.threshold) {
    const decision = pdp.evaluate(kingRequest(entry.action));
    (byCode[decision.code] ??= []).push(entry.action);
  }
  assert.ok(
    (byCode['SOVEREIGN_COMMAND_REQUIRED'] ?? []).length >= 6,
    `أكثر بنود العتبة يجب أن تُرفض بسبب غياب الأمر الملكي، والمقيس: ${JSON.stringify(byCode)}`,
  );
  assert.deepEqual(
    byCode['POLICY_DENY'] ?? [],
    ['export-keys'],
    'إخراج المفاتيح هو الممنوع المطلق الوحيد في العتبة',
  );
});

// ملخصانِ بصورةِ `sha256` الحقيقيّةِ: بعدَ النتيجةِ `R6-A-07` لم يعدْ أيُّ نصٍّ
// يُقرأُ ملخصاً، فالسندُ في الاختبارِ يجبُ أن يكونَ ما يمكنُ أن يكونَ ملخصاً.
const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

test('الأمر الملكي يفتح فعل العتبة ولا يفتح الممنوع المطلق', () => {
  const stop = pdp.evaluate(
    kingRequest('stop-state', { royalCommandId: 'cmd:0001', royalCommandDigest: DIGEST_A }),
  );
  assert.equal(stop.allowed, true, 'الأمر الملكي المقبول يُنفِذ الفعل السيادي');
  assert.equal(stop.policyId, 'pol:king-sovereign-acts');
  assert.equal(stop.royalCommandId, 'cmd:0001', 'القرار يصف الأمر الذي صدر من أجله');

  const keys = pdp.evaluate(
    kingRequest('export-keys', { royalCommandId: 'cmd:0002', royalCommandDigest: DIGEST_B }),
  );
  assert.equal(keys.allowed, false, 'إخراج المفاتيح لا يُفتح بأمر ملكي — منعٌ مطلق');
  assert.equal(keys.code, 'POLICY_DENY');
});

test('الأمر الملكي الفارغ لا يُقرأ أمراً — ولا فرق بين غيابه وبين نصّ فراغ', () => {
  for (const value of ['', '   ']) {
    const decision = pdp.evaluate(kingRequest('rotate-king-key', { royalCommandId: value }));
    assert.equal(decision.allowed, false, `أمر ملكي فارغ قُرئ أمراً: «${value}»`);
    assert.equal(decision.code, 'SOVEREIGN_COMMAND_REQUIRED');
  }
});

test('فاعلٌ دون الملك لا يبلغ العتبة أصلاً ولو حمل أمراً ملكياً', () => {
  const decision = pdp.evaluate({
    actor: { id: 'minister:health', kind: 'human', role: 'role:minister', state: 'active' },
    action: 'stop-state',
    resource: { type: 'state', id: 'all' },
    context: {},
    royalCommandId: 'cmd:0003',
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'POLICY_NO_MATCH', 'لا سياسة تأذن لوزير بإيقاف الدولة');
});

test('R6-A-07: ملخصٌ لا يمكنُ أن يكونَ ملخصَ أمرٍ لا يفتحُ فعلاً سياديّاً', () => {
  // العيبُ: كانتِ العتبةُ تقيسُ حضورَ نصّينِ، فسلسلةٌ مثل `digest:0001` — أو
  // ملخصٌ بحرفٍ كبيرٍ أو ناقصِ الطولِ — تُنفِذُ فعلاً سياديّاً.
  for (const digest of ['digest:0001', 'A'.repeat(64), 'a'.repeat(63), `${'a'.repeat(64)}0`]) {
    const decision = pdp.evaluate(
      kingRequest('stop-state', { royalCommandId: 'cmd:0001', royalCommandDigest: digest }),
    );
    assert.equal(decision.allowed, false, `ملخصٌ مشوَّهٌ فتحَ فعلاً سياديّاً: «${digest}»`);
    assert.equal(
      decision.code,
      'SOVEREIGN_COMMAND_DIGEST_MALFORMED',
      'خطأُ الربطِ لا يُخلَطُ بغيابِ الأمرِ فيُقرأَ نقصاً في الصلاحيةِ',
    );
    assert.equal(decision.requiresRoyalCommand, true);
  }
});

test('R6-A-07: الملخصُ ذو الصورةِ الصحيحةِ يبقى نافذاً — الفحصُ صورةٌ لا تشديدٌ على السلطةِ', () => {
  const decision = pdp.evaluate(
    kingRequest('stop-state', { royalCommandId: 'cmd:0001', royalCommandDigest: DIGEST_A }),
  );
  assert.equal(decision.allowed, true, 'ملخصٌ صحيحُ الصورةِ رُدَّ — تضييقٌ تجاوزَ نطاقَه');
});
