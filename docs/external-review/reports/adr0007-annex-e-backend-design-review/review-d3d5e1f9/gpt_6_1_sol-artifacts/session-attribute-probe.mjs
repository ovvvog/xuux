import { spawn } from 'node:child_process';
import { mkdirSync, appendFileSync } from 'node:fs';
import net from 'node:net';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { once } from 'node:events';

const root = '/tmp/council-wl437/gpt_6_1_sol';
const state = root + '/swtpm-attribute-state';
mkdirSync(state, { recursive: true });
const port = 7700;
const sim = spawn('swtpm', ['socket', '--tpm2', '--tpmstate', `dir=${state}`, '--server', `type=tcp,port=${port},bindaddr=127.0.0.1`, '--ctrl', `type=tcp,port=${port + 1},bindaddr=127.0.0.1`, '--flags', 'not-need-init'], { stdio: ['ignore', 'pipe', 'pipe'] });
sim.stderr.on('data', d => appendFileSync(root + '/swtpm-attribute-stderr.log', d));
sim.stdout.on('data', d => appendFileSync(root + '/swtpm-attribute-stdout.log', d));
const u16 = x => { const b = Buffer.alloc(2); b.writeUInt16BE(x); return b; };
const u32 = x => { const b = Buffer.alloc(4); b.writeUInt32BE(x); return b; };
const b2 = b => Buffer.concat([u16(b.length), b]);
const sha = b => createHash('sha256').update(b).digest();
function packet(cc, payload, tag = 0x8001) {
  return Buffer.concat([u16(tag), u32(payload.length + 10), u32(cc), payload]);
}
function send(bytes) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let data = Buffer.alloc(0);
    socket.setTimeout(3000, () => socket.destroy(new Error('timeout')));
    socket.on('error', reject);
    socket.on('connect', () => socket.write(bytes));
    socket.on('data', chunk => {
      data = Buffer.concat([data, chunk]);
      if (data.length >= 10 && data.length >= data.readUInt32BE(2)) {
        socket.destroy();
        resolve(data);
      }
    });
  });
}
async function start(type = 0) {
  const nonce = randomBytes(32);
  const p = Buffer.concat([u32(0x40000007), u32(0x40000007), b2(nonce), b2(Buffer.alloc(0)), Buffer.from([type]), u16(0x0010), u16(0x000b)]);
  const r = await send(packet(0x176, p));
  const rc = r.readUInt32BE(6);
  if (rc !== 0) throw new Error(`StartAuthSession=0x${rc.toString(16)}`);
  return { handle: r.readUInt32BE(10), nonceTPM: r.subarray(16, 16 + r.readUInt16BE(14)) };
}
async function withHmac(cc, handles, names, parameters, attrs) {
  const s = await start();
  const nonceCaller = randomBytes(32);
  const cpHash = sha(Buffer.concat([u32(cc), names, parameters]));
  const hmac = createHmac('sha256', Buffer.alloc(0)).update(Buffer.concat([cpHash, nonceCaller, s.nonceTPM, Buffer.from([attrs])])).digest();
  const auth = Buffer.concat([u32(s.handle), b2(nonceCaller), Buffer.from([attrs]), b2(hmac)]);
  const r = await send(packet(cc, Buffer.concat([handles, u32(auth.length), auth, parameters]), 0x8002));
  await send(packet(0x165, u32(s.handle)));
  return { command: `0x${cc.toString(16)}`, attrs: `0x${attrs.toString(16)}`, rc: `0x${r.readUInt32BE(6).toString(16)}`, tag: `0x${r.readUInt16BE(0).toString(16)}`, responseBytes: r.length };
}
try {
  await new Promise(r => setTimeout(r, 250));
  const startup = await send(packet(0x144, u16(0)));
  console.log('SIM_STARTUP', startup.toString('hex'));
  const params = Buffer.concat([u32(6), u32(0x100), u32(1)]);
  console.log('GETCAP_HMAC_ONLY', JSON.stringify(await withHmac(0x17a, Buffer.alloc(0), Buffer.alloc(0), params, 0x01)));
  console.log('GETCAP_HMAC_AUDIT', JSON.stringify(await withHmac(0x17a, Buffer.alloc(0), Buffer.alloc(0), params, 0x81)));
  const policy = await start(1);
  console.log('POLICYCOMMANDCODE_HMAC_ONLY', JSON.stringify(await withHmac(0x16c, u32(policy.handle), u32(policy.handle), u32(0x137), 0x01)));
  console.log('POLICYCOMMANDCODE_HMAC_AUDIT', JSON.stringify(await withHmac(0x16c, u32(policy.handle), u32(policy.handle), u32(0x137), 0x81)));
  await send(packet(0x165, u32(policy.handle)));
} finally {
  sim.kill('SIGTERM');
  await once(sim, 'exit');
}
