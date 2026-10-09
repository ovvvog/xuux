/**
 * `R6-B-03` — قياسُ المصافحةِ لا قراءةُ الإعداد.
 *
 * النتيجةُ: وصلةُ `DATABASE_URL` المُعلَنةُ للجولةِ (‏`sslmode=require` إلى قاعدةٍ
 * تُوقِّعُ شهادتَها جهةٌ خاصّةٌ) كانت تَسقُطُ بـ`SELF_SIGNED_CERT_IN_CHAIN` فيخرجُ
 * `guard:encryption` بـ`1` قبلَ الاختبارات. والإصلاحُ (‏`PR #99`، `createPool` يبني
 * خيارَ `ssl` بالشهادةِ المُعلَنةِ ويَحذِفُ `sslmode`) **قُرِئَ** في الجولةِ السابعةِ
 * ولم يُقَسْ: «لا قياسَ لاتصالِ قاعدةٍ حقيقيّة» — فبقيَتِ النتيجةُ `open`.
 *
 * **فهذا الملفُّ يقيسُ ما لم يُقَس** على مِقبسٍ حقيقيٍّ ومصافحةٍ حقيقيّةٍ:
 * خادمٌ يتكلّمُ بروتوكولَ PostgreSQL على السلكِ (‏`SSLRequest` ⇐ `S` ⇐ TLS ⇐
 * `StartupMessage` ⇐ `AuthenticationOk` ⇐ `ReadyForQuery`) ويُقدِّمُ **سلسلةً**
 * (‏الورقةُ وجهةُ الإصدارِ الذاتيّةُ التوقيعِ معاً) — وهي عينُ ما يُقدِّمُه مزوِّدُ
 * قاعدةٍ مُدارةٍ، وعينُ ما يُنتِجُ `SELF_SIGNED_CERT_IN_CHAIN` بلا شهادةٍ مُعلَنة.
 *
 * والدعاوى المقيسةُ، وكلٌّ يسقطُ وحدَه إن انكسر:
 * 1. بلا شهادةٍ مُعلَنةٍ ⇐ `SELF_SIGNED_CERT_IN_CHAIN` (‏استنساخُ مسارِ النتيجةِ بحرفِه)،
 *    **ولا يصلُ الخادمَ بايتُ `StartupMessage` واحدٌ** (‏لا اعتمادَ يعبرُ قناةً لم تُوثَّق).
 * 2. بالشهادةِ المُعلَنةِ (‏`DATABASE_CA_FILE`) ⇐ مصافحةٌ مُوثَّقةٌ واستعلامٌ يعودُ،
 *    والخادمُ يرى قناتَه مُعمّاةً.
 * 3. بجهةِ إصدارٍ **أخرى** ⇐ رفضٌ: الشهادةُ المُعلَنةُ مِرساةٌ لا إسقاطُ تحقُّق.
 * 4. `guard:encryption` **عمليّةً منفصلةً** بالوصلةِ المُعلَنةِ والشهادةِ ⇐ يخرجُ `0`
 *    ويفحصُ كلَّ مخزنٍ معلَنٍ؛ وبلا الشهادةِ ⇐ يخرجُ غيرَ صفرٍ بالرمزِ نفسِه.
 *
 * **حدٌّ مُعلَنٌ:** الخادمُ مُحاكٍ للبروتوكولِ لا PostgreSQL نفسُه — يقيسُ مصافحةَ
 * TLS وسلسلةَ الثقةِ ومسارَ الحاجزِ بايتاً ببايتٍ على السلكِ، ولا يقيسُ إعدادَ TLS في
 * خادمِ PostgreSQL حقيقيٍّ (‏`ssl_cert_file` …). والمادّةُ تُولَّدُ بـ`openssl` في
 * مجلَّدٍ مؤقَّتٍ خارجَ المستودعِ وتُمحى (‏`tests/helpers/tls-material.mjs`).
 */

import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import tls from 'node:tls';

import { createPool } from '../../src/persistence/db.mjs';
import { issueMaterial } from '../helpers/tls-material.mjs';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

const ROOT = process.cwd();
const SSL_REQUEST_CODE = 80877103;

