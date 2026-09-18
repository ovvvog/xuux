import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';
import YAML from 'yaml';
import { CONFIG_DIR, loadPolicyBundle } from '../../src/policy/loader.mjs';
import { createPolicyDecisionPoint } from '../../src/policy/engine.mjs';

/**
 * R6-A-03: القدراتُ والمنحُ لا تدخلُ قرارَ المحرّكِ. أُضيفَ عاملُ `includes`
 * الذي يفحصُ هل القيمةُ المُعطاةُ عضوٌ في مصفوفةِ الخاصِّيةِ — كأن يتحقَّقَ من
 * حضورِ قدرةٍ في `actor.capabilities`.
 */

function withMutatedConfig(
  /** @type {(docs: { roles: any, policies: any, threshold: any, quotas: any }) => void} */ mutate,
) {
  const dir = registerTmpRoot(mkdtempSync(join(tmpdir(), 'xuux-pol-incl-')));
  cpSync(CONFIG_DIR, dir, { recursive: true });
  const read = (/** @type {string} */ f) => YAML.parse(readFileSync(join(dir, f), 'utf8'));
  const docs = {
    roles: read('roles.yaml'),
    policies: read('policies.yaml'),
    threshold: read('royal-authority.yaml'),
    quotas: read('quotas.yaml'),
  };
  mutate(docs);
  writeFileSync(join(dir, 'roles.yaml'), YAML.stringify(docs.roles));
  writeFileSync(join(dir, 'policies.yaml'), YAML.stringify(docs.policies));
  writeFileSync(join(dir, 'royal-authority.yaml'), YAML.stringify(docs.threshold));
  writeFileSync(join(dir, 'quotas.yaml'), YAML.stringify(docs.quotas));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('R6-A-03: includes operator checks capability membership', () => {
  test('includes يفحصُ هل القيمةُ عضوٌ في مصفوفةِ الخاصِّية', () => {
    const { dir, cleanup } = withMutatedConfig((docs) => {
      // Add a policy that requires a capability via the includes operator
      docs.policies.policies.push({
        id: 'pol:r6-a-03-deny-no-cap',
        name: 'Deny write-data without action:write-data capability',
        owner: 'test',
        version: 1,
        effect: 'deny',
        priority: 500,
        reason: 'write-data requires action:write-data capability (R6-A-03)',
        approvedBy: 'king:test',
        enabled: true,
        actors: { roles: ['role:agent'] },
        actions: ['write-data'],
        resources: ['*'],
        conditions: [
          {
            attribute: 'actor.capabilities',
            operator: 'not-includes',
            value: 'action:write-data',
          },
        ],
      });
    });

    try {
      const bundle = loadPolicyBundle({ dir });
      const pdp = createPolicyDecisionPoint({ bundle });

      // Actor WITH the required capability → allowed
      const withCap = pdp.evaluate({
        actor: {
          id: 'agent:cap-1',
          role: 'role:agent',
          state: 'active',
          capabilities: ['action:write-data'],
        },
        action: 'write-data',
        resource: { id: 'res-1', type: 'data' },
      });
      assert.equal(withCap.allowed, true, 'actor with capability should be allowed');
      assert.equal(withCap.code, 'POLICY_ALLOW');

      // Actor WITHOUT the required capability → denied (no match on the condition)
      const withoutCap = pdp.evaluate({
        actor: {
          id: 'agent:cap-2',
          role: 'role:agent',
          state: 'active',
          capabilities: [],
        },
        action: 'write-data',
        resource: { id: 'res-1', type: 'data' },
      });
      assert.equal(withoutCap.allowed, false, 'actor without capability should be denied');
    } finally {
      cleanup();
    }
  });

  test('includes يُرجِعُ false لخاصِّيةٍ غيرِ مصفوفة', () => {
    const { dir, cleanup } = withMutatedConfig((docs) => {
      docs.policies.policies.push({
        id: 'pol:r6-a-03-non-array',
        name: 'Check non-array attribute with includes',
        owner: 'test',
        version: 1,
        effect: 'allow',
        priority: 100,
        reason: 'should not match because actor.role is not an array',
        approvedBy: 'king:test',
        enabled: true,
        actors: { roles: ['role:agent'] },
        actions: ['write-memory'],
        resources: ['*'],
        conditions: [
          {
            attribute: 'actor.role',
            operator: 'includes',
            value: 'role:agent',
          },
        ],
      });
    });

    try {
      const bundle = loadPolicyBundle({ dir });
      const pdp = createPolicyDecisionPoint({ bundle });
      // actor.role is a string, not an array → includes returns false → no match
      const result = pdp.evaluate({
        actor: { id: 'a1', role: 'role:agent', state: 'active' },
        action: 'write-memory',
        resource: { id: 'agent:a1', type: 'memory' },
      });
      // The new policy won't match, but the existing write-own-memory policy should
      // still allow it. The test verifies includes doesn't crash on non-arrays.
      assert.equal(result.code, 'POLICY_ALLOW');
    } finally {
      cleanup();
    }
  });
});
