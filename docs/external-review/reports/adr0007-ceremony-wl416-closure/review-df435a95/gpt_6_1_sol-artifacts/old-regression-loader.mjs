import { readFileSync } from 'node:fs';
import { load as portLoad } from './port-loader.mjs';
export async function load(url, context, nextLoad) {
  if (url === 'file:///tmp/wt-a3f1505d/tests/sim/tpm-ceremony-wl416.test.mjs') {
    const head = readFileSync('/tmp/wt-df435a95-gpt/tests/sim/tpm-ceremony-wl416.test.mjs', 'utf8');
    const from = "const harness = join(root, 'tests/helpers/tpm-ceremony-harness.ps1');";
    if (!head.includes(from)) throw new Error('harness path changed');
    console.error('WL420 old-regression overlay: HEAD test + HEAD fault injection; a3f1505d core + a3f1505d lifecycle helper');
    return {
      format: 'module',
      shortCircuit: true,
      source: head.replace(from, "const harness = '/tmp/council-wl420-gpt_6_1_sol/old-harness.ps1';"),
    };
  }
  return portLoad(url, context, nextLoad);
}
