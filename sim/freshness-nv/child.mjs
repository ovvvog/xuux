// @ts-nocheck
// sim/freshness-nv/child.mjs
//
// WL-431 — عمليّةُ عميلٍ مستقلّةٌ لمجسِّ مرجعِ الحداثة: تُثبتُ أنّ المرجعَ يُقرأُ بعدَ انتهاءِ عمليّةِ
// العميلِ وتشغيلِها ثانيةً، وتقيسُ التزامنَ والسقوطَ (‏SIGKILL) عبرَ العمليات. **محاكاةٌ فقط.**
//
// الوسيطُ الوحيد: JSON ‏`{tcti, counterIndex, recordIndex, lockDir, op, from?, to?, faults?, goFile?, binding?}`
// (‏`binding = {file, publicKeyPem}` في WL-433: الربطُ المختومُ يُتحقَّقُ منه ولا يُختَمُ في العميل).
// المخرجُ: سطرُ JSON واحدٌ ‏`{ok, reading?|code?, name?}` (‏العهودُ نصًّا).

import { createPublicKey } from 'node:crypto';
import { existsSync } from 'node:fs';

import { Tpm2Tools } from './swtpm-harness.mjs';
import { SwtpmNvStateBoundSocket } from './nv-state-bound-socket.mjs';

const spec = JSON.parse(process.argv[2]);
const tools = new Tpm2Tools(spec.tcti);
const socket = new SwtpmNvStateBoundSocket({
  tools: () => tools,
  counterIndex: spec.counterIndex,
  recordIndex: spec.recordIndex,
  lockDir: spec.lockDir,
  binding: spec.binding ? { file: spec.binding.file, publicKey: createPublicKey(spec.binding.publicKeyPem) } : null,
});
socket.faults = spec.faults ?? [];
const reading = (r) => ({ epoch: r.epoch.toString(), anchor: r.anchor });
const parse = (r) => ({ epoch: BigInt(r.epoch), anchor: r.anchor });

async function main() {
  if (spec.goFile) {
    const deadline = Date.now() + 20000;
    while (!existsSync(spec.goFile)) {
      if (Date.now() > deadline) throw new Error('GO_TIMEOUT');
      await new Promise((r) => setTimeout(r, 2));
    }
  }
  if (spec.op === 'provision') return { ok: true, base: (await socket.provision()).base.toString() };
  if (spec.op === 'read') return { ok: true, reading: reading(await socket.read()) };
  if (spec.op === 'advance') {
    return { ok: true, reading: reading(await socket.advanceState(parse(spec.from), parse(spec.to))) };
  }
  throw new Error(`unknown op ${spec.op}`);
}

main().then(
  (result) => {
    process.stdout.write(JSON.stringify({ ...result, applied: socket.applied }) + '\n');
  },
  (error) => {
    process.stdout.write(
      JSON.stringify({ ok: false, code: error.code ?? null, name: error.name, message: error.message, applied: socket.applied }) + '\n',
    );
    process.exitCode = 3;
  },
);
