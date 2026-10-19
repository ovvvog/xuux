import { readFileSync } from 'node:fs';
const base = '/tmp/council-wl420-gpt_6_1_sol/';
const get = name => readFileSync(base + name, 'utf8');
for (const id of ['07-head-wl416', '15-old-native', '16-old-four', '20-head-four', '23-r3-fup']) {
  const tap = get(id + '.stdout.txt');
  console.log(JSON.stringify({
    run: id, exit: Number(get(id + '.exit.txt')),
    counters: tap.split('\n').filter(x => /^# (tests|pass|fail|skipped|cancelled|duration_ms) /.test(x)),
    selected: tap.split('\n').filter(x => /^(not )?ok \d+ - (NV[45]|L7[ab]):/.test(x)),
  }));
}
for (const mode of ['nv-appear-late', 'nv-appear-after-define', 'nv-appear-after-primary', 'inventory-more0-hide']) {
  for (const prefix of ['22-detail-', '26-old-detail-']) {
    if (prefix.startsWith('26') && (mode === 'nv-appear-late' || mode === 'inventory-more0-hide')) continue;
    const id = prefix + mode;
    const o = JSON.parse(get(id + '.stdout.txt'));
    const codes = new Set(['0x0000012a', '0x00000134', '0x00000122', '0x00000131', '0x00000153', '0x00000157', '0x00000176', '0x00000160', '0x0000016c', '0x00000165']);
    console.log(JSON.stringify({
      run: id, exit: Number(get(id + '.exit.txt')),
      status: o.report.status, failure: o.report.failure, changes: o.fault.changes,
      mutations: o.report.steps.filter(x => codes.has(x.commandCode)).map(x => x.name),
      nvAfter: o.nvAfter,
      guardIndices: o.report.facts['nvOwnershipGuard.unresolvedIndices'],
    }));
  }
}
