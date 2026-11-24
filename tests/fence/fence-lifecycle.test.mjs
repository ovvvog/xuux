/**
 * دورةُ حياةِ سياجِ القاعدة (`WL-532`، المراجعةُ المعدَّلة §5 و§7 و§8):
 *
 *  - **ختمُ الجلسات (§5):** ما يُثبَتُ هو «حاملُ مفتاحِ العاملِ الذي يملكُ وحدَه جلساتِ الدورِ
 *    المختومة» — لا هويّةُ العمليةِ أمامَ مهاجمٍ بالـUID نفسِه يقرأُ المفتاح (انظر UID-05 في المختبر).
 *  - **HALT/RESUME (§7):** كاتبٌ نشِط، جلساتٌ متعدّدة، انقطاعٌ أثناءَ الإيقاف، فشلُ تسجيلِ الدليل،
 *    الإعادة، الأوامرُ المنقضية، التزامن، فشلُ RESUME في كلِّ مرحلة، الانهيارُ وإعادةُ الاتصال،
 *    واختلافُ حالةِ القاعدةِ عن حالةِ النظام. DB_FENCED وSYSTEM_HALT_COMPLETE وRECOVERY_REQUIRED
 *    حالاتٌ متمايزة، وكلُّ فشلٍ مغلق.
 *  - **استقلالُ دليلِ الآثار (§8):** القاعدةُ تختمُ الدليلَ بالإيقافِ والعهدِ والقائمةِ والتجسُّد؛
 *    الطالبُ (السياديّ) والعاملُ لا يُسجّلانه؛ الدليلُ القديمُ لا يُعادُ استعمالُه. ولا يُثبتُ الهاشُ
 *    صدقَ مصدرِه — ذلك حدٌّ معلن.
 *
 * انهيارُ خادمِ القاعدةِ نفسِه (إعادةُ تشغيلِ postmaster) في `scripts/fence-lab.mjs` لا هنا:
 * الحزامُ يشاركُ خادماً واحداً بينَ الاختبارات.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';

import pg from 'pg';

import {
  FENCE_ERRORS,
  FenceError,
  FenceRoot,
  FenceSovereign,
  FenceSupervisor,
  ORPHAN_REVOKE_REASON,
  SUPERVISOR_LOCK_KEY,
  SupervisorBootGate,
  confirmWorkerSeal,
  generateTestKeyProvider,
  reviewEffectsEvidence,
  sealFencedPool,
  sealFencedSessions,
} from '../../src/fence/db-fence.mjs';
import { HaltSwitch, KingIdentity } from '../../src/root-of-trust/index.mjs';
import { NO_EFFECTS, harness, rejection, rejectsWith } from '../helpers/fence-harness.mjs';
import { startFaultProxy } from '../helpers/pg-fault-proxy.mjs';
import { databaseUrl, quoteIdent, skipWithoutDatabase } from '../helpers/pg.mjs';

/** @param {any} c @param {number} id @param {string} v */
const write = (c, id, v) =>
  c.query('INSERT INTO state.fence_probe (id, v) VALUES ($1, $2)', [id, v]);

