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
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import pg from 'pg';

import {
  FENCE_ERRORS,
  FenceError,
  FenceSovereign,
  confirmWorkerSeal,
  generateTestKeyProvider,
  reviewEffectsEvidence,
  sealFencedPool,
  sealFencedSessions,
} from '../../src/fence/db-fence.mjs';
import { HaltSwitch, KingIdentity } from '../../src/root-of-trust/index.mjs';
import { NO_EFFECTS, harness, rejection, rejectsWith } from '../helpers/fence-harness.mjs';
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
    await h.db.pool.query(`ALTER ROLE ${quoteIdent(role)} PASSWORD '${password}' VALID UNTIL 'infinity'`);
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
