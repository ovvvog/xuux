import {spawnSync} from 'node:child_process';
import {writeFileSync, mkdirSync} from 'node:fs';
const root='/home/user/workspace/xuux-review-284f74d0';
const out='/tmp/council-gpt-6-astra';
mkdirSync(out,{recursive:true});
const groups={
retention:'env -u DATABASE_URL node --test tests/data/retention-authorization.test.mjs tests/persistence/retention.test.mjs tests/tooling/guard-retention.test.mjs',
policy:'env -u DATABASE_URL node --test tests/policy/r5-b-09-capability-enforcement.test.mjs tests/policy/sovereign-threshold.test.mjs tests/policy/r5-b-06-sovereign-command-verification.test.mjs tests/core/kernel-safe-mode-actor.test.mjs',
restart:'env -u DATABASE_URL node --test tests/production/wl-305-quarantine-restart.test.mjs tests/identity/capability-grants.test.mjs tests/inference/budget-store.test.mjs tests/inference/budget-snapshot-restore.test.mjs tests/constitution/amendment-path.test.mjs',
root:'env -u DATABASE_URL node --test tests/root-of-trust/replay-limit.test.mjs tests/root-of-trust/production-runtime.test.mjs tests/root-of-trust/production-runtime-softhsm.test.mjs tests/root-of-trust/round-4-halt-log-witness.test.mjs tests/root-of-trust/r5-b-01-revocation-durability.test.mjs',
veto:'env -u DATABASE_URL node --test tests/production/wl-349-durable-veto.test.mjs tests/production/wl-348-sovereign-console.test.mjs',
docs:'env -u DATABASE_URL node --test tests/docs/agent-containment-claims.test.mjs',
supplement:'env -u DATABASE_URL node --test tests/production/wl-303-sovereign-authorization.test.mjs tests/production/halt-switch-integration.test.mjs tests/persistence/r6-a-11-raw-purge-authority.test.mjs tests/data/legal-hold-sovereign.test.mjs tests/persistence/db.test.mjs',
supplement2:'env -u DATABASE_URL node --test tests/production/wl-303-sovereign-authorization.test.mjs tests/production/halt-switch-integration.test.mjs tests/persistence/r6-a-11-raw-purge-authority.test.mjs tests/data/legal-hold-sovereign.test.mjs tests/persistence/db-config.test.mjs',
revocation:'env -u DATABASE_URL node /tmp/council-gpt-6-astra/revocation-probe.mjs',
safeMode:'env -u DATABASE_URL node --test tests/core/safe-mode-persistence.test.mjs tests/root-of-trust/wl-302-royal-command-authorization.test.mjs',
inventory:'env -u DATABASE_URL node /tmp/council-gpt-6-astra/inventory.mjs',
paths:'git ls-tree -r 284f74d0 --name-only | rg M11.06; printf \"TREE_FILTER_EXIT=%s\\n\" \"$?\"; env -u DATABASE_URL node --test tests/agents/; printf \"AGENTS_EXIT=%s\\n\" \"$?\"; env -u DATABASE_URL node scripts/retention.mjs purge; printf \"PURGE_CLI_EXIT=%s\\n\" \"$?\"; env -u DATABASE_URL npm run hsm:verify:f05; printf \"HSM_EXIT=%s\\n\" \"$?\"; env -u DATABASE_URL NODE_ENV=production XUUX_STATE_ROOT=/tmp/council-gpt-6-astra/cli-root XUUX_FRESHNESS_BACKEND=council node scripts/production-entry.mjs; printf \"PRODUCTION_CLI_EXIT=%s\\n\" \"$?\"',
probes:'env -u DATABASE_URL node /tmp/council-gpt-6-astra/probes.mjs',
vetoProbe:'env -u DATABASE_URL node /tmp/council-gpt-6-astra/veto-probe.mjs',
mutation:'env -u DATABASE_URL node /tmp/council-gpt-6-astra/doc-mutation.mjs',
};
for(const name of process.argv.slice(2)){
const command=groups[name];
const start=new Date().toISOString();
const r=spawnSync('bash',['-c',command],{cwd:root,env:{...process.env,TMPDIR:out},encoding:'utf8',maxBuffer:20*1024*1024});
const record={name,command,start,end:new Date().toISOString(),exit:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr};
writeFileSync(`${out}/${name}.json`,JSON.stringify(record,null,2));
console.log(JSON.stringify({...record,stdout:r.stdout?.slice(-1900)}));
}
