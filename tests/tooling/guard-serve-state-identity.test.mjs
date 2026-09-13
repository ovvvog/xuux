import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * R6-A-04: جذرُ التركيبِ يصلُ سلسلةَ الإنفاذِ في عمليّةٍ واحدةٍ.
 *
 * مسارُ التطويرِ `serve-state.mjs` كان يُنشئ `EnforcementPoint` بلا بوابةِ هويّةٍ
 * فيكونُ `requireIdentityGate = false` — فالفاعلُ يُقرَأُ من ادّعاءٍ في الطلبِ لا
 * من جذرِ الثقةِ. هذا الحارسُ يقرأُ النصَّ ويُثبتُ أنَّ التركيبَ يصلُ البوابةَ.
 */
describe('R6-A-04: serve-state wires identity gate into enforcement point', () => {
  const source = readFileSync(join(process.cwd(), 'scripts', 'serve-state.mjs'), 'utf8');

  test('يستوردُ IdentityGate و AgentRegistry و CertificateAuthority', () => {
    assert.ok(source.includes('IdentityGate'), 'serve-state must import IdentityGate');
    assert.ok(source.includes('AgentRegistry'), 'serve-state must import AgentRegistry');
    assert.ok(
      source.includes('CertificateAuthority'),
      'serve-state must import CertificateAuthority',
    );
  });

  test('يُنشئُ بوابةَ هويّةٍ موصولةً بالسجلِّ وسلطةِ التصديقِ والكتالوج', () => {
    assert.ok(source.includes('new IdentityGate('), 'serve-state must instantiate IdentityGate');
    assert.ok(source.includes('new AgentRegistry('), 'serve-state must instantiate AgentRegistry');
    assert.ok(
      source.includes('new CertificateAuthority('),
      'serve-state must instantiate CertificateAuthority',
    );
  });

  test('يمرّرُ identityGate و requireIdentityGate: true إلى EnforcementPoint', () => {
    assert.ok(
      source.includes('identityGate'),
      'serve-state must pass identityGate to EnforcementPoint',
    );
    assert.ok(
      source.includes('requireIdentityGate: true'),
      'serve-state must set requireIdentityGate: true',
    );
  });

  test('لا يستعملُ ACTOR_ID ثابتاً بلا سجلٍّ — الفاعلُ يُسجَّلُ في السجلِّ', () => {
    assert.ok(
      source.includes('registry.register('),
      'serve-state must register the viewer agent in the registry',
    );
    assert.ok(
      !source.includes("const ACTOR_ID = '"),
      'serve-state must not use a hardcoded ACTOR_ID constant',
    );
  });
});
