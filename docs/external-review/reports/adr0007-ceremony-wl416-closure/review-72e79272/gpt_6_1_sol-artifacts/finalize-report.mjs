import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const root='/tmp/council-wl422-gpt_6_1_sol';
const report=root+'/report.md';
let text=fs.readFileSync(report,'utf8');
assert.equal((text.match(/END_UTC_PENDING/g)||[]).length,1,'finalize once only');
const end=new Date().toISOString();
text=text.replace('END_UTC_PENDING',end);
for(const [,href] of text.matchAll(/\]\(([^)]+)\)/g)){
  if(!/^\d\d-[a-z0-9-]+\.(stdout|command|exit)\.txt$/.test(href)) throw new Error('Unexpected citation '+href);
  assert.ok(fs.existsSync(root+'/'+href),'Missing citation '+href);
}
assert.ok(text.startsWith('# تقريرُ مراجعةٍ مستقلّةٍ — WL-422\n'));
assert.ok(!text.includes('END_UTC_PENDING'));
assert.ok(text.includes('72e79272576f0d9e85c1d69f415e834ee542c34a'));
const git=spawnSync('git',['-C','/tmp/wt-72e79272-gpt_6_1_sol','status','--porcelain=v1'],
  {encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}});
assert.equal(git.status,0);assert.equal(git.stdout,'');
fs.writeFileSync(report,text);
console.log(JSON.stringify({report,provider:'OpenAI',identity:'gpt_6_1_sol',endUtc:end,
  reportBytes:Buffer.byteLength(text),
  reportSha256:crypto.createHash('sha256').update(text).digest('hex'),
  citationTargetsVerified:true,repositoryClean:true,
  reviewConcluded:true,openFindings:[{id:'WL422-gpt_6_1_sol-01',severity:'low',
    summary:'Cleanup EACCES masks original body error; measured real filesystem permissions; no simulator left'}]},null,2));