describe('دورةُ حياةِ السياج — WL-532 (§5 §7 §8)', { skip: skipWithoutDatabase }, () => {
  /** @type {Awaited<ReturnType<typeof harness>>} */
  let h;
  before(async () => {
    h = await harness('fence_life');
    await h.resume();
  });
  after(async () => {
    await h?.close();
  });

  /** سياقُ الختمِ لإقلاعٍ مُصدَر. @param {string} workerId @param {any} w */
  const sealCtx = async (workerId, w) => ({
    db: h.db.name,
    sysid: String((await h.sovereign.status()).live.sysid),
    workerId,
    bootId: w.bootId,
    epoch: w.credential.epoch,
    roleName: String(w.credential.role_name),
  });
  /** @param {string} role */
  const credStatus = async (role) =>
    (await h.db.pool.query('SELECT status FROM fence.credentials WHERE role_name = $1', [role]))
      .rows[0]?.status;
  /** يُعيدُ القاعدةَ إلى RUNNING إن لم تكن. */
  const ensureRunning = async () => {
    if ((await h.sovereign.status()).effective.state !== 'RUNNING') await h.resume();
  };

  // ── §5 ختمُ الجلسات ─────────────────────────────────────────────────────────

  test('SEAL-01: جلسةٌ غيرُ مختومةٍ لاعتمادٍ نشِطٍ لا تكتب (XF011)؛ بعدَ الختمِ تكتب', async () => {
    await ensureRunning();
    const w = await h.boot('alpha', { seal: false });
    const c = /** @type {any} */ (w.client);
    await rejectsWith(() => write(c, 501, 'unsealed'), ['XF011'], 'كتابةٌ قبلَ الختم');
    const who = (await c.query('SELECT fence.whoami() AS w')).rows[0].w;
    assert.equal(who.known, true);
    assert.equal(who.sealed, false);
    await sealFencedSessions([c], h.keys.alpha, await sealCtx('alpha', w));
    await write(c, 501, 'sealed');
    const after = (await c.query('SELECT fence.whoami() AS w')).rows[0].w;
    assert.equal(after.sealed, true);
    assert.equal(after.session_sealed, true);
    await h.root.revokeCredential(String(w.credential.role_name), 'test');
  });

  test('SEAL-02: بعدَ الختمِ الدورُ NOLOGIN — دخولٌ لاحقٌ بالدورِ نفسِه (عمليةٌ أخرى) مرفوض', async () => {
    await ensureRunning();
    const w = await h.boot('alpha');
    const role = String(w.credential.role_name);
    const login = (
      await h.db.pool.query('SELECT rolcanlogin FROM pg_roles WHERE rolname = $1', [role])
    ).rows[0].rolcanlogin;
    assert.equal(login, false, 'NOLOGIN بعدَ الختم');
    const e = await rejection(() => h.login(role));
    assert.equal(e.code, '28000', `دخولٌ متأخّر: ${e.code} ${e.message}`);
    assert.equal(await credStatus(role), 'ACTIVE', 'الدخولُ المتأخّرُ المرفوضُ لا يُلغي العامل');
    await h.root.revokeCredential(role, 'test');
  });

  test('SEAL-03: دخيلٌ حاضرٌ لحظةَ الختم ⇒ الختمُ يُرفَضُ والاعتمادُ يُلغى وجلسةُ الدخيلِ تُنهى', async () => {
    await ensureRunning();
    const w = await h.boot('alpha', { seal: false });
    const role = String(w.credential.role_name);
    const ctx = await sealCtx('alpha', w);
    const intruder = await h.login(role);
    const e = await rejection(() =>
      sealFencedSessions([/** @type {any} */ (w.client)], h.keys.alpha, ctx),
    );
    assert.ok(e instanceof FenceError && e.code === FENCE_ERRORS.SEAL_REFUSED, String(e));
    assert.equal(/** @type {any} */ (e.detail)?.reason, 'session_set_mismatch');
    assert.equal(/** @type {any} */ (e.detail)?.actual?.length, 2, 'القاعدةُ رأت جلستين');
    assert.equal(await credStatus(role), 'REVOKED');
    await rejection(() => write(intruder, 503, 'intruder'));
    await rejectsWith(
      () => write(w.client, 503, 'worker'),
      ['XF007', '57P01'],
      'العاملُ بعدَ الرفض',
    );
    const ev = await h.db.pool.query(
      `SELECT detail->>'reason' AS r FROM fence.events WHERE kind = 'SEAL_REFUSED' AND detail->>'role' = $1`,
      [role],
    );
    assert.deepEqual(
      ev.rows.map((x) => x.r),
      ['session_set_mismatch'],
      'الرفضُ مسجَّلٌ حدثاً',
    );
  });

  test('SEAL-04: توقيعٌ بمفتاحٍ آخر، أو مجموعةٌ فارغة، أو ختمٌ ثانٍ ⇒ رفضٌ وإلغاء', async () => {
    await ensureRunning();
    for (const [why, run] of /** @type {const} */ ([
      [
        'bad_signature',
        async (/** @type {any} */ c, /** @type {any} */ ctx) =>
          sealFencedSessions([c], h.keys.beta, ctx),
      ],
      [
        'bad_signature',
        async (/** @type {any} */ c, /** @type {any} */ ctx) =>
          sealFencedSessions([c], h.keys.alpha, { ...ctx, epoch: Number(ctx.epoch) + 1 }),
      ],
      [
        'no_sessions_declared',
        async (/** @type {any} */ c) =>
          (
            await c.query('SELECT fence.seal_sessions($1::jsonb, $2) AS r', [
              '[]',
              Buffer.alloc(64),
            ])
          ).rows[0].r,
      ],
      [
        'already_sealed',
        async (/** @type {any} */ c, /** @type {any} */ ctx) => {
          await sealFencedSessions([c], h.keys.alpha, ctx);
          return sealFencedSessions([c], h.keys.alpha, ctx);
        },
      ],
    ])) {
      const w = await h.boot('alpha', { seal: false });
      const role = String(w.credential.role_name);
      const ctx = await sealCtx('alpha', w);
      const out = await run(w.client, ctx).catch((/** @type {any} */ err) => err);
      const reason =
        out instanceof FenceError ? /** @type {any} */ (out.detail)?.reason : out?.reason;
      assert.equal(reason, why, `${why}: ${String(out?.message ?? JSON.stringify(out))}`);
      assert.equal(await credStatus(role), 'REVOKED', `${why} يُلغي`);
    }
  });

  test('SEAL-05: المُشرِفُ يُلغي إن أبلغ العاملُ مجموعةً غيرَ المختومة، أو فشلاً، أو صمت', async () => {
    await ensureRunning();
    for (const kind of ['mismatch', 'seal-failed', 'timeout']) {
      const w = await h.boot('alpha');
      const role = String(w.credential.role_name);
      const child = new EventEmitter();
      const p = confirmWorkerSeal(h.root, /** @type {any} */ (child), w.credential, {
        timeoutMs: 300,
      });
      if (kind === 'mismatch')
        child.emit('message', {
          type: 'xuux-fence/sealed',
          role_name: role,
          sessions: [{ pid: 1, start: '0' }],
        });
      if (kind === 'seal-failed')
        child.emit('message', { type: 'xuux-fence/seal-failed', role_name: role, reason: 'x' });
      const e = await rejection(() => p);
      assert.ok(e instanceof FenceError && e.code === FENCE_ERRORS.SEAL_REFUSED, `${kind}: ${e}`);
      assert.equal(await credStatus(role), 'REVOKED', `${kind} يُلغي`);
    }
    // والمطابقةُ تُقبَل.
    const w = await h.boot('alpha');
    const child = new EventEmitter();
    const p = confirmWorkerSeal(h.root, /** @type {any} */ (child), w.credential, {
      timeoutMs: 2000,
    });
    child.emit('message', {
      type: 'xuux-fence/sealed',
      role_name: w.credential.role_name,
      sessions: w.sealed,
    });
    assert.deepEqual(await p, w.sealed);
    await h.root.revokeCredential(String(w.credential.role_name), 'test');
  });

  test('SEAL-06 (خطرٌ متبقٍّ معلن): من يقرأُ مفتاحَ العاملِ ويسبقُه إلى الختمِ يختم — والمُشرِفُ يكشفُ ويُلغي', async () => {
    await ensureRunning();
    const w = await h.boot('alpha', { seal: false });
    const role = String(w.credential.role_name);
    const ctx = await sealCtx('alpha', w);
    // «المهاجم»: جلسةٌ أخرى بالدورِ نفسِه + المفتاحُ نفسُه (مسروقٌ من ملفٍّ يقرؤه الـUID نفسُه).
    const attacker = await h.login(role);
    await /** @type {any} */ (w.client).end();
    await new Promise((r) => setTimeout(r, 200));
    const stolen = await sealFencedSessions([attacker], h.keys.alpha, ctx);
    assert.equal(stolen.length, 1, 'القاعدةُ لا تستطيعُ التمييزَ: حاملُ المفتاحِ هو «العامل»');
    await write(attacker, 506, 'attacker-wrote');
    // العاملُ الحقيقيُّ لا يدخلُ (NOLOGIN) فيُبلغُ الفشل ⇒ المُشرِفُ يُلغي ويُنهي جلسةَ المهاجم.
    const child = new EventEmitter();
    const p = confirmWorkerSeal(h.root, /** @type {any} */ (child), w.credential, {
      timeoutMs: 2000,
    });
    const late = await rejection(() => h.login(role));
    assert.equal(late.code, '28000');
    child.emit('message', {
      type: 'xuux-fence/seal-failed',
      role_name: role,
      reason: late.message,
    });
    await rejection(() => p);
    assert.equal(await credStatus(role), 'REVOKED');
    await rejection(() => write(attacker, 507, 'after-revoke'));
    const rows = await h.db.pool.query(
      'SELECT id FROM state.fence_probe WHERE id IN (506, 507) ORDER BY id',
    );
    assert.deepEqual(
      rows.rows.map((r) => r.id),
      [506],
      'نافذةُ المهاجمِ حقيقيةٌ حتى الإلغاء — حدٌّ معلن',
    );
  });

  test('SEAL-07: sealFencedPool مع دخيلٍ حاضر ⇒ يرمي SEAL_REFUSED ولا يُسقطُ العمليةَ (وصلاتُ المجمّعِ المُنهاةُ تُتلَف)', async () => {
    await ensureRunning();
    const w = await h.boot('alpha', { seal: false });
    const role = String(w.credential.role_name);
    const ctx = await sealCtx('alpha', w);
    const intruder = await h.login(role);
    const password = randomBytes(18).toString('base64url');
    // WL-538: الدورُ يصدرُ VALID UNTIL '-infinity' (‏لا مصادقةَ بكلمةِ مرور)؛ المختبرُ يفتحُها بـsuperuser
    // ليصلَ المجمّعُ عبرَ TCP، والختمُ المرفوضُ يُعيدُها '-infinity'.
    await h.db.pool.query(
      `ALTER ROLE ${quoteIdent(role)} PASSWORD '${password}' VALID UNTIL 'infinity'`,
    );
    const url = new URL(databaseUrl() ?? '');
    url.username = role;
    url.password = password;
    url.pathname = `/${h.db.name}`;
    const pool = new pg.Pool({ connectionString: url.toString(), max: 3, idleTimeoutMillis: 0 });
    pool.on('error', () => {});
    try {
      const e = await rejection(() => sealFencedPool(pool, 3, h.keys.alpha, ctx));
      assert.ok(e instanceof FenceError && e.code === FENCE_ERRORS.SEAL_REFUSED, String(e));
      assert.equal(/** @type {any} */ (e.detail)?.reason, 'session_set_mismatch');
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(await credStatus(role), 'REVOKED');
      await rejection(() => write(intruder, 508, 'intruder'));
    } finally {
      await pool.end().catch(() => {});
    }
  });

  // ── §8 دليلُ الآثار ─────────────────────────────────────────────────────────

  test('EVID-01: الطالبُ (السياديّ) والعاملُ لا يُسجّلان دليلاً؛ والدليلُ لا يُعدَّلُ ولا يُحذَف', async () => {
    await ensureRunning();
    await h.root.halt('evid-01', { effects: NO_EFFECTS });
    for (const role of ['xf_sovereign', 'xuux_worker']) {
      const can = (
        await h.db.pool.query(
          `SELECT has_function_privilege($1, 'fence.record_effects_evidence(text,jsonb)', 'EXECUTE') AS x`,
          [role],
        )
      ).rows[0].x;
      assert.equal(can, false, `${role} لا يملكُ تسجيلَ الدليل`);
    }
    await rejectsWith(
      () =>
        h.sovClient.query('SELECT fence.record_effects_evidence($1, $2::jsonb)', [
          '0'.repeat(64),
          '{}',
        ]),
      ['42501'],
      'السياديُّ لا يُسجِّل',
    );
    const snap = async () =>
      (
        await h.db.pool.query(
          `SELECT md5(string_agg(e::text, '|' ORDER BY id)) AS m FROM fence.evidence e`,
        )
      ).rows[0].m;
    const before0 = await snap();
    await rejection(() =>
      h.db.pool.query(
        `UPDATE fence.evidence SET detail = '{"ok":true}' WHERE kind = 'EFFECTS_HALTED'`,
      ),
    );
    await rejection(() => h.db.pool.query(`DELETE FROM fence.evidence`));
    await rejection(() => h.db.pool.query(`TRUNCATE fence.evidence`));
    assert.equal(await snap(), before0, 'الدليلُ لم يتغيّر (superuser عبرَ المسارِ العادي)');
  });

  test('EVID-02: ok=false يُسجَّلُ EFFECTS_NOT_HALTED فلا SYSTEM_HALT_COMPLETE، والسياديُّ لا يوقّع، والقاعدةُ ترفض', async () => {
    await ensureRunning();
    const r = await h.root.halt('evid-02', {
      effects: { stop: async () => ({ ok: false, detail: { cgroup: 'not-empty' } }) },
    });
    assert.equal(r.dbFenced, true, 'DB_FENCED');
    assert.equal(r.systemHaltComplete, false, 'لا SYSTEM_HALT_COMPLETE');
    assert.equal(r.effectsEvidenceSha256, null);
    const s = await h.sovereign.status();
    assert.equal(s.effective.state, 'HALTED', 'القاعدةُ مغلقةٌ مع ذلك');
    assert.equal(s.effects_evidence.kind, 'EFFECTS_NOT_HALTED');
    const sha = String(s.effects_evidence.sha256);
    const review = reviewEffectsEvidence(s, sha);
    assert.equal(review.ok, false);
    await assert.rejects(
      () => h.sovereign.resume(sha),
      (e) => e instanceof FenceError && e.code === FENCE_ERRORS.EFFECTS_EVIDENCE_REJECTED,
    );
    const signed = h.sovereign.sign('resume', s, {
      roster_hash: s.bound.roster_hash,
      pm_start_epoch: String(s.live.pm_start_epoch),
      effects_evidence_sha256: sha,
    });
    await rejectsWith(
      () => h.sovClient.query('SELECT fence.resume($1,$2)', [signed.payload, signed.signature]),
      ['XF414'],
      'دليلٌ سلبيٌّ موقَّعٌ عمداً',
    );
    // استثناءٌ في موقِفِ الآثارِ نفسِه ⇒ ok=false أيضاً.
    const thrown = await h.root.halt('evid-02b', {
      effects: {
        stop: async () => {
          throw new Error('cgroup unreachable');
        },
      },
    });
    assert.equal(thrown.systemHaltComplete, false);
    assert.equal(
      (await h.sovereign.status()).effects_evidence.detail.stop_error,
      'cgroup unreachable',
    );
    // موقِفٌ يحاولُ الكتابةَ فوقَ الحقولِ المُلزِمة لا ينجح.
    const liar = await h.root.halt('evid-02c', {
      effects: { stop: async () => ({ ok: false, detail: { ok: true, halt_id: 1, epoch: 0 } }) },
    });
    const ls = await h.sovereign.status();
    assert.equal(liar.systemHaltComplete, false);
    assert.equal(ls.effects_evidence.detail.ok, false);
    assert.equal(Number(ls.effects_evidence.detail.halt_id), Number(liar.haltId));
  });

  test('EVID-03: دليلٌ قديم (إيقافٌ سابق) لا يُعادُ استعمالُه، ودليلٌ بعهدٍ أو إيقافٍ آخرَ لا يُسجَّل', async () => {
    await ensureRunning();
    const a = await h.root.halt('evid-03a', { effects: NO_EFFECTS });
    assert.equal(a.systemHaltComplete, true);
    const b = await h.root.halt('evid-03b', { effects: NO_EFFECTS });
    assert.equal(b.systemHaltComplete, true);
    const s = await h.sovereign.status();
    assert.equal(reviewEffectsEvidence(s, String(a.effectsEvidenceSha256)).ok, false);
    const signed = h.sovereign.sign('resume', s, {
      roster_hash: s.bound.roster_hash,
      pm_start_epoch: String(s.live.pm_start_epoch),
      effects_evidence_sha256: String(a.effectsEvidenceSha256),
    });
    await rejectsWith(
      () => h.sovClient.query('SELECT fence.resume($1,$2)', [signed.payload, signed.signature]),
      ['XF414'],
      'دليلُ الإيقافِ السابق',
    );
    const rec = async (/** @type {Record<string, unknown>} */ detail) => {
      const d = (
        await h.rootClient.query(
          `SELECT encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') AS d`,
          [JSON.stringify(detail)],
        )
      ).rows[0].d;
      return h.rootClient.query('SELECT fence.record_effects_evidence($1, $2::jsonb)', [
        d,
        JSON.stringify(detail),
      ]);
    };
    const epoch = Number(s.bound.epoch);
    await rejectsWith(() => rec({ ok: true, halt_id: a.haltId, epoch }), ['XF509'], 'halt_id قديم');
    await rejectsWith(
      () => rec({ ok: true, halt_id: b.haltId, epoch: epoch - 1 }),
      ['XF509'],
      'عهدٌ آخر',
    );
    await rejectsWith(
      () => rec({ ok: 'true', halt_id: b.haltId, epoch }),
      ['XF509'],
      'ok ليس منطقياً',
    );
    await rejectsWith(
      () =>
        h.rootClient.query('SELECT fence.record_effects_evidence($1, $2::jsonb)', [
          'f'.repeat(64),
          JSON.stringify({ ok: true, halt_id: b.haltId, epoch }),
        ]),
      ['XF508'],
      'هاشٌ لا يطابقُ التفاصيل',
    );
    // ودليلُ الإيقافِ الأخيرِ ما زال صالحاً.
    assert.equal(
      reviewEffectsEvidence(await h.sovereign.status(), String(b.effectsEvidenceSha256)).ok,
      true,
    );
  });

  test('EVID-04: تغييرُ القائمةِ بعدَ الدليلِ يُسقطُه (الربطُ بالقائمة)، ومفاتيحُ صغيرةُ الرتبةِ أو مختلطةٌ لا تُسجَّل', async () => {
    await ensureRunning();
    const r = await h.root.halt('evid-04', { effects: NO_EFFECTS });
    assert.equal(r.systemHaltComplete, true);
    const fresh = generateTestKeyProvider('alpha-rotated');
    const roster = (/** @type {Buffer} */ alphaKey) => [
      { worker_id: 'alpha', pubkey: alphaKey, os_principal: 'xuuxw-alpha' },
      { worker_id: 'beta', pubkey: h.keys.beta.publicKeyRaw(), os_principal: 'xuuxw-beta' },
    ];
    // مفتاحٌ صغيرُ الرتبة (نقطةُ الهويّة) ومفتاحٌ مختلطُ الرتبةِ (من Wycheproof) ⇒ XF404.
    const identity = Buffer.from('01'.padEnd(64, '0'), 'hex');
    const wy = JSON.parse(
      readFileSync(
        new URL('../fixtures/ed25519/wycheproof_ed25519_test.json', import.meta.url),
        'utf8',
      ),
    );
    const mixedHex = wy.testGroups.find((/** @type {any} */ g) =>
      g.tests.some((/** @type {any} */ t) => t.flags.includes('MixedOrderPublicKey')),
    ).publicKey.pk;
    const mixed = Buffer.from(String(mixedHex), 'hex');
    await rejectsWith(
      () => h.sovereign.rosterSet(roster(identity)),
      ['XF404'],
      'نقطةُ الهويّةِ مفتاحاً',
    );
    await rejectsWith(
      () => h.sovereign.rosterSet(roster(mixed)),
      ['XF404'],
      'مفتاحٌ مختلطُ الرتبة',
    );
    await rejectsWith(
      () => h.sovereign.command('key_rotate', { new_pubkey: identity.toString('hex') }),
      ['XF404'],
      'تدويرُ مفتاحِ السياديِّ إلى نقطةٍ صغيرة',
    );
    await h.sovereign.rosterSet(roster(fresh.publicKeyRaw()));
    const s = await h.sovereign.status();
    const review = reviewEffectsEvidence(s, String(r.effectsEvidenceSha256));
    assert.ok(
      review.problems.some((x) => x.includes('القائمة')),
      JSON.stringify(review.problems),
    );
    const signed = h.sovereign.sign('resume', s, {
      roster_hash: s.bound.roster_hash,
      pm_start_epoch: String(s.live.pm_start_epoch),
      effects_evidence_sha256: String(r.effectsEvidenceSha256),
    });
    await rejectsWith(
      () => h.sovClient.query('SELECT fence.resume($1,$2)', [signed.payload, signed.signature]),
      ['XF414'],
      'دليلٌ لقائمةٍ سابقة',
    );
    await h.sovereign.rosterSet(roster(h.keys.alpha.publicKeyRaw()));
  });

  // ── §7 HALT/RESUME ─────────────────────────────────────────────────────────

  test('EVID-05: تجسُّدُ الدليلِ يُعادُ نصّاً بدقّتِه — ميكروثانيةٌ تنتهي بصفرٍ لا تُسقطُ دليلاً سليماً (WL-533، LAB-RESTART)', async () => {
    // الفشلُ المقيسُ في المختبر: binding.incarnation.pm_start_epoch عادَ رقماً في JSON فصارَ في JS
    // ‎…123450 ⇒ …12345‎، والمقارنةُ نصّاً مع live (نصّ) ⇒ «تجسُّدُ القاعدةِ تغيّرَ بعدَ الدليل».
    await ensureRunning();
    const r = await h.root.halt('evid-05', {
      effects: { stop: async () => ({ ok: true, detail: {} }) },
    });
    assert.equal(r.systemHaltComplete, true);
    const s = await h.sovereign.status();
    const pm = s.effects_evidence.binding.incarnation.pm_start_epoch;
    assert.equal(typeof pm, 'string', 'pm_start_epoch في الدليلِ نصٌّ لا رقم');
    assert.equal(pm, s.live.pm_start_epoch);
    const exact = (
      await h.db.pool.query(`SELECT extract(epoch FROM pg_postmaster_start_time())::text AS t`)
    ).rows[0].t;
    assert.equal(pm, exact, 'الدقّةُ كاملةٌ كما في PostgreSQL');
    assert.equal(reviewEffectsEvidence(s, String(r.effectsEvidenceSha256)).ok, true);
    // الضابط: الحالةُ نفسُها والتجسُّدُ رقماً بصفرٍ ذيليٍّ (كما كان) ⇒ مراجعةٌ سليمةٌ تُرفَض.
    const zero = '1794477600.123450';
    const numeric = JSON.parse(`{"e":${zero}}`).e;
    const forged = structuredClone(s);
    forged.live.pm_start_epoch = zero;
    forged.effects_evidence.binding.incarnation.pm_start_epoch = numeric;
    assert.notEqual(String(numeric), zero);
    assert.ok(
      reviewEffectsEvidence(forged, String(r.effectsEvidenceSha256)).problems.includes(
        'تجسُّدُ القاعدةِ تغيّرَ بعدَ الدليل',
      ),
    );
  });

  test('HR-01: جلساتٌ مختومةٌ متعدّدة، إحداها في معاملةٍ مفتوحة ⇒ الإيقافُ يُنهيها كلَّها ولا يلتزمُ شيء', async () => {
    await ensureRunning();
    const w = await h.boot('alpha', { seal: false });
    const role = String(w.credential.role_name);
    const c2 = await h.login(role);
    const c3 = await h.login(role);
    const all = [/** @type {any} */ (w.client), c2, c3];
    await sealFencedSessions(all, h.keys.alpha, await sealCtx('alpha', w));
    await write(c2, 701, 'before-halt');
    await c3.query('BEGIN');
    await write(c3, 702, 'in-flight');
    const r = await h.root.halt('hr-01', { effects: NO_EFFECTS });
    assert.equal(r.systemHaltComplete, true, JSON.stringify(r));
    await rejection(() => c3.query('COMMIT'));
    for (const [i, c] of all.entries()) await rejection(() => write(c, 710 + i, 'after-halt'));
    const rows = await h.db.pool.query(
      'SELECT id FROM state.fence_probe WHERE id BETWEEN 700 AND 799 ORDER BY id',
    );
    assert.deepEqual(
      rows.rows.map((x) => x.id),
      [701],
    );
    const live = await h.db.pool.query(
      'SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename = $1',
      [role],
    );
    assert.equal(live.rows[0].n, 0, 'لا جلسةَ باقيةً للدور');
  });

  test('HR-02: انقطاعُ وصلةِ الجذرِ أثناءَ الإيقاف ⇒ الحالةُ ليست RUNNING، والكاتبُ مرفوض، وإعادةُ الإيقافِ تُكمل', async () => {
    await ensureRunning();
    const w = await h.boot('alpha');
    const rootPid = (await h.rootClient.query('SELECT pg_backend_pid() AS p')).rows[0].p;
    for (const point of ['afterRequest', 'afterLock', 'afterRevoke']) {
      if ((await h.sovereign.status()).effective.state !== 'RUNNING') break;
      const e = await rejection(() =>
        h.root.halt(`hr-02-${point}`, {
          effects: NO_EFFECTS,
          faults: {
            [point]: () => {
              throw Object.assign(new Error(`connection lost @${point}`), { code: '57P01' });
            },
          },
        }),
      );
      assert.match(String(e.message), /connection lost/);
      assert.notEqual((await h.sovereign.status()).effective.state, 'RUNNING', point);
      await rejection(() => write(w.client, 720, point));
    }
    // انقطاعٌ حقيقيّ: superuser يُنهي جلسةَ الجذرِ نفسَها.
    await h.db.pool.query('SELECT pg_terminate_backend($1)', [rootPid]);
    await rejection(() => h.root.halt('hr-02-dead-root', { effects: NO_EFFECTS }));
    await h.reconnect();
    const again = await h.root.halt('hr-02-retry', { effects: NO_EFFECTS });
    assert.equal(again.systemHaltComplete, true, JSON.stringify(again));
    const n = await h.db.pool.query(
      'SELECT count(*)::int AS n FROM state.fence_probe WHERE id = 720',
    );
    assert.equal(n.rows[0].n, 0);
  });

  test('HR-03: تعذّرُ تسجيلِ دليلِ الآثار ⇒ DB_FENCED بلا SYSTEM_HALT_COMPLETE، ولا استئناف', async () => {
    await ensureRunning();
    const r = await h.root.halt('hr-03', {
      // نصٌّ بنصفِ زوجٍ بديل (\ud800) ترفضُه jsonb — فشلٌ حقيقيٌّ في التسجيل لا محاكاة.
      effects: { stop: async () => ({ ok: true, detail: { note: '\ud800' } }) },
    });
    assert.equal(r.dbFenced, true);
    assert.equal(r.systemHaltComplete, false);
    assert.equal(r.reason, 'EFFECTS_EVIDENCE_NOT_RECORDED');
    const s = await h.sovereign.status();
    assert.equal(s.effective.state, 'HALTED');
    // لا دليلَ لهذا الإيقاف: آخرُ دليلٍ (إن وُجد) لإيقافٍ سابق ⇒ المراجعةُ ترفض.
    const sha = String(s.effects_evidence?.sha256 ?? '0'.repeat(64));
    assert.equal(reviewEffectsEvidence(s, sha).ok, false);
    await rejection(() => h.sovereign.resume(sha));
    assert.equal((await h.sovereign.status()).effective.state, 'HALTED');
  });

  test('HR-04: الإعادة، والأمرُ المنقضي، وأمران متزامنان ⇒ واحدٌ فقط ينجح', async () => {
    await ensureRunning();
    const r = await h.root.halt('hr-04', { effects: NO_EFFECTS });
    const s = await h.sovereign.status();
    const extra = {
      roster_hash: s.bound.roster_hash,
      pm_start_epoch: String(s.live.pm_start_epoch),
      effects_evidence_sha256: String(r.effectsEvidenceSha256),
    };
    // منقضٍ: نافذةُ ثانيةٍ واحدة ثمّ انتظار.
    const short = h.sovereign.sign('resume', s, extra, { validitySeconds: 1 });
    await new Promise((res) => setTimeout(res, 2200));
    await rejectsWith(
      () => h.sovClient.query('SELECT fence.resume($1,$2)', [short.payload, short.signature]),
      ['XF408'],
      'أمرٌ منقضٍ',
    );
    // متزامنان على وصلتين سياديتين، بنونسين مختلفين.
    const sov2 = await h.login('xf_sovereign');
    const a = h.sovereign.sign('resume', s, extra);
    const b = h.sovereign.sign('resume', s, extra);
    const results = await Promise.allSettled([
      h.sovClient.query('SELECT fence.resume($1,$2)', [a.payload, a.signature]),
      sov2.query('SELECT fence.resume($1,$2)', [b.payload, b.signature]),
    ]);
    const ok = results.filter((x) => x.status === 'fulfilled');
    const bad = results.filter((x) => x.status === 'rejected');
    assert.equal(ok.length, 1, 'استئنافٌ واحد');
    assert.ok(
      ['XF407', 'XF409'].includes(/** @type {any} */ (bad[0]).reason.code),
      String(/** @type {any} */ (bad[0]).reason.code),
    );
    const resumed = await h.db.pool.query(
      `SELECT count(*)::int AS n FROM fence.sovereign_commands WHERE nonce IN ($1, $2)`,
      [JSON.parse(a.payload).nonce, JSON.parse(b.payload).nonce],
    );
    assert.equal(resumed.rows[0].n, 1, 'أمرٌ واحدٌ مسجَّل');
    // الإعادة: الأمرُ الناجحُ نفسُه بعدَ إيقافٍ جديد.
    await h.root.halt('hr-04-replay', { effects: NO_EFFECTS });
    const winner = ok.length === 1 && results[0].status === 'fulfilled' ? a : b;
    await rejectsWith(
      () => h.sovClient.query('SELECT fence.resume($1,$2)', [winner.payload, winner.signature]),
      ['XF405', 'XF407', 'XF408'],
      'إعادةُ أمرٍ مُنفَّذ',
    );
    await sov2.end();
  });

  test('HR-05: HALT وRESUME متزامنان ⇒ لا حالةَ وسطى: إمّا RUNNING بلا طلبٍ معلّق أو ليست RUNNING والكاتبُ مرفوض', async () => {
    await ensureRunning();
    for (let i = 0; i < 4; i++) {
      await ensureRunning();
      const r = await h.root.halt(`hr-05-prep-${i}`, { effects: NO_EFFECTS });
      const s = await h.sovereign.status();
      const signed = h.sovereign.sign('resume', s, {
        roster_hash: s.bound.roster_hash,
        pm_start_epoch: String(s.live.pm_start_epoch),
        effects_evidence_sha256: String(r.effectsEvidenceSha256),
      });
      await Promise.allSettled([
        h.sovClient.query('SELECT fence.resume($1,$2)', [signed.payload, signed.signature]),
        h.root.halt(`hr-05-${i}`, { effects: NO_EFFECTS }),
      ]);
      const st = await h.sovereign.status();
      const open = await h.db.pool.query(
        `SELECT count(*)::int AS n FROM fence.halt_requests WHERE status IN ('OPEN','LOCKED')`,
      );
      if (st.effective.state === 'RUNNING')
        assert.equal(open.rows[0].n, 0, 'RUNNING بلا طلبٍ معلّق');
      else {
        const w = await h.boot('beta', { connect: false }).catch((e) => e);
        assert.ok(w instanceof Error, 'لا إصدارَ خارجَ RUNNING');
      }
    }
  });

  test('HR-06: فشلُ RESUME في كلِّ مرحلةٍ يُبقي HALTED، ولا يُسجِّلُ أمراً، ولا يُصدِرُ اعتماداً', async () => {
    await ensureRunning();
    const r = await h.root.halt('hr-06', { effects: NO_EFFECTS });
    const s = await h.sovereign.status();
    const good = {
      roster_hash: s.bound.roster_hash,
      pm_start_epoch: String(s.live.pm_start_epoch),
      effects_evidence_sha256: String(r.effectsEvidenceSha256),
    };
    const forger = new FenceSovereign(h.sovClient, generateTestKeyProvider('forger-06'));
    const stages = [
      ['XF403', forger.sign('resume', s, good)],
      ['XF404', h.sovereign.sign('recover', s, good)],
      ['XF407', h.sovereign.sign('resume', s, good, { expectedEpoch: Number(s.bound.epoch) + 1 })],
      ['XF413', h.sovereign.sign('resume', s, { ...good, roster_hash: 'e'.repeat(64) })],
      ['XF410', h.sovereign.sign('resume', s, { ...good, pm_start_epoch: '1' })],
      [
        'XF414',
        h.sovereign.sign('resume', s, { ...good, effects_evidence_sha256: 'c'.repeat(64) }),
      ],
    ];
    const cmds = async () =>
      (
        await h.db.pool.query(
          `SELECT count(*)::int AS n FROM fence.sovereign_commands WHERE type = 'RESUME'`,
        )
      ).rows[0].n;
    const before0 = await cmds();
    for (const [code, c] of stages) {
      await rejectsWith(
        () =>
          h.sovClient.query('SELECT fence.resume($1,$2)', [
            /** @type {any} */ (c).payload,
            /** @type {any} */ (c).signature,
          ]),
        [/** @type {string} */ (code)],
        `مرحلة ${code}`,
      );
      assert.equal((await h.sovereign.status()).effective.state, 'HALTED', `${code} يُبقي HALTED`);
      await rejectsWith(
        () => h.root.issueChallenge('alpha', 'b-' + code),
        ['XF502'],
        `${code}: لا إصدار`,
      );
    }
    assert.equal(await cmds(), before0, 'لا أمرَ RESUME مسجَّلٌ من أيِّ رفض');
    // XF415 (check_fenced) مغطّى في db-fence.test.mjs؛ والنجاحُ أخيراً:
    await h.sovereign.resume(String(r.effectsEvidenceSha256));
    assert.equal((await h.sovereign.status()).effective.state, 'RUNNING');
  });

  test('HR-07: انهيارُ كلِّ الوصلات (جذر، سياديّ، عمال) أثناءَ الإيقاف ⇒ الحالةُ دائمةٌ وليست RUNNING، والإكمالُ بعدَ إعادةِ الاتصال', async () => {
    await ensureRunning();
    const w = await h.boot('alpha');
    await rejection(() =>
      h.root.halt('hr-07', {
        effects: NO_EFFECTS,
        faults: {
          afterLock: () => {
            throw new Error('crash');
          },
        },
      }),
    );
    await h.db.pool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend'`,
    );
    await h.reconnect();
    const s = await h.sovereign.status();
    assert.notEqual(s.effective.state, 'RUNNING');
    await rejection(() => write(w.client, 730, 'after-crash'));
    const again = await h.root.halt('hr-07-retry', { effects: NO_EFFECTS });
    assert.equal(again.systemHaltComplete, true, JSON.stringify(again));
    assert.equal(await credStatus(String(w.credential.role_name)), 'REVOKED');
  });

  test('HR-08: حالةُ القاعدةِ تخالفُ حالةَ النظام — كلٌّ منهما يُغلقُ وحدَه (الحارسُ المركّب)', async (t) => {
    await ensureRunning();
    // (أ) القاعدةُ RUNNING والمفتاحُ المحلّيُّ HALTED ⇒ الحارسُ المحلّيُّ يرمي.
    const dir = mkdtempSync(join(tmpdir(), 'fence-hr08-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const halt = new HaltSwitch(join(dir, 'halt.json'), new KingIdentity(), {
      fsync: false,
      allowUnsignedTestHalt: true,
    });
    halt.halt('local-only');
    assert.equal((await h.sovereign.status()).effective.state, 'RUNNING');
    assert.throws(() => halt.assertOperational(), 'المحلّيُّ HALTED يكفي للرفض');
    // (ب) القاعدةُ HALTED والعاملُ «يظنّ» نفسَه يعمل ⇒ القاعدةُ ترفضُ الكتابة.
    const w = await h.boot('alpha');
    await h.root.halt('hr-08', { effects: NO_EFFECTS });
    await rejection(() => write(w.client, 740, 'stale-worker'));
  });
});

