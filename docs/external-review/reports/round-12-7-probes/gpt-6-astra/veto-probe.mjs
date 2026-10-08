import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {TestFreshnessSocket,boot,crownCommand,fixedKeys,testVault,session} from '/home/user/workspace/xuux-review-284f74d0/tests/helpers/production-sovereign-rig.mjs';
const root=mkdtempSync('/tmp/council-gpt-6-astra/veto-forgery-');
const keys={...fixedKeys(),socket:new TestFreshnessSocket(0n,'council')};
const {secret,factorSecrets}=testVault();
const first=await boot(root,{keys,factorSecrets});
const token=(await session(first,secret)).opened.token;
const signed=crownCommand({action:'veto-commands',target:'crown:gateway',reason:'legitimate veto'});
await first.royalConsole.issue({command:'cmd:veto',royalCommand:signed.command,signature:signed.signature,sovereignSession:token});
assert.equal(first.crown.veto.enabled,false);
console.log('WL349 legitimate veto',!first.crown.veto.enabled);
// The writer needs only the logging capability; no royal command or second-factor session.
await first.auditLog.appendSealed('console.veto.state','agent:log-writer',{vetoed:false});
console.log('WL349 after unsigned append runtime veto',!first.crown.veto.enabled);
await first.close();
const second=await boot(root,{keys,factorSecrets});
console.log('WL349 reboot veto',!second.crown.veto.enabled);
assert.equal(second.crown.veto.enabled,true);
const last=second.auditLog.events.filter(x=>x.type==='console.veto.state').at(-1);
console.log('WL349 last actor/body',last.actor,JSON.stringify(await second.auditLog.openEvent(last)));
// R5-A-05: the live CA consumes the durable revocation store, including after boot.
const cert=await second.authority?.issueAsync?.({subject:'agent:revoked',role:'role:agent',capabilities:[]});
console.log('system keys',Object.keys(second).join(','));
await second.close();
console.log('scratch root',root);
