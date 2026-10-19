import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
const w='/tmp/wl414-followup/reviewers/gpt_6_1_sol',r=join(w,'repo');
const read=(p)=>fs.readFileSync(join(w,p),'utf8');
const obj=(d,n)=>JSON.parse(read(`${d}/${n}.json`));
const summary={head:execFileSync('git',['rev-parse','HEAD'],{cwd:r,encoding:'utf8'}).trim(),runs:[],checks:[],processes:{}};
assert.equal(summary.head,'3e67d362dc4f30ec35f73957fd5542be47a3a875');
for(const d of ['independent','independent-extra','independent-partial','control-before-fix','control-extra']) {
 for(const f of fs.readdirSync(join(w,d)).filter(x=>x.endsWith('.json'))) {
  const o=JSON.parse(read(`${d}/${f}`)), n=f.slice(0,-5);
  summary.runs.push({directory:d,mode:o.mode,exit:Number(read(`${d}/${n}.exit`)),changes:o.changes,status:o.report.status,
   failure:o.report.failure,steps:o.report.steps.length,postRunInventory:o.report.postRunInventory,flushed:o.flushed,
   deleteAttempts:o.deleted,forwardedUndefines:o.forwarded?.filter(x=>x==='0x00000122').length,
   before:{nv:o.nvBefore,transients:o.transientsBefore},after:{nv:o.nvAfter,transients:o.transientsAfter},events:o.events});
 }
}
const check=(name,fn)=>{fn();summary.checks.push(name);console.log('OBSERVED '+name);};
check('Every independent collector exited 0',()=>assert(summary.runs.every(x=>x.exit===0)));
check('Full historical duplicate/hidden-victim chain fires twice and flushes victim on pre-fix core',()=>{
 const o=obj('control-before-fix','duplicate-alias');
 assert.equal(o.changes,2);assert(o.flushed.includes(o.seedB));assert(!o.transientsAfter.includes(o.seedB));
});
check('Target breaks chain at baseline; both guards survive and no mutation is attempted',()=>{
 const o=obj('independent','duplicate-alias');assert.equal(o.changes,1);
 assert.deepEqual(o.transientsAfter,o.transientsBefore);assert.equal(o.flushed.length,0);assert.equal(o.deleted.length,0);
 assert(o.report.steps.every(x=>x.commandCode==='0x0000017a'));assert.equal(o.report.postRunInventory.verified,false);
});
for(const n of ['duplicate-many','descending','cross-page','below-start'])check(`Named rejection for ${n}`,()=>{
 const o=obj('independent',n);assert.match(o.report.failure,/HANDLE_ORDER_MALFORMED/);
 assert.deepEqual(o.transientsAfter,o.transientsBefore);assert.equal(o.flushed.length,0);
});
for(const n of ['auth-policy-on-password','auth-password-on-policy','auth-policy-nonce16','auth-policy-attrs08'])check(`Bound authentication profile rejects ${n}`,()=>{
 assert.match(obj('independent',n).report.failure,/RESPONSE_AUTH_CONTENT_MALFORMED/);
});
for(const d of ['independent','independent-partial']) {
 const names=d==='independent'?['partial-transient','partial-session']:['partial-transient-badclass','partial-session-badclass'];
 for(const n of names)check(`Untrusted partial baseline ${n}`,()=>{
  const o=obj(d,n);assert.equal(o.report.postRunInventory.verified,false);assert.match(o.report.postRunInventory.error,/partial baseline/);
  assert(o.report.steps.every(x=>x.commandCode==='0x0000017a'));
 });
}
check('Actual lost define response leaves own candidate and pre-existing foreign NV; zero undefine attempts',()=>{
 const o=obj('independent','loss-define');assert.deepEqual(o.nvBefore,['0x01807777']);
 assert(o.nvAfter.includes('0x01807777'));assert(o.nvAfter.includes(o.defined));assert.equal(o.deleted.length,0);
 assert.deepEqual(o.report.postRunInventory.residualNv,[o.defined]);
});
check('Matching-public foreign seed survives lost failed define reply; zero forwarded undefines',()=>{
 const o=obj('independent-extra','loss-define-foreign-matching');
 assert(o.events.some(x=>x.includes('rc=0x0000014c')));assert(o.nvAfter.includes(o.defined));
 assert.equal(o.forwarded.filter(x=>x==='0x00000122').length,0);
});
check('Known remaining NULL auth ticket digest accepted at lengths 1/32/64',()=>{
 for(const n of [1,32,64])assert.equal(obj('independent','policy-digest-'+n).report.status,'COMPLETE');
 assert.equal(obj('independent','policy-digest-65').report.status,'FAILED_CLOSED');
});
check('Known remaining creation data mismatch accepted',()=>{
 for(const n of ['creation-outsideinfo','creation-parentname'])assert.equal(obj('independent',n).report.status,'COMPLETE');
});
check('Reconciliation text promises cleanup after cleanup budget already spent',()=>{
 const o=obj('independent-extra','cleanup-undefine-before');
 assert.match(o.report.reconciliation.join(' '),/left for the bounded cleanup attempt/);
 assert.equal(o.deleted.length,1);assert.equal(o.forwarded.filter(x=>x==='0x00000122').length,0);
 assert(o.nvAfter.includes(o.defined));assert.equal(o.report.postRunInventory.verified,true);
});
check('Genuine positive-expiration swtpm success rejected only by target schema',()=>{
 assert.match(read('positive-expiration/current-3600.txt'),/response=8001000000140000000000008025400000070000/);
 assert.match(read('positive-expiration/current-3600.txt'),/SCHEMA_REJECT.*RESPONSE_POLICY_TIMEOUT_MALFORMED/);
 assert.match(read('positive-expiration/before-fix-3600.txt'),/SCHEMA_ACCEPT/);
});
for(const [name,path] of Object.entries({
 suiteBefore:'shipped/processes-before-suite.txt',
 suiteImmediate:'shipped/processes-immediately-after-suite.txt',
 rehearsalImmediate:'shipped/processes-immediately-after-rehearsal.txt',
 fixtureStopped:'shipped/processes-after-fixture-stop.txt',
 assertionBefore:'forced-failure/processes-before.txt',
 assertionImmediate:'forced-failure/processes-immediately-after.txt',
 readinessBefore:'readiness-failure/processes-before.txt',
 readinessImmediate:'readiness-failure/processes-immediately-after.txt',
 readinessExplicitCleanup:'readiness-failure/processes-after-explicit-cleanup.txt'})) {
 const lines=read(path).split('\n').filter(x=>/^\s*\d+\s+\d+\s+\S+\s+swtpm /.test(x));
 summary.processes[name]={all:lines.length,own:lines.filter(x=>x.includes(w+'/')).length,file:path};
}
check('No extra daemon at native suite exit; supplied fixture stays intentionally',()=>{
 assert.equal(summary.processes.suiteBefore.own,1);assert.equal(summary.processes.suiteImmediate.own,1);
 assert.equal(summary.processes.fixtureStopped.own,0);
});
check('Assertion failure inside test body leaves no owned simulator',()=>{
 assert.equal(Number(read('forced-failure/forced.exit')),1);
 assert.equal(summary.processes.assertionBefore.own,0);assert.equal(summary.processes.assertionImmediate.own,0);
});
check('Readiness failure leaks one live owned simulator at immediate node exit',()=>{
 assert.equal(Number(read('readiness-failure/readiness.exit')),1);
 assert.equal(summary.processes.readinessBefore.own,0);assert.equal(summary.processes.readinessImmediate.own,1);
 assert.equal(summary.processes.readinessExplicitCleanup.own,0);
});
const entries=s=>s.split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!x.startsWith('#')).sort();
const gitShow=rev=>execFileSync('git',['show',`${rev}:docs/audit/template-allowlist.txt`],{cwd:r,encoding:'utf8'});
summary.allowlist={before:entries(gitShow('d9e1dc3b')),after:entries(gitShow('HEAD'))};
check('Template allowlist has identical semantic entries',()=>assert.deepEqual(summary.allowlist.before,summary.allowlist.after));
summary.nativeSuite={exit:Number(read('shipped/suite.exit')),tests:73,fail:0,skipped:0};
summary.positiveExpirationCommand='bash run-positive-expiration.sh';
fs.writeFileSync(join(w,'review-summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(`run_count=${summary.runs.length} check_count=${summary.checks.length}`);
console.log(JSON.stringify(summary.processes,null,2));