/**
 * رسالةُ خادمٍ: نوعٌ ثمّ طولٌ (‏يشملُ نفسَه) ثمّ الحمولة.
 * @param {string} type
 * @param {Buffer} payload
 * @returns {Buffer}
 */
function message(type, payload) {
  const head = Buffer.alloc(5);
  head.write(type, 0, 'ascii');
  head.writeInt32BE(payload.length + 4, 1);
  return Buffer.concat([head, payload]);
}

/** @returns {Buffer} */
function readyForQuery() {
  return message('Z', Buffer.from('I', 'ascii'));
}

/**
 * وصفُ صفوفٍ بأعمدةٍ نصّيّةٍ (‏`text`، OID 25) — ما يطلبُه الحاجزُ: `id` · `content` · `classification`.
 * @param {string[]} names
 * @returns {Buffer}
 */
function rowDescription(names) {
  const count = Buffer.alloc(2);
  count.writeInt16BE(names.length, 0);
  const parts = [count];
  for (const name of names) {
    const field = Buffer.alloc(18);
    field.writeInt32BE(0, 0); // tableOID
    field.writeInt16BE(0, 4); // attnum
    field.writeInt32BE(25, 6); // typeOID: text
    field.writeInt16BE(-1, 10); // typlen
    field.writeInt32BE(-1, 12); // typmod
    field.writeInt16BE(0, 16); // format: text
    parts.push(Buffer.from(`${name}\0`, 'utf8'), field);
  }
  return message('T', Buffer.concat(parts));
}

/**
 * خادمٌ يتكلّمُ بروتوكولَ PostgreSQL على السلكِ ويشترطُ TLS. يُجيبُ كلَّ استعلامٍ بسيطٍ
 * بصفرِ صفوفٍ — فالمقيسُ القناةُ والثقةُ لا محتوى القاعدة.
 * @param {{ key: Buffer, cert: Buffer, ca: Buffer }} material
 * @returns {Promise<{ port: number, observed: { sslRequests: number, encrypted: number, startups: number, queries: string[], handshakeErrors: string[] }, close: () => Promise<void> }>}
 */
async function startWireServer(material) {
  const observed = {
    sslRequests: 0,
    encrypted: 0,
    startups: 0,
    /** @type {string[]} */
    queries: [],
    /** @type {string[]} */
    handshakeErrors: [],
  };
  /** @type {Set<net.Socket>} */
  const sockets = new Set();
  const server = net.createServer((raw) => {
    sockets.add(raw);
    raw.on('close', () => sockets.delete(raw));
    raw.on('error', () => {});
    raw.once('data', (first) => {
      if (first.length < 8 || first.readInt32BE(4) !== SSL_REQUEST_CODE) {
        // لا رجوعَ إلى نصٍّ صريحٍ: من لم يطلبْ TLS قُطِع.
        raw.destroy();
        return;
      }
      observed.sslRequests += 1;
      raw.write('S');
      const secure = new tls.TLSSocket(raw, {
        isServer: true,
        key: material.key,
        // السلسلةُ كاملةً: الورقةُ ثمّ جهةُ الإصدارِ الذاتيّةُ التوقيعِ — كما يُقدِّمُها
        // مزوِّدٌ مُدارٌ، فيُنتِجُ غيابُ المِرساةِ `SELF_SIGNED_CERT_IN_CHAIN` بحرفِه.
        cert: Buffer.concat([material.cert, material.ca]),
        minVersion: 'TLSv1.2',
      });
      secure.on('error', (error) => {
        observed.handshakeErrors.push(/** @type {Error} */ (error).message);
      });
      secure.on('secure', () => {
        observed.encrypted += 1;
      });
      let buffer = Buffer.alloc(0);
      let started = false;
      secure.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        for (;;) {
          if (!started) {
            if (buffer.length < 4) return;
            const length = buffer.readInt32BE(0);
            if (buffer.length < length) return;
            buffer = buffer.subarray(length);
            started = true;
            observed.startups += 1;
            const auth = Buffer.alloc(4);
            auth.writeInt32BE(0, 0);
            secure.write(Buffer.concat([message('R', auth), readyForQuery()]));
            continue;
          }
          if (buffer.length < 5) return;
          const type = String.fromCharCode(buffer[0] ?? 0);
          const length = buffer.readInt32BE(1);
          if (buffer.length < length + 1) return;
          const payload = buffer.subarray(5, length + 1);
          buffer = buffer.subarray(length + 1);
          if (type === 'Q') {
            observed.queries.push(payload.toString('utf8').replace(/\0$/u, ''));
            secure.write(
              Buffer.concat([
                rowDescription(['id', 'content', 'classification']),
                message('C', Buffer.from('SELECT 0\0', 'utf8')),
                readyForQuery(),
              ]),
            );
          } else if (type === 'X') {
            secure.end();
            return;
          }
        }
      });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = /** @type {net.AddressInfo} */ (server.address());
  return {
    port: address.port,
    observed,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve(undefined));
      }),
  };
}

