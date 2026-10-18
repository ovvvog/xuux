import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const w='/tmp/wl414-followup/reviewers/gpt_6_1_sol',r=join(w,'repo'),out=join(w,'readiness-failure');
mkdirSync(join(out,'tmp'),{recursive:true});
let s=readFileSync(join(r,'tests/sim/tpm-ceremony-wl413-r3.test.mjs'),'utf8');
s=s.replace("'../../sim/tpm/tcti_guard.mjs'",JSON.stringify(pathToFileURL(join(r,'sim/tpm/tcti_guard.mjs')).href));
s=s.replace("const root = fileURLToPath(new URL('../../', import.meta.url));",`const root = ${JSON.stringify(r)};`);
s=s.replace('const port = 2700 + 2 * Math.floor(Math.random() * 150);','const port = 7100;');
// Bound the deliberate fault to one simulator and one readiness check.
s=s.replace('attempt < 8','attempt < 1').replace('i < 10','i < 1');
writeFileSync(join(out,'readiness-r3.test.mjs'),s);
console.log('Copied native R3 tests outside tree; fixed port, one startup attempt/check. PATH shim fails readiness query.');
