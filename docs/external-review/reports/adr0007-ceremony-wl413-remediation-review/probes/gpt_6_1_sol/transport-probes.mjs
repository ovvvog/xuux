import net from 'node:net';
import {spawn, spawnSync, execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, writeFileSync, readFileSync} from 'node:fs';
const W='/home/user/workspace/council-wl413/gpt_6_1_sol';
const R='/home/user/workspace/xuux-review-dbaf6104';
const O=W+'/fresh/transport';
mkdirSync(O,{recursive:true});
if(process.argv[2]==='proxy') {
  const log=process.argv[3];
  let bytes=0;
  net.createServer(c=>{
    const t=net.connect(2101,'127.0.0.1');
    c.on('data',d=>{bytes+=d.length;writeFileSync(log,String(bytes));t.write(d);});
    t.pipe(c);c.on('close',()=>t.destroy());t.on('error',()=>c.destroy());
  }).listen(2103,'127.0.0.1',()=>console.log('listening'));
} else {
  const state=mkdtempSync(O+'/state-');
  const pidFile=O+'/pid';
  const sim=spawnSync('swtpm',['socket','--tpm2','--tpmstate','dir='+state,
    '--server','type=tcp,port=2101,bindaddr=127.0.0.1',
    '--ctrl','type=tcp,port=2102,bindaddr=127.0.0.1',
    '--flags','not-need-init,startup-clear','--pid','file='+pidFile,'--daemon'],{encoding:'utf8'});
  if(sim.status!==0) throw Error(sim.stderr);
  const pid=Number(readFileSync(pidFile,'utf8'));
  const baseline=O+'/baseline';
  mkdirSync(baseline,{recursive:true});
  for(const file of ['rehearse.ps1','TpmCeremonyCore.cs'])
    writeFileSync(baseline+'/'+file,execFileSync('git',['show','42c0050a:sim/tpm-ceremony/'+file],{cwd:R}));
  const bytesFile=O+'/bytes.txt';writeFileSync(bytesFile,'0');
  const proxy=spawn(process.execPath,[import.meta.filename??new URL(import.meta.url).pathname,'proxy',bytesFile],{stdio:['ignore','pipe','inherit']});
  await new Promise((resolve,reject)=>{proxy.stdout.once('data',resolve);proxy.once('error',reject);});
  const results=[];
  try {
    for(const [version,file] of [['baseline',baseline+'/rehearse.ps1'],['current',R+'/sim/tpm-ceremony/rehearse.ps1']]) {
      for(const pidflag of [false,true]) {
        const before=Number(readFileSync(bytesFile,'utf8'));
        const args=['-NoProfile','-File',file,'-SimHost','127.0.0.1','-SimPort','2103','-Stages','S1',...(pidflag?['-SimPidFile',pidFile]:[])];
        const run=spawnSync('pwsh',args,{encoding:'utf8',maxBuffer:16<<20});
        const after=Number(readFileSync(bytesFile,'utf8'));
        const name=version+(pidflag?'-pid':'-nopid');
        writeFileSync(O+'/'+name+'.json',run.stdout);writeFileSync(O+'/'+name+'.stderr',run.stderr);
        const parsed=JSON.parse(run.stdout);
        results.push({version,pidflag,exit:run.status,bytesForwarded:after-before,status:parsed.status,failure:parsed.failure,steps:parsed.steps?.length,command:['pwsh',...args]});
      }
    }
  } finally {proxy.kill();process.kill(pid,'SIGTERM');}
  writeFileSync(O+'/results.json',JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify(results,null,2));
}
