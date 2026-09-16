#!/usr/bin/env node
// أداةُ إبرهانِ الوقتِ — إغلاقُ الدَّينِ `D-7` (‏`WL-192`).
//
// ثلاثةُ أطوارٍ، وكلُّها تُخرِجُ رمزَ خروجٍ يُقرأُ آلياً:
//
//   --self-check  فحصٌ ذاتيٌّ **على سلكٍ حقيقيٍّ**: يُشغِّلُ شاهدَينِ محليَّينِ
//                 يوقِّعانِ بمفتاحَينِ عابرَينِ على مِقبسَي UDP، ثمّ يُبرهِنُ
//                 الوقتَ منهما، ثمّ يُثبتُ أنَّ شاهداً كاذباً يُرفَضُ. لا يلمسُ
//                 الشبكةَ الخارجيّةَ، فيصلحُ في بيئةِ بناءٍ لا خروجَ فيها على
//                 UDP — وهي بيئةُ هذا المستودعِ (‏حدٌّ مُعلَنٌ في
//                 `docs/TIME.md`).
//   --once        سؤالُ مصادرِ `config/time.yaml` الحقيقيّةِ مرّةً. يفشلُ حيثُ
//                 لا خروجَ على UDP، وفشلُه رفضٌ مُسمّى لا صمتٌ.
//   --describe    طباعةُ السياسةِ المُحمَّلةِ بلا سؤالِ أحدٍ.
//
// و`--json` يطبعُ تقريراً واحداً بصيغةٍ تُقرأُ آلياً بلا زخرفةٍ.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AttestedClock } from '../src/time/attested-clock.mjs';
import { TimeError } from '../src/time/errors.mjs';
import { TimePolicy, loadTimePolicy } from '../src/time/policy.mjs';
import { TimeWitness, startWitness } from '../src/time/witness.mjs';

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const rootIndex = argv.indexOf('--root');
const ROOT = path.resolve(
  rootIndex >= 0
    ? String(argv[rootIndex + 1])
    : path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
);
const CONFIG_DIR = path.join(ROOT, 'config');

/**
 * @param {object} report
 * @param {number} code
 * @returns {never}
 */
