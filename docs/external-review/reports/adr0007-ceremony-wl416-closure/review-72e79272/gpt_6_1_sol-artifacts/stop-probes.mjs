import assert from 'node:assert/strict';
import fs from 'node:fs';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
const [tree, mode] = process.argv.slice(2);
const h = await import(`${tree}/tests/helpers/ceremony-swtpm.mjs`);
const root = '/tmp/council-wl422-gpt_6_1_sol/tmp/';
const dead = pid => {try{process.kill(pid,0);return false;}catch(e){return e.code==='ESRCH';}};
const state = pid => {
  try {const s=fs.readFileSync(`/proc/${pid}/stat`,'utf8');return s.slice(s.lastIndexOf(')')+2).split(' ')[0];}
  catch{return 'ESRCH';}
};
const waitSync = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
const actualSpawnSync=cp.spawnSync, actualRead=fs.readFileSync, actualKill=process.kill;
let maskedPid=null, failPid=null, failedOnce=false;
const signals=[];
let nonzeroKillCalls=0;
cp.spawnSync=function(cmd,args,...rest){
  if(cmd==='python3' && args[0]==='-c'){
    const entry={pid:Number(args[2]),signal:Number(args[3]),injected:false};
    signals.push(entry);
    if(entry.pid===failPid && !failedOnce){
      failedOnce=true;entry.injected=true;
      return {status:0,stdout:'unsupported\n',stderr:''};
    }
  }
  return actualSpawnSync.call(this,cmd,args,...rest);
};
fs.readFileSync=function(p,...rest){
  if(maskedPid && p===`/proc/${maskedPid}/cmdline`) throw Object.assign(new Error('reviewer injected unreadable cmdline'),{code:'EACCES'});
  return actualRead.call(this,p,...rest);
};
process.kill=function(pid,sig){
  if(sig!==0 && sig!==undefined) nonzeroKillCalls++;
  return actualKill.call(this,pid,sig);
};
syncBuiltinESMExports();
let s=null,child=null,exited=null,dir=null;
try {
  if(mode==='zombie'){
    dir=fs.mkdtempSync(root+'review-zombie-');
    child=cp.spawn('swtpm',['socket','--tpm2','--tpmstate',`dir=${dir}`,
      '--server','type=tcp,port=25340,bindaddr=127.0.0.1',
      '--ctrl','type=tcp,port=25341,bindaddr=127.0.0.1',
      '--flags','not-need-init,startup-clear'],{stdio:'ignore'});
    exited=new Promise(r=>child.once('exit',r));
    let found=false;
    for(let i=0;i<100;i++){if(h.discoverSimPids(dir).includes(child.pid)){found=true;break;}waitSync(10);}
    assert.equal(found,true,'real simulator was owned');
    // Direct child handle is our own launch, not a production-helper identity decision.
    child.kill('SIGKILL');
    for(let i=0;i<100 && state(child.pid)!=='Z';i++)waitSync(10);
    assert.equal(state(child.pid),'Z');
    const before=state(child.pid),t=performance.now();
    const returned=h.stopSim({pid:2147483000,dir});
    console.log(JSON.stringify({tree,mode,owner:child.pid,before,after:state(child.pid),
      returned,dirKept:fs.existsSync(dir),elapsedMs:performance.now()-t,signals,nonzeroKillCalls}));
    assert.equal(returned,false);assert.equal(fs.existsSync(dir),true);
  }else{
    s=h.startSim({prefix:'review-'+mode+'-',portBase:25000,attempts:1});dir=s.dir;
    let delivered=s.pid;
    if(mode==='nonowner'){
      child=cp.spawn('sleep',['120'],{stdio:'ignore'});
      exited=new Promise(r=>child.once('exit',r));delivered=child.pid;
    }else if(mode==='unresolved'){
      maskedPid=s.pid;delivered=2147483000;
    }else if(mode==='channel-failure'){
      failPid=s.pid;
    }else if(mode==='absent'){
      delivered=2147483000;
    }else throw new Error('unknown mode');
    const beforeOwners=h.discoverSimPids(dir),t=performance.now();
    const returned=h.stopSim({...s,pid:delivered});
    const result={tree,mode,owner:s.pid,delivered,beforeOwners,returned,
      ownerDead:dead(s.pid),ownerState:state(s.pid),dirKept:fs.existsSync(dir),
      decoyDead:child?dead(child.pid):null,elapsedMs:performance.now()-t,
      signals,nonzeroKillCalls,failedOnce};
    console.log(JSON.stringify(result));
    if(mode==='unresolved'){
      assert.equal(returned,false);assert.equal(result.ownerDead,false);
      assert.equal(result.dirKept,true);assert.equal(signals.length,0);
    }else if(mode==='nonowner'){
      assert.equal(returned,false);assert.equal(result.ownerDead,true);
      assert.equal(result.decoyDead,false);assert.equal(result.dirKept,true);
      assert.equal(signals.some(x=>x.pid===delivered),false);
    }else if(mode==='channel-failure'){
      assert.equal(returned,false);assert.equal(result.ownerDead,true);
      assert.equal(result.dirKept,true);assert.equal(failedOnce,true);
      assert.equal(signals.filter(x=>x.pid===s.pid).length,2);
    }else{
      assert.equal(returned,true);assert.equal(result.ownerDead,true);assert.equal(result.dirKept,false);
    }
    assert.equal(nonzeroKillCalls,0);
  }
}finally{
  maskedPid=null;failPid=null;
  cp.spawnSync=actualSpawnSync;fs.readFileSync=actualRead;process.kill=actualKill;syncBuiltinESMExports();
  if(child){
    if(child.exitCode===null && child.signalCode===null) child.kill('SIGKILL');
    await exited;
    console.log(JSON.stringify({cleanupChild:child.pid,state:state(child.pid),dead:dead(child.pid)}));
  }
  if(s && !dead(s.pid)) h.killSim(s.pid,{dir:s.dir});
  const left=dir?h.discoverSimPids(dir):[];
  console.log(JSON.stringify({cleanupOwners:left,dir}));
  assert.deepEqual(left,[]);
  // Own temporary directory only; cleanup after observations have been recorded.
  if(dir)fs.rmSync(dir,{recursive:true,force:true});
  await delay(10);
}
