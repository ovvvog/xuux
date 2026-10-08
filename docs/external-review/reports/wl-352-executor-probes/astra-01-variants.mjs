// R12-ASTRA-01: can an audit-log writer (no royal key, no 2nd factor) lift a sealed veto across reboot?
//  V0 control: genuine veto -> reboot                                  -> veto must hold
//  V1 forged {vetoed:false} with no commandId                          (Astra's path)
//  V2 forged {vetoed:false} reusing the GENUINE veto's committed commandId (is a ledger-id check enough?)
//  V3 replay: genuine clear record copied after a newer genuine veto   (is a signature check enough?)
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Run from a tree root: REPO=$PWD env -u DATABASE_URL node <this file>
const REPO = process.env.REPO;
const rig = await import(`${REPO}/tests/helpers/production-sovereign-rig.mjs`);
const code = (e) => e?.code ?? String(e?.message ?? e).slice(0, 140);
const TYPE = 'console.veto.state';
async function issue(s, tok, command, action, reason) {
  const sc = rig.crownCommand({ action, target: 'crown:gateway', reason });
  await s.royalConsole.issue({ command, royalCommand: sc.command, signature: sc.signature, sovereignSession: tok });
  return sc.command.id;
}
async function lastVetoBody(s) {
  await s.rootOfTrust.log.flush?.();
  const evs = s.auditLog.events.filter((e) => e.type === TYPE);
  return s.auditLog.openEvent(evs[evs.length - 1]);
}
async function run(label, forge) {
  const root = mkdtempSync(join(tmpdir(), 'astra-'));
  const { secret, factorSecrets } = rig.testVault();
  const keys = { ...rig.fixedKeys(), socket: new rig.TestFreshnessSocket(0n, 'astra') };
  const a = await rig.boot(root, { keys, factorSecrets });
  let step = 1;
  const tok = async (s) => (await rig.session(s, secret, step++)).opened.token;
  const ctx = { a, tok, issue, lastVetoBody };
  await forge(ctx);
  await a.close();
  try {
    const b = await rig.boot(root, { keys, factorSecrets });
    console.log(`${label}: reboot vetoed=${!b.crown.veto.enabled} reason=${b.crown.veto.reason}`);
    await b.close();
  } catch (e) { console.log(`${label}: reboot REFUSED ${code(e)}`); }
  rmSync(root, { recursive: true, force: true });
}
await run('V0 control      ', async ({ a, tok, issue }) => {
  await issue(a, await tok(a), 'cmd:veto', 'veto-commands', 'v0');
});
await run('V1 no commandId ', async ({ a, tok, issue }) => {
  await issue(a, await tok(a), 'cmd:veto', 'veto-commands', 'v1');
  await a.auditLog.appendSealed(TYPE, 'agent:log-writer', { vetoed: false });
});
await run('V2 reused id    ', async ({ a, tok, issue }) => {
  const id = await issue(a, await tok(a), 'cmd:veto', 'veto-commands', 'v2');
  await a.auditLog.appendSealed(TYPE, 'agent:log-writer', { vetoed: false, reason: null, commandId: id });
});
await run('V3 replayed clear', async ({ a, tok, issue, lastVetoBody }) => {
  const t = await tok(a);
  await issue(a, t, 'cmd:veto', 'veto-commands', 'v3-first');
  await issue(a, t, 'cmd:veto.clear', 'clear-veto', 'v3-clear');
  const genuineClear = await lastVetoBody(a);
  await issue(a, t, 'cmd:veto', 'veto-commands', 'v3-second');
  await a.auditLog.appendSealed(TYPE, 'agent:log-writer', genuineClear);
  console.log(`  V3 replayed body = ${JSON.stringify(genuineClear)}`);
});