/** @returns {{ dir: string, trusted: ReturnType<typeof issueMaterial>, foreign: ReturnType<typeof issueMaterial> }} */
function material() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r6-b-03-tls-'));
  registerTmpRoot(dir);
  return { dir, trusted: issueMaterial(dir, 'db'), foreign: issueMaterial(dir, 'foreign') };
}

/**
 * @param {ReturnType<typeof issueMaterial>} issued
 * @returns {{ key: Buffer, cert: Buffer, ca: Buffer }}
 */
function read(issued) {
  return {
    key: fs.readFileSync(issued.keyFile),
    cert: fs.readFileSync(issued.certFile),
    ca: fs.readFileSync(issued.caFile),
  };
}

/**
 * يعزلُ الاختبارَ عن شهادةٍ في بيئةِ المُشغِّلِ: «بلا شهادةٍ مُعلَنةٍ» يعني بلا شهادةٍ فعلاً.
 * @returns {() => void} مُعيدُ البيئةِ كما كانت
 */
function isolateCaEnv() {
  const saved = { file: process.env['DATABASE_CA_FILE'], pem: process.env['DATABASE_CA'] };
  delete process.env['DATABASE_CA_FILE'];
  delete process.env['DATABASE_CA'];
  return () => {
    if (saved.file !== undefined) process.env['DATABASE_CA_FILE'] = saved.file;
    if (saved.pem !== undefined) process.env['DATABASE_CA'] = saved.pem;
  };
}

/** @param {number} port */
function urlFor(port) {
  return `postgresql://reviewer@127.0.0.1:${port}/postgres?sslmode=require`;
}

/**
 * يُعيدُ رمزَ خطأِ الوصلةِ أوّلَ استعلامٍ — أو `null` إن نجح.
 * @param {import('pg').Pool} pool
 * @returns {Promise<string | null>}
 */
async function firstQueryError(pool) {
  try {
    await pool.query('SELECT 1');
    return null;
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code ?? String(error);
  } finally {
    await pool.end();
  }
}

