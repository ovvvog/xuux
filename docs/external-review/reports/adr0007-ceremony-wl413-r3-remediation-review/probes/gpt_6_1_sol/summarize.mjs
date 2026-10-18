import {readdirSync,readFileSync} from 'node:fs';
const dir=process.argv[2];
const rows=[];
for(const f of readdirSync(dir).filter(x=>x.endsWith('.json')).sort()){
  let x;try{x=JSON.parse(readFileSync(`${dir}/${f}`,'utf8'));}catch{continue}
  const r=x.report||x;
  rows.push({file:f,mode:x.mode||x.fault?.mode,status:r.status,failure:r.failure,changes:x.changes??x.fault?.changes,steps:r.steps?.length,reconciliation:r.reconciliation,leftovers:r.cleanupLeftovers,post:r.postRunInventory,nvBefore:x.nvBefore,nvAfter:x.nvAfter,transientsBefore:x.transientsBefore,transientsAfter:x.transientsAfter,sessionsAfter:x.sessionsAfter,flushed:x.flushed,authMutation:x.edits?.find(s=>s.includes(':auth:'))});
}
console.log(JSON.stringify(rows,null,2));