// WL-567: نُقلت هنا حرفيّاً كتلتا `describe` ‏WL-563 وWL-564 من `tests/fence/db-fence-privileges.test.mjs`
// (‏بترتيبِهما وبلا تغييرٍ في جسمٍ أو تأكيد) لأنَّ الملفَّ بلغَ مهلةَ الملفِّ 120 ث في `npm test` على CI (‏تشغيلة 44306823389)
// ففشلَ بالمهلةِ لا بخطأ. لا تعتمدانِ على مساعدٍ في الملفِّ الأصليّ — على الاستيراداتِ ومساعداتِ `tests/helpers` وحدَها.
// ── WL-563: عضويّةُ xf_owner الصاعدة (‏0033) — `GRANT xf_root TO xf_owner` كانت تُعفي كلَّ عضوٍ من XF105/XF107 ولا تُكشَف ──
describe(
  'WL-563: xf_owner عضواً في xf_root أو xf_sovereign أو غيرِهما (‏0033)',
  { skip: skipWithoutDatabase },
  () => {
    /** @type {Awaited<ReturnType<typeof harness>>} */
    let h;
    /** @type {string[]} */
    const made = [];
    /** @type {Record<string, string>} */
    const pw = {};
    const su = (/** @type {string} */ s, /** @type {unknown[]} */ p = []) => h.db.pool.query(s, p);
    const mk = async (/** @type {string} */ name, /** @type {string} */ attrs = 'NOLOGIN') => {
      await su(`DROP ROLE IF EXISTS ${quoteIdent(name)}`);
      await su(`CREATE ROLE ${quoteIdent(name)} ${attrs}`);
      made.push(name);
    };
    // ‏الأدوارُ عامّةٌ في العنقود: كلُّ حافّةٍ يصنعُها الاختبارُ نحوَ الأدوارِ المحجوزةِ تُسحَبُ مهما حدث.
    const clearDrift = async () => {
      for (const r of ['xf_root', 'xf_sovereign', 'xf_auditor', 'xuux_migrator'])
        await su(`REVOKE ${r} FROM xf_owner`).catch(() => {});
      await su('REVOKE xf_sovereign FROM xuux_worker').catch(() => {});
      await su('REVOKE ADMIN OPTION FOR pg_signal_backend FROM xf_owner').catch(() => {});
    };
    const dropMade = async () => {
      await clearDrift();
      while (made.length) {
        const name = String(made.pop());
        await su(
          `REVOKE CONNECT ON DATABASE ${quoteIdent(h.db.name)} FROM ${quoteIdent(name)}`,
        ).catch(() => {});
        await su(`DROP ROLE IF EXISTS ${quoteIdent(name)}`);
      }
    };
    /** @returns {Promise<{ ok: boolean, problems: any[], residuals: any[] }>} */
    const fenced = async () =>
      (await h.rootClient.query('SELECT fence.check_fenced() AS r')).rows[0].r;
    const upward = async () =>
      (await fenced()).problems.filter((p) => p.kind === 'owner_upward_membership');
    const state = async () => (await h.sovereign.status()).effective.state;
    /** @param {string} name */
    const mkLogin = async (name) => {
      await mk(name, 'LOGIN');
      pw[name] = `wl563-${Math.random().toString(36).slice(2)}-${Date.now()}`;
      await su(`ALTER ROLE ${quoteIdent(name)} PASSWORD '${pw[name]}'`);
      await su(`GRANT CONNECT ON DATABASE ${quoteIdent(h.db.name)} TO ${quoteIdent(name)}`);
      await su(`GRANT xf_owner TO ${quoteIdent(name)} WITH INHERIT FALSE, SET TRUE`);
    };
    /** @param {string} name */
    const login = async (name) => {
      const u = new URL(String(process.env['DATABASE_URL']));
      u.username = name;
      u.password = String(pw[name]);
      u.pathname = `/${h.db.name}`;
      const c = new pg.Client({ connectionString: u.toString() });
      await c.connect();
      return c;
    };
    /** @param {pg.Client} c @param {Array<[string, string]>} steps */
    const run = async (c, steps) => {
      /** @type {Record<string, string>} */
      const out = {};
      await c.query('BEGIN');
      for (const [k, sql] of steps) {
        await c.query('SAVEPOINT p');
        try {
          const r = await c.query(sql);
          out[k] = r.rows?.[0]?.v === undefined ? 'OK' : String(r.rows[0].v);
          await c.query('RELEASE SAVEPOINT p');
        } catch (e) {
          out[k] = String(/** @type {any} */ (e).code);
          await c.query('ROLLBACK TO SAVEPOINT p');
        }
      }
      await c.query('ROLLBACK');
      return out;
    };
    /** @type {Array<[string, string]>} */
    const WRITES = [
      ['set_role', 'SET ROLE xf_owner'],
      ['lease_update', `UPDATE fence.run_lease SET expires_at = expires_at + interval '1 year'`],
      ['lease_delete', 'DELETE FROM fence.run_lease'],
      ['credentials_update', 'UPDATE fence.credentials SET revoked_at = revoked_at'],
      ['roster_delete', 'DELETE FROM fence.roster'],
      ['manifest_update', 'UPDATE fence.manifest SET digest = digest'],
      ['control_seal', 'UPDATE fence.control SET seal = seal'],
      ['control_running', `UPDATE fence.control SET state = 'RUNNING', epoch = epoch + 1`],
    ];
    const BLOCKED = {
      set_role: 'OK',
      lease_update: 'XF107',
      lease_delete: 'XF107',
      credentials_update: 'XF107',
      roster_delete: 'XF107',
      manifest_update: 'XF107',
      control_seal: 'XF105',
      control_running: 'XF105',
    };
    before(async () => {
      h = await harness('wl563');
      const base = await fenced();
      assert.equal(base.ok, true, JSON.stringify(base.problems));
    });
    after(async () => {
      if (h) {
        await dropMade().catch(() => {});
        await h.close();
      }
    });

    test('الأساسُ المقيسُ صامت، وكلُّ حافّةٍ صاعدةٍ خارجَه (‏مباشرةً، وعبرَ وسيط، وبلا INHERIT/SET، وفائق، وخياراتٌ مغيَّرة) ⇒ مشكلةٌ ⇒ XF415، والسحبُ ⇒ سليم', async () => {
      // ‏الأساسُ بعدَ 0024 بالضبط — ولا يُرى أيُّه مشكلة.
      const base =
        await su(`SELECT r.rolname AS role, bool_or(am.admin_option) AS a, bool_or(am.inherit_option) AS i,
          bool_or(am.set_option) AS s FROM pg_auth_members am JOIN pg_roles r ON r.oid = am.roleid
        WHERE am.member = 'xf_owner'::regrole AND r.rolname NOT LIKE 'xw\\_%' GROUP BY r.rolname ORDER BY 1`);
      assert.deepEqual(base.rows, [
        { role: 'pg_read_all_stats', a: false, i: true, s: true },
        { role: 'pg_signal_backend', a: false, i: true, s: true },
        { role: 'xuux_worker', a: true, i: false, s: false },
      ]);
      assert.deepEqual(await upward(), []);
      // ‏الدالّةُ ليست لـPUBLIC ولا للعامل.
      const acl =
        await su(`SELECT has_function_privilege('xuux_worker', 'fence._owner_reach_problems()', 'EXECUTE') AS w,
          has_function_privilege('xf_auditor', 'fence._owner_reach_problems()', 'EXECUTE') AS a`);
      assert.deepEqual(acl.rows[0], { w: false, a: false });
      await h.root.halt('wl563-detect', { effects: NO_EFFECTS });
      await mk('zz_wl563_mid');
      await mk('zz_wl563_su', 'NOLOGIN SUPERUSER');
      // ‏اسمُ هويّةِ عاملٍ بلا عضويّةٍ في xuux_worker: حافّةُ المُنشئِ (‏ADMIN وحدَه) لا تُستثنى له.
      await mk('xw_wl563_fake');
      const edge = (
        /** @type {string} */ role,
        /** @type {string} */ member,
        admin = false,
        inherit = true,
        set = true,
      ) => ({
        role,
        member,
        admin,
        inherit,
        set,
      });
      const one = (/** @type {string} */ role, extra = {}, edges = [edge(role, 'xf_owner')]) => ({
        kind: 'owner_upward_membership',
        role,
        superuser: false,
        reserved: role === 'xf_root' || role === 'xf_sovereign',
        depth: edges.length,
        path: ['xf_owner', ...edges.map((e) => e.role)],
        edges,
        ...extra,
      });
      /** @type {Array<[string, string[], string[], any[]]>} */
      const cases = [
        [
          'xf_root',
          ['GRANT xf_root TO xf_owner'],
          ['REVOKE xf_root FROM xf_owner'],
          [one('xf_root')],
        ],
        [
          'xf_sovereign',
          ['GRANT xf_sovereign TO xf_owner'],
          ['REVOKE xf_sovereign FROM xf_owner'],
          [one('xf_sovereign')],
        ],
        [
          'xf_root بلا INHERIT ولا SET',
          ['GRANT xf_root TO xf_owner WITH INHERIT FALSE, SET FALSE'],
          ['REVOKE xf_root FROM xf_owner'],
          [one('xf_root', {}, [edge('xf_root', 'xf_owner', false, false, false)])],
        ],
        [
          'xf_root بحافّةِ المُنشئِ (‏ADMIN وحدَه)',
          ['GRANT xf_root TO xf_owner WITH ADMIN TRUE, INHERIT FALSE, SET FALSE'],
          ['REVOKE xf_root FROM xf_owner'],
          [one('xf_root', {}, [edge('xf_root', 'xf_owner', true, false, false)])],
        ],
        [
          'xw_* ليس عاملاً بحافّةِ المُنشئ',
          ['GRANT xw_wl563_fake TO xf_owner WITH ADMIN TRUE, INHERIT FALSE, SET FALSE'],
          ['REVOKE xw_wl563_fake FROM xf_owner'],
          [one('xw_wl563_fake', {}, [edge('xw_wl563_fake', 'xf_owner', true, false, false)])],
        ],
        [
          'xf_root عبرَ وسيط',
          ['GRANT xf_root TO zz_wl563_mid', 'GRANT zz_wl563_mid TO xf_owner'],
          ['REVOKE zz_wl563_mid FROM xf_owner', 'REVOKE xf_root FROM zz_wl563_mid'],
          [
            one('xf_root', {}, [edge('zz_wl563_mid', 'xf_owner'), edge('xf_root', 'zz_wl563_mid')]),
            one('zz_wl563_mid'),
          ],
        ],
        [
          'xf_sovereign عبرَ xuux_worker (‏حلقةٌ أساسيّة)',
          ['GRANT xf_sovereign TO xuux_worker'],
          ['REVOKE xf_sovereign FROM xuux_worker'],
          [
            one('xf_sovereign', {}, [
              edge('xuux_worker', 'xf_owner', true, false, false),
              edge('xf_sovereign', 'xuux_worker'),
            ]),
          ],
        ],
        [
          'دورٌ فائق',
          ['GRANT zz_wl563_su TO xf_owner'],
          ['REVOKE zz_wl563_su FROM xf_owner'],
          [one('zz_wl563_su', { superuser: true })],
        ],
        [
          'xf_auditor',
          ['GRANT xf_auditor TO xf_owner'],
          ['REVOKE xf_auditor FROM xf_owner'],
          [one('xf_auditor')],
        ],
        [
          'xuux_migrator',
          ['GRANT xuux_migrator TO xf_owner'],
          ['REVOKE xuux_migrator FROM xf_owner'],
          [one('xuux_migrator')],
        ],
        [
          'حلقةٌ أساسيّةٌ بخياراتٍ أوسع',
          ['GRANT pg_signal_backend TO xf_owner WITH ADMIN TRUE'],
          ['REVOKE ADMIN OPTION FOR pg_signal_backend FROM xf_owner'],
          [one('pg_signal_backend', {}, [edge('pg_signal_backend', 'xf_owner', true, true, true)])],
        ],
      ];
      for (const [label, grants, revokes, expected] of cases) {
        for (const g of grants) await su(g);
        assert.deepEqual(await upward(), expected, label);
        await rejectsWith(() => h.resume(), ['XF415'], `${label} يمنعُ الاستئناف`);
        for (const r of revokes) await su(r);
        assert.deepEqual(await upward(), [], `${label}: السحبُ يُزيلُ المشكلة`);
        assert.equal((await fenced()).ok, true, `${label}: سليمٌ بعدَ السحب`);
      }
      // ‏مغلقُ الفشل: غيابُ الصلاحيّةِ على الدالّةِ لا يُسقِطُ check_fenced بل يصيرُ مشكلة.
      await su('REVOKE EXECUTE ON FUNCTION fence._owner_reach_problems() FROM xf_owner');
      try {
        const kinds = (await fenced()).problems.map((p) => p.kind);
        assert.ok(kinds.includes('owner_reach_inventory_failed'), JSON.stringify(kinds));
      } finally {
        await su('GRANT EXECUTE ON FUNCTION fence._owner_reach_problems() TO xf_owner');
      }
      await dropMade();
      assert.equal((await fenced()).ok, true);
      await h.resume();
      assert.equal(await state(), 'RUNNING');
    });

    test('عضوُ xf_owner وحدَه لا يكتبُ ولو صارَ xf_owner جذراً أو سياديّاً (‏XF107/XF105)؛ والعضوُ الجذريُّ بقيّتُه كما هي؛ والإيقافُ والاستئنافُ والعاملُ كما هي', async () => {
      // ‏الإيقافُ أولاً (‏سليماً): بعدَه يُنشأُ الأعضاءُ ويُصنَعُ الانحراف، وكلُّه مكشوفٌ فيُرفَضُ RESUME.
      await h.root.halt('wl563-writer', { effects: NO_EFFECTS });
      assert.equal(await state(), 'HALTED');
      await mkLogin('zz_wl563_p');
      await mkLogin('zz_wl563_r');
      await su('GRANT xf_root TO zz_wl563_r');
      await mk('zz_wl563_mid2');
      /** @type {pg.Client[]} */
      const clients = [];
      try {
        const p = await login('zz_wl563_p');
        const r = await login('zz_wl563_r');
        clients.push(p, r);
        /** @type {Array<[string, string[], string[]]>} */
        const drifts = [
          ['xf_root', ['GRANT xf_root TO xf_owner'], ['REVOKE xf_root FROM xf_owner']],
          [
            'xf_sovereign',
            ['GRANT xf_sovereign TO xf_owner'],
            ['REVOKE xf_sovereign FROM xf_owner'],
          ],
          [
            'xf_root بلا INHERIT ولا SET',
            ['GRANT xf_root TO xf_owner WITH INHERIT FALSE, SET FALSE'],
            ['REVOKE xf_root FROM xf_owner'],
          ],
          [
            'xf_sovereign عبرَ وسيط',
            ['GRANT xf_sovereign TO zz_wl563_mid2', 'GRANT zz_wl563_mid2 TO xf_owner'],
            ['REVOKE zz_wl563_mid2 FROM xf_owner', 'REVOKE xf_sovereign FROM zz_wl563_mid2'],
          ],
        ];
        for (const [label, grants, revokes] of drifts) {
          for (const g of grants) await su(g);
          assert.deepEqual(await run(p, WRITES), BLOCKED, `${label}: العضوُ وحدَه`);
          // ‏بقيّةٌ مُعلَنةٌ منذُ 0032 (‏قرارُ مالك): الجذرُ العضوُ في xf_owner يكتبُ — لا تتغيّر.
          assert.deepEqual(
            await run(r, [
              ['set_role', 'SET ROLE xf_owner'],
              ['residual_lease_delete', 'DELETE FROM fence.run_lease'],
              ['residual_control_seal', 'UPDATE fence.control SET seal = seal'],
              ['control_running', `UPDATE fence.control SET state = 'RUNNING', epoch = epoch + 1`],
            ]),
            {
              set_role: 'OK',
              residual_lease_delete: 'OK',
              residual_control_seal: 'OK',
              control_running: 'XF106',
            },
            `${label}: العضوُ الجذريّ`,
          );
          await rejectsWith(() => h.resume(), ['XF415'], `${label} يمنعُ الاستئناف`);
          for (const g of revokes) await su(g);
        }
        // ‏بلا انحراف: العضوُ وحدَه كما في 0032 (‏XF107)، والتحكّمُ كما في 0031 (‏XF105).
        assert.deepEqual(await run(p, WRITES), BLOCKED, 'بلا انحراف');
      } finally {
        for (const c of clients) await c.end().catch(() => {});
        await dropMade();
      }
      assert.equal((await fenced()).ok, true);
      await h.resume();
      assert.equal(await state(), 'RUNNING');
      const w = await h.boot('alpha');
      assert.ok(w.client !== null && w.sealed !== null, 'العاملُ يُقلِعُ ويُختَم');
      const role = String(w.credential.role_name);
      const renewed = await h.rootClient.query('SELECT fence.renew_lease($1) AS e', [role]);
      assert.ok(renewed.rows[0].e !== null, 'الجذرُ يجدّدُ الإيجار');
      // ‏هويّةُ العاملِ أنشأَها xf_owner فصارَ له عليها حافّةُ المُنشئ (‏ADMIN وحدَه، PG 16+): أساسٌ لا مشكلة.
      const creator = await h.db.pool.query(
        `SELECT am.admin_option AS a, am.inherit_option AS i, am.set_option AS s FROM pg_auth_members am
        WHERE am.member = 'xf_owner'::regrole AND am.roleid = $1::regrole`,
        [role],
      );
      assert.deepEqual(creator.rows, [{ a: true, i: false, s: false }]);
      assert.deepEqual(await upward(), []);
    });
  },
);

