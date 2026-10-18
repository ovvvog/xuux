import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import {
  anchorIncrementPolicy, anchorAttributeViolations, nameOfPublicArea,
} from '/home/user/workspace/xuux-review-dbaf6104/sim/tpm-ceremony/policy_digest.mjs';

const dir='/home/user/workspace/council-wl413/gpt_6_1_sol';
const r=JSON.parse(readFileSync(`${dir}/rehearsal.json`,'utf8'));
const name=r.facts['s2.serviceKey.name'];
const h=x=>execFileSync('openssl',['dgst','-sha256','-binary'],{input:Buffer.from(x,'hex')}).toString('hex');
const first=h('00'.repeat(32)+'00000160'+name);
const signed=h(first);
const final=h(signed+'0000016c00000134');
const wrong=h(first+'0000016c00000134');
assert.equal(final,r.facts['s2.policy.tpmTrialDigest']);
assert.equal(final,r.facts['s2.policy.coreFormulaDigest']);
assert.equal(final,anchorIncrementPolicy(name));
assert.notEqual(final,wrong);
assert.equal(nameOfPublicArea(r.facts['s2.serviceKey.publicAreaHex']),name);
const reserved=[8,9,20,21,22,23,24].map(bit=>{
  const violations=anchorAttributeViolations(0x02040018+2**bit);
  assert(violations.includes(`RESERVED_BIT_${bit}=1`));
  return {bit,violations};
});
const summary={name,first,signed,final,wrong,reserved,rawCommandFields:r.steps.some(s=>'command' in s||'commandHex' in s)};
writeFileSync(`${dir}/additional-checks.json`,JSON.stringify(summary,null,2)+'\n');
const runs=readdirSync(dir).filter(f=>/^probe-.*\.jsonl$/.test(f)).map(f=>{
  const o=JSON.parse(readFileSync(`${dir}/${f}`,'utf8')),p=o.report;
  return {file:f,mode:o.mode,status:p.status,failure:p.failure,steps:p.steps.length,changes:o.changes,
    before:{nv:o.nvBefore,sessions:o.sessionsBefore,transients:o.transientsBefore},
    after:{nv:o.nvAfter,sessions:o.sessionsAfter,transients:o.transientsAfter},
    reconciliation:p.reconciliation,cleanupLeftovers:p.cleanupLeftovers,postRunInventory:p.postRunInventory};
});
writeFileSync(`${dir}/probe-summary.json`,JSON.stringify(runs,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
console.log(`summarized ${runs.length} probes`);
