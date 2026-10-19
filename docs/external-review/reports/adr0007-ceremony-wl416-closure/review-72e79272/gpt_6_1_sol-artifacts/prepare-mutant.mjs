import fs from 'node:fs';
import crypto from 'node:crypto';
const original='/tmp/wt-72e79272-gpt_6_1_sol/sim/tpm-ceremony/TpmCeremonyCore.cs';
const target='/tmp/council-wl422-gpt_6_1_sol/mutant-core.cs';
const src=fs.readFileSync(original,'utf8');
const from='private void SessionConsumed(uint h) { _transients.Remove(h); _ctx.EndOfLife(h);';
if(src.split(from).length!==2)throw new Error('exactly one SessionConsumed mutation target required');
const out=src.replace(from,'private void SessionConsumed(uint h) { _transients.Remove(h); /* reviewer mutation: omit context retirement */');
fs.writeFileSync(target,out);
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
console.log(JSON.stringify({original,target,originalSha256:sha(src),mutantSha256:sha(out),
  mutation:'Omit _ctx.EndOfLife(h) only in SessionConsumed; leave state-derived fact intact',
  repositoryOriginalUnchanged:fs.readFileSync(original,'utf8')===src},null,2));