// ── WL-564: امتيازاتٌ منجرفةٌ في fence (‏0034) — منحٌ من عضوٍ مُعفىً في xf_owner يبقى بعدَ سحبِ العضويّة ويُتيحُ كتابةً مباشرة ──
describe(
  'WL-564: امتيازٌ منجرفٌ في fence لغيرِ xf_owner (‏0034)',
  { skip: skipWithoutDatabase },
  () => {
    /** @type {Awaited<ReturnType<typeof harness>>} */
    let h;
    const su = (/** @type {string} */ s) => h.db.pool.query(s);
    /** @returns {Promise<{ ok: boolean, problems: any[] }>} */
    const fenced = async () =>
      (await h.rootClient.query('SELECT fence.check_fenced() AS r')).rows[0].r;
    const drift = async () =>
      (await fenced()).problems
        .filter((p) => p.kind === 'fence_acl_drift')
        .map((p) => `${p.axis}|${p.object}|${p.grantee}|${p.privilege}|${p.grantable}`)
        .sort();
    const state = async () => (await h.sovereign.status()).effective.state;
    /** @param {pg.Client} c @param {Array<[string, string]>} steps */
    const run = async (c, steps) => {
      /** @type {Record<string, string>} */
      const out = {};
      await c.query('BEGIN');
      for (const [k, sql] of steps) {
        await c.query('SAVEPOINT p');
        try {
          await c.query(sql);
          out[k] = 'OK';
          await c.query('RELEASE SAVEPOINT p');
        } catch (e) {
          out[k] = String(/** @type {any} */ (e).code);
          await c.query('ROLLBACK TO SAVEPOINT p');
        }
      }
      await c.query('ROLLBACK');
      return out;
    };
    // ‏المنحُ التي يصنعُها عضوٌ مُعفىً في xf_owner بعدَ SET ROLE xf_owner، وعكسُها بـsuperuser (‏كأنّه المالك).
    /** @type {Array<[string, string]>} */
    const GRANTS = [
      [
        'GRANT UPDATE ON fence.credentials TO xf_auditor',
        'REVOKE UPDATE ON fence.credentials FROM xf_auditor',
      ],
      ['GRANT UPDATE ON fence.control TO xf_root', 'REVOKE UPDATE ON fence.control FROM xf_root'],
      [
        'GRANT EXECUTE ON FUNCTION fence._reseal() TO xf_auditor',
        'REVOKE EXECUTE ON FUNCTION fence._reseal() FROM xf_auditor',
      ],
      [
        'GRANT UPDATE (pubkey) ON fence.roster TO xuux_migrator',
        'REVOKE UPDATE (pubkey) ON fence.roster FROM xuux_migrator',
      ],
      [
        'GRANT CREATE ON SCHEMA fence TO xf_auditor',
        'REVOKE CREATE ON SCHEMA fence FROM xf_auditor',
      ],
      [
        'GRANT SELECT ON fence.events TO xf_auditor WITH GRANT OPTION',
        'REVOKE GRANT OPTION FOR SELECT ON fence.events FROM xf_auditor',
      ],
      [
        'ALTER DEFAULT PRIVILEGES FOR ROLE xf_owner IN SCHEMA fence GRANT INSERT ON TABLES TO xf_auditor',
        'ALTER DEFAULT PRIVILEGES FOR ROLE xf_owner IN SCHEMA fence REVOKE INSERT ON TABLES FROM xf_auditor',
      ],
    ];
    const EXPECTED = [
      'column|fence.roster.pubkey|xuux_migrator|UPDATE|false',
      'default_acl|xf_owner/fence/r|xf_auditor|INSERT|false',
      'function|fence._reseal()|xf_auditor|EXECUTE|false',
      'relation|fence.control|xf_root|UPDATE|false',
      'relation|fence.credentials|xf_auditor|UPDATE|false',
      'relation|fence.events|xf_auditor|SELECT|true',
      'schema|fence|xf_auditor|CREATE|false',
    ];
    const undo = async () => {
      await su('REVOKE xf_owner FROM xf_root').catch(() => {});
      for (const [, r] of GRANTS) await su(r).catch(() => {});
    };
    before(async () => {
      h = await harness('wl564');
      const base = await fenced();
      assert.equal(base.ok, true, JSON.stringify(base.problems));
    });
    after(async () => {
      if (h) {
        await undo();
        await h.close();
      }
    });

    test('منحٌ من الجذرِ العضوِ في xf_owner يبقى بعدَ سحبِ العضويّة ⇒ fence_acl_drift ⇒ XF415؛ والكاتبُ المباشرُ ⇒ XF108؛ والعكسُ ⇒ سليمٌ ويُستأنَف', async () => {
      // ‏الأساسُ صامت، والدالّةُ ليست لـPUBLIC ولا للعاملِ ولا للمدقّق.
      assert.deepEqual(await drift(), []);
      const acl =
        await su(`SELECT has_function_privilege('xuux_worker', 'fence._fence_acl_problems()', 'EXECUTE') AS w,
          has_function_privilege('xf_auditor', 'fence._fence_acl_problems()', 'EXECUTE') AS a`);
      assert.deepEqual(acl.rows[0], { w: false, a: false });
      await h.root.halt('wl564-acl', { effects: NO_EFFECTS });
      assert.equal(await state(), 'HALTED');
      const aud = await h.login('xf_auditor');
      try {
        // ‏البقيّةُ المُعلَنة (‏0032): الجذرُ عضواً في xf_owner يمنحُ بعدَ SET ROLE — ثمّ تُسحَبُ العضويّة.
        await su('GRANT xf_owner TO xf_root WITH INHERIT FALSE, SET TRUE');
        await h.rootClient.query('SET ROLE xf_owner');
        try {
          for (const [g] of GRANTS) await h.rootClient.query(g);
        } finally {
          await h.rootClient.query('RESET ROLE');
        }
        await su('REVOKE xf_owner FROM xf_root');
        assert.deepEqual(await drift(), EXPECTED);
        await rejectsWith(() => h.resume(), ['XF415'], 'RESUME فوقَ امتيازٍ منجرف');
        // ‏الكاتبُ المباشرُ بلا عضويّةٍ في xf_owner: المدقّقُ على الاعتماد، والجذرُ على صفِّ التحكّمِ (‏ولو RUNNING بلا توقيع).
        assert.deepEqual(
          await run(aud, [
            ['credentials_update', 'UPDATE fence.credentials SET revoked_at = revoked_at'],
            ['reseal', 'SELECT fence._reseal()'],
          ]),
          { credentials_update: 'XF108', reseal: 'XF105' },
        );
        assert.deepEqual(
          await run(h.rootClient, [
            // ‏بلا قراءةِ عمود: المنحُ UPDATE وحدَه (‏لا SELECT للجذرِ على صفِّ التحكّم).
            ['control_touch', 'UPDATE fence.control SET updated_at = now()'],
            ['control_running', `UPDATE fence.control SET state = 'RUNNING', epoch = 1000000`],
          ]),
          { control_touch: 'XF108', control_running: 'XF108' },
        );
        assert.equal(await state(), 'HALTED');
        // ‏مغلقُ الفشل: غيابُ الصلاحيّةِ على الدالّةِ لا يُسقِطُ check_fenced بل يصيرُ مشكلة.
        await su('REVOKE EXECUTE ON FUNCTION fence._fence_acl_problems() FROM xf_owner');
        try {
          const kinds = (await fenced()).problems.map((p) => p.kind);
          assert.ok(kinds.includes('fence_acl_inventory_failed'), JSON.stringify(kinds));
        } finally {
          await su('GRANT EXECUTE ON FUNCTION fence._fence_acl_problems() TO xf_owner');
        }
      } finally {
        await undo();
        await aud.end().catch(() => {});
      }
      assert.deepEqual(await drift(), []);
      assert.equal((await fenced()).ok, true);
      await h.resume();
      assert.equal(await state(), 'RUNNING');
    });

    test('المساراتُ المشروعةُ لا تتغيّر: superuser يكتبُ مباشرة، والعاملُ يُقلِعُ ويُختَم، والجذرُ يجدّدُ الإيجار (‏والإيقافُ والاستئنافُ في الاختبارِ السابق)', async () => {
      if ((await state()) !== 'RUNNING') await h.resume();
      const c = await h.db.pool.connect();
      try {
        assert.deepEqual(
          await run(/** @type {any} */ (c), [
            ['manifest_update', 'UPDATE fence.manifest SET digest = digest'],
            ['control_seal', 'UPDATE fence.control SET seal = seal'],
          ]),
          { manifest_update: 'OK', control_seal: 'OK' },
        );
      } finally {
        c.release();
      }
      const w = await h.boot('alpha');
      assert.ok(w.client !== null && w.sealed !== null, 'العاملُ يُقلِعُ ويُختَم');
      const role = String(w.credential.role_name);
      const renewed = await h.rootClient.query('SELECT fence.renew_lease($1) AS e', [role]);
      assert.ok(renewed.rows[0].e !== null, 'الجذرُ يجدّدُ الإيجار');
      await /** @type {pg.Client} */ (w.client).end();
      assert.equal(await state(), 'RUNNING');
      assert.deepEqual(await drift(), []);
    });
  },
);

