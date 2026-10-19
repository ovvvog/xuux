import assert from 'node:assert/strict';
import fs from 'node:fs';
import {startSim as startSimShared,killSim,discoverSimPids} from '/tmp/wt-72e79272-gpt_6_1_sol/tests/helpers/ceremony-swtpm.mjs';
const source=fs.readFileSync('/tmp/wt-72e79272-gpt_6_1_sol/tests/sim/tpm-ceremony-wl416.test.mjs','utf8');
const from=source.indexOf('function cleanupOwned(dir) {');
const to=source.indexOf('// L7a (',from);
assert.ok(from>0 && to>from,'extract exact checked-in guard, no modified implementation');
const extracted=source.slice(from,to);
const withCleanupGuard=new Function('discoverSimPids','killSim','rmSync','assert',
  extracted+'\nreturn withCleanupGuard;')(discoverSimPids,killSim,fs.rmSync,assert);
let s;
const restricted=process.argv[2] !== 'normal';
const original=new Error('review-original-body-error');
let caught;
try{
  withCleanupGuard(track=>{
    s=startSimShared({prefix:'review-guard-eacces-',portBase:25400,attempts:1});
    track(s.dir);
    fs.writeFileSync(s.dir+'/protected-evidence.txt','review guard diagnostic\n');
    if(restricted)fs.chmodSync(s.dir,0o500);
    throw original;
  });
}catch(e){caught=e;}
try{
  assert.ok(s,'simulator launched');
  const result={restricted,uid:process.getuid(),dir:s.dir,pid:s.pid,caughtOriginal:caught===original,
    originalMessage:original.message,caughtMessage:caught?.message,caughtCode:caught?.code,
    ownersAfter:discoverSimPids(s.dir),dirKept:fs.existsSync(s.dir)};
  console.log(JSON.stringify(result,null,2));
  if(restricted)assert.equal(result.caughtCode,'EACCES','real filesystem fault required');
  assert.equal(result.caughtOriginal,!restricted,'diagnostic: identity of original body exception');
  assert.deepEqual(result.ownersAfter,[],'termination still happened');
}finally{
  if(s){
    if(fs.existsSync(s.dir))fs.chmodSync(s.dir,0o700);
    for(const pid of discoverSimPids(s.dir))killSim(pid,{dir:s.dir});
    fs.rmSync(s.dir,{recursive:true,force:true});
    console.log(JSON.stringify({finalOwners:discoverSimPids(s.dir),dirExists:fs.existsSync(s.dir)}));
  }
}
