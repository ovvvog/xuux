import fs from 'node:fs';
import assert from 'node:assert/strict';
const root='/tmp/council-wl422-gpt_6_1_sol/';
for(const stem of ['05-l7-l8','08-l7-l8-enabled','11-full-wl416','25-new-tests-old-helper',
  '27-sc1-raw-baseline','28-sc1-mutant','30-sc1-after-mutant','33-fup-response-context']){
  const text=fs.readFileSync(root+stem+'.stdout.txt','utf8');
  console.log(JSON.stringify({run:stem,exit:fs.readFileSync(root+stem+'.exit.txt','utf8').trim(),
    counts:text.split('\n').filter(l=>/^# (tests|pass|fail|skipped|cancelled|duration_ms) /.test(l)),
    failures:text.split('\n').filter(l=>l.startsWith('not ok '))}));
}
for(const stem of ['27-sc1-raw-baseline','28-sc1-mutant']){
  const text=fs.readFileSync(root+stem+'.stdout.txt','utf8');
  for(const line of text.split('\n')){
    if(!line.startsWith('# REVIEW_HARNESS_JSON '))continue;
    const obj=JSON.parse(line.slice('# REVIEW_HARNESS_JSON '.length).replaceAll('\\#','#'));
    const summary={run:stem};
    if(obj.cases)summary.cases=obj.cases;
    if(obj.report){
      summary.mode=obj.fault.mode;summary.status=obj.report.status;
      summary.witness=obj.fault;summary.ctxFacts=Object.fromEntries(
        Object.entries(obj.report.facts).filter(([k])=>k.startsWith('ctx.')));
      summary.reconciliation=obj.report.reconciliation;
    }
    console.log(JSON.stringify(summary));
    if(obj.fault?.mode==='consumed-session-witness'){
      assert.equal(obj.fault.witnessPresentBefore,true);
      assert.equal(obj.fault.witnessPresentAfter,false);
      assert.equal(obj.report.status,'COMPLETE');
      const suffix=stem==='28-sc1-mutant'?'False':'True';
      assert.equal(obj.report.facts['ctx.endOfLife.sessionConsumed'],
        `session-consumed ${obj.fault.witnessSession} contextGone=${suffix}`);
    }
  }
}