// ── WL-570: سياسةُ المالك — لا عضويّةَ بينَ xf_root وxf_sovereign وxf_owner في أيِّ اتّجاه (‏0035) — كشفٌ يمنعُ RESUME وhalt_complete ──
describe(
  'WL-570: عضويّةٌ بينَ الأدوارِ السياديّةِ الثلاثة (‏0035)',
  { skip: skipWithoutDatabase },
  () => {
    /** @type {Awaited<ReturnType<typeof harness>>} */
    let h;
    /** @type {string[]} */
    const made = [];
    const SOV = ['xf_root', 'xf_sovereign', 'xf_owner'];
    /** @type {Array<[string, string]>} الاتّجاهاتُ الستّة: [العضو، الدور] */
    const PAIRS = SOV.flatMap((m) =>
      SOV.filter((r) => r !== m).map((r) => /** @type {[string, string]} */ ([m, r])),
    );
    const su = (/** @type {string} */ s, /** @type {unknown[]} */ p = []) => h.db.pool.query(s, p);
    const mk = async (/** @type {string} */ name) => {
      await su(`DROP ROLE IF EXISTS ${quoteIdent(name)}`);
      await su(`CREATE ROLE ${quoteIdent(name)} NOLOGIN`);
      made.push(name);
    };
    // ‏الأدوارُ عامّةٌ في العنقود: كلُّ حافّةٍ بينَ الأدوارِ المحجوزةِ يصنعُها الاختبارُ تُسحَبُ مهما حدث.
    const clearSovereign = async () => {
      for (const [m, r] of PAIRS) await su(`REVOKE ${r} FROM ${m}`).catch(() => {});
    };
    const dropMade = async () => {
      await clearSovereign();
      while (made.length) await su(`DROP ROLE IF EXISTS ${quoteIdent(String(made.pop()))}`);
    };
    /** @returns {Promise<{ ok: boolean, problems: any[], residuals: any[] }>} */
    const fenced = async () =>
      (await h.rootClient.query('SELECT fence.check_fenced() AS r')).rows[0].r;
    const sovereign = async () =>
      (await fenced()).problems.filter((p) => p.kind === 'sovereign_membership');
    const inventory = async () =>
      (await su('SELECT fence._sovereign_membership_problems() AS r')).rows[0].r;
    const state = async () => (await h.sovereign.status()).effective.state;
    const edge = (
      /** @type {string} */ role,
      /** @type {string} */ member,
      admin = false,
      inherit = true,
      set = true,
    ) => ({ role, member, admin, inherit, set });
    /** @param {Array<ReturnType<typeof edge>>} edges */
    const hit = (edges) => ({
      kind: 'sovereign_membership',
      member: edges[0]?.member,
      role: edges[edges.length - 1]?.role,
      depth: edges.length,
      path: [edges[0]?.member, ...edges.map((e) => e.role)],
      edges,
    });
    /** @param {any[]} xs */
    const sorted = (xs) =>
      [...xs].sort((a, b) => `${a.member}|${a.role}`.localeCompare(`${b.member}|${b.role}`));
    before(async () => {
      h = await harness('wl570');
      const base = await fenced();
      assert.equal(base.ok, true, JSON.stringify(base.problems));
    });
    after(async () => {
      if (h) {
        await dropMade().catch(() => {});
        await h.close();
      }
    });

    test('الاتّجاهاتُ الستّةُ مباشرةً × ثمانيةُ تراكيبِ ADMIN/INHERIT/SET ⇒ sovereign_membership ⇒ XF415؛ والسحبُ ⇒ سليمٌ ويُستأنَف', async () => {
      // ‏الأساسُ صامت، ولا عضويّةَ بينَ الثلاثةِ أصلاً، والدالّةُ ليست لـPUBLIC ولا للعاملِ ولا للمدقّق.
      assert.deepEqual(await sovereign(), []);
      const none = await su(
        `SELECT count(*)::int AS n FROM pg_auth_members am
          WHERE am.roleid IN (SELECT oid FROM pg_roles WHERE rolname = ANY($1))
            AND am.member IN (SELECT oid FROM pg_roles WHERE rolname = ANY($1))`,
        [SOV],
      );
      assert.equal(none.rows[0].n, 0);
      const acl =
        await su(`SELECT has_function_privilege('xuux_worker', 'fence._sovereign_membership_problems()', 'EXECUTE') AS w,
          has_function_privilege('xf_auditor', 'fence._sovereign_membership_problems()', 'EXECUTE') AS a,
          has_function_privilege('xf_owner', 'fence._sovereign_membership_problems()', 'EXECUTE') AS o`);
      assert.deepEqual(acl.rows[0], { w: false, a: false, o: true });
      const res = (await fenced()).residuals.find(
        (r) => r.kind === 'sovereign_membership_detect_only',
      );
      assert.match(String(res?.note), /superuser/, 'الحدُّ مُعلَن: الكشفُ لا المنع');
      await h.root.halt('wl570-direct', { effects: NO_EFFECTS });
      assert.equal(await state(), 'HALTED');
      let n = 0;
      let resumes = 0;
      for (const [member, role] of PAIRS) {
        for (const admin of [false, true])
          for (const inherit of [false, true])
            for (const set of [false, true]) {
              const label = `${member} ∈ ${role} (‏ADMIN ${admin}، INHERIT ${inherit}، SET ${set})`;
              await su(
                `GRANT ${role} TO ${member} WITH ADMIN ${admin}, INHERIT ${inherit}, SET ${set}`,
              );
              try {
                const want = [hit([edge(role, member, admin, inherit, set)])];
                // ‏الجردُ نفسُه للثمانيةِ والأربعين (‏ميلّي ثوانٍ)؛ وcheck_fenced وRESUME — وكلٌّ منهما ثلثُ ثانيةٍ فأكثر — لكلِّ اتّجاهٍ
                // بأضعفِ الخيارات (‏لا ADMIN ولا INHERIT ولا SET)، ولكلِّ تركيبٍ على اتّجاهٍ واحد: 13 استئنافاً مرفوضاً (‏مهلةُ الملفّ).
                assert.deepEqual(await inventory(), want, label);
                if (
                  (!admin && !inherit && !set) ||
                  (member === 'xf_root' && role === 'xf_sovereign')
                ) {
                  const r = await fenced();
                  assert.equal(r.ok, false, label);
                  assert.deepEqual(
                    r.problems.filter((p) => p.kind === 'sovereign_membership'),
                    want,
                    label,
                  );
                  await rejectsWith(() => h.resume(), ['XF415'], `${label} يمنعُ الاستئناف`);
                  assert.equal(await state(), 'HALTED', label);
                  resumes += 1;
                }
              } finally {
                await su(`REVOKE ${role} FROM ${member}`);
              }
              assert.deepEqual(await inventory(), [], `${label}: السحبُ يُزيلُ المشكلة`);
              n += 1;
            }
      }
      assert.deepEqual([n, resumes], [48, 13]);
      // ‏مغلقُ الفشل: غيابُ الصلاحيّةِ على الدالّةِ لا يُسقِطُ check_fenced بل يصيرُ مشكلة.
      await su('REVOKE EXECUTE ON FUNCTION fence._sovereign_membership_problems() FROM xf_owner');
      try {
        const r = await fenced();
        assert.equal(r.ok, false);
        assert.ok(
          r.problems.some((p) => p.kind === 'sovereign_membership_inventory_failed'),
          JSON.stringify(r.problems.map((p) => p.kind)),
        );
        await rejectsWith(() => h.resume(), ['XF415'], 'الجردُ الفاشلُ يمنعُ الاستئناف');
      } finally {
        await su('GRANT EXECUTE ON FUNCTION fence._sovereign_membership_problems() TO xf_owner');
      }
      // ‏مغلقُ الفشل: غيابُ أحدِ الأدوارِ الثلاثةِ بالاسم (‏هنا xf_owner بلا دخولٍ ولا كلمةِ مرور، يُعادُ اسمُه مهما حدث)
      // ‏يرفعُ الجردُ خطأً فيصيرُ مشكلةً ولا يُقرأُ «لا عضويّة».
      await su('ALTER ROLE xf_owner RENAME TO zz_xf_owner_renamed');
      try {
        await assert.rejects(() => inventory(), /أحدُ الأدوارِ السياديّةِ غائب/);
        const r = await fenced();
        assert.equal(r.ok, false);
        assert.ok(
          r.problems.some((p) => p.kind === 'sovereign_membership_inventory_failed'),
          JSON.stringify(r.problems.map((p) => p.kind)),
        );
        await rejectsWith(() => h.resume(), ['XF415'], 'غيابُ دورٍ سياديٍّ يمنعُ الاستئناف');
      } finally {
        await su('ALTER ROLE zz_xf_owner_renamed RENAME TO xf_owner');
      }
      assert.equal((await fenced()).ok, true);
      await h.resume();
      assert.equal(await state(), 'RUNNING');
    });

    test('المتعدّي: الاتّجاهاتُ الستّةُ عبرَ وسيط، وعبرَ وسيطَين، وعبرَ الدورِ الثالث ⇒ أقصرُ مسارٍ بحوافِّه ⇒ XF415', async () => {
      await h.root.halt('wl570-transitive', { effects: NO_EFFECTS });
      await mk('zz_wl570_m1');
      await mk('zz_wl570_m2');
      try {
        for (const [member, role] of PAIRS) {
          const label = `${member} ⇒ zz_wl570_m1 ⇒ ${role}`;
          await su(`GRANT ${role} TO zz_wl570_m1 WITH INHERIT FALSE, SET FALSE`);
          await su(`GRANT zz_wl570_m1 TO ${member}`);
          assert.deepEqual(
            await sovereign(),
            [hit([edge('zz_wl570_m1', member), edge(role, 'zz_wl570_m1', false, false, false)])],
            label,
          );
          await rejectsWith(() => h.resume(), ['XF415'], label);
          await su(`REVOKE zz_wl570_m1 FROM ${member}`);
          await su(`REVOKE ${role} FROM zz_wl570_m1`);
          assert.deepEqual(await inventory(), [], `${label}: السحب`);
        }
        // ‏وسيطان (‏ADMIN وحدَه على الحافّةِ الوسطى).
        await su('GRANT xf_sovereign TO zz_wl570_m2');
        await su('GRANT zz_wl570_m2 TO zz_wl570_m1 WITH ADMIN TRUE, INHERIT FALSE, SET FALSE');
        await su('GRANT zz_wl570_m1 TO xf_root');
        assert.deepEqual(await sovereign(), [
          hit([
            edge('zz_wl570_m1', 'xf_root'),
            edge('zz_wl570_m2', 'zz_wl570_m1', true, false, false),
            edge('xf_sovereign', 'zz_wl570_m2'),
          ]),
        ]);
        await rejectsWith(() => h.resume(), ['XF415'], 'وسيطان');
        await su('REVOKE zz_wl570_m1 FROM xf_root');
        await su('REVOKE zz_wl570_m2 FROM zz_wl570_m1');
        await su('REVOKE xf_sovereign FROM zz_wl570_m2');
        assert.deepEqual(await sovereign(), []);
        // ‏عبرَ الدورِ الثالث: xf_root ∈ xf_owner ∈ xf_sovereign ⇒ ثلاثُ مشكلات (‏حافّتان وأقصرُ المتعدّي).
        await su('GRANT xf_owner TO xf_root WITH INHERIT FALSE, SET FALSE');
        await su('GRANT xf_sovereign TO xf_owner WITH INHERIT FALSE, SET FALSE');
        assert.deepEqual(
          sorted(await sovereign()),
          sorted([
            hit([edge('xf_owner', 'xf_root', false, false, false)]),
            hit([edge('xf_sovereign', 'xf_owner', false, false, false)]),
            hit([
              edge('xf_owner', 'xf_root', false, false, false),
              edge('xf_sovereign', 'xf_owner', false, false, false),
            ]),
          ]),
        );
        await rejectsWith(() => h.resume(), ['XF415'], 'عبرَ الدورِ الثالث');
        await clearSovereign();
        assert.deepEqual(await sovereign(), []);
      } finally {
        await dropMade();
      }
      assert.equal((await fenced()).ok, true);
      await h.resume();
      assert.equal(await state(), 'RUNNING');
    });

    test('halt_complete: عضويّةٌ قائمةٌ تُبقي الإيقافَ HALT_REQUESTED (‏DB_NOT_FENCED)، والسحبُ يُكمِله', async () => {
      if ((await state()) !== 'RUNNING') await h.resume();
      // ‏superuser يمنحُ أثناءَ RUNNING (‏لا منعَ — الحدُّ المُعلَن)؛ البوّابةُ التاليةُ تكشفُه.
      await su('GRANT xf_root TO xf_sovereign WITH INHERIT FALSE, SET FALSE');
      try {
        const r = await h.root.halt('wl570-halt', { effects: NO_EFFECTS });
        assert.equal(r.dbFenced, false);
        assert.equal(r.reason, 'DB_NOT_FENCED');
        assert.deepEqual(
          r.check.problems.filter((/** @type {any} */ p) => p.kind === 'sovereign_membership'),
          [hit([edge('xf_root', 'xf_sovereign', false, false, false)])],
        );
        assert.equal(await state(), 'HALT_REQUESTED');
        const hr = await su('SELECT status FROM fence.halt_requests WHERE id = $1', [r.haltId]);
        assert.notEqual(hr.rows[0].status, 'COMPLETE');
      } finally {
        await su('REVOKE xf_root FROM xf_sovereign');
      }
      const r2 = await h.root.halt('wl570-halt-2', { effects: NO_EFFECTS });
      assert.equal(r2.dbFenced, true, JSON.stringify(r2.check?.problems));
      assert.equal(await state(), 'HALTED');
      await h.resume();
      assert.equal(await state(), 'RUNNING');
    });

    test('لا إنذارَ كاذب: أبٌ مشترك، وعضوٌ مشترك، وعضويّاتٌ لغيرِ الثلاثة، والعاملُ وحافّةُ المُنشئ ⇒ صامتٌ ويُستأنَف؛ وبقيّةُ 0032 كما هي', async () => {
      await h.root.halt('wl570-negative', { effects: NO_EFFECTS });
      await mk('zz_wl570_up');
      await mk('zz_wl570_down');
      try {
        // ‏الجذرُ والسياديُّ عضوانِ في دورٍ واحد (‏أبٌ مشترك) — ليست عضويّةً بينهما.
        await su('GRANT zz_wl570_up TO xf_root, xf_sovereign, xf_owner');
        // ‏دورٌ عضوٌ في الثلاثة (‏عضوٌ مشترك) — ليست عضويّةً بينها.
        await su(
          'GRANT xf_root, xf_sovereign, xf_owner TO zz_wl570_down WITH INHERIT FALSE, SET FALSE',
        );
        // ‏عضويّاتٌ لأدوارٍ أخرى في الثلاثةِ ولها.
        await su('GRANT xf_auditor TO xf_root');
        await su('GRANT pg_read_all_stats TO xf_sovereign');
        assert.deepEqual(await sovereign(), [], 'لا عضويّةَ بينَ الثلاثة');
      } finally {
        await su('REVOKE zz_wl570_up FROM xf_root, xf_sovereign, xf_owner').catch(() => {});
        await su('REVOKE xf_root, xf_sovereign, xf_owner FROM zz_wl570_down').catch(() => {});
        await su('REVOKE xf_auditor FROM xf_root').catch(() => {});
        await su('REVOKE pg_read_all_stats FROM xf_sovereign').catch(() => {});
        await dropMade();
      }
      assert.equal((await fenced()).ok, true);
      await h.resume();
      assert.equal(await state(), 'RUNNING');
      // ‏العاملُ يُقلِع: حافّةُ المُنشئِ xf_owner ⇒ xw_* ⇒ xuux_worker لا تصلُ إلى الجذرِ ولا السياديّ.
      const w = await h.boot('alpha');
      assert.ok(w.client !== null && w.sealed !== null, 'العاملُ يُقلِعُ ويُختَم');
      assert.deepEqual(await sovereign(), []);
      const role = String(w.credential.role_name);
      const renewed = await h.rootClient.query('SELECT fence.renew_lease($1) AS e', [role]);
      assert.ok(renewed.rows[0].e !== null, 'الجذرُ يجدّدُ الإيجار');
      await /** @type {pg.Client} */ (w.client).end();
      // ‏بقيّةُ 0032 (‏قرارُ مالك) لا تتغيّر: الجذرُ عضواً في xf_owner يكتبُ الإيجارَ بعدَ SET ROLE — والاستئنافُ مرفوض.
      await h.root.halt('wl570-residual', { effects: NO_EFFECTS });
      await su('GRANT xf_owner TO xf_root WITH INHERIT FALSE, SET TRUE');
      try {
        await h.rootClient.query('BEGIN');
        try {
          await h.rootClient.query('SET LOCAL ROLE xf_owner');
          await h.rootClient.query('DELETE FROM fence.run_lease');
        } finally {
          await h.rootClient.query('ROLLBACK');
        }
        assert.deepEqual(await sovereign(), [
          hit([edge('xf_owner', 'xf_root', false, false, true)]),
        ]);
        await rejectsWith(() => h.resume(), ['XF415'], 'بقيّةُ 0032 مكشوفة');
      } finally {
        await su('REVOKE xf_owner FROM xf_root');
      }
      assert.equal((await fenced()).ok, true);
      await h.resume();
      assert.equal(await state(), 'RUNNING');
    });
  },
);