function emit(report, code) {
  if (asJson) console.log(JSON.stringify(report, null, 2));
  else {
    for (const [key, value] of Object.entries(report)) {
      console.log(`${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
    }
  }
  process.exit(code);
}

/**
 * سياسةٌ اصطناعيّةٌ تُوجَّهُ إلى شاهدَينِ محليَّينِ. تُبنى في الذاكرةِ ولا تُكتَبُ
 * في `config/`: مِفتاحُ الشاهدِ عابرٌ، وكتابتُه في السياسةِ تجعلُ الجهازَ يشهدُ
 * لنفسِه — و`guard:time` (قاعدةُ `T3`) يرفضُ ذلك.
 *
 * @param {import('../src/time/policy.mjs').TimePolicy} base
 * @param {Array<{ id: string, port: number, publicKey: Buffer }>} witnesses
 * @returns {import('../src/time/policy.mjs').TimePolicy}
 */
function localPolicy(base, witnesses) {
  return new TimePolicy({
    version: base.version,
    quorum: 2,
    maxRadiusMs: base.maxRadiusMs,
    maxAgeMs: base.maxAgeMs,
    maxLocalSkewMs: base.maxLocalSkewMs,
    requestTimeoutMs: base.requestTimeoutMs,
    sovereign: { requireAttestedTime: true },
    sources: witnesses.map((witness) => ({
      id: witness.id,
      dialect: 'ietf',
      host: '127.0.0.1',
      port: witness.port,
      publicKey: witness.publicKey.toString('base64'),
    })),
  });
}

/** @returns {Promise<never>} */
async function selfCheck() {
  const base = loadTimePolicy({ dir: CONFIG_DIR });
  const honestA = new TimeWitness({ dialectId: 'ietf' });
  const honestB = new TimeWitness({ dialectId: 'ietf' });
  const liar = new TimeWitness({ dialectId: 'ietf', now: () => Date.now() + 3600000 });
  const servers = await Promise.all([
    startWitness({ witness: honestA }),
    startWitness({ witness: honestB }),
    startWitness({ witness: liar }),
  ]);
  const [serverA, serverB, serverLiar] = servers;
  /** @type {Record<string, unknown>} */
  const report = { mode: 'self-check', wire: 'udp/127.0.0.1' };
  let code = 0;
  try {
    const clock = new AttestedClock({
      policy: localPolicy(base, [
        { id: 'witness-a', port: Number(serverA?.port), publicKey: honestA.publicKey },
        { id: 'witness-b', port: Number(serverB?.port), publicKey: honestB.publicKey },
      ]),
    });
    const attestation = await clock.attest();
    report.attested = true;
    report.atMs = attestation.atMs;
    report.radiusMs = attestation.radiusMs;
    report.sources = attestation.sources;
    report.localSkewMs = attestation.localSkewMs;
    report.nowFromAttestation = clock.now();

    // شاهدٌ كاذبٌ مع شاهدٍ صادقٍ: التقاطعُ فارغٌ فيُرفَضُ — ولو أُخِذَ المتوسِّطُ
    // لمرَّ الكذبُ منقوصاً بلا أن يُخالفَ أحداً صراحةً.
    const withLiar = new AttestedClock({
      policy: localPolicy(base, [
        { id: 'witness-a', port: Number(serverA?.port), publicKey: honestA.publicKey },
        { id: 'witness-liar', port: Number(serverLiar?.port), publicKey: liar.publicKey },
      ]),
    });
    try {
      await withLiar.attest();
      report.liarRejected = false;
      report.failure = 'شاهدٌ كاذبٌ قُبِلَ؛ والتقاطعُ لم يُطبَّقْ.';
      code = 1;
    } catch (error) {
      const rejectedAs = error instanceof TimeError ? error.code : 'UNKNOWN';
      report.liarRejected = rejectedAs === 'TIME_SOURCES_DISAGREE';
      report.liarRejectionCode = rejectedAs;
      if (rejectedAs !== 'TIME_SOURCES_DISAGREE') code = 1;
    }

    // مصدرٌ صامتٌ: النِّصابُ لا يُستوفى فيُرفَضُ بمُهلةٍ لا بانتظارٍ بلا نهايةٍ.
    const withSilent = new AttestedClock({
      policy: localPolicy(base, [
        { id: 'witness-a', port: Number(serverA?.port), publicKey: honestA.publicKey },
        { id: 'witness-silent', port: 1, publicKey: honestB.publicKey },
      ]),
    });
    try {
      await withSilent.attest();
      report.silentRejected = false;
      report.failure = 'نِصابٌ استُوفيَ من مصدرٍ واحدٍ.';
      code = 1;
    } catch (error) {
      const rejectedAs = error instanceof TimeError ? error.code : 'UNKNOWN';
      report.silentRejected = rejectedAs === 'TIME_QUORUM_NOT_MET';
      report.silentRejectionCode = rejectedAs;
      if (rejectedAs !== 'TIME_QUORUM_NOT_MET') code = 1;
    }
  } catch (error) {
    report.attested = false;
    report.error = error instanceof TimeError ? error.code : String(error);
    report.detail = error instanceof Error ? error.message : String(error);
    code = 1;
  } finally {
    await Promise.all(servers.map((server) => server.close()));
  }
  return emit(report, code);
}

/** @returns {Promise<never>} */
async function once() {
  const policy = loadTimePolicy({ dir: CONFIG_DIR });
  const clock = new AttestedClock({ policy });
  try {
    const attestation = await clock.attest();
    /** @type {Record<string, unknown>} */
    const report = {
      mode: 'once',
      attested: true,
      atMs: attestation.atMs,
      iso: new Date(attestation.atMs).toISOString(),
      radiusMs: attestation.radiusMs,
      sources: attestation.sources,
      localSkewMs: attestation.localSkewMs,
      localClockAgrees: Math.abs(attestation.localSkewMs) <= policy.maxLocalSkewMs,
    };
    return emit(report, report.localClockAgrees === true ? 0 : 1);
  } catch (error) {
    return emit(
      {
        mode: 'once',
        attested: false,
        error: error instanceof TimeError ? error.code : 'UNKNOWN',
        detail: error instanceof Error ? error.message : String(error),
        note: 'الخروجُ على UDP قد يكونُ مُغلَقاً في هذه البيئةِ؛ وهو حدٌّ مُعلَنٌ لا عطبٌ مكتومٌ (docs/TIME.md).',
      },
      1,
    );
  }
}

/** @returns {never} */
function describe() {
  const policy = loadTimePolicy({ dir: CONFIG_DIR });
  return emit(
    {
      mode: 'describe',
      version: policy.version,
      quorum: policy.quorum,
      maxRadiusMs: policy.maxRadiusMs,
      maxAgeMs: policy.maxAgeMs,
      maxLocalSkewMs: policy.maxLocalSkewMs,
      requestTimeoutMs: policy.requestTimeoutMs,
      requireAttestedTime: policy.requireAttestedTime,
      sources: policy.sources.map((source) => ({
        id: source.id,
        dialect: source.dialect,
        endpoint: source.endpoint,
      })),
    },
    0,
  );
}

if (argv.includes('--self-check')) await selfCheck();
else if (argv.includes('--once')) await once();
else if (argv.includes('--describe')) describe();
else {
  console.error(
    'استعمالٌ: node scripts/time-attest.mjs (--self-check | --once | --describe) [--json] [--root <مسار>]',
  );
  process.exit(2);
}
