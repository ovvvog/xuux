import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import YAML from '/home/user/workspace/xuux-review-284f74d0/node_modules/yaml/dist/index.js';
const root='/home/user/workspace/xuux-review-284f74d0';
const out='/tmp/council-gpt-6-astra';
const command=(cmd)=>{const r=spawnSync('bash',['-c',cmd],{cwd:root,encoding:'utf8'});return {command:cmd,exit:r.status,stdout:r.stdout,stderr:r.stderr};};
const x=YAML.parse(fs.readFileSync(root+'/config/external-review.yaml','utf8'));
const findings=x.findings.filter(f=>f.status==='open'&&['M11.04','M11.06'].includes(f.engagement)).map(f=>({id:f.id,engagement:f.engagement,reproductionPath:f.reproductionPath,affectedFiles:f.affectedFiles,closure:f.closure??null}));
fs.writeFileSync(out+'/finding-contracts.json',JSON.stringify(findings,null,2));
const changed=command('git diff --name-only b1c6e4aa 284f74d0 -- src/ scripts/');
const affected=[...new Set(findings.flatMap(f=>f.affectedFiles))];
const meta={
start:'2026-10-08T01:25:58Z',head:command('git rev-parse HEAD'),
node:command('node --version'),npm:command('npm --version'),os:command('uname -a'),status:command('git status --porcelain'),
diff:command('git diff --stat b1c6e4aa 284f74d0'),changed,
affectedChanged:changed.stdout.trim().split('\n').filter(p=>affected.includes(p)),
plan:command("git ls-tree -r 284f74d0 --name-only | rg '^docs/external-review/M11\\.06.*plan\\.md$'"),
currentPlan:command("git cat-file -e HEAD:docs/external-review/M11.06-round-7-plan.md"),
end:command('date -u +%Y-%m-%dT%H:%M:%SZ')};
fs.writeFileSync(out+'/metadata.json',JSON.stringify(meta,null,2));
console.log(JSON.stringify(meta,null,2));
console.log('CONTRACT_ROWS='+findings.length+' CLOSURE_NON_NULL='+findings.filter(f=>f.closure!==null).length);