// ── TH-SUP-05 (‏WL-577): كنسُ الاعتماداتِ اليتيمةِ عندَ إقلاعِ المُشرِف ─────────────────────────────────
describe(
  'TH-SUP-05 — المُشرِفُ يُلغي عندَ إقلاعِه كلَّ اعتمادٍ ACTIVE لم يُصدِره (‏WL-577)',
  { skip: skipWithoutDatabase },
  () => {
    /** @type {Awaited<ReturnType<typeof harness>>} */
    let h;
    before(async () => {
      h = await harness('fence_orphans');
      await h.resume();
    });
    after(async () => {
      await h?.close();
    });

    /** @returns {Promise<Array<{ role_name: string, worker_id: string, status: string, revoke_reason: string | null }>>} */
    const credentials = async () =>
      (
        await h.db.pool.query(
          `SELECT role_name::text AS role_name, worker_id, status, revoke_reason FROM fence.credentials ORDER BY issued_at, role_name`,
        )
      ).rows;
    /** @param {string} role */
    const canLogin = async (role) =>
      (await h.db.pool.query('SELECT rolcanlogin AS l FROM pg_roles WHERE rolname = $1', [role]))
        .rows[0]?.l;
    /** @param {string[]} roles */
    const sessions = async (roles) =>
      Number(
        (
          await h.db.pool.query(
            'SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename = ANY($1::text[])',
            [roles],
          )
        ).rows[0].n,
      );
    const clean = async () => {
      await h.root.revokeOrphanCredentials();
      assert.deepEqual(
        (await credentials()).filter((c) => c.status === 'ACTIVE'),
        [],
        'لا اعتمادَ نشِطاً قبلَ الاختبار',
      );
    };

    test('إقلاعٌ بلا ما أصدرَه: كلُّ اعتمادٍ ACTIVE يُلغى وتُنهى جلساتُه ولا يكتبُ العاملُ بعدَه', async () => {
      await clean();
      const a = await h.boot('alpha');
      const b = await h.boot('beta');
      const ra = String(a.credential.role_name);
      const rb = String(b.credential.role_name);
      await /** @type {pg.Client} */ (a.client).query(
        `INSERT INTO state.fence_probe (id, v) VALUES (5770, 'before-sweep')`,
      );
      assert.equal(await sessions([ra, rb]), 2, 'جلستا العاملَين حيّتانِ قبلَ الكنس');
      /** @type {Array<Record<string, unknown>>} */
      const log = [];
      const root = new FenceRoot(
        async () =>
          /** @type {any} */ ({
            query: (/** @type {any[]} */ ...q) => /** @type {any} */ (h.rootClient).query(...q),
          }),
        { log: (e) => log.push(e) },
      );
      const r = await root.revokeOrphanCredentials();
      assert.deepEqual(
        r.revoked.map((x) => [x.role_name, x.worker_id, x.terminated]).sort(),
        [
          [ra, 'alpha', 1],
          [rb, 'beta', 1],
        ].sort(),
        'الاعتمادانِ أُلغيا وجلسةُ كلٍّ منهما أُنهيت',
      );
      assert.deepEqual(r.kept, [], 'لا شيءَ مُبقىً');
      for (const x of r.revoked) assert.equal(typeof x.boot_id, 'string');
      const byRole = new Map((await credentials()).map((c) => [c.role_name, c]));
      for (const role of [ra, rb]) {
        assert.equal(byRole.get(role)?.status, 'REVOKED', `${role} ملغى`);
        assert.equal(byRole.get(role)?.revoke_reason, ORPHAN_REVOKE_REASON, 'بالسببِ المسمّى');
        assert.equal(await canLogin(role), false, `${role} NOLOGIN`);
      }
      assert.equal(await sessions([ra, rb]), 0, 'لا جلسةَ حيّةً بعدَ الكنس');
      await rejection(() =>
        /** @type {pg.Client} */ (a.client).query(
          `INSERT INTO state.fence_probe (id, v) VALUES (5771, 'after-sweep')`,
        ),
      );
      const probe = await h.db.pool.query(
        'SELECT id FROM state.fence_probe WHERE id IN (5770, 5771) ORDER BY id',
      );
      assert.deepEqual(
        probe.rows.map((x) => x.id),
        [5770],
        'ما التزمَ قبلَ الكنسِ باقٍ ولا كتابةَ بعدَه',
      );
      assert.deepEqual(
        log.map((e) => e['ev']),
        ['orphan_revoked', 'orphan_revoked'],
        'سجلٌّ لكلِّ إلغاء',
      );
      const again = await root.revokeOrphanCredentials();
      assert.deepEqual(again, { revoked: [], kept: [] }, 'الكنسُ الثاني لا يجدُ شيئاً');
      assert.equal(
        (
          await h.db.pool.query(
            `SELECT count(*)::int AS n FROM fence.events WHERE kind = 'CREDENTIAL_REVOKED' AND detail->>'reason' = $1`,
            [ORPHAN_REVOKE_REASON],
          )
        ).rows[0].n,
        2,
        'حدثانِ في سلسلةِ الأحداثِ بالسبب',
      );
    });

    test('ما أصدرَه المُشرِفُ الحاليُّ يبقى ويكتب، والسببُ المخصّصُ يُسجَّل', async () => {
      await clean();
      const a = await h.boot('alpha');
      const b = await h.boot('beta');
      const ra = String(a.credential.role_name);
      const rb = String(b.credential.role_name);
      const r = await h.root.revokeOrphanCredentials({
        keep: [ra, 'xuuxw_not_active'],
        reason: 'wl577-keep',
      });
      assert.deepEqual(
        r.revoked.map((x) => x.role_name),
        [rb],
        'اليتيمُ وحدَه أُلغي',
      );
      assert.deepEqual(r.kept, [ra], 'المُبقى هو ما أصدرَه المُشرِفُ وما زالَ نشِطاً');
      const byRole = new Map((await credentials()).map((c) => [c.role_name, c]));
      assert.equal(byRole.get(ra)?.status, 'ACTIVE');
      assert.equal(byRole.get(rb)?.revoke_reason, 'wl577-keep');
      await /** @type {pg.Client} */ (a.client).query(
        `INSERT INTO state.fence_probe (id, v) VALUES (5772, 'kept-writes')`,
      );
      await rejection(() =>
        /** @type {pg.Client} */ (b.client).query(
          `INSERT INTO state.fence_probe (id, v) VALUES (5773, 'orphan-writes')`,
        ),
      );
      assert.equal(await sessions([rb]), 0);
      assert.equal(await sessions([ra]), 1, 'جلسةُ المُبقى لم تُمَسّ');
    });

    test('مُصدِرٌ متزامنٌ بدورِ الجذر ⇒ فشلٌ مغلقٌ بالتفاصيل لا نجاحٌ صامت', async () => {
      await clean();
      const a = await h.boot('alpha', { connect: false });
      const ra = String(a.credential.role_name);
      const root = new FenceRoot(
        async () =>
          /** @type {any} */ ({
            query: (/** @type {any[]} */ ...q) => /** @type {any} */ (h.rootClient).query(...q),
          }),
      );
      const orig = root.revokeCredential.bind(root);
      /** @type {{ boot: Promise<{ credential: Record<string, unknown> }> | null }} */
      const lateHolder = { boot: null };
      // ‏مُشرِفٌ ثانٍ (‏أو أيُّ حاملٍ لـxf_root) يُصدِرُ اعتماداً بينَ الجردِ والتحقّق.
      root.revokeCredential = async (role, why) => {
        const n = await orig(role, why);
        if (lateHolder.boot === null) {
          lateHolder.boot = h.boot('beta', { connect: false });
          await lateHolder.boot;
        }
        return n;
      };
      const error = await rejectsWith(
        () => root.revokeOrphanCredentials(),
        [FENCE_ERRORS.ORPHAN_SWEEP_INCOMPLETE],
        'يتيمٌ ظهرَ بعدَ الكنس',
      );
      assert.ok(lateHolder.boot !== null, 'المُصدِرُ المتزامنُ عمل');
      const late = String((await lateHolder.boot).credential.role_name);
      assert.ok(error instanceof FenceError);
      const detail = /** @type {any} */ (error.detail);
      assert.deepEqual(
        detail.appeared.map((/** @type {any} */ x) => x.role_name),
        [late],
        'الاعتمادُ المتأخّرُ مسمّى',
      );
      assert.deepEqual(
        detail.revoked.map((/** @type {any} */ x) => x.role_name),
        [ra],
        'وما أُلغيَ قبلَه مُعلَن',
      );
      const byRole = new Map((await credentials()).map((c) => [c.role_name, c]));
      assert.equal(
        byRole.get(String(late))?.status,
        'ACTIVE',
        'لا يُلغى ما لم يُجرَد — يُكشَفُ ولا يُمنَع',
      );
      const r = await h.root.revokeOrphanCredentials();
      assert.deepEqual(
        r.revoked.map((x) => x.role_name),
        [late],
        'الكنسُ التالي يحسمُه',
      );
    });

    test('جلسةٌ حيّةٌ لاعتمادٍ أُلغيَ قبلَ الإقلاع (‏نجت من الإنهاء — صنفُ WL-552) ⇒ فشلٌ مغلق', async () => {
      await clean();
      const g = await h.boot('alpha');
      const rg = String(g.credential.role_name);
      assert.equal(await sessions([rg]), 1, 'جلسةُ العاملِ حيّة');
      // ‏محاكاةُ «أُلغيَ ولم تمُت جلستُه» (‏إنهاءٌ انقضت مهلتُه على خادمٍ موقوف): الحالةُ REVOKED بلا إنهاء — بدورِ superuser
      // ‏في صندوقِ الاختبار وحدَه.
      await h.db.pool.query(
        `UPDATE fence.credentials SET status = 'REVOKED', revoke_reason = 'wl577-pre-boot' WHERE role_name = $1`,
        [rg],
      );
      const error = await rejectsWith(
        () => h.root.revokeOrphanCredentials({ settleMs: 200, pollMs: 20 }),
        [FENCE_ERRORS.ORPHAN_SWEEP_INCOMPLETE],
        'جلسةُ دورٍ ملغىً قبلَ الإقلاعِ ما زالت حيّة',
      );
      assert.ok(error instanceof FenceError);
      const detail = /** @type {any} */ (error.detail);
      assert.deepEqual(detail.revoked, [], 'لا اعتمادَ ACTIVE أُلغيَ في هذا الكنس');
      assert.deepEqual(detail.appeared, []);
      assert.deepEqual(
        detail.lingering.map((/** @type {any} */ x) => x.role),
        [rg],
        'الجلسةُ الباقيةُ مسمّاةٌ بدورِها من pg_stat_activity الحقيقيّ',
      );
      assert.equal(typeof detail.lingering[0].pid, 'number');
      // ‏`keep` يُعفي اعتماداً ACTIVE من الإلغاءِ لا جلسةَ دورٍ ملغىً من الفحص: إبقاءُ الدورِ نفسِه لا يُمرِّرُ الكنس.
      const kept = await rejectsWith(
        () => h.root.revokeOrphanCredentials({ keep: [rg], settleMs: 200, pollMs: 20 }),
        [FENCE_ERRORS.ORPHAN_SWEEP_INCOMPLETE],
        'keep لا يُعفي جلسةَ دورٍ ملغىً',
      );
      assert.deepEqual(
        /** @type {any} */ (kept).detail.lingering.map((/** @type {any} */ x) => x.role),
        [rg],
      );
      // ‏وينجحُ بعدَ موتِ الجلسة.
      await h.db.pool.query(
        'SELECT pg_terminate_backend(pid, 5000) FROM pg_stat_activity WHERE usename = $1',
        [rg],
      );
      assert.deepEqual(await h.root.revokeOrphanCredentials({ settleMs: 2000 }), {
        revoked: [],
        kept: [],
      });
    });

    test('دورٌ غيرُ الجذر لا يكنس: السياديُّ يُرفَضُ في القاعدة ولا يُلغى شيء', async () => {
      await clean();
      const a = await h.boot('alpha', { connect: false });
      const ra = String(a.credential.role_name);
      const sov = new FenceRoot(
        async () =>
          /** @type {any} */ ({
            query: (/** @type {any[]} */ ...q) => /** @type {any} */ (h.sovClient).query(...q),
          }),
      );
      const error = await rejection(() => sov.revokeOrphanCredentials());
      assert.ok(
        !(error instanceof FenceError),
        `رفضُ القاعدةِ لا رمزُ الكنس: ${error.code} ${error.message}`,
      );
      const byRole = new Map((await credentials()).map((c) => [c.role_name, c]));
      assert.equal(byRole.get(ra)?.status, 'ACTIVE', 'لا إلغاءَ بغيرِ الجذر');
      await h.root.revokeOrphanCredentials();
    });

    test('جلسةُ دورٍ ملغىً بقيت حيّةً بعدَ المهلة ⇒ فشلٌ مغلقٌ (‏lingering)، وتُنتظَرُ حتى تموتَ إن ماتت', async () => {
      await clean();
      const a = await h.boot('alpha', { connect: false });
      const ra = String(a.credential.role_name);
      // ‏إنهاءُ الجلسةِ إشارةٌ لا انتظار: تبقى في pg_stat_activity لحظةً أو أكثر (‏SIGSTOP في المختبر، WL-552).
      // ‏هنا تُحاكى بإجابةٍ مصنوعةٍ لاستعلامِ الجلسات وحدَه — الإلغاءُ نفسُه حقيقيّ.
      let alive = 3;
      /** @param {boolean} forever */
      const rootWith = (forever) =>
        new FenceRoot(
          async () =>
            /** @type {any} */ ({
              query: async (/** @type {string} */ sql, /** @type {any[]} */ params) => {
                if (/pg_stat_activity/.test(sql)) {
                  if (forever || alive-- > 0) return { rows: [{ r: [{ role: ra, pid: 4242 }] }] };
                  return { rows: [{ r: [] }] };
                }
                return /** @type {any} */ (h.rootClient).query(sql, params);
              },
            }),
        );
      const error = await rejectsWith(
        () => rootWith(true).revokeOrphanCredentials({ settleMs: 120, pollMs: 20 }),
        [FENCE_ERRORS.ORPHAN_SWEEP_INCOMPLETE],
        'جلسةٌ لا تموت',
      );
      assert.deepEqual(error.detail.lingering, [{ role: ra, pid: 4242 }]);
      assert.deepEqual(error.detail.appeared, []);
      assert.equal((await credentials()).find((c) => c.role_name === ra)?.status, 'REVOKED');
      const b = await h.boot('beta', { connect: false });
      const r = await rootWith(false).revokeOrphanCredentials({ settleMs: 2_000, pollMs: 10 });
      assert.deepEqual(
        r.revoked.map((x) => x.role_name),
        [String(b.credential.role_name)],
      );
      assert.equal(alive, -1, 'انتُظِرت الجلسةُ ثلاثَ مرّاتٍ ثمّ ماتت');
    });
  },
);

test('TH-SUP-05: مدخلاتُ الكنسِ تُرفَضُ قبلَ أيِّ اتصال (‏WL-577)', async () => {
  let connects = 0;
  const root = new FenceRoot(async () => {
    connects++;
    throw new Error('لا اتصال');
  });
  for (const [opts, why] of /** @type {Array<[any, string]>} */ ([
    [{ keep: [''] }, 'keep فارغ'],
    [{ keep: [42] }, 'keep رقم'],
    [{ keep: [null] }, 'keep null'],
    [{ reason: '' }, 'سببٌ فارغ'],
    [{ reason: '   ' }, 'سببٌ فراغات'],
    [{ reason: 7 }, 'سببٌ رقم'],
    [{ settleMs: 0 }, 'مهلةٌ صفر'],
    [{ settleMs: -1 }, 'مهلةٌ سالبة'],
    [{ settleMs: 1.5 }, 'مهلةٌ كسريّة'],
    [{ settleMs: Number.NaN }, 'مهلةٌ NaN'],
    [{ pollMs: 0 }, 'فاصلٌ صفر'],
    [{ pollMs: '10' }, 'فاصلٌ نصّ'],
  ]))
    await assert.rejects(() => root.revokeOrphanCredentials(opts), TypeError, why);
  assert.equal(connects, 0, 'لا اتصالَ لمدخلاتٍ مرفوضة');
  await assert.rejects(() => root.revokeOrphanCredentials(), /لا اتصال/);
  assert.equal(connects, 1, 'المدخلاتُ الصالحةُ تتّصل');
  assert.equal(ORPHAN_REVOKE_REASON, 'SUPERVISOR_BOOT_ORPHAN');
  assert.equal(FENCE_ERRORS.ORPHAN_SWEEP_INCOMPLETE, 'FENCE_ORPHAN_SWEEP_INCOMPLETE');
});

// ── LIVE-75 (‏WL-604): المُشرِفُ المركّب `FenceSupervisor` — عمليّاتُ عمّالٍ حقيقيّةٌ بـIPC و`XUUX_DB_FENCE=required` ──
// كلُّ عاملٍ عمليّةُ Node ابنةٌ حقيقيّة تسلكُ مسارَ العاملِ (‏`dbFenceMode` ⇒ `workerFenceHandshake` ⇒ `sealFencedPool` ⇒
// `assertFencedSession`) بمفتاحِها في ملفٍّ لا يقرؤه المُشرِف. **حدُّ الحزامِ المعلن:** دورُ الإقلاعِ يدخلُ بكلمةِ مرورٍ
// مشتقّةٍ يمنحُها superuser (‏`loginBroker`) — الإنتاجُ peer/pg_ident بلا سرّ (‏D-SUP-2)، والمختبرُ يختبرُ peer.
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FENCE_MODULE = new URL('../../src/fence/db-fence.mjs', import.meta.url).href;
const L75_WORKER_SRC = `
import { createHmac } from 'node:crypto';
import pg from 'pg';
import { assertFencedSession, dbFenceMode, fileKeyProvider, newBootId, sealFencedPool, workerFenceHandshake }
  from ${JSON.stringify(FENCE_MODULE)};
const env = process.env;
const mode = env.L75_MODE ?? 'write';
const send = (m) => { if (process.connected) { try { process.send(m); } catch {} } };
process.on('disconnect', () => { if (mode !== 'stubborn') process.exit(70); });
if (dbFenceMode(env) !== 'required') process.exit(64);
if (mode === 'die-before-hello') process.exit(11);
const workerId = env.XUUX_FENCE_WORKER_ID;
const key = fileKeyProvider(env.XUUX_FENCE_WORKER_KEY);
const bootId = newBootId();
const cred = await workerFenceHandshake(key, { workerId, bootId, timeoutMs: 10000 });
if (mode === 'die-after-handshake') process.exit(12);
const role = String(cred.role_name);
const url = new URL(env.L75_DB_URL);
url.username = role;
url.password = createHmac('sha256', env.L75_HARNESS_SECRET).update(role).digest('base64url');
const pool = new pg.Pool({ connectionString: url.toString(), max: 2, idleTimeoutMillis: 0 });
pool.on('error', () => {});
if (mode === 'seal-fail') {
  send({ type: 'xuux-fence/seal-failed', role_name: role, reason: 'injected' });
  await new Promise(() => {});
}
for (let i = 0; ; i++) {
  try { const c = await pool.connect(); c.release(); break; }
  catch (e) { if (i > 100) { send({ type: 'xuux-fence/seal-failed', role_name: role, reason: 'login' }); process.exit(14); }
    await new Promise((r) => setTimeout(r, 30)); }
}
let sessions;
try {
  sessions = await sealFencedPool(pool, 2, key, { db: cred.db, sysid: cred.sysid, workerId, bootId, epoch: cred.epoch, roleName: role });
} catch (e) {
  send({ type: 'xuux-fence/seal-failed', role_name: role, reason: String(e?.message ?? e) });
  process.exit(13);
}
send({ type: 'xuux-fence/sealed', role_name: role, sessions: mode === 'seal-lie' ? sessions.slice(0, 1) : sessions });
if (mode === 'seal-lie') await new Promise(() => {});
await assertFencedSession(pool, { workerId, bootId });
send({ type: 'l75/ready', role, pid: process.pid });
const id = Number(env.L75_ID);
if (mode === 'open-txn') {
  const c = await pool.connect();
  await c.query('BEGIN');
  await c.query("INSERT INTO state.fence_probe (id, v) VALUES ($1, 'open-txn')", [id]);
  send({ type: 'l75/txn-open' });
  await new Promise(() => {});
}
if (mode === 'die-after-ready') setTimeout(() => process.exit(21), 150);
let n = 0;
for (;;) {
  try {
    await pool.query('INSERT INTO state.fence_probe (id, v) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET v = excluded.v', [id, String(++n)]);
    send({ type: 'l75/wrote', n });
  } catch (e) {
    send({ type: 'l75/write-refused', code: e?.code ?? null });
    if (mode !== 'stubborn') process.exit(30);
  }
  await new Promise((r) => setTimeout(r, 40));
}
`;

