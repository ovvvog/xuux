// اختبارُ جذرِ التركيبِ — `R6-A-04`.
//
// المقيسُ هنا ليس «هل يُبنى الكائنُ» بل: **هل يبقى مسارٌ ينالُ سلسلةَ إنفاذٍ
// ناقصةَ الوصلةِ من الجذرِ نفسِه**. فالنتيجةُ `R6-A-04` لم تكن «الوحدةُ غائبةٌ»،
// كانتْ «الوحداتُ موجودةٌ ولا موضعَ يصلُها»، فكلُّ مُشغِّلٍ يُعيدُ التركيبَ بيدِه
// ومن نسيَ وصلةً نالَ نقطةَ تفويضٍ تقرأُ الفاعلَ من ادّعاءِ الطلبِ.
//
// فالمفحوصُ خمسةُ حدودٍ: أنَّ الجذرَ يُعيدُ السلسلةَ كاملةً لا نصفَها، وأنَّ
// بوابةَ الهويّةِ مُثبَّتةٌ لا يُطفئُها مُنادٍ، وأنَّ الفاعلَ غيرَ المُسجَّلِ في
// جذرِ الثقةِ يُرفَضُ **قياساً على قرارٍ لا على قراءةِ نصٍّ**، وأنَّ الفاعلَ
// المُسجَّلَ يُقيَّمُ بما يقولُه السجلُّ، وأنَّ الوصلةَ الناقصةَ رفضٌ عندَ البناءِ.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { COMPOSITION_ERRORS, composeEnforcementChain } from '../../src/core/composition-root.mjs';

/** سجلُّ أحداثٍ صغيرٌ: القياسُ على ما سُجِّلَ، فلا يُستعارُ سجلٌّ ثقيلٌ لقياسِ الوصلِ. */
function memoryLog() {
  /** @type {Array<{ type: string, actor: string, payload: object }>} */
  const events = [];
  return {
    events,
    /**
     * @param {string} type
     * @param {string} actor
     * @param {object} payload
     * @returns {void}
     */
    append(type, actor, payload) {
      events.push({ type, actor, payload });
    },
  };
}

test('الجذرُ يُعيدُ السلسلةَ كاملةً — لا وحدةَ تُبنى في الخفاءِ ولا تُرى', () => {
  const chain = composeEnforcementChain({ log: memoryLog() });
  for (const part of [
    'kingIdentity',
    'authority',
    'catalog',
    'incidents',
    'grants',
    'registry',
    'identityGate',
    'quarantine',
    'enforcementPoint',
    'bundle',
  ]) {
    assert.ok(
      /** @type {Record<string, unknown>} */ (chain)[part] !== undefined &&
        /** @type {Record<string, unknown>} */ (chain)[part] !== null,
      `الجذرُ لم يُعِدْ «${part}» فلا يُفحَصُ ما لا يُرى`,
    );
  }
});

test('بوابةُ الهويّةِ موصولةٌ في نقطةِ التفويضِ ومُلزِمةٌ', () => {
  const { enforcementPoint, identityGate } = composeEnforcementChain({ log: memoryLog() });
  assert.equal(enforcementPoint.requireIdentityGate, true);
  assert.equal(
    enforcementPoint.identityGate,
    identityGate,
    'نقطةُ التفويضِ يجبُ أن تحملَ نفسَ بوابةِ السلسلةِ لا بوابةً أخرى',
  );
});

test('إطفاءُ بوابةِ الهويّةِ ليس خياراً يُمرَّرُ إلى الجذرِ', () => {
  assert.throws(
    () =>
      composeEnforcementChain(
        /** @type {never} */ ({ log: memoryLog(), requireIdentityGate: false }),
      ),
    new RegExp(COMPOSITION_ERRORS.IDENTITY_GATE_NOT_OPTIONAL),
  );
  // ولا حتّى `true`: القبولُ يجعلُ الحدَّ خياراً، والخيارُ يُنسى.
  assert.throws(
    () =>
      composeEnforcementChain(
        /** @type {never} */ ({ log: memoryLog(), requireIdentityGate: true }),
      ),
    new RegExp(COMPOSITION_ERRORS.IDENTITY_GATE_NOT_OPTIONAL),
  );
});

