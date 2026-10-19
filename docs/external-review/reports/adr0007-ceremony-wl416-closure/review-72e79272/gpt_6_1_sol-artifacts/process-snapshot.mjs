import fs from 'node:fs';
const root = '/tmp/council-wl422-gpt_6_1_sol/tmp/';
const found = [];
const zombies = [];
for (const name of fs.readdirSync('/proc')) {
  if (!/^\d+$/.test(name)) continue;
  try {
    const st = fs.readFileSync(`/proc/${name}/stat`,'utf8');
    const fields = st.slice(st.lastIndexOf(')')+2).split(' ');
    const comm = fs.readFileSync(`/proc/${name}/comm`,'utf8').trim();
    const args = fs.readFileSync(`/proc/${name}/cmdline`,'utf8').split('\0').filter(Boolean);
    if (fields[0] === 'Z') zombies.push({pid:Number(name),ppid:Number(fields[1]),comm});
    if (args[0]?.includes('swtpm')) {
      const i = args.indexOf('--tpmstate');
      const state = args[i+1];
      found.push({pid:Number(name),ppid:Number(fields[1]),state:fields[0],comm,
        ownReview:state?.startsWith(`dir=${root}`), stateArg:state});
    }
  } catch {}
}
console.log(JSON.stringify({utc:new Date().toISOString(),swtpm:found,
  reviewOwners:found.filter(p=>p.ownReview).length,zombies,
  stateDirs:fs.readdirSync(root)},null,2));
if (found.some(p=>p.ownReview)) process.exitCode = 1;
