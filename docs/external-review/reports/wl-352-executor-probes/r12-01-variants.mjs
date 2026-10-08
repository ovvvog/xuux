// M11.04-R12-01: three variants on a clean tree at 284f74d0.
//  A: restore pre-veto snapshot, freshness socket NOT rewound  -> expect boot refused (rollback detected)
//  B: restore pre-veto snapshot, freshness socket rewound      -> Grok's path (veto lost)
//  C: same as B but the protected state is a HALT, not a veto  -> is the limit specific to WL-349?
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Run from a tree root: REPO=$PWD env -u DATABASE_URL node <this file>
const REPO = process.env.REPO;
const rig = await import(`${REPO}/tests/helpers/production-sovereign-rig.mjs`);
const code = (e) => e?.code ?? String(e?.message ?? e).slice(0, 140);

async function scenario(label, act, rewind) {
  const root = mkdtempSync(join(tmpdir(), 'r12-'));
  const snap = mkdtempSync(join(tmpdir(), 'r12s-'));
  const { secret, factorSecrets } = rig.testVault();
  const keys = { ...rig.fixedKeys(), socket: new rig.TestFreshnessSocket(0n, 'r12') };
  const a = await rig.boot(root, { keys, factorSecrets });
  const epoch = (await keys.socket.read()).epoch;
  await a.close();
  rmSync(snap, { recursive: true, force: true }); cpSync(root, snap, { recursive: true });
  const b = await rig.boot(root, { keys, factorSecrets });
  const { opened } = await rig.session(b, secret, 1);
  await act(b, opened.token);
  const after = { veto: !b.crown.veto.enabled, halt: b.rootOfTrust.haltSwitch.read().state };
  await b.close();
  rmSync(root, { recursive: true, force: true }); cpSync(snap, root, { recursive: true });
  const k2 = rewind ? { ...keys, socket: new rig.TestFreshnessSocket(epoch, 'r12') } : keys;
  let out;
  try {
    const c = await rig.boot(root, { keys: k2, factorSecrets });
    out = `BOOTED vetoed=${!c.crown.veto.enabled} halt=${c.rootOfTrust.haltSwitch.read().state}`;
    await c.close();
  } catch (e) { out = `REFUSED ${code(e)}`; }
  console.log(`${label}: before-restore ${JSON.stringify(after)} -> ${out}`);
  rmSync(root, { recursive: true, force: true }); rmSync(snap, { recursive: true, force: true });
}
const veto = async (s, tok) => {
  const sc = rig.crownCommand({ action: 'veto-commands', target: 'crown:gateway', reason: 'r12 veto' });
  await s.royalConsole.issue({ command: 'cmd:veto', royalCommand: sc.command, signature: sc.signature, sovereignSession: tok });
};
const halt = async (s, tok) => {
  const sc = rig.crownCommand({ action: 'stop-state', target: 'state:sovereign', reason: 'r12 halt' });
  await s.royalConsole.issue({ command: 'cmd:halt', royalCommand: sc.command, signature: sc.signature, sovereignSession: tok,
    haltCommand: rig.haltAuthority(s.rootOfTrust.haltSwitch, 'halt', 'r12 halt', sc.command.id) });
};
await scenario('A veto, socket not rewound', veto, false);
await scenario('B veto, socket rewound    ', veto, true);
await scenario('C halt, socket rewound    ', halt, true);
