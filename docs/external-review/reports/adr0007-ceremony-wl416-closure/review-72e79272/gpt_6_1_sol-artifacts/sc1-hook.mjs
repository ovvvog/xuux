import fs from 'node:fs';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
const base = '/tmp/council-wl422-gpt_6_1_sol';
const orig=cp.spawnSync;
cp.spawnSync=function(cmd,args,...rest){
  const isHarness=cmd==='pwsh' && args?.some(a=>String(a).endsWith('/tests/helpers/tpm-ceremony-harness.ps1'));
  if(isHarness){
    args=[...args];
    if(process.env.REVIEW_CORE_MUTATION==='1'){
      const ix=args.findIndex(a=>String(a).endsWith('/tests/helpers/tpm-ceremony-harness.ps1'));
      args[ix]=base+'/sc1-harness.ps1';
    }
  }
  const r=orig.call(this,cmd,args,...rest);
  if(isHarness && r.status===0){
    // The actual harness JSON is independent raw evidence, not executor output.
    console.log('REVIEW_HARNESS_JSON '+r.stdout.trim());
  }
  return r;
};
syncBuiltinESMExports();
