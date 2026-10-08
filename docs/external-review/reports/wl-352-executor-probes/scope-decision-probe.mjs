// Scope-decision probe for R5-A-05 and R6-A-08 on main@284f74d0.
// It measures the SAME two legs every member measured, side by side, so the council
// only has to answer the scope question: does the finding govern the production
// composition (createProductionSystem) only, or every environment/API that ships?
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Run from a tree root: REPO=$PWD env -u DATABASE_URL node <this file>
const REPO = process.env.REPO;
const rig = await import(`${REPO}/tests/helpers/production-sovereign-rig.mjs`);
const { ExecutionKernel } = await import(`${REPO}/src/core/execution-kernel.mjs`);
const code = (e) => e?.code ?? String(e?.message ?? e).slice(0, 120);
const out = {};

// ── R5-A-05 — leg P: the production composition (revoke, reboot, read) ──
{
  const root = mkdtempSync(join(tmpdir(), 'scope-'));
  const { factorSecrets } = rig.testVault();
  const keys = { ...rig.fixedKeys(), socket: new rig.TestFreshnessSocket(0n, 'scope') };
  const a = await rig.boot(root, { keys, factorSecrets });
  const ca = a.crown.authority ?? a.chain.authority;
  const cert = await ca.issueAsync('agent:scope', 'role:agent', ['action:read-data']);
  out['R5-A-05 P valid before revoke'] = ca.isValid(cert);
  await ca.revokeAsync(cert.id, 'scope');
  await a.close();
  const b = await rig.boot(root, { keys, factorSecrets });
  const cb = b.crown.authority ?? b.chain.authority;
  out['R5-A-05 P createProductionSystem: revoked cert valid after reboot'] = cb.isValid(cert);
  await b.close();
  rmSync(root, { recursive: true, force: true });
}
// ── R5-A-05 — leg R: the root-of-trust factory alone builds the store; it has no reader of its own ──
{
  const src = (await import('node:fs')).readFileSync(`${REPO}/src/root-of-trust/production-runtime.mts`, 'utf8');
  out['R5-A-05 R production-runtime.mts builds FileRevocationStore'] = src.includes('new FileRevocationStore');
  out['R5-A-05 R production-runtime.mts itself calls isRevoked'] = src.includes('isRevoked');
}
// ── R6-A-08 — leg P: production kernel ──
{
  const root = mkdtempSync(join(tmpdir(), 'scope-'));
  const { factorSecrets } = rig.testVault();
  const keys = { ...rig.fixedKeys(), socket: new rig.TestFreshnessSocket(0n, 'scope') };
  const s = await rig.boot(root, { keys, factorSecrets });
  try { s.kernel.stop('scope', 'anyone'); out['R6-A-08 P production kernel.stop() without command'] = `ACCEPTED safeMode=${s.kernel.safeMode.active}`; }
  catch (e) { out['R6-A-08 P production kernel.stop() without command'] = `REFUSED ${code(e)}`; }
  await s.close();
  rmSync(root, { recursive: true, force: true });
}
// ── R6-A-08 — leg N: the same exported class outside production ──
{
  const k = new ExecutionKernel({ crown: { veto: { enabled: true } }, log: { append() {} } });
  k.stop('scope', 'anyone'); const s1 = k.safeMode.active; k.resume('anyone');
  out['R6-A-08 N non-production kernel.stop()/resume() without command'] = `ACCEPTED stop->${s1} resume->${k.safeMode.active}`;
}
console.log(JSON.stringify(out, null, 2));