test('R6-B-03: بلا شهادةٍ مُعلَنةٍ تسقطُ المصافحةُ بـSELF_SIGNED_CERT_IN_CHAIN ولا يعبرُ اعتمادٌ', async () => {
  const { dir, trusted } = material();
  const server = await startWireServer(read(trusted));
  try {
    const restore = isolateCaEnv();
    let code;
    try {
      code = await firstQueryError(createPool({ url: urlFor(server.port) }));
    } finally {
      restore();
    }
    assert.equal(code, 'SELF_SIGNED_CERT_IN_CHAIN', 'استنساخُ مسارِ النتيجةِ بحرفِه');
    assert.equal(server.observed.sslRequests, 1, 'العميلُ طلبَ TLS');
    assert.equal(
      server.observed.startups,
      0,
      'لا `StartupMessage` — اسمُ المستخدمِ لا يعبرُ قناةً لم تُوثَّق',
    );
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('R6-B-03: بالشهادةِ المُعلَنةِ تُوثَّقُ المصافحةُ ويعودُ الاستعلامُ', async () => {
  const { dir, trusted } = material();
  const server = await startWireServer(read(trusted));
  try {
    const pool = createPool({ url: urlFor(server.port), caFile: trusted.caFile });
    try {
      const result = await pool.query('SELECT 1');
      assert.deepEqual(
        result.fields.map((f) => f.name),
        ['id', 'content', 'classification'],
      );
      assert.equal(result.rows.length, 0);
    } finally {
      await pool.end();
    }
    assert.equal(server.observed.encrypted, 1, 'الخادمُ رأى قناتَه مُعمّاةً');
    assert.equal(server.observed.startups, 1);
    assert.deepEqual(server.observed.queries, ['SELECT 1']);
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('R6-B-03: جهةُ إصدارٍ أخرى تُرَدُّ — الشهادةُ المُعلَنةُ مِرساةٌ لا إسقاطُ تحقُّقٍ', async () => {
  const { dir, trusted, foreign } = material();
  const server = await startWireServer(read(trusted));
  try {
    const code = await firstQueryError(
      createPool({ url: urlFor(server.port), caFile: foreign.caFile }),
    );
    assert.equal(code, 'SELF_SIGNED_CERT_IN_CHAIN');
    assert.equal(server.observed.startups, 0);
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * بيئةُ الحاجزِ: الوصلةُ والشهادةُ ممّا يُمرَّرُ وحدَه — لا تتسرّبُ شهادةٌ من بيئةِ المُشغِّل.
 * @param {Record<string, string>} extra
 * @returns {NodeJS.ProcessEnv}
 */
function guardEnv(extra) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env };
  delete env['DATABASE_CA_FILE'];
  delete env['DATABASE_CA'];
  return { ...env, ...extra };
}

const GUARD = path.join(ROOT, 'scripts/guard-encryption.mjs');

/**
 * الحاجزُ غيرَ متزامنٍ: الخادمُ في العمليّةِ نفسِها، و`spawnSync` كان سيحجبُ حلقتَه فلا يُجيب.
 * @param {Record<string, string>} extra
 * @returns {Promise<{ status: number, output: string, stdout: string }>}
 */
function runGuardAsync(extra) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [GUARD],
      { cwd: ROOT, env: guardEnv(extra), encoding: 'utf8', timeout: 30_000 },
      (error, stdout, stderr) =>
        resolve({
          status: error === null ? 0 : typeof error.code === 'number' ? error.code : 1,
          output: `${stdout}${stderr}`,
          stdout,
        }),
    );
  });
}

test('R6-B-03: `guard:encryption` عمليّةً منفصلةً — يعبرُ بالشهادةِ المُعلَنةِ ويسقطُ بدونِها', async () => {
  const { dir, trusted } = material();
  const server = await startWireServer(read(trusted));
  try {
    const url = urlFor(server.port);
    const ok = await runGuardAsync({ DATABASE_URL: url, DATABASE_CA_FILE: trusted.caFile });
    assert.equal(ok.status, 0, `الحاجزُ يعبرُ بالشهادةِ المُعلَنةِ:\n${ok.output}`);
    assert.match(ok.stdout, /فُحص 0 صفّاً/u, 'فحصَ المخزونَ فعلاً عبرَ القناةِ المُوثَّقةِ');
    assert.ok(
      server.observed.queries.some((q) => q.includes('state.data_assets')),
      'استعلامُ R5 وصلَ الخادمَ',
    );

    const refused = await runGuardAsync({ DATABASE_URL: url });
    assert.notEqual(refused.status, 0, 'بلا الشهادةِ لا يُقرأُ الحاجزُ نجاحاً');
    assert.match(
      refused.output,
      /self-signed certificate in certificate chain|SELF_SIGNED_CERT_IN_CHAIN/u,
    );
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// بلا خادمٍ في العمليّةِ يكفي التشغيلُ المتزامن: وصلةٌ بلا TLS تُرَدُّ قبلَ أيِّ اتّصالٍ.
test('R6-B-03: وصلةُ الجولةِ بلا TLS إلى مضيفٍ غيرِ محلّيٍّ تُرَدُّ بـENCRYPTION_TRANSPORT_INSECURE قبلَ الشبكةِ', () => {
  const result = spawnSync(process.execPath, [GUARD], {
    cwd: ROOT,
    env: guardEnv({ DATABASE_URL: 'postgresql://reviewer@db.invalid:5432/postgres' }),
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /ENCRYPTION_TRANSPORT_INSECURE/u);
});
