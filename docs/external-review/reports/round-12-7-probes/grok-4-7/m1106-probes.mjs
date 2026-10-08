// Closest runnable equivalents for M11.06 findings. No tracked-file edits.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';

const REPO = '/home/user/workspace/xuux-review-284f74d0';

function line(name, detail) {
  console.log(`[${name}] ${detail}`);
}

// R6-A-03
{
  const { loadPolicyBundle } = await import(new URL('src/policy/loader.mjs', `file://${REPO}/`).href);
  const { PolicyDecisionPoint } = await import(new URL('src/policy/engine.mjs', `file://${REPO}/`).href);
  const bundle = loadPolicyBundle({ dir: `${REPO}/config` });
  const pdp = new PolicyDecisionPoint({ bundle });
  const base = {
    resource: { type: 'data', id: 'row-1', classification: 'internal' },
    context: {},
  };
  const emptyCaps = pdp.evaluate({
    ...base,
    actor: { id: 'agent:x', role: 'role:agent', kind: 'agent', state: 'active', capabilities: [] },
    action: 'write-data',
  });
  const withCap = pdp.evaluate({
    ...base,
    actor: {
      id: 'agent:x',
      role: 'role:agent',
      kind: 'agent',
      state: 'active',
      capabilities: ['action:write-data'],
    },
    action: 'write-data',
  });
  const grantedCreate = pdp.evaluate({
    actor: {
      id: 'agent:x',
      role: 'role:agent',
      kind: 'agent',
      state: 'active',
      capabilities: ['action:create-agent'],
    },
    action: 'create-agent',
    resource: { type: 'agent', id: 'new', classification: 'internal' },
    context: {},
  });
  const roleOnlyCreate = pdp.evaluate({
    actor: { id: 'u', role: 'role:minister', kind: 'human', state: 'active', capabilities: [] },
    action: 'create-agent',
    resource: { type: 'agent', id: 'new', classification: 'internal' },
    context: {},
  });
  line(
    'R6-A-03',
    `emptyCaps allowed=${emptyCaps.allowed} code=${emptyCaps.code}; withCap allowed=${withCap.allowed} code=${withCap.code}; grantedCreate allowed=${grantedCreate.allowed} code=${grantedCreate.code}; ministerNoCap allowed=${roleOnlyCreate.allowed} code=${roleOnlyCreate.code}`,
  );
}

// R6-A-07 shape vs signature
{
  const { loadPolicyBundle } = await import(new URL('src/policy/loader.mjs', `file://${REPO}/`).href);
  const { PolicyDecisionPoint } = await import(new URL('src/policy/engine.mjs', `file://${REPO}/`).href);
  const pdp = new PolicyDecisionPoint({ bundle: loadPolicyBundle({ dir: `${REPO}/config` }) });
  const actor = { id: 'king', role: 'role:king', kind: 'human', state: 'active', capabilities: ['action:purge-data'] };
  const resource = { type: 'data', id: 'mem', classification: 'secret' };
  const fake = pdp.evaluate({
    actor,
    action: 'purge-data',
    resource,
    context: {},
    royalCommandId: 'cmd-fake',
    royalCommandDigest: 'a'.repeat(64),
  });
  const malformed = pdp.evaluate({
    actor,
    action: 'purge-data',
    resource,
    context: {},
    royalCommandId: 'cmd-fake',
    royalCommandDigest: 'digest:0001',
  });
  const missing = pdp.evaluate({ actor, action: 'purge-data', resource, context: {} });
  line(
    'R6-A-07',
    `fakeDigest allowed=${fake.allowed} code=${fake.code}; malformed allowed=${malformed.allowed} code=${malformed.code}; missing allowed=${missing.allowed} code=${missing.code}`,
  );
}

// R6-A-08
{
  const { ExecutionKernel } = await import(new URL('src/core/execution-kernel.mjs', `file://${REPO}/`).href);
  const log = { events: [], append(type, actor, data) { this.events.push({ type, actor, data }); } };
  const crown = { submit() { return { allowed: false }; } };
  const enforcement = { verify() { return true; } };
  const dev = new ExecutionKernel({ crown, log, enforcement, env: { NODE_ENV: 'development' } });
  let devStop = 'THROW';
  try {
    dev.stop('probe', 'nobody');
    devStop = `entered safeMode=${dev.safeMode?.active ?? dev.safeMode?.isActive?.() ?? 'unknown'}`;
    dev.resume('nobody');
    devStop += ` then left`;
  } catch (err) {
    devStop = `THROW ${err.message}`;
  }
  const prod = new ExecutionKernel({
    crown,
    log,
    enforcement,
    env: { NODE_ENV: 'production', STATE_ENV: 'production' },
  });
  let prodStop = 'NO_THROW';
  try {
    prod.stop('probe');
  } catch (err) {
    prodStop = err.message;
  }
  let prodResume = 'NO_THROW';
  try {
    prod.resume();
  } catch (err) {
    prodResume = err.message;
  }
  line('R6-A-08', `dev=${devStop}; prodStop=${prodStop}; prodResume=${prodResume}`);
}

