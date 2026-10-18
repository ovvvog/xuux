import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {anchorIncrementPolicy,anchorAttributeViolations,nameOfPublicArea,policySignedUpdate,policyCommandCodeUpdate} from '/home/user/workspace/xuux-review-dbaf6104/sim/tpm-ceremony/policy_digest.mjs';
const W='/home/user/workspace/council-wl413/gpt_6_1_sol',D=W+'/fresh';
const r=JSON.parse(readFileSync(D+'/rehearsal.json','utf8'));
const h=x=>execFileSync('openssl',['dgst','-sha256','-binary'],{input:Buffer.from(x,'hex')}).toString('hex');
const name=r.facts['s2.serviceKey.name'];
const a=h('00'.repeat(32)+'00000160'+name),b=h(a),digest=h(b+'0000016c00000134');
assert.equal(digest,r.facts['s2.policy.tpmTrialDigest']);
assert.equal(digest,r.facts['s2.policy.coreFormulaDigest']);
assert.equal(digest,anchorIncrementPolicy(name));
assert.notEqual(digest,h(a+'0000016c00000134'));
assert.equal(nameOfPublicArea(r.facts['s2.serviceKey.publicAreaHex']),name);
const reserved=[8,9,20,21,22,23,24].map(bit=>{
 const violations=anchorAttributeViolations(0x02040018+2**bit);
 assert(violations.includes(`RESERVED_BIT_${bit}=1`));return {bit,violations};
});
const rows=readdirSync(D).filter(f=>f.endsWith('.jsonl')&&!f.startsWith('parser')).map(f=>{
 const o=JSON.parse(readFileSync(D+'/'+f,'utf8')),p=o.report;
 return {file:f,mode:o.mode,exit:Number(readFileSync(D+'/'+f.replace(/\.jsonl$/,'.exit'),'utf8')),
 status:p.status,failure:p.failure,steps:p.steps.length,changes:o.changes,
 before:{nv:o.nvBefore,sessions:o.sessionsBefore,transients:o.transientsBefore},
 after:{nv:o.nvAfter,sessions:o.sessionsAfter,transients:o.transientsAfter},
 reconciliation:p.reconciliation,cleanupLeftovers:p.cleanupLeftovers,postRunInventory:p.postRunInventory};
});
let nonemptyPolicyRef=null;
if(existsSync(D+'/policyref.json')) {
 const ref=JSON.parse(readFileSync(D+'/policyref.json','utf8')).run;
 const first=h('00'.repeat(32)+'00000160'+ref.name);
 const second=h(first+ref.policyRef);
 const calculated=h(second+'0000016c00000134');
 assert.equal(calculated,ref.tpmDigest);
 assert.equal(policyCommandCodeUpdate(policySignedUpdate(Buffer.alloc(32),ref.name,Buffer.from(ref.policyRef,'hex')),0x134).toString('hex'),calculated);
 nonemptyPolicyRef={...ref,calculated};
 writeFileSync(D+'/nonempty-policyref-check.json',JSON.stringify(nonemptyPolicyRef,null,2)+'\n');
}
const summary={digest,reserved,nonemptyPolicyRef,rows};
writeFileSync(D+'/summary.json',JSON.stringify(summary,null,2)+'\n');
console.log('OpenSSL digest='+digest+'; reserved bits='+reserved.length+'; probe rows='+rows.length);
for(const o of rows) console.log(JSON.stringify({file:o.file,status:o.status,failure:o.failure,after:o.after,reconciliation:o.reconciliation,cleanupLeftovers:o.cleanupLeftovers,postRunInventory:o.postRunInventory}));
