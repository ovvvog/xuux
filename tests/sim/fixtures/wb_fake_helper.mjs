#!/usr/bin/env node
// @ts-nocheck
// tests/sim/fixtures/wb_fake_helper.mjs
//
// WL-511 — مساعدٌ زائفٌ لقياسِ عقدِ بروتوكولِ W-B (‏sim/tpm-host/wb_helper_protocol.mjs)
// على بيئةِ المحاكاةِ (Linux/CI). ليس مساعدًا حقيقيًّا ولا يلمسُ TPM/TBS/Windows.
// يقرأ إطارًا واحدًا من stdin ويردُّ بإطارٍ واحدٍ — وسلوكُه الفاسدُ يُختارُ بمتغيرِ
// WB_FAKE_MODE لقياسِ الفشلِ المغلقِ سلوكًا بكلِّ رموزِه.

import { frame, parseMessage } from '../../../sim/tpm/channel_protocol.mjs';

const mode = process.argv[2] ?? process.env.WB_FAKE_MODE ?? 'ok';
const chunks = [];
process.stdin.on('data', (d) => chunks.push(d));
process.stdin.on('end', () => {
  const req = parseMessage(Buffer.concat(chunks));
  if (!req.ok) {
    process.stderr.write(`fake helper: bad request frame: ${req.error}`);
    process.exit(3);
  }
  /** @type {any} */
  let body;
  try {
    body = JSON.parse(req.payload?.toString('utf8') ?? '');
  } catch {
    process.stderr.write('fake helper: payload is not JSON');
    process.exit(3);
  }
  const nonce = body?.nonce ?? '';

  const respond = (payload, after) => {
    const out = frame(Buffer.from(JSON.stringify(payload)), 0);
    process.stdout.write(out, () => {
      if (after) after();
      else process.exit(0);
    });
  };

  switch (mode) {
    case 'ok':
      respond({ schema: 'xuux.wb-helper/1', ok: true, nonce, result: { echo: body?.op, args: body?.args } });
      return;
    case 'okfalse':
      respond({ schema: 'xuux.wb-helper/1', ok: false, nonce, error: 'WB_HELPER_REPORTED_FAILURE' });
      return;
    case 'wrongnonce':
      respond({ schema: 'xuux.wb-helper/1', ok: true, nonce: '0'.repeat(32), result: null });
      return;
    case 'garbage':
      process.stdout.write(Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]));
      process.exit(0);
      return;
    case 'badcrc': {
      const out = frame(Buffer.from(JSON.stringify({ schema: 'xuux.wb-helper/1', ok: true, nonce, result: null })), 0);
      out[out.length - 1] ^= 0xff; // إفسادُ CRC
      process.stdout.write(out);
      process.exit(0);
      return;
    }
    case 'extra': {
      const out = frame(Buffer.from(JSON.stringify({ schema: 'xuux.wb-helper/1', ok: true, nonce, result: null })), 0);
      process.stdout.write(Buffer.concat([out, Buffer.from('trailing bytes')]));
      process.exit(0);
      return;
    }
    case 'exit1':
      respond({ schema: 'xuux.wb-helper/1', ok: true, nonce, result: null }, () => process.exit(1));
      return;
    case 'stderr':
      process.stderr.write('noise on stderr');
      respond({ schema: 'xuux.wb-helper/1', ok: true, nonce, result: null });
      return;
    case 'silent':
      // لا ردَّ أبدًا: يبقى حيًّا (مؤقّتٌ يُبقي الحلقةَ) حتى يقتله العميلُ بالمهلةِ.
      setInterval(() => {}, 1000);
      return;
    case 'late':
      setTimeout(() => respond({ schema: 'xuux.wb-helper/1', ok: true, nonce, result: null }), 5000);
      return;
    default:
      process.stderr.write(`fake helper: unknown mode ${mode}`);
      process.exit(4);
  }
});