// R6-A-01 retention cycle without authorizer
{
  const { RetentionCycle } = await import(new URL('src/data/retention-cycle.mjs', `file://${REPO}/`).href);
  const cycle = new RetentionCycle({
    log: { append() {} },
    erasureLedger: { lastRunAt: () => null, record() {} },
    repositories: { dataAssets: {}, memories: {}, dataLineage: {}, classificationApprovals: {} },
    authorizer: null,
  });
  try {
    await cycle.run({
      actor: { id: 'stranger', role: 'role:operator', kind: 'human', state: 'active' },
      now: new Date(),
    });
    line('R6-A-01-cycle', 'RUN_ACCEPTED unexpected');
  } catch (err) {
    line('R6-A-01-cycle', `REJECT code=${err.code ?? ''} msg=${err.message?.slice(0, 180)}`);
  }
}

// R6-A-11 raw purge
{
  const retention = await import(new URL('src/persistence/retention.mjs', `file://${REPO}/`).href);
  const names = Object.keys(retention).filter((k) => /purge|erase/i.test(k));
  line('R6-A-11-exports', names.join(',') || '(none)');
  if (typeof retention.purge === 'function') {
    const pool = { query() { throw new Error('QUERY_SHOULD_NOT_RUN'); } };
    try {
      await retention.purge(pool, { now: new Date(), tables: ['memories'] });
      line('R6-A-11-purge', 'ACCEPTED unexpected');
    } catch (err) {
      line('R6-A-11-purge', `REJECT code=${err.code ?? ''} name=${err.name ?? ''} msg=${String(err.message).slice(0, 160)}`);
    }
  }
  if (typeof retention.eraseById === 'function') {
    try {
      await retention.eraseById({ query() { throw new Error('QUERY_SHOULD_NOT_RUN'); } }, 'memories', 'id-1');
      line('R6-A-11-erase', 'ACCEPTED unexpected');
    } catch (err) {
      line('R6-A-11-erase', `REJECT code=${err.code ?? ''} msg=${String(err.message).slice(0, 120)}`);
    }
  }
}

// R6-A-05 memory maps
{
  const q = await import(new URL('src/governance/quarantine.mjs', `file://${REPO}/`).href);
  const g = await import(new URL('src/identity/capability-grants.mjs', `file://${REPO}/`).href);
  const srcQ = (await import('node:fs')).readFileSync(`${REPO}/src/governance/quarantine.mjs`, 'utf8');
  const srcG = (await import('node:fs')).readFileSync(`${REPO}/src/identity/capability-grants.mjs`, 'utf8');
  const srcI = (await import('node:fs')).readFileSync(`${REPO}/src/inference/inference-gate.mjs`, 'utf8');
  const srcA = (await import('node:fs')).readFileSync(`${REPO}/src/constitution/amendment-path.mjs`, 'utf8');
  line(
    'R6-A-05',
    `quarantineExports=${Object.keys(q).filter((k) => /restore|FromSealed/i.test(k)).join(',')}; grantsHasLoad=${/load\(|persist|readFile/.test(srcG)}; inferenceRequiresStore=${srcI.includes('budgetStore')}; amendmentMap=${srcA.includes('this.proposals = new Map')}; quarantineCommentRestore=${srcQ.includes('quarantineFromSealedLog')}`,
  );
}

// R5-A-05 style consumer (also useful here? skip)

// R6-B-03 transport check without a live server: import assert and call createPool path
{
  const db = await import(new URL('src/persistence/db.mjs', `file://${REPO}/`).href);
  const url = 'postgresql://reviewer:secret@db.example.internal:5432/postgres'; // secret-scan:allow
  try {
    if (typeof db.assertTransport === 'function') {
      db.assertTransport(url);
      line('R6-B-03-assert', 'NO_THROW');
    } else if (typeof db.createPool === 'function') {
      const pool = db.createPool({ url });
      await pool.end().catch(() => undefined);
      line('R6-B-03-createPool', 'NO_THROW');
    } else {
      line('R6-B-03', `exports=${Object.keys(db).join(',')}`);
    }
  } catch (err) {
    line('R6-B-03', `REJECT code=${err.code ?? ''} msg=${String(err.message).slice(0, 200)}`);
  }
}

console.log('---DONE---');
