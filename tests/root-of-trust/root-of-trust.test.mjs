import test from 'node:test';
import assert from 'node:assert/strict';
import { KingIdentity, CertificateAuthority, AgentIdentity, EventLog, CrownGateway, createRoyalCommand } from '../../src/root-of-trust/index.mjs';

test('king signs and verifies commands', () => {
  const king=new KingIdentity(); const command=createRoyalCommand('inspect','agent:one'); const sig=king.sign(command);
  assert.equal(king.verify(command,sig),true); assert.equal(king.verify({...command,action:'destroy'},sig),false);
});
test('certificate authority issues and revokes agents', () => {
  const king=new KingIdentity(); const ca=new CertificateAuthority(king); const agent=new AgentIdentity(ca,'one','observer',['read:a']);
  assert.equal(ca.isValid(agent.certificate),true); ca.revoke(agent.certificate.id,'test'); assert.equal(ca.isValid(agent.certificate),false);
});
test('event log is tamper evident', () => {
  const log=new EventLog(); log.append('test','system',{ok:true}); log.append('test','system',{ok:false}); assert.equal(log.verify(),true);
  log.events[0].data.ok='tampered'; assert.equal(log.verify(),false);
});
test('crown gateway rejects bad signature and stops safely', () => {
  const king=new KingIdentity(); const log=new EventLog(); const crown=new CrownGateway(king,new CertificateAuthority(king),log); const c=createRoyalCommand('inspect','agent:one');
  assert.throws(()=>crown.command(c,'bad'),/INVALID_ROYAL_SIGNATURE/); assert.deepEqual(crown.command(c,king.sign(c)).action,'inspect'); crown.stop('test'); assert.throws(()=>crown.command(c,king.sign(c)),/CROWN_STOPPED/);
});
