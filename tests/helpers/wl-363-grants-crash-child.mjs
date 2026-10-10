// @ts-nocheck
// tests/helpers/wl-363-grants-crash-child.mjs
//
// `WL-363` — عمليّةٌ فرعيّةٌ تُقلِعُ الجذرَ الإنتاجيَّ الحقيقيَّ وتركِّبُ سلسلةَ الإنفاذِ
// (دفترُ منحِ القدراتِ موصولٌ بحاجزِ الالتزامِ عبرَ `grantsTxn`) ثمَّ تُنفِّذُ منحاً أو سحباً
// معامَليّاً وتُقتَلُ بـ`SIGKILL` في نقطةٍ بعينِها من مراحلِ الالتزامِ. لا مسَّ بشفرةِ
// الإنتاج: النقاطُ خطّافُ `onStage` في الحاجزِ وأعطالُ المرجعِ المحقونة.
//
// الوسيط: مسارُ ملفِّ JSON: { root, keys, socketFile, op, spec, kill }
//   op            'grant' | 'revoke' | 'close-persist'
//   spec          وسيطُ grantAsync أو { id, reason } للسحب
//   kill.stage    'S2' | 'S3' | 'S4' | 'S5' | 'ACK' | 'AFTER_ACK' | 'BEFORE_TXN'
//   kill.socket   عطلٌ يُحقَنُ في المرجع (‏'kill-before-apply' | 'kill-after-apply')
//   kill.inFn     قتلٌ داخلَ جسمِ المعاملةِ بعدَ الكتابةِ الأولى (‏كتابةٌ ممزّقة)
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const kill = config.kill ?? {};
const die = () => process.kill(process.pid, 'SIGKILL');

if (kill.renameMatch) {
  const original = fs.renameSync;
  fs.renameSync = function (from, to) {
    const out = original.call(fs, from, to);
    if (String(to).includes(kill.renameMatch)) die();
    return out;
  };
  syncBuiltinESMExports();
}

const { FileStateBoundSocket, bootRoot } = await import('./wl-326-root.mjs');
const socket = new FileStateBoundSocket(config.socketFile);
const runtime = await bootRoot(config.root, config.keys, socket);
if (kill.socket) socket.faults.push(kill.socket);
// شاهدُ المنحِ من السجلِّ المختومِ (عقدُ الإنتاجِ: `grantsFromSealedLog`) — لا يُمرَّر
// بلاهُ فلا تُفحصُ أصالةُ أيِّ منحةٍ تُعيدُها التشغيلةُ اللاحقةُ.
const { grantsFromSealedLog } = await import('../../src/root-of-trust/production-runtime.mjs');
const grantWitness = await grantsFromSealedLog(runtime.log);

// سلسلةُ الإنفاذِ فوقَ الجذرِ الحقيقيّ: الدفترُ موصولٌ بالحاجزِ (grantsTxn) كما في
// `createProductionSystem` — نفسُ العقدِ لا محاكاةٍ.
const { composeEnforcementChain } = await import('../../src/core/composition-root.mjs');
const { FileCapabilityGrantStore } = await import('../../src/identity/capability-grant-store.mjs');
const { sealedAudit } = await import('../../src/root-of-trust/sealed-audit.mjs');
const chain = composeEnforcementChain({
  log: sealedAudit(runtime.log),
  withLegislation: false,
  crown: null,
  haltSwitch: runtime.haltSwitch,
  kingIdentity: runtime.kingIdentity ?? null,
  authority: runtime.authority ?? null,
  royalCommandVerifier: null,
  grantsStore: new FileCapabilityGrantStore({
    filePath: config.root + '/capability-grants.json',
  }),
  grantWitness,
  grantsTxn: (intent, fn) => runtime.commitBarrier.run(intent, fn),
});
const grants = chain.grants;

runtime.commitBarrier.onStage = (stage) => {
  if (kill.stage === stage) die();
};
if (kill.stage === 'BEFORE_TXN') die();

process.stdout.write('BOOTED\n');
if (config.op === 'grant') {
  // C3: كتابةٌ ممزّقةٌ — قتلٌ داخلَ جسمِ المعاملةِ بعدَ أولِ كتابةٍ للملفِّ.
  if (kill.inFn) {
    const originalWrite = fs.writeFileSync;
    fs.writeFileSync = function (file, data, ...rest) {
      const out = originalWrite.call(fs, file, data, ...rest);
      if (String(file).endsWith('capability-grants.json.tmp')) die();
      return out;
    };
    syncBuiltinESMExports();
  }
  const granted = await grants.grantAsync(config.spec);
  process.stdout.write(`GRANTED:${granted.id}\n`);
} else if (config.op === 'revoke') {
  const revoked = await grants.revokeAsync(config.spec.id, config.spec.reason);
  process.stdout.write(`REVOKED:${revoked.id}\n`);
} else if (config.op === 'close-persist') {
  // صرفُ حفظٍ معلَّقٍ عبرَ الإغلاقِ (معاملةُ grants.persist) — لا كاتبَ ثانٍ.
  await runtime.commitBarrier.run('grants.persist', async () => {
    await grants.persist();
  });
  process.stdout.write('PERSISTED\n');
}
process.stdout.write('ACK\n');
if (kill.stage === 'AFTER_ACK') die();
await runtime.close();
process.exit(0);
