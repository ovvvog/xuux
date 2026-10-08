// WL-349: does a consistent pre-veto snapshot plus a freshness epoch rewound to that
// snapshot drop a sealed crown veto? Scratch only.
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = '/home/user/workspace/xuux-review-284f74d0';
const rig = await import(
  new URL('tests/helpers/production-sovereign-rig.mjs', `file://${REPO}/`).href
);
const { CONSOLE_ERRORS } = await import(new URL('src/console/index.mjs', `file://${REPO}/`).href);

const root = mkdtempSync(join(tmpdir(), 'grok-veto-'));
const snap = mkdtempSync(join(tmpdir(), 'grok-veto-snap-'));
const { secret, factorSecrets } = rig.testVault();
const keys = { ...rig.fixedKeys(), socket: new rig.TestFreshnessSocket(0n, 'wl349-repro') };

function codeOf(err) {
  return err?.code ?? err?.message ?? String(err);
}

let snapEpoch = null;
const first = await rig.boot(root, { keys, factorSecrets });
try {
  snapEpoch = (await keys.socket.read()).epoch.toString();
  console.log(`after-first-boot veto.enabled=${first.crown.veto.enabled} socketEpoch=${snapEpoch}`);
} finally {
  await first.close();
}
rmSync(snap, { recursive: true, force: true });
cpSync(root, snap, { recursive: true });

const second = await rig.boot(root, { keys, factorSecrets });
try {
  const { opened } = await rig.session(second, secret, 1);
  const signed = rig.crownCommand({
    action: 'veto-commands',
    target: 'crown:gateway',
    reason: 'نقضٌ يُقاسُ سقوطُه بالاسترجاع',
  });
  const vetoed = await second.royalConsole.issue({
    command: 'cmd:veto',
    royalCommand: signed.command,
    signature: signed.signature,
    sovereignSession: opened.token,
  });
  console.log(
    `after-veto status=${vetoed.status} veto.enabled=${second.crown.veto.enabled} socketEpoch=${(await keys.socket.read()).epoch}`,
  );
} finally {
  await second.close();
}

rmSync(root, { recursive: true, force: true });
cpSync(snap, root, { recursive: true });
const rewound = new rig.TestFreshnessSocket(BigInt(snapEpoch), 'wl349-repro');
const keys2 = { ...keys, socket: rewound };
let third;
try {
  third = await rig.boot(root, { keys: keys2, factorSecrets });
} catch (err) {
  console.log(`restored-boot REJECT ${codeOf(err)}`);
  rmSync(root, { recursive: true, force: true });
  rmSync(snap, { recursive: true, force: true });
  process.exit(0);
}
try {
  console.log(`restored-boot veto.enabled=${third.crown.veto.enabled} reason=${third.crown.veto.reason}`);
  const { opened } = await rig.session(third, secret, 0);
  const signed = rig.crownCommand({
    action: 'stop-state',
    target: 'state:sovereign',
    reason: 'إيقافٌ بعدَ استرجاعِ ما قبلَ النقض',
  });
  try {
    const halted = await third.royalConsole.issue({
      command: 'cmd:halt',
      royalCommand: signed.command,
      signature: signed.signature,
      sovereignSession: opened.token,
      haltCommand: rig.haltAuthority(third.rootOfTrust.haltSwitch, 'halt', 'إيقافٌ بعدَ استرجاعِ ما قبلَ النقض', signed.command.id),
    });
    console.log(
      `halt-after-restore status=${halted.status} halt=${third.rootOfTrust.haltSwitch.read().state} veto.enabled=${third.crown.veto.enabled}`,
    );
  } catch (err) {
    console.log(`halt-after-restore REJECT ${codeOf(err)} msg=${String(err.message).slice(0, 180)}`);
  }
} finally {
  await third.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(snap, { recursive: true, force: true });
}