/** @param {() => Promise<boolean> | boolean} fn @param {number} ms @param {string} why */
async function l75Until(fn, ms, why) {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > deadline) throw new Error(`انقضت المهلة: ${why}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe(
  'LIVE-75 — المُشرِفُ المركّب FenceSupervisor: إقلاعٌ وكنسٌ ومراقبةٌ وإعادةٌ وفشلٌ مغلق (‏WL-604)',
  { skip: skipWithoutDatabase },
  () => {
    /** @type {Awaited<ReturnType<typeof harness>>} */
    let h;
    /** @type {string} */
    let dir;
    /** @type {string} */
    let rootPassword;
    const secret = randomBytes(18).toString('base64url');
    /** @type {Record<string, string>} */
    const keyFiles = {};
    /** @type {Set<import('node:child_process').ChildProcess>} */
    const children = new Set();
    /** @type {FenceSupervisor[]} */
    const supervisors = [];

    before(async () => {
      h = await harness('fence_sup');
      await h.resume();
      dir = mkdtempSync(join(tmpdir(), 'xuux-l75-'));
      for (const w of /** @type {const} */ (['alpha', 'beta'])) {
        keyFiles[w] = join(dir, `${w}.pem`);
        writeFileSync(keyFiles[w], h.keys[w].privateKeyPem, { mode: 0o600 });
        chmodSync(keyFiles[w], 0o600);
      }
      rootPassword = randomBytes(18).toString('base64url');
      await h.db.pool.query(`ALTER ROLE xf_root PASSWORD '${rootPassword}'`);
    });
    after(async () => {
      for (const s of supervisors) await s.stop().catch(() => {});
      for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
      await h?.close();
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    /** @param {string} [base] */
    const rootUrl = (base = databaseUrl() ?? '') => {
      const u = new URL(base);
      u.username = 'xf_root';
      u.password = rootPassword;
      u.pathname = `/${h.db.name}`;
      return u.toString();
    };
    const workerDbUrl = () => {
      const u = new URL(databaseUrl() ?? '');
      u.pathname = `/${h.db.name}`;
      return u.toString();
    };
    /** @param {string} url */
    const connectAt = (url) => async () => {
      const c = new pg.Client({ connectionString: url });
      c.on('error', () => {});
      await c.connect();
      return c;
    };
    /** @param {Record<string, any>} credential */
    const loginBroker = async (credential) => {
      const role = String(credential['role_name']);
      const pw = createHmac('sha256', secret).update(role).digest('base64url');
      await h.db.pool.query(
        `ALTER ROLE ${quoteIdent(role)} PASSWORD '${pw}' VALID UNTIL 'infinity'`,
      );
    };
    /** @type {Record<string, number>} */
    const probeId = { alpha: 7501, beta: 7502 };

    /**
     * @param {{ modes?: Record<string, string[]>, workers?: string[], url?: string, root?: FenceRoot,
     *           options?: Record<string, any> }} [o]
     */
    const mk = (o = {}) => {
      const url = o.url ?? rootUrl();
      /** @type {Array<Record<string, unknown>>} */
      const events = [];
      /** @type {Array<{ worker: string, attempt: number, env: Record<string, string>, child: import('node:child_process').ChildProcess }>} */
      const spawned = [];
      /** @type {Array<{ worker: string, attempt: number, m: any }>} */
      const messages = [];
      const modes = o.modes ?? {};
      const sup = new FenceSupervisor({
        root:
          o.root ??
          new FenceRoot(connectAt(url), { log: (e) => events.push({ src: 'root', ...e }) }),
        lockConnect: connectAt(url),
        workers: (o.workers ?? ['alpha', 'beta']).map((workerId) => ({ workerId })),
        spawnWorker: (spec, ctx) => {
          const list = modes[spec.workerId] ?? ['write'];
          const mode = list[Math.min(ctx.attempt - 1, list.length - 1)];
          const child = spawn(process.execPath, ['--input-type=module', '-e', L75_WORKER_SRC], {
            cwd: REPO_ROOT,
            env: {
              PATH: process.env['PATH'] ?? '',
              ...ctx.env,
              XUUX_FENCE_WORKER_KEY: keyFiles[spec.workerId],
              L75_MODE: mode,
              L75_DB_URL: workerDbUrl(),
              L75_HARNESS_SECRET: secret,
              L75_ID: String(probeId[spec.workerId]),
            },
            stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
          });
          child.stderr?.on('data', () => {});
          child.on('message', (m) =>
            messages.push({ worker: spec.workerId, attempt: ctx.attempt, m }),
          );
          children.add(child);
          spawned.push({ worker: spec.workerId, attempt: ctx.attempt, env: ctx.env, child });
          return child;
        },
        loginBroker,
        handshakeTimeoutMs: 8_000,
        sealTimeoutMs: 8_000,
        leaseIntervalMs: 200,
        monitorIntervalMs: 100,
        lockCheckTimeoutMs: 1_000,
        maxDbFailures: 2,
        killGraceMs: 500,
        restart: { maxRestarts: 3, windowMs: 60_000, backoffMs: 50 },
        reaper: { ceilingMs: 1_000, retryMs: 50, firstTickTimeoutMs: 3_000 },
        ...(o.options ?? {}),
        log: (e) => events.push({ src: 'supervisor', ...e }),
      });
      supervisors.push(sup);
      return { sup, events, spawned, messages };
    };

    /** اعتماداتُ الاختباراتِ السابقةِ (‏تُرى عندَ `clean()`) خارجَ ما يَعُدُّه الاختبارُ الجاري. */
    let seen = new Set();
    /** @returns {Promise<Array<{ role_name: string, worker_id: string, status: string, revoke_reason: string | null }>>} */
    const creds = async () =>
      (
        await h.db.pool.query(
          `SELECT role_name::text AS role_name, worker_id, status, revoke_reason FROM fence.credentials ORDER BY issued_at, role_name`,
        )
      ).rows.filter((/** @type {any} */ c) => !seen.has(c.role_name));
    const active = async () => (await creds()).filter((c) => c.status === 'ACTIVE');
    /** @param {string[]} roles */
    const sessionsOf = async (roles) =>
      Number(
        (
          await h.db.pool.query(
            'SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename = ANY($1::text[])',
            [roles],
          )
        ).rows[0].n,
      );
    const lockHolders = async () =>
      Number(
        (
          await h.db.pool.query(
            `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND classid = $1::oid AND objid = $2::oid
               AND objsubid = 2 AND granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
            [...SUPERVISOR_LOCK_KEY],
          )
        ).rows[0].n,
      );
    /** @param {FenceSupervisor} sup @param {string} id */
    const workerOf = (sup, id) => sup.snapshot().workers.find((w) => w.id === id);
    /** @param {import('node:child_process').ChildProcess} c */
    const dead = (c) => c.exitCode !== null || c.signalCode !== null;
    /** بدايةٌ نظيفة: لا اعتمادَ نشِط، والسياجُ RUNNING، ولا قفل. */
    const clean = async () => {
      // ‏اختبارٌ سابقٌ سقطَ قبلَ `stop()` لا يتركُ مُشرِفَه ممسكاً بالقفلِ للتالي.
      for (const s of supervisors.splice(0)) await s.stop().catch(() => {});
      if ((await h.sovereign.status()).effective.state !== 'RUNNING') await h.resume();
      await h.root.revokeOrphanCredentials();
      await h.db.pool.query('DELETE FROM state.fence_probe WHERE id IN (7501, 7502)');
      await l75Until(
        async () => (await lockHolders()) === 0,
        5_000,
        'القفلُ محرَّرٌ قبلَ الاختبار',
      );
      assert.deepEqual(await active(), [], 'لا اعتمادَ نشِطاً قبلَ الاختبار');
      seen = new Set(
        (await h.db.pool.query('SELECT role_name::text AS r FROM fence.credentials')).rows.map(
          (/** @type {any} */ x) => x.r,
        ),
      );
    };

    test('SUP-01: الإقلاعُ الكامل — قفل ⇒ كنس ⇒ RUNNING ⇒ حاصد ⇒ عاملان بـXUUX_DB_FENCE=required مختومان يكتبان؛ والإيقافُ يُلغي ثمّ يقتلُ ويُحرِّرُ القفل', async () => {
      await clean();
      // ‏يتيمٌ قبلَ الإقلاع (‏مُشرِفٌ سابقٌ مات): الكنسُ يُلغيه قبلَ أيِّ إطلاق.
      const orphan = await h.boot('alpha', { connect: false });
      const { sup, events, spawned, messages } = mk();
      await sup.start();
      assert.equal(sup.state, 'RUNNING');
      const steps = events.filter((e) => e.src === 'supervisor').map((e) => e.ev);
      assert.deepEqual(
        steps.slice(0, 3),
        ['supervisor_locking', 'supervisor_swept', 'supervisor_running'],
        'الترتيب: قفلٌ ثمّ كنسٌ ثمّ RUNNING (‏الحاصدُ قبلَه)',
      );
      const byRole = new Map((await creds()).map((c) => [c.role_name, c]));
      assert.equal(
        byRole.get(String(orphan.credential.role_name))?.status,
        'REVOKED',
        'اليتيمُ أُلغي',
      );
      assert.equal(
        byRole.get(String(orphan.credential.role_name))?.revoke_reason,
        ORPHAN_REVOKE_REASON,
      );
      for (const s of spawned)
        assert.equal(s.env['XUUX_DB_FENCE'], 'required', 'العاملُ يُطلَقُ بالسياجِ إلزاميّاً');
      const snap = sup.snapshot();
      assert.deepEqual(
        snap.workers.map((w) => w.state),
        ['RUNNING', 'RUNNING'],
      );
      const roles = snap.workers.map((w) => String(w.role));
      const act = await active();
      assert.deepEqual(
        act.map((c) => c.role_name).sort(),
        [...roles].sort(),
        'النشِطُ = ما يُشرِفُ عليه بالضبط',
      );
      for (const role of roles) {
        const seal = await h.root.credentialSeal(role);
        assert.equal(seal?.sealed, true, `${role} مختوم`);
        assert.equal(seal?.sessions?.length, 2, 'جلستا المجمّعِ مختومتان');
      }
      await l75Until(
        () =>
          ['alpha', 'beta'].every((w) =>
            messages.some((x) => x.worker === w && x.m?.type === 'l75/wrote'),
          ),
        8_000,
        'العاملانِ كتبا',
      );
      assert.ok((snap.reaper?.ticks ?? 0) >= 1, 'الحاصدُ نادى مرّةً على الأقلّ قبلَ الإطلاق');
      assert.equal(await lockHolders(), 1, 'القفلُ ممسوك');
      const r = await sup.stop();
      assert.equal(r.state, 'STOPPED');
      assert.deepEqual(r.revokeErrors, []);
      assert.deepEqual([...r.revoked].sort(), [...roles].sort());
      for (const c of await creds())
        if (roles.includes(c.role_name)) {
          assert.equal(c.status, 'REVOKED');
          assert.equal(c.revoke_reason, 'SUPERVISOR:SUPERVISOR_STOP');
        }
      assert.equal(await sessionsOf(roles), 0, 'لا جلسةَ بعدَ الإيقاف');
      for (const s of spawned) assert.ok(dead(s.child), 'كلُّ عاملٍ مات');
      assert.equal(await lockHolders(), 0, 'القفلُ حُرِّر');
      assert.equal(sup.snapshot().serial.maxConcurrent, 1, 'الطابورُ تسلسليٌّ');
    });

    test('SUP-02: موتُ العاملِ أثناءَ الإقلاع (‏قبلَ hello، وبعدَ المصافحةِ قبلَ الختم) ⇒ ما صدرَ يُلغى، ويُعادُ حتى يعمل', async () => {
      await clean();
      const { sup, spawned, events } = mk({
        workers: ['alpha'],
        modes: { alpha: ['die-before-hello', 'die-after-handshake', 'write'] },
      });
      await sup.start();
      await l75Until(
        () => workerOf(sup, 'alpha')?.state === 'RUNNING',
        15_000,
        'alpha يعملُ في المحاولةِ الثالثة',
      );
      const w = workerOf(sup, 'alpha');
      assert.equal(w?.attempts, 3);
      const all = (await creds()).filter((c) => c.worker_id === 'alpha');
      const act = all.filter((c) => c.status === 'ACTIVE');
      assert.deepEqual(
        act.map((c) => c.role_name),
        [String(w?.role)],
        'نشِطٌ واحدٌ هو الجاري',
      );
      const failed = all.filter(
        (c) =>
          c.role_name !== w?.role &&
          c.status === 'REVOKED' &&
          c.revoke_reason !== ORPHAN_REVOKE_REASON,
      );
      assert.equal(failed.length, 1, 'اعتمادُ «بعدَ المصافحة» أُلغي (‏قبلَ hello لا اعتماد)');
      assert.match(
        String(failed[0]?.revoke_reason),
        /^(SEAL_NOT_CONFIRMED|SUPERVISOR_BOOT_FAILED)/,
      );
      assert.equal(await sessionsOf([String(failed[0]?.role_name)]), 0);
      assert.deepEqual(
        spawned.slice(0, 2).map((s) => s.child.exitCode),
        [11, 12],
        'المحاولتانِ الأولَيانِ ماتتا بالرمزِ المحقون',
      );
      assert.ok(events.some((e) => e.ev === 'worker_boot_failed'));
      await sup.stop();
    });

    test('SUP-03: موتُ العاملِ بعدَ الختم (‏SIGKILL) ⇒ إلغاءٌ قبلَ أيِّ إعادة، والدورُ القديمُ NOLOGIN بلا جلسات، ثمّ عاملٌ جديد', async () => {
      await clean();
      const { sup, spawned } = mk({ workers: ['alpha'] });
      await sup.start();
      const first = String(workerOf(sup, 'alpha')?.role);
      spawned[0]?.child.kill('SIGKILL');
      await l75Until(
        () => workerOf(sup, 'alpha')?.state === 'RUNNING' && workerOf(sup, 'alpha')?.role !== first,
        15_000,
        'عاملٌ جديدٌ بدورٍ جديد',
      );
      const old = (await creds()).find((c) => c.role_name === first);
      assert.equal(old?.status, 'REVOKED');
      assert.match(String(old?.revoke_reason), /^SUPERVISOR_WORKER_LOST:EXIT:null\/SIGKILL/);
      assert.equal(await sessionsOf([first]), 0);
      const login = await h.db.pool.query(
        'SELECT rolcanlogin AS l FROM pg_roles WHERE rolname = $1',
        [first],
      );
      assert.equal(login.rows[0]?.l ?? false, false, 'NOLOGIN');
      assert.equal((await active()).length, 1);
      await sup.stop();
    });

    test('SUP-04: فشلُ تأكيدِ الختم (‏إبلاغُ فشل، ومجموعةٌ كاذبة) ⇒ إلغاءٌ وقتل، وبعدَ حدِّ الإعادة GAVE_UP بلا نشِط', async () => {
      await clean();
      const { sup, spawned } = mk({
        workers: ['alpha'],
        modes: { alpha: ['seal-fail', 'seal-lie'] },
        options: { restart: { maxRestarts: 1, windowMs: 60_000, backoffMs: 50 } },
      });
      await sup.start();
      await l75Until(
        () => workerOf(sup, 'alpha')?.state === 'GAVE_UP',
        15_000,
        'استسلامٌ بعدَ محاولتين',
      );
      assert.equal(workerOf(sup, 'alpha')?.attempts, 2);
      const mine = (await creds()).filter(
        (c) => c.worker_id === 'alpha' && c.revoke_reason !== ORPHAN_REVOKE_REASON,
      );
      assert.equal(mine.length, 2);
      for (const c of mine) {
        assert.equal(c.status, 'REVOKED');
        assert.match(String(c.revoke_reason), /^SEAL_NOT_CONFIRMED:(injected|mismatch)/);
      }
      assert.deepEqual(await active(), []);
      await l75Until(() => spawned.every((s) => dead(s.child)), 5_000, 'كلُّ محاولةٍ قُتلت');
      await sup.stop();
    });

    test('SUP-05: مُشرِفٌ ثانٍ على القاعدةِ نفسِها ⇒ FENCE_SUPERVISOR_LOCKED قبلَ أيِّ كنس — اعتماداتُ الأوّلِ تبقى ويكتب', async () => {
      await clean();
      const a = mk();
      await a.sup.start();
      const roles = a.sup.snapshot().workers.map((w) => String(w.role));
      const b = mk();
      const err = await rejection(() => b.sup.start());
      assert.equal(err.code, 'FENCE_SUPERVISOR_LOCKED');
      assert.equal(b.sup.state, 'FAILED');
      assert.equal(b.spawned.length, 0, 'الثاني لم يُطلِق');
      assert.ok(!b.events.some((e) => e.ev === 'supervisor_swept'), 'الثاني لم يكنس');
      assert.deepEqual(
        (await active()).map((c) => c.role_name).sort(),
        [...roles].sort(),
        'اعتماداتُ الأوّلِ ACTIVE',
      );
      assert.equal(a.sup.state, 'RUNNING');
      const n = a.messages.filter((x) => x.m?.type === 'l75/wrote').length;
      await l75Until(
        () => a.messages.filter((x) => x.m?.type === 'l75/wrote').length > n + 2,
        5_000,
        'الأوّلُ ما زالَ يكتب',
      );
      assert.equal(await lockHolders(), 1);
      await a.sup.stop();
    });

    test('SUP-06: موتُ المُشرِفِ نفسِه (‏عمليّةُ CLI بـSIGKILL) ⇒ القاعدةُ تُحرِّرُ القفل؛ عاملٌ عنيدٌ يكتبُ حتى يكنسَه المُشرِفُ التالي', async () => {
      await clean();
      const cfgPath = join(dir, 'sup.json');
      const cmd = [process.execPath, '--input-type=module', '-e', L75_WORKER_SRC];
      const wenv = (/** @type {string} */ w, /** @type {string} */ mode) => ({
        XUUX_FENCE_WORKER_KEY: keyFiles[w],
        L75_MODE: mode,
        L75_DB_URL: workerDbUrl(),
        L75_HARNESS_SECRET: secret,
        L75_ID: String(probeId[w]),
      });
      writeFileSync(
        cfgPath,
        JSON.stringify({
          harnessPasswordBroker: true,
          workers: [
            { workerId: 'alpha', command: cmd, env: wenv('alpha', 'stubborn') },
            { workerId: 'beta', command: cmd, env: wenv('beta', 'write') },
          ],
          options: {
            leaseIntervalMs: 200,
            monitorIntervalMs: 100,
            killGraceMs: 500,
            reaper: { ceilingMs: 1000, retryMs: 50, firstTickTimeoutMs: 3000 },
          },
        }),
        { mode: 0o600 },
      );
      const suUrl = workerDbUrl();
      const cli = spawn(
        process.execPath,
        ['scripts/fence-lab.mjs', 'supervise', '--config', cfgPath],
        {
          cwd: REPO_ROOT,
          env: {
            PATH: process.env['PATH'] ?? '',
            XUUX_ROOT_DATABASE_URL: rootUrl(),
            XUUX_FENCE_HARNESS: '1',
            XUUX_HARNESS_SUPERUSER_URL: suUrl,
            XUUX_HARNESS_SECRET: secret,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      children.add(cli);
      /** @type {any[]} */
      const lines = [];
      let buf = '';
      cli.stdout?.on('data', (d) => {
        buf += String(d);
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          try {
            lines.push(JSON.parse(line));
          } catch {
            lines.push({ raw: line });
          }
        }
      });
      cli.stderr?.on('data', () => {});
      await l75Until(
        () => lines.some((l) => l.ev === 'cli_started'),
        20_000,
        'المُشرِفُ (‏CLI) أقلع',
      );
      const started = lines.find((l) => l.ev === 'cli_started');
      const ws = started.snapshot.workers;
      assert.deepEqual(
        ws.map((/** @type {any} */ w) => w.state),
        ['RUNNING', 'RUNNING'],
      );
      const alphaRole = String(ws[0].role);
      const alphaPid = Number(ws[0].pid);
      const betaPid = Number(ws[1].pid);
      assert.equal(await lockHolders(), 1, 'عمليّةُ المُشرِفِ تمسكُ القفل');
      cli.kill('SIGKILL');
      await l75Until(() => dead(cli), 5_000, 'المُشرِفُ مات');
      await l75Until(
        async () => (await lockHolders()) === 0,
        5_000,
        'القاعدةُ حرّرت القفلَ بموتِ وصلته',
      );
      const alive = (/** @type {number} */ pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      await l75Until(() => !alive(betaPid), 5_000, 'العاملُ العاديُّ خرجَ بانقطاعِ IPC');
      assert.ok(alive(alphaPid), 'العنيدُ حيٌّ بلا مُشرِف — هذه النافذةُ المعلنة');
      const v1 = (await h.db.pool.query('SELECT v FROM state.fence_probe WHERE id = 7501')).rows[0]
        ?.v;
      await new Promise((r) => setTimeout(r, 200));
      const v2 = (await h.db.pool.query('SELECT v FROM state.fence_probe WHERE id = 7501')).rows[0]
        ?.v;
      // ‏قد يكونُ الإيجارُ انقضى (‏renew كلَّ 200ms بلا حافظ) فتُرفضُ كتابتُه قبلَ الكنس — كلاهما يُسجَّل، لا يُفترَض.
      const wroteWithoutSupervisor = v1 !== v2;
      // ‏المُشرِفُ التالي (‏في هذه العمليّة): يقفلُ، ثمّ يكنسُ اليتيم.
      const next = mk({ workers: ['beta'] });
      await next.sup.start();
      const old = (await creds()).find((c) => c.role_name === alphaRole);
      assert.equal(old?.status, 'REVOKED', 'اعتمادُ العنيدِ أُلغي (‏بالكنسِ أو بانقضاءِ الإيجار)');
      assert.match(
        String(old?.revoke_reason),
        new RegExp(`^(${ORPHAN_REVOKE_REASON}|LEASE_LAPSED)`),
      );
      assert.equal(await sessionsOf([alphaRole]), 0, 'لا جلسةَ للعنيدِ بعدَ الكنس');
      const v3 = (await h.db.pool.query('SELECT v FROM state.fence_probe WHERE id = 7501')).rows[0]
        ?.v;
      await new Promise((r) => setTimeout(r, 300));
      const v4 = (await h.db.pool.query('SELECT v FROM state.fence_probe WHERE id = 7501')).rows[0]
        ?.v;
      assert.equal(v3, v4, 'العنيدُ لا يكتبُ بعدَ الكنس');
      process.kill(alphaPid, 'SIGKILL');
      await next.sup.stop();
      t_note('SUP-06', { wroteWithoutSupervisor, revokeReason: old?.revoke_reason });
    });

    test('SUP-07: فشلُ بدءِ الحاصد (‏نداءٌ يرمي، أو لا يعود) ⇒ FENCE_SUPERVISOR_REAPER_START، لا إطلاق، والقفلُ يُحرَّر', async () => {
      await clean();
      for (const target of [
        {
          reapLapsed: async () =>
            Promise.reject(Object.assign(new Error('reaper down'), { code: '57P01' })),
        },
        { reapLapsed: () => new Promise(() => {}) },
      ]) {
        const { sup, spawned } = mk({
          options: { reaper: { ceilingMs: 1_000, retryMs: 50, firstTickTimeoutMs: 300, target } },
        });
        const err = await rejection(() => sup.start());
        assert.equal(err.code, 'FENCE_SUPERVISOR_REAPER_START');
        assert.equal(sup.state, 'FAILED');
        assert.equal(spawned.length, 0, 'لا عاملَ بلا حاصد');
        assert.equal(await lockHolders(), 0);
      }
      assert.deepEqual(await active(), []);
    });

    test('SUP-08: إصدارٌ وإلغاءٌ متزامنان (‏عاملٌ يموتُ متكرّراً بينما الآخرُ يُقلِع، وإيقافٌ أثناءَ الإقلاع) ⇒ تسلسلٌ صارم ولا نشِطَ يتيم', async () => {
      await clean();
      const a = mk({
        modes: { alpha: ['die-after-ready'], beta: ['write'] },
        options: { restart: { maxRestarts: 4, windowMs: 60_000, backoffMs: 0 } },
      });
      await a.sup.start();
      await l75Until(
        () => workerOf(a.sup, 'alpha')?.state === 'GAVE_UP',
        20_000,
        'alpha استسلمَ بعدَ موتٍ متكرّر',
      );
      const snap = a.sup.snapshot();
      assert.equal(snap.serial.maxConcurrent, 1, 'لا نداءَ إصدارٍ وإلغاءٍ متداخلان');
      assert.ok(snap.serial.issue >= 10 && snap.serial.revoke >= 5, JSON.stringify(snap.serial));
      assert.deepEqual(
        (await active()).map((c) => c.role_name),
        [String(workerOf(a.sup, 'beta')?.role)],
        'النشِطُ الوحيدُ هو beta الجاري',
      );
      await a.sup.stop();
      // ‏إيقافٌ أثناءَ الإقلاع: stop() يُنادى فورَ إطلاقِ أوّلِ عامل.
      const b = mk({ options: { handshakeTimeoutMs: 8_000 } });
      const starting = b.sup.start();
      await l75Until(() => b.spawned.length >= 1, 10_000, 'أوّلُ عاملٍ أُطلِق');
      const r = await b.sup.stop();
      await starting.catch(() => {});
      assert.equal(r.state, 'STOPPED');
      assert.deepEqual(await active(), [], 'لا نشِطَ بعدَ إيقافٍ أثناءَ الإقلاع');
      await l75Until(() => b.spawned.every((s) => dead(s.child)), 5_000, 'لا عاملَ حيّ');
      assert.equal(await lockHolders(), 0);
    });

    test('SUP-09: انقطاعُ القاعدةِ عن المُشرِفِ في كلِّ مرحلةٍ حرجة ⇒ فشلٌ مغلق؛ وما تعذّرَ إلغاؤه يُعلَنُ ويكنسُه التالي', async () => {
      const target = new URL(databaseUrl() ?? '');
      /** @type {Array<Record<string, unknown>>} */
      const outcomes = [];
      for (const stage of [
        'before-lock',
        'boot_gate_sweeping',
        'worker_spawned',
        'worker_credential',
        'running',
      ]) {
        await clean();
        const proxy = await startFaultProxy({
          host: target.hostname,
          port: Number(target.port || 5432),
        });
        try {
          const url = rootUrl(proxy.urlFor(databaseUrl() ?? ''));
          /** @type {(e: Record<string, unknown>) => void} */
          let hook = () => {};
          const rootEvents = /** @type {Array<Record<string, unknown>>} */ ([]);
          const root = new FenceRoot(connectAt(url), {
            log: (e) => {
              rootEvents.push(e);
              hook(e);
            },
          });
          const m = mk({ url, root, workers: ['alpha'] });
          let cut = false;
          const down = () => {
            if (!cut) {
              cut = true;
              void proxy.down();
            }
          };
          if (stage === 'before-lock') await proxy.down();
          if (stage === 'boot_gate_sweeping')
            hook = (e) => e['ev'] === 'boot_gate_sweeping' && down();
          const poll = setInterval(() => {
            if (stage === 'worker_spawned' && m.events.some((e) => e.ev === 'worker_spawned'))
              down();
            if (stage === 'worker_credential' && m.events.some((e) => e.ev === 'worker_credential'))
              down();
          }, 1);
          let startError = null;
          try {
            await m.sup.start();
          } catch (error) {
            startError = /** @type {any} */ (error).code ?? String(error);
          }
          if (stage === 'running') {
            assert.equal(m.sup.state, 'RUNNING');
            down();
          }
          const result = await Promise.race([
            m.sup.done,
            new Promise((_, rej) =>
              setTimeout(() => rej(new Error(`${stage}: المُشرِفُ لم يتوقّف`)), 15_000),
            ),
          ]);
          clearInterval(poll);
          assert.equal(m.sup.state, 'FAILED', `${stage}: FAILED`);
          await l75Until(
            () => m.spawned.every((s) => dead(s.child)),
            5_000,
            `${stage}: لا عاملَ حيّ`,
          );
          await proxy.up();
          const left = await active();
          outcomes.push({
            stage,
            startError,
            reason: result.reason,
            revokeErrors: result.revokeErrors.length,
            unresolved: result.unresolved.length,
            activeLeft: left.length,
          });
          // ‏لا صمت: كلُّ اعتمادٍ بقيَ ACTIVE مُعلَنٌ في تقريرِ الإيقاف (‏فشلُ إلغاءٍ أو جردٍ) أو بوصفِه عاملاً جارياً.
          if (left.length > 0)
            assert.ok(
              result.revokeErrors.length + result.unresolved.length > 0,
              `${stage}: ${left.length} نشِطٌ باقٍ والتقريرُ لا يُعلِنُه`,
            );
          if (stage === 'before-lock' || stage === 'boot_gate_sweeping')
            assert.equal(m.spawned.length, 0, `${stage}: لا إطلاق`);
          // ‏ما بقيَ ACTIVE (‏تعذّرَ إلغاؤه والقاعدةُ مقطوعة) يُكنَسُ عندَ المُشرِفِ التالي — يُثبَتُ هنا لا يُفترَض.
          if (left.length > 0) {
            const next = mk({ workers: ['beta'] });
            await next.sup.start();
            for (const c of left) {
              const after = (await creds()).find((x) => x.role_name === c.role_name);
              assert.equal(
                after?.status,
                'REVOKED',
                `${stage}: ${c.role_name} أُلغي بالكنسِ التالي`,
              );
              assert.equal(await sessionsOf([c.role_name]), 0);
            }
            await next.sup.stop();
          }
        } finally {
          await proxy.close();
        }
      }
      t_note('SUP-09', outcomes);
    });

    test('SUP-10: معاملةٌ مفتوحةٌ للعامل أثناءَ تغيّرِ التفويض (‏إيقافُ المُشرِف، ثمّ HALT سياديّ) ⇒ لا تلتزم، وWAITING ثمّ إعادةُ إطلاقٍ بعدَ RESUME', async () => {
      await clean();
      const a = mk({ workers: ['alpha'], modes: { alpha: ['open-txn'] } });
      await a.sup.start();
      await l75Until(
        () => a.messages.some((x) => x.m?.type === 'l75/txn-open'),
        8_000,
        'معاملةٌ مفتوحة',
      );
      const role = String(workerOf(a.sup, 'alpha')?.role);
      await a.sup.stop();
      assert.equal(
        (await h.db.pool.query('SELECT count(*)::int AS n FROM state.fence_probe WHERE id = 7501'))
          .rows[0].n,
        0,
        'المعاملةُ المفتوحةُ لم تلتزم',
      );
      assert.equal(await sessionsOf([role]), 0);
      // ‏HALT سياديٌّ تحتَ مُشرِفٍ جارٍ: المراقِبُ يرى غيرَ RUNNING ⇒ WAITING بلا إعادةِ إطلاق؛ RESUME ⇒ كنسٌ وإطلاق.
      await clean();
      const b = mk({ workers: ['alpha'], modes: { alpha: ['open-txn', 'write'] } });
      await b.sup.start();
      await l75Until(
        () => b.messages.some((x) => x.m?.type === 'l75/txn-open'),
        8_000,
        'معاملةٌ مفتوحة (‏2)',
      );
      const r1 = String(workerOf(b.sup, 'alpha')?.role);
      const halted = await h.root.halt('l75-sup-10', { effects: NO_EFFECTS });
      assert.equal(halted.systemHaltComplete, true);
      await l75Until(() => b.sup.state === 'WAITING', 5_000, 'المُشرِفُ WAITING');
      assert.equal(
        (await h.db.pool.query('SELECT count(*)::int AS n FROM state.fence_probe WHERE id = 7501'))
          .rows[0].n,
        0,
      );
      assert.equal(await sessionsOf([r1]), 0);
      await new Promise((r) => setTimeout(r, 400));
      assert.deepEqual(await active(), [], 'لا إصدارَ تحتَ HALTED');
      // ‏مُشرِفٌ جديدٌ تحتَ HALTED يرفضُ الإقلاع.
      const c = mk({ workers: ['beta'] });
      assert.equal(
        (await rejection(() => c.sup.start())).code,
        'FENCE_SUPERVISOR_LOCKED',
        'القفلُ ما زالَ لـb',
      );
      await h.resume();
      await l75Until(
        () => b.sup.state === 'RUNNING' && workerOf(b.sup, 'alpha')?.state === 'RUNNING',
        15_000,
        'إعادةُ الإطلاقِ بعدَ RESUME',
      );
      assert.notEqual(workerOf(b.sup, 'alpha')?.role, r1);
      await b.sup.stop();
      // ‏والإقلاعُ تحتَ HALTED (‏بلا مُشرِفٍ آخر) ⇒ FENCE_SUPERVISOR_NOT_RUNNING.
      await h.root.halt('l75-sup-10b', { effects: NO_EFFECTS });
      const d = mk({ workers: ['beta'] });
      assert.equal((await rejection(() => d.sup.start())).code, 'FENCE_SUPERVISOR_NOT_RUNNING');
      assert.equal(d.spawned.length, 0);
      await h.resume();
    });
  },
);

/** سطرُ قياسٍ في مخرجِ TAP (‏دليلٌ لا تأكيد). @param {string} id @param {unknown} data */
function t_note(id, data) {
  process.stdout.write(`# L75-NOTE ${id} ${JSON.stringify(data)}\n`);
}

test('LIVE-75: مدخلاتُ FenceSupervisor تُرفَضُ قبلَ أيِّ اتصال', () => {
  const ok = () => ({
    root: new FenceRoot(async () => {
      throw new Error('لا اتصال');
    }),
    lockConnect: async () => {
      throw new Error('لا اتصال');
    },
    workers: [{ workerId: 'alpha' }],
    spawnWorker: () => {
      throw new Error('لا إطلاق');
    },
  });
  assert.ok(new FenceSupervisor(ok()));
  for (const [patch, why] of /** @type {Array<[any, string]>} */ ([
    [{ root: {} }, 'جذرٌ ليس FenceRoot'],
    [{ lockConnect: null }, 'بلا وصلةِ قفل'],
    [{ spawnWorker: 'x' }, 'بلا مُطلِق'],
    [{ workers: [] }, 'بلا عمّال'],
    [{ workers: [{ workerId: 'a' }, { workerId: 'a' }] }, 'عاملٌ مكرّر'],
    [{ workers: [{ workerId: '' }] }, 'معرّفٌ فارغ'],
    [{ monitorIntervalMs: 0 }, 'فاصلُ مراقبةٍ صفر'],
    [{ handshakeTimeoutMs: 1.5 }, 'مهلةٌ كسريّة'],
    [{ leaseIntervalMs: 0 }, 'فاصلُ إيجارٍ صفر'],
    [{ restart: { maxRestarts: -1 } }, 'حدُّ إعادةٍ سالب'],
  ]))
    assert.throws(() => new FenceSupervisor({ ...ok(), ...patch }), TypeError, why);
  const root = new FenceRoot(async () => {
    throw new Error('x');
  });
  new FenceSupervisor({ ...ok(), root }).snapshot();
  // ‏جذرٌ له بوابةٌ قائمة (‏مُشرِفٌ آخرُ في العمليّة) يُرفَض: المُشرِفُ يملكُ بوابتَه وحدَه.
  const gated = new FenceRoot(async () => {
    throw new Error('x');
  });
  new SupervisorBootGate(gated);
  assert.throws(() => new FenceSupervisor({ ...ok(), root: gated }), TypeError);
  assert.equal(FENCE_ERRORS.SUPERVISOR_LOCKED, 'FENCE_SUPERVISOR_LOCKED');
  assert.deepEqual([...SUPERVISOR_LOCK_KEY], [0x58555558, 0x53555056]);
});
