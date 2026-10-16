import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { runTpm } from '/home/user/workspace/xuux-review-a76c8478/sim/tpm/tpm_client.mjs';
import { getCapability } from '/home/user/workspace/xuux-review-a76c8478/sim/tpm/getcap.mjs';
const base = '/home/user/workspace/council-adr0007/gpt_6_1_sol';
fs.chmodSync(path.join(base, 'timeout-stub/tpm2'), 0o700);
process.env.PATH = path.join(base, 'timeout-stub') + ':' + process.env.PATH;
const opts = { tcti: 'swtpm:host=127.0.0.1,port=29351', timeoutMs: 20 };
const start = new Date().toISOString();
const command = await runTpm(['getcap', 'properties-fixed'], opts);
const capability = await getCapability('properties-fixed', opts);
assert.equal(command.rc, 0);
assert.equal(capability.rc, 0);
const result = {
  id: 'P11-child-signal-exit-classified-zero',
  start, end: new Date().toISOString(),
  scope: 'local executable fixture sleeps; no TPM command or network',
  command, capability,
};
fs.writeFileSync(path.join(base, 'child-timeout-result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