test('وصلةٌ ناقصةٌ رفضٌ عندَ البناءِ لا عندَ الاستعمالِ', () => {
  assert.throws(
    () => composeEnforcementChain(/** @type {never} */ ({})),
    new RegExp(COMPOSITION_ERRORS.LOG_MISSING),
  );
  assert.throws(
    () => composeEnforcementChain(/** @type {never} */ ({ log: {} })),
    new RegExp(COMPOSITION_ERRORS.LOG_MISSING),
  );
  assert.throws(
    () =>
      composeEnforcementChain(/** @type {never} */ ({ log: memoryLog(), withLegislation: true })),
    new RegExp(COMPOSITION_ERRORS.LAW_REPOSITORY_MISSING),
  );
});

test('فاعلٌ يُدَّعى في الطلبِ ولا يَعرفُه جذرُ الثقةِ يُرفَضُ — قياسُ قرارٍ لا قراءةُ نصٍّ', async () => {
  const { enforcementPoint } = composeEnforcementChain({ log: memoryLog() });
  const result = await enforcementPoint.authorize({
    actor: { id: 'agent:ghost', kind: 'autonomous', role: 'role:agent', state: 'active' },
    action: 'write-memory',
    resource: { type: 'memory', id: 'agent:ghost' },
    context: {},
  });
  assert.equal(result.decision.allowed, false, 'فاعلٌ لا يَحملُه السجلُّ لا يُفوَّضُ');
  assert.equal(result.token, null, 'تذكرةٌ على فاعلٍ مجهولٍ تُبطلُ معنى البوابةِ');
});

test('الفاعلُ المُسجَّلُ في السجلِّ يُقيَّمُ بما يقولُه السجلُّ لا بما يقولُه الطلبُ', async () => {
  const { enforcementPoint, registry } = composeEnforcementChain({ log: memoryLog() });
  const agent = await registry.register({
    name: 'composition-probe',
    role: 'role:agent',
    capabilities: ['action:write-memory'],
    kind: 'autonomous',
  });
  const result = await enforcementPoint.authorize({
    // الطلبُ يَدَّعي دوراً أعلى: البوابةُ تستبدلُ الفاعلَ بما يقولُه جذرُ الثقةِ.
    actor: { id: agent.id, kind: 'autonomous', role: 'role:minister', state: 'active' },
    action: 'write-memory',
    resource: { type: 'memory', id: agent.id },
    context: {},
  });
  assert.equal(
    result.decision.allowed,
    true,
    'فاعلٌ مُسجَّلٌ بقدرةِ الكتابةِ يُفوَّضُ — وإلّا فالسلسلةُ مقطوعةٌ لا مُشدَّدةٌ',
  );
});

test('مسارُ التطويرِ الحيُّ يأخذُ سلسلتَه من الجذرِ ولا يُعيدُ تركيبَها بيدِه', () => {
  const source = readFileSync(join(process.cwd(), 'scripts', 'serve-state.mjs'), 'utf8');
  assert.ok(
    source.includes('composeEnforcementChain('),
    'serve-state must take its chain from the composition root',
  );
  assert.ok(
    !source.includes('new EnforcementPoint('),
    'serve-state must not rebuild the enforcement point by hand',
  );
  assert.ok(
    !source.includes('new IdentityGate('),
    'serve-state must not rebuild the identity gate by hand',
  );
  assert.ok(
    !source.includes("const ACTOR_ID = '"),
    'serve-state must not use a hardcoded ACTOR_ID constant',
  );
  assert.ok(
    source.includes('registry.register('),
    'serve-state must register its viewer agent in the registry',
  );
});
