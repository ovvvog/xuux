import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {EventLog,KingIdentity,CertificateAuthority,CrownGateway} from '/home/user/workspace/xuux-review-284f74d0/src/root-of-trust/index.mjs';
import {createPolicyDecisionPoint,loadPolicyBundle} from '/home/user/workspace/xuux-review-284f74d0/src/policy/index.mjs';
import {ExecutionKernel} from '/home/user/workspace/xuux-review-284f74d0/src/core/execution-kernel.mjs';
import {CapabilityGrantLedger} from '/home/user/workspace/xuux-review-284f74d0/src/identity/capability-grants.mjs';
import {loadCapabilityCatalog} from '/home/user/workspace/xuux-review-284f74d0/src/identity/capability-catalog.mjs';
import {AmendmentPath} from '/home/user/workspace/xuux-review-284f74d0/src/constitution/amendment-path.mjs';
import {ConstitutionStore,loadConstitutionPolicy} from '/home/user/workspace/xuux-review-284f74d0/src/constitution/constitution.mjs';
import {resolveDatabaseConfig,createPool} from '/home/user/workspace/xuux-review-284f74d0/src/persistence/db.mjs';
const pdp=createPolicyDecisionPoint({bundle:loadPolicyBundle()});
for(const [action,capabilities,resource] of [['write-data',[],{type:'data',id:'x'}],['write-data',['action:write-data'],{type:'data',id:'x'}],['create-agent',['action:create-agent'],{type:'agent',id:'x'}]]){
const d=pdp.evaluate({actor:{id:'agent:probe',role:'role:agent',state:'active',capabilities},action,resource});
console.log('R6-A-03',JSON.stringify({action,capabilities,allowed:d.allowed,code:d.code}));
}
const d=pdp.evaluate({actor:{id:'crown',role:'role:king',state:'active'},action:'stop-state',resource:{type:'state',id:'sovereign'},royalCommandId:'fabricated',royalCommandDigest:'a'.repeat(64)});
console.log('R6-A-07 direct PDP shaped strings',JSON.stringify({allowed:d.allowed,code:d.code}));
const kernel=new ExecutionKernel({crown:{},log:new EventLog(),env:{NODE_ENV:'production'}});
for(const method of ['stop','resume']){try{kernel[method]();console.log('R6-A-08',method,'unexpected');process.exitCode=1;}catch(e){console.log('R6-A-08',method,e.message);assert.match(e.message,/KERNEL_SAFE_MODE_REQUIRES_ROYAL_COMMAND/);}}
for(const url of ['postgresql://user:placeholder@db.invalid:5432/postgres','postgresql://user:placeholder@db.invalid:5432/postgres?sslmode=require']){ // secret-scan:allow
try{const c=resolveDatabaseConfig({url,environment:'development'});const pool=createPool({url,environment:'development',ca:'-----BEGIN CERTIFICATE-----\nprobe-only-not-used-for-connect\n-----END CERTIFICATE-----'});console.log('R6-B-03 config',JSON.stringify({tls:c.tls,ssl:pool.options.ssl,removedSslmode:!pool.options.connectionString.includes('sslmode')}));await pool.end();}catch(e){console.log('R6-B-03 config',e.code);}
}
const log=new EventLog(), catalog=loadCapabilityCatalog();
const grants=new CapabilityGrantLedger({catalog,log});
grants.grant({agentId:'agent:probe',capability:'action:read-registry',reason:'restart probe',principal:{id:'minister:probe',role:'role:minister',state:'active'},ttlSeconds:3600});
console.log('R6-A-05 grant before',grants.activeGrants('agent:probe').length);
const king=new KingIdentity(),policy=loadConstitutionPolicy(),store=new ConstitutionStore({policy,signer:king}), ca=new CertificateAuthority(king), crown=new CrownGateway(king,ca,log);
const amendments=new AmendmentPath({policy,store,log});
const command={id:'restart-proposal-0001',action:'amend-constitution',target:'art:03',payload:{},issuedAt:new Date().toISOString()};
const accepted=crown.command(command,king.sign(command));
amendments.propose({actor:{id:king.id,roles:['role:king']},articleId:'art:03',text:'نص دستوري جديد للاختبار فقط يطلب حفظ جذر الثقة في عتاد مستقل وعدم تغيير السلطة الدستورية بمجرد إعادة تشغيل العملية.',reason:'قياس بقاء المقترح عبر عملية جديدة',command:accepted});
console.log('R6-A-05 proposals before',amendments.proposals.size);
// A new process receives the same API defaults; neither API accepts a durable grant/proposal backend.
const child=spawnSync(process.execPath,['--input-type=module','-e',`
import {EventLog,KingIdentity} from '/home/user/workspace/xuux-review-284f74d0/src/root-of-trust/index.mjs';
import {CapabilityGrantLedger} from '/home/user/workspace/xuux-review-284f74d0/src/identity/capability-grants.mjs';
import {loadCapabilityCatalog} from '/home/user/workspace/xuux-review-284f74d0/src/identity/capability-catalog.mjs';
import {AmendmentPath} from '/home/user/workspace/xuux-review-284f74d0/src/constitution/amendment-path.mjs';
import {ConstitutionStore,loadConstitutionPolicy} from '/home/user/workspace/xuux-review-284f74d0/src/constitution/constitution.mjs';
const log=new EventLog(),grants=new CapabilityGrantLedger({catalog:loadCapabilityCatalog(),log});
const policy=loadConstitutionPolicy(),store=new ConstitutionStore({policy,signer:new KingIdentity()});
console.log('R6-A-05 child grants',grants.activeGrants('agent:probe').length);
console.log('R6-A-05 child proposals',new AmendmentPath({policy,store,log}).proposals.size);
`],{encoding:'utf8',env:process.env});
console.log(child.stdout,child.stderr,'CHILD_EXIT='+child.status);assert.equal(child.status,0);
