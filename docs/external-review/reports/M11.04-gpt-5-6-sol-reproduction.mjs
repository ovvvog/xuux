import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionStore } from '/home/user/workspace/xuux/src/api/session-store.mjs';
import { loadPolicyBundle } from '/home/user/workspace/xuux/src/policy/loader.mjs';
import { PolicyDecisionPoint } from '/home/user/workspace/xuux/src/policy/engine.mjs';
import { EnforcementPoint } from '/home/user/workspace/xuux/src/policy/enforcement-point.mjs';
import { createPolicyVersionStore } from '/home/user/workspace/xuux/src/policy/versioning.mjs';
import { KingIdentity, CertificateAuthority, EventLog, CrownGateway, createRoyalCommand, HaltSwitch } from '/home/user/workspace/xuux/src/root-of-trust/index.mjs';
import { ExecutionKernel } from '/home/user/workspace/xuux/src/core/execution-kernel.mjs';
import { loadCapabilityCatalog } from '/home/user/workspace/xuux/src/identity/capability-catalog.mjs';
import { CapabilityGrantLedger } from '/home/user/workspace/xuux/src/identity/capability-grants.mjs';

const result = {};

// R1: معرفة معرّف هوية نشطة تكفي لاستخراج رمز حامل باسمها.
{
  const events=[];
  const store=new SessionStore({
    policy:{tokenBytes:32,ttlSeconds:300,digest:'sha256'},
    audit:{sessionOpenedEvent:'session.opened',sessionClosedEvent:'session.closed'},
    log:{append:(...x)=>events.push(x)},
    agents:{get:async(id)=>id==='agent:auditor'?{id,role:'role:auditor',state:'active',capabilities:['read-audit']}:null},
  });
  const opened=await store.open({actorId:'agent:auditor'});
  const resolved=await store.resolve(opened.token);
  result.sessionImpersonation={opened:true,claimedActor:resolved.actorId,claimedRole:resolved.role,proofSupplied:false};
}

// R2: معرّف أمر ملكي ملفّق يجتاز العتبة؛ التذكرة لا ترتبط بمعرّف الأمر الحقيقي.
{
  const king=new KingIdentity();
  const log=new EventLog();
  const crown=new CrownGateway(king,new CertificateAuthority(king),log);
  const enforcement=new EnforcementPoint({decisionPoint:new PolicyDecisionPoint({bundle:loadPolicyBundle()}),log});
  const kernel=new ExecutionKernel({crown,log,enforcement});
  const command=createRoyalCommand('change-policy','policy:retention');
  const auth=await enforcement.authorize({
    actor:{id:'crown',kind:'human',role:'role:king',state:'active'},
    action:'change-policy',resource:{type:'policy',id:'retention'},context:{},
    royalCommandId:'cmd:forged-not-accepted',
  });
  const task=await kernel.submit(command,king.sign(command),()=>({changed:true}),{decisionToken:auth.token});
  result.royalCommandBinding={decisionAllowed:auth.decision.allowed,forgedId:'cmd:forged-not-accepted',realId:command.id,idsDiffer:command.id!=='cmd:forged-not-accepted',kernelState:task.state};
}

// R3: الحزمة المعلنة مجمّدة سطحياً فقط؛ تعديل مصفوفة متداخلة يغيّر القرار الحي.
{
  const bundle=loadPolicyBundle();
  const pdp=new PolicyDecisionPoint({bundle});
  const req={actor:{id:'agent:operator',role:'role:operator',state:'active'},action:'read-audit',resource:{type:'audit',id:'events'}};
  const before=pdp.evaluate(req);
  const p=bundle.policies.find(x=>x.id==='pol:read-registry-authorized-roles');
  p.actions.push('read-audit');
  p.resources.push('audit:*');
  const after=pdp.evaluate(req);
  bundle.actions.set('runtime-injected',{id:'runtime-injected',description:'injected',sensitive:false});
  result.mutablePolicyBundle={mapFrozen:Object.isFrozen(bundle.actions),nestedActionsFrozen:Object.isFrozen(p.actions),before:before.code,after:after.code,afterAllowed:after.allowed,mapMutationVisible:bundle.actions.has('runtime-injected')};
}

// R4: تحميل override نشط لا يعيد التحقق من توقيعه المخزن.
{
  const base=loadPolicyBundle();
  const original=base.policies.find(x=>x.id==='pol:read-registry-authorized-roles');
  const malicious={...original,effect:'deny',priority:999,reason:'tampered row',actors:{roles:[...original.actors.roles]},actions:[...original.actions],resources:[...original.resources]};
  let verifyCalls=0;
  const pool={query:async()=>({rows:[{policy_id:original.id,version:77,document:malicious,change_reason:'tampered',proposed_by:'attacker',approved_by:'king:claimed',approval_signature:'bogus',active:true,created_at:new Date()}]})};
  const signer={verify:()=>{verifyCalls++; return false;}};
  const merged=await createPolicyVersionStore({pool,signer}).bundleWithOverrides(base);
  const loaded=merged.policies.find(x=>x.id===original.id);
  result.policyOverrideSignature={verifyCalls,loadedVersion:loaded.version,loadedEffect:loaded.effect,loadedReason:loaded.reason};
}

// R5: عملية واحدة تؤكد نيابةً عن عقدتين حيتين ثم تستأنف.
{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'m1104-halt-'));
  const file=path.join(dir,'halt.json');
  const king=new KingIdentity();
  const halt=new HaltSwitch(file,king,{fsync:false});
  halt.registerNode('node:a',process.pid);
  halt.registerNode('node:b',process.pid);
  halt.halt('repro');
  const before=halt.pendingConfirmations();
  const a=halt.confirmHalt('node:a');
  const b=halt.confirmHalt('node:b');
  const after=halt.pendingConfirmations();
  const resumed=halt.resume('same process forged both acks');
  result.haltConfirmationSpoof={pendingBefore:before.map(x=>x.nodeId),ackPids:[a.pid,b.pid],sameProcess:a.pid===b.pid,pendingAfter:after.map(x=>x.nodeId),resumedState:resumed.state};
}

// R6: دور المانح ومعرّفه ادعاءان نصيان؛ لا تحقق من سجل هوية أو توقيع.
{
  const events=[];
  const catalog=loadCapabilityCatalog();
  const ledger=new CapabilityGrantLedger({catalog,log:{append:(...x)=>events.push(x)}});
  const capability=[...catalog.grantable.values()].find(x=>x.grantorRoles.has('role:minister'));
  const grant=ledger.grant({agentId:'agent:beneficiary',capability:capability.id,reason:'repro',grantedBy:'agent:not-registered',grantorRole:'role:minister',ttlSeconds:60});
  result.grantorImpersonation={granted:true,grantId:grant.id,grantedBy:grant.grantedBy,claimedRole:grant.grantorRole,effective:[...ledger.capabilitiesOf('agent:beneficiary')]};
}

console.log(JSON.stringify(result,null,2));
