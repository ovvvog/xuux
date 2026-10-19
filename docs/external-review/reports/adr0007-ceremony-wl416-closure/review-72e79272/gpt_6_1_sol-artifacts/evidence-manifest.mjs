import fs from 'node:fs';
import crypto from 'node:crypto';
const root='/tmp/council-wl422-gpt_6_1_sol';
const names=fs.readdirSync(root).filter(n=>/^\d\d-.*\.(command|stdout|stderr|exit)\.txt$/.test(n))
  .filter(n=>!n.startsWith('37-') && !n.startsWith('38-')).sort();
const files=names.map(n=>{
  const data=fs.readFileSync(root+'/'+n);
  if(data.length===0)throw new Error('Empty evidence artifact: '+n);
  return {path:root+'/'+n,bytes:data.length,
    sha256:crypto.createHash('sha256').update(data).digest('hex')};
});
for(let i=1;i<=36;i++){
  const prefix=String(i).padStart(2,'0')+'-';
  for(const kind of ['command','stdout','exit']){
    if(!names.some(n=>n.startsWith(prefix)&&n.endsWith('.'+kind+'.txt')))
      throw new Error('Missing required evidence '+prefix+kind);
  }
}
const supportFiles=fs.readdirSync(root).filter(n=>/\.(mjs|ps1|cs)$/.test(n)).sort().map(n=>{
  const data=fs.readFileSync(root+'/'+n);
  return {path:root+'/'+n,bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')};
});
console.log(JSON.stringify({provider:'OpenAI',identity:'gpt_6_1_sol',
  reviewedSha:'72e79272576f0d9e85c1d69f415e834ee542c34a',
  evidenceRoot:root,generatedUtc:new Date().toISOString(),files,supportFiles},null,2));
