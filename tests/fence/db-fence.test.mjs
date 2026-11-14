/**
 * سياجُ قاعدةِ البيانات (`WL-532`) — اختباراتُ القبولِ (§10) والهجماتِ (§11) على PostgreSQL حقيقيّ.
 *
 * **ما تُثبتُه وما لا تُثبتُه:**
 *  - كلُّ اختبارٍ هنا يعملُ على قاعدةٍ معزولةٍ طُبِّقت عليها الهجراتُ كلُّها (ومنها 0024)، وأدوارُ
 *    `xf_root`/`xf_sovereign`/أدوارُ الإقلاعِ هي الأدوارُ الحقيقيّة؛ والتوقيعاتُ Ed25519 حقيقيّة.
 *  - **حدُّ الحزام (harness):** في CI لا مصادقةَ peer ولا شهادات؛ فيمنحُ الاختبارُ — بصلاحيةِ
 *    superuser — كلمةَ مرورٍ عشوائيةً لكلِّ دورٍ يتّصلُ به. ذلك يُثبتُ منطقَ السياجِ ولا يُثبتُ
 *    ربطَ الاعتمادِ بهويّةِ النظام (`T-CRED-05`): ذلك في `scripts/fence-lab.mjs` بـpeer وpg_ident.
 *    ويتحقّقُ الاختبارُ **قبلَ** منحِ كلمةِ المرور أنّ دورَ الإقلاعِ صدرَ بلا سرّ.
 *  - superuser (مالكُ الحزام) خارجَ السياجِ عمداً (`T-OWN-04`) ويُعلَنُ break-glass.
 */

import assert from 'node:assert/strict';
import { createPrivateKey, randomBytes, sign as nodeSign, generateKeyPairSync } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';

import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers';
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FENCE_ERRORS,
  FenceError,
  FenceSovereign,
  assertFencedSession,
  dbFenceMode,
  prepareFencedWorker,
  superviseWorkerHandshake,
  generateTestKeyProvider,
  newBootId,
  rawEd25519PublicKey,
  confirmWorkerSeal,
  sealFencedSessions,
  signCredentialChallenge,
} from '../../src/fence/db-fence.mjs';
import { auditWorkerCapabilitiesLive, loadCapabilityPolicy } from '../../src/fence/effects.mjs';
import { DB_ERRORS, createPool } from '../../src/persistence/db.mjs';
import { HaltSwitch, KingIdentity } from '../../src/root-of-trust/index.mjs';
import { databaseUrl, quoteIdent, skipWithoutDatabase } from '../helpers/pg.mjs';
import { NO_EFFECTS, harness, rejection, rejectsWith } from '../helpers/fence-harness.mjs';

/** إرسالُ COPY FROM STDIN بلا مكتبةٍ إضافية: كائنٌ قابلٌ للإرسالِ بواجهةِ `pg`. */
class CopyIn {
  /** @param {string} text @param {string} data */
  constructor(text, data) {
    this.text = text;
    this.data = data;
    /** @type {any} */
    this.error = null;
    this.done = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
  /** @param {any} connection */
  submit(connection) {
    connection.query(this.text);
  }
  /** @param {any} connection */
  handleCopyInResponse(connection) {
    connection.sendCopyFromChunk(Buffer.from(this.data));
    connection.endCopyFrom();
  }
  handleCommandComplete() {}
  handleRowDescription() {}
  handleDataRow() {}
  handleEmptyQuery() {}
  handlePortalSuspended() {}
  /** @param {any} error */
  handleError(error) {
    // `pg` يُصفِّرُ الاستعلامَ النشِطَ عندَ الخطأ فلا يصلُ ReadyForQuery إلى هذا الكائن: نرفضُ فوراً.
    this.error = error;
    this.reject(error);
  }
  handleReadyForQuery() {
    if (this.error) this.reject(this.error);
    else this.resolve(true);
  }
}

/** @param {pg.Client} client @param {string} text @param {string} data */
function copyIn(client, text, data) {
  const q = new CopyIn(text, data);
  client.query(/** @type {any} */ (q));
  return q.done;
}

const RFC8032_TEST1 = {
  secret: '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', // متجهُ RFC 8032 العامُّ (اختبار 1) لا سرّ — secret-scan:allow
  pub: 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
  sig: 'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
};

describe('سياجُ القاعدة — WL-532', { skip: skipWithoutDatabase }, () => {
  /** @type {Awaited<ReturnType<typeof harness>>} */
  let h;
  before(async () => {
    h = await harness('fence');
  });
  after(async () => {
    await h?.close();
  });

  test('Ed25519 داخلَ القاعدة: متجهُ RFC 8032 (اختبار 1) ومطابقةُ Node، والتلاعبُ يُرفَض', async () => {
    const v = await h.db.pool.query(
      `SELECT fence.ed25519_verify(decode($1,'hex'), ''::bytea, decode($2,'hex')) AS ok`,
      [RFC8032_TEST1.pub, RFC8032_TEST1.sig],
    );
    assert.equal(v.rows[0].ok, true, 'متجهُ RFC 8032 يُقبَل');
    for (let i = 0; i < 4; i++) {
      const { privateKey } = generateKeyPairSync('ed25519');
      const msg = randomBytes(1 + i * 37);
      const sig = nodeSign(null, msg, privateKey);
      const pub = rawEd25519PublicKey(privateKey);
      const ok = await h.db.pool.query('SELECT fence.ed25519_verify($1,$2,$3) AS ok', [
        pub,
        msg,
        sig,
      ]);
      assert.equal(ok.rows[0].ok, true, 'توقيعُ Node يُقبَل');
      const bad = Buffer.from(sig);
      bad[i % 64] = Number(bad[i % 64]) ^ 1;
      const no = await h.db.pool.query('SELECT fence.ed25519_verify($1,$2,$3) AS ok', [
        pub,
        msg,
        bad,
      ]);
      assert.equal(no.rows[0].ok, false, 'بتٌّ مقلوبٌ يُرفَض');
      const other = Buffer.concat([msg, Buffer.from([0])]);
      const no2 = await h.db.pool.query('SELECT fence.ed25519_verify($1,$2,$3) AS ok', [
        pub,
        other,
        sig,
      ]);
      assert.equal(no2.rows[0].ok, false, 'رسالةٌ أخرى تُرفَض');
    }
    // S غيرُ قانونيّ (S + L): قابليةُ التطويعِ تُرفَض.
    const L = (1n << 252n) + 27742317777372353535851937790883648493n;
    const sig = Buffer.from(RFC8032_TEST1.sig, 'hex');
    let s = 0n;
    for (let i = 31; i >= 0; i--) s = (s << 8n) | BigInt(Number(sig[32 + i]));
    const s2 = s + L;
    const mall = Buffer.from(sig);
    let t = s2;
    for (let i = 0; i < 32; i++) {
      mall[32 + i] = Number(t & 0xffn);
      t >>= 8n;
    }
    if (t === 0n) {
      const no = await h.db.pool.query(
        `SELECT fence.ed25519_verify(decode($1,'hex'), ''::bytea, $2) AS ok`,
        [RFC8032_TEST1.pub, mall],
      );
      assert.equal(no.rows[0].ok, false, 'S ≥ L يُرفَض (لا تطويع)');
    }
    // تحقّقٌ من أنّ المفتاحَ السرّيَّ في المتجهِ يُنتجُ المفتاحَ العامَّ نفسَه (المتجهُ صحيحُ النقل).
    const pkcs8 = Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(RFC8032_TEST1.secret, 'hex'),
    ]);
    assert.equal(
      rawEd25519PublicKey(createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' })).toString(
        'hex',
      ),
      RFC8032_TEST1.pub,
    );
  });

  test('البدءُ مغلق: بعدَ الهجرةِ والإقلاعِ HALTED؛ لا عودةَ افتراضيةَ إلى RUNNING، ولا كتابةَ لعامل', async () => {
    const s = await h.sovereign.status();
    assert.equal(s.effective.state, 'HALTED');
    const chk = await h.root.checkFenced();
    assert.equal(chk.ok, true, `check_fenced سليمٌ تحتَ HALTED: ${JSON.stringify(chk.problems)}`);
    await rejectsWith(
      () => h.root.issueChallenge('alpha', newBootId()),
      ['XF502'],
      'لا إصدارَ تحتَ HALTED',
    );
  });

  test('RESUME: توقيعٌ مزوَّر، نوعٌ آخر، عهدٌ متوقَّعٌ خاطئ، نافذةٌ منقضية، هاشُ قائمةٍ خاطئ، دليلٌ غائب — كلُّها تُرفَض', async () => {
    const s0 = await h.sovereign.status();
    const send = (/** @type {{payload: string, signature: Buffer}} */ c) =>
      h.sovClient.query('SELECT fence.resume($1,$2)', [c.payload, c.signature]);
    // دليلٌ غائب (لا إيقافَ مكتملٌ في هذا العهدِ بعدَ الإقلاع)
    await rejectsWith(
      () =>
        send(
          h.sovereign.sign('resume', s0, {
            roster_hash: s0.bound.roster_hash,
            pm_start_epoch: String(s0.live.pm_start_epoch),
            effects_evidence_sha256: '0'.repeat(64),
          }),
        ),
      ['XF414'],
      'بلا دليلِ آثار',
    );
    // دليلٌ غيرُ مربوطٍ بإيقافٍ مكتمل ⇒ لا يُسجَّلُ أصلاً (XF509)
    const loose = { pre: true, ok: true };
    const looseD = (
      await h.rootClient.query(
        `SELECT encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') AS d`,
        [JSON.stringify(loose)],
      )
    ).rows[0].d;
    await rejectsWith(
      () =>
        h.rootClient.query('SELECT fence.record_effects_evidence($1, $2::jsonb)', [
          looseD,
          JSON.stringify(loose),
        ]),
      ['XF509'],
      'دليلٌ بلا halt_id',
    );
    const halted = await h.root.halt('resume-matrix', { effects: NO_EFFECTS });
    assert.equal(halted.systemHaltComplete, true, JSON.stringify(halted));
    const d = String(halted.effectsEvidenceSha256);
    const s = await h.sovereign.status();
    const extra = {
      roster_hash: s.bound.roster_hash,
      pm_start_epoch: String(s.live.pm_start_epoch),
      effects_evidence_sha256: d,
    };
    // توقيعٌ بمفتاحٍ آخر
    const forger = new FenceSovereign(h.sovClient, generateTestKeyProvider('forger'));
    await rejectsWith(() => send(forger.sign('resume', s, extra)), ['XF403'], 'مفتاحٌ مزوَّر');
    // حمولةٌ عُدِّلت بعدَ التوقيع
    const good = h.sovereign.sign('resume', s, extra);
    await rejectsWith(
      () =>
        send({ payload: good.payload.replace('"RESUME"', '"RESUME" '), signature: good.signature }),
      ['XF403'],
      'حمولةٌ معدَّلة',
    );
    // نوعٌ آخر بتوقيعٍ صحيح
    const wrongType = h.sovereign.sign('recover', s, extra);
    await rejectsWith(() => send(wrongType), ['XF404'], 'نوعٌ آخر');
    await rejectsWith(
      () =>
        send(h.sovereign.sign('resume', s, extra, { expectedEpoch: Number(s.bound.epoch) + 7 })),
      ['XF407'],
      'عهدٌ متوقَّعٌ خاطئ',
    );
    await rejectsWith(
      () => send(h.sovereign.sign('resume', s, extra, { validitySeconds: 100_000 })),
      ['XF408'],
      'نافذةُ صلاحيةٍ أطولُ من الحدّ',
    );
    await rejectsWith(
      () => send(h.sovereign.sign('resume', s, { ...extra, roster_hash: 'f'.repeat(64) })),
      ['XF413'],
      'هاشُ قائمةٍ خاطئ',
    );
    await rejectsWith(
      () =>
        send(h.sovereign.sign('resume', s, { ...extra, effects_evidence_sha256: 'a'.repeat(64) })),
      ['XF414'],
      'هاشُ دليلٍ لا يطابق',
    );
    // الجذرُ لا يستأنف (لا EXECUTE)
    await rejectsWith(
      () => h.rootClient.query('SELECT fence.resume($1,$2)', [good.payload, good.signature]),
      ['42501'],
      'الجذرُ ليس سيادياً',
    );
    // superuser لا يستأنفُ بالأمرِ السياديّ (فصلُ الهويّات)
    await rejectsWith(
      () => h.db.pool.query('SELECT fence.resume($1,$2)', [good.payload, good.signature]),
      ['XF401'],
      'superuser ليس السياديّ',
    );
    const st = await h.sovereign.status();
    assert.equal(st.effective.state, 'HALTED', 'كلُّ رفضٍ لم يُغيِّر الحالة');
    // والاستئنافُ الصحيح
    const ok = await send(good);
    assert.ok(ok);
    assert.equal((await h.sovereign.status()).effective.state, 'RUNNING');
    // إعادةُ إرسالِ الأمرِ نفسِه
    await rejectsWith(() => send(good), ['XF405', 'XF407', 'XF409'], 'إعادةُ إرسالِ RESUME');
  });

  test('T-CRED-07: الجذرُ وحدَه لا يُصدِرُ اعتماداً — يلزمُ توقيعُ مفتاحِ العاملِ المُدرَجِ على تحدّيه', async () => {
    const bootId = newBootId();
    const ch = await h.root.issueChallenge('alpha', bootId);
    await rejectsWith(
      () => h.root.completeCredential(ch.nonce, randomBytes(64)),
      ['XF506'],
      'توقيعٌ عشوائيّ',
    );
    const rootOwn = generateTestKeyProvider('root-own');
    await rejectsWith(
      () => h.root.completeCredential(ch.nonce, rootOwn.sign(Buffer.from(ch.message))),
      ['XF506'],
      'الجذرُ يوقّعُ بمفتاحِه',
    );
    await rejectsWith(
      () => h.root.completeCredential(ch.nonce, h.keys.beta.sign(Buffer.from(ch.message))),
      ['XF506'],
      'مفتاحُ عاملٍ آخر',
    );
    assert.throws(
      () => signCredentialChallenge(h.keys.alpha, ch, { workerId: 'alpha', bootId: newBootId() }),
      FenceError,
      'العاملُ لا يوقّعُ تحدّيَ إقلاعٍ آخر',
    );
    assert.throws(
      () =>
        signCredentialChallenge(
          h.keys.alpha,
          { ...ch, message: ch.message + 'x' },
          { workerId: 'alpha', bootId },
        ),
      FenceError,
      'ولا رسالةً غيرَ حقولِ التحدّي',
    );
    const cred = await h.root.completeCredential(
      ch.nonce,
      signCredentialChallenge(h.keys.alpha, ch, { workerId: 'alpha', bootId }),
    );
    assert.equal(cred.role_name, `xw_alpha_${bootId.slice(0, 16)}`);
    await rejectsWith(
      () =>
        h.root.completeCredential(
          ch.nonce,
          signCredentialChallenge(h.keys.alpha, ch, { workerId: 'alpha', bootId }),
        ),
      ['XF505'],
      'التحدّي لا يُستعمَلُ مرّتين',
    );
    await rejectsWith(
      () => h.root.issueChallenge('alpha', bootId),
      ['XF504'],
      'boot_id لا يُعادُ لعاملِه',
    );
    await h.root.revokeCredential(cred.role_name, 'test');
  });

  test('T-ROS-03: عاملٌ خارجَ القائمةِ لا يُصدَرُ له، وتغييرُ القائمةِ تحتَ RUNNING مرفوض', async () => {
    await rejectsWith(
      () => h.root.issueChallenge('gamma', newBootId()),
      ['XF008'],
      'خارجَ القائمة',
    );
    await rejectsWith(
      () =>
        h.sovereign.rosterSet([
          {
            worker_id: 'gamma',
            pubkey: generateTestKeyProvider().publicKeyRaw(),
            os_principal: 'x',
          },
        ]),
      ['XF409'],
      'القائمةُ لا تتغيّرُ تحتَ RUNNING',
    );
  });

  test('T-CRED-05 (جزئيٌّ هنا): دورُ الإقلاعِ يصدرُ بلا سرّ، ولا يرثُ إلا xuux_worker بلا SET', async () => {
    const w = await h.boot('alpha', { connect: false });
    assert.equal(
      w.issuedWithoutSecret,
      true,
      'PASSWORD NULL: لا يُدخَلُ إلا بمصادقةٍ مربوطة (peer/cert)',
    );
    const m = await h.db.pool.query(
      `SELECT m.roleid::regrole::text AS r, m.inherit_option, m.set_option FROM pg_auth_members m WHERE m.member = $1::regrole`,
      [w.credential.role_name],
    );
    assert.deepEqual(
      m.rows.map((r) => [r.r, r.inherit_option, r.set_option]),
      [['xuux_worker', true, false]],
    );
    await h.root.revokeCredential(w.credential.role_name, 'test');
  });

  test('الكتابةُ المشروعة: اعتمادٌ نشِطٌ في RUNNING يكتب (INSERT/UPSERT/MERGE/UPDATE/DELETE؛ وCOPY مرفوضٌ تحتَ RLS) ويعرفُ نفسَه', async () => {
    const w = await h.boot('alpha');
    const c = /** @type {pg.Client} */ (w.client);
    const who = await assertFencedSession(c, { workerId: 'alpha', bootId: w.bootId });
    assert.equal(who.worker_id, 'alpha');
    await c.query(`INSERT INTO state.fence_probe (id, v) VALUES (1, 'a')`);
    await c.query(
      `INSERT INTO state.fence_probe (id, v) VALUES (1, 'b') ON CONFLICT (id) DO UPDATE SET v = excluded.v`,
    );
    await c.query(
      `MERGE INTO state.fence_probe t USING (VALUES (2, 'm')) s(id, v) ON t.id = s.id WHEN NOT MATCHED THEN INSERT VALUES (s.id, s.v)`,
    );
    // COPY FROM على جدولٍ مفعَّلٍ فيه RLS يرفضُه PostgreSQL للعاملِ أصلاً (0A000): مسارُ كتابةٍ مغلقٌ لا ثغرة،
    // والتطبيقُ لا يستعملُ COPY. نُثبتُ الرفضَ ثمّ نُكملُ بالمساراتِ الأخرى.
    await rejectsWith(
      () => copyIn(c, 'COPY state.fence_probe (id, v) FROM STDIN', '3\tc\n'),
      ['0A000'],
      'COPY تحتَ RLS',
    );
    await c.query(`INSERT INTO state.fence_probe (id, v) VALUES (3, 'c')`);
    await c.query(`UPDATE state.fence_probe SET v = v || '!' WHERE id = 3`);
    await c.query(`DELETE FROM state.fence_probe WHERE id = 3`);
    const rows = await c.query('SELECT id, v FROM state.fence_probe ORDER BY id');
    assert.deepEqual(rows.rows, [
      { id: 1, v: 'b' },
      { id: 2, v: 'm' },
    ]);
    await assert.rejects(
      () => assertFencedSession(c, { workerId: 'beta' }),
      FenceError,
      'هويّةٌ أخرى لا تُقبَل',
    );
    await h.root.revokeCredential(w.credential.role_name, 'test');
  });

  test('T-OWN-04 وT-PRIV-05: العاملُ لا يملكُ جدولاً، ولا CREATE/TEMP/LO/TRUNCATE/TRIGGER، ولا SET ROLE، ولا تعطيلَ للزناد', async () => {
    const own = await h.db.pool.query(
      `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='state' AND (fence.is_worker_role(c.relowner) OR c.relowner='xuux_worker'::regrole)`,
    );
    assert.equal(own.rows[0].n, 0);
    const w = await h.boot('alpha');
    const c = /** @type {pg.Client} */ (w.client);
    await rejectsWith(
      () => c.query('CREATE TABLE state.evil (x int)'),
      ['42501', 'XF201'],
      'CREATE في state',
    );
    await rejectsWith(
      () => c.query('CREATE TABLE public.evil (x int)'),
      ['42501', 'XF201'],
      'CREATE في public',
    );
    await rejectsWith(() => c.query('CREATE TEMP TABLE evil (x int)'), ['42501', 'XF201'], 'TEMP');
    await rejectsWith(() => c.query('SELECT lo_create(0)'), ['42501'], 'كائنٌ كبير');
    await rejectsWith(
      () => c.query('SELECT lo_from_bytea(0, $1)', [Buffer.from('x')]),
      ['42501'],
      'كائنٌ كبير من bytea',
    );
    await rejectsWith(() => c.query('TRUNCATE state.fence_probe'), ['42501'], 'TRUNCATE');
    await rejectsWith(
      () => c.query('ALTER TABLE state.fence_probe DISABLE TRIGGER xf_guard'),
      ['42501', 'XF201'],
      'تعطيلُ الزناد',
    );
    await rejectsWith(
      () => c.query('ALTER TABLE state.fence_probe DISABLE ROW LEVEL SECURITY'),
      ['42501', 'XF201'],
      'تعطيلُ RLS',
    );
    await rejectsWith(() => c.query('SET ROLE xuux_owner'), ['42501'], 'SET ROLE مالك');
    await rejectsWith(
      () => c.query('SET ROLE xuux_worker'),
      ['42501'],
      'SET ROLE xuux_worker (SET FALSE)',
    );
    await rejectsWith(() => c.query('SET ROLE xf_root'), ['42501'], 'SET ROLE جذر');
    await rejectsWith(
      () => c.query(`SELECT fence.halt_complete(1)`),
      ['42501'],
      'دوالُّ الجذرِ ليست للعامل',
    );
    await rejectsWith(() => c.query(`SELECT fence.check_fenced()`), ['42501'], 'ولا الفحص');
    await rejectsWith(
      () => c.query(`UPDATE fence.control SET state = 'RUNNING'`),
      ['42501'],
      'صفُّ التحكّم',
    );
    await rejectsWith(
      () => c.query(`SET session_authorization = 'xf_root'`),
      ['42501'],
      'SESSION AUTHORIZATION',
    );
    await rejectsWith(
      () => c.query(`CREATE RULE r AS ON INSERT TO state.fence_probe DO INSTEAD NOTHING`),
      ['42501', 'XF201'],
      'RULE',
    );
    await h.root.revokeCredential(w.credential.role_name, 'test');
  });

  test('هويّةٌ مزوَّرة: دورٌ عاديٌّ ذو امتيازٍ على الجدول، ومتغيّراتُ جلسةٍ مُزوَّرة، وsearch_path — لا شيءَ منها يُعطي هويّة', async () => {
    const quiet = { effects: { stop: async () => ({ ok: true, detail: {} }) } };
    // GRANT/REVOKE تمرّان بمُطلِقِ الأحداثِ فتُرفَضان تحتَ RUNNING (XF201): الامتيازُ يُمنَحُ تحتَ HALTED.
    await rejectsWith(
      () => h.db.pool.query(`GRANT SELECT ON state.fence_probe TO PUBLIC`),
      ['XF201'],
      'GRANT تحتَ RUNNING',
    );
    await h.db.pool.query(`DROP ROLE IF EXISTS xattacker`);
    await h.db.pool.query(`CREATE ROLE xattacker LOGIN`);
    await h.root.halt('attacker-setup', quiet);
    await h.db.pool.query(`GRANT CONNECT ON DATABASE ${quoteIdent(h.db.name)} TO xattacker`);
    await h.db.pool.query(`GRANT USAGE ON SCHEMA state TO xattacker`);
    await h.db.pool.query(`GRANT INSERT, SELECT ON state.fence_probe TO xattacker`);
    await h.resume();
    try {
      const a = await h.login('xattacker');
      await a.query(`SET xuux.worker_id = 'alpha'`);
      await a.query(`SELECT set_config('fence.role', 'xw_alpha_0000000000000000', false)`);
      await a.query(`SET search_path = pg_temp, state, fence, pg_catalog`);
      await rejectsWith(
        () => a.query(`INSERT INTO state.fence_probe VALUES (50, 'x')`),
        ['XF006'],
        'دورٌ بلا اعتماد',
      );
    } finally {
      await h.db.pool.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'xattacker'`,
      );
      await h.root.halt('attacker-teardown', quiet);
      await h.db.pool.query(`REVOKE ALL ON state.fence_probe FROM xattacker`);
      await h.db.pool.query(`REVOKE ALL ON SCHEMA state FROM xattacker`);
      await h.db.pool.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'xattacker'`,
      );
      await h.db.pool.query(`REVOKE ALL ON DATABASE ${quoteIdent(h.db.name)} FROM xattacker`);
      await h.db.pool.query(`DROP ROLE xattacker`);
      await h.resume();
    }
  });

  test('الاعتمادُ القديم: إقلاعٌ جديدٌ يُلغي القديمَ ويُنهي جلستَه، وإعادةُ الدخولِ بالقديمِ مرفوضة', async () => {
    const w1 = await h.boot('alpha');
    const c1 = /** @type {pg.Client} */ (w1.client);
    await c1.query(`INSERT INTO state.fence_probe VALUES (10, 'w1')`);
    const w2 = await h.boot('alpha');
    await rejection(() => c1.query(`INSERT INTO state.fence_probe VALUES (11, 'w1-late')`));
    const re = await rejection(() => h.login(w1.credential.role_name));
    assert.match(
      String(re.message),
      /not permitted to log in|password authentication failed|does not exist/,
    );
    const c2 = /** @type {pg.Client} */ (w2.client);
    await c2.query(`INSERT INTO state.fence_probe VALUES (11, 'w2')`);
    const rows = await h.db.pool.query(`SELECT v FROM state.fence_probe WHERE id = 11`);
    assert.deepEqual(rows.rows, [{ v: 'w2' }]);
    await h.root.revokeCredential(w2.credential.role_name, 'test');
  });

  test('الإيجار: انقضاؤه يرفضُ الكتابة (XF009)، والجذرُ لا يُجدِّدُ لاعتمادٍ ملغى', async () => {
    const w = await h.boot('beta');
    const c = /** @type {pg.Client} */ (w.client);
    await h.db.pool.query(
      `UPDATE fence.run_lease SET expires_at = clock_timestamp() - interval '1 second' WHERE role_name = $1`,
      [w.credential.role_name],
    );
    await rejectsWith(
      () => c.query(`INSERT INTO state.fence_probe VALUES (20, 'late')`),
      ['XF009'],
      'إيجارٌ منقضٍ',
    );
    await h.root.renewLease(w.credential.role_name);
    await c.query(`INSERT INTO state.fence_probe VALUES (20, 'renewed')`);
    await h.root.revokeCredential(w.credential.role_name, 'test');
    await rejectsWith(() => h.root.renewLease(w.credential.role_name), ['XF007'], 'تجديدٌ لملغى');
  });

  test('WL-536: لا nextval/setval للعاملِ على تسلسلاتِ state — أثرٌ لا معامليٌّ يتجاوزُ الزنادَ ويبقى بعدَ الإيقاف', async () => {
    // سلبيّ (يفشلُ قبلَ الإصلاح): منحُ USAGE على تسلسلاتِ state كان يتيحُ للعاملِ nextval بعدَ انقضاءِ إيجارِه
    // أو إلغاءِ اعتمادِه — كتابةٌ دائمةٌ لا تمرُّ بـxf_guard ولا يتراجعُ عنها ROLLBACK.
    const seqs = await h.db.pool.query(
      // اسمٌ مؤهَّلٌ بالمخطّط: search_path جلسةِ العاملِ غيرُ search_path الإدارة (regclass::text يُسقِطُه).
      `SELECT format('%I.%I', n.nspname, c.relname) AS s FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'state' AND c.relkind = 'S' ORDER BY 1`,
    );
    assert.ok(seqs.rows.length > 0, 'تسلسلاتُ هويّةٍ في state');
    for (const { s } of seqs.rows) {
      const p = await h.db.pool.query(
        `SELECT has_sequence_privilege('xuux_worker', $1, 'USAGE') AS u,
                has_sequence_privilege('xuux_worker', $1, 'UPDATE') AS w`,
        [s],
      );
      assert.deepEqual(p.rows[0], { u: false, w: false }, `${s}: لا USAGE ولا UPDATE للعامل`);
    }
    const w = await h.boot('beta');
    const c = /** @type {pg.Client} */ (w.client);
    const seq = String(seqs.rows[0].s);
    const before = await h.db.pool.query(`SELECT last_value, is_called FROM ${seq}`);
    // إيجارٌ منقضٍ: الكتابةُ مرفوضةٌ (XF009) — وnextval يجبُ أن يُرفَضَ كذلك لا أن يتقدّمَ صامتاً.
    await h.db.pool.query(
      `UPDATE fence.run_lease SET expires_at = clock_timestamp() - interval '1 second' WHERE role_name = $1`,
      [w.credential.role_name],
    );
    await rejectsWith(
      () => c.query(`SELECT nextval($1::regclass)`, [seq]),
      ['42501'],
      'nextval بإيجارٍ منقضٍ',
    );
    await rejectsWith(
      () => c.query(`SELECT setval($1::regclass, 1000000)`, [seq]),
      ['42501'],
      'setval',
    );
    const after = await h.db.pool.query(`SELECT last_value, is_called FROM ${seq}`);
    assert.deepEqual(after.rows[0], before.rows[0], 'التسلسلُ لم يتقدّم');
    // إيجابيّ: الإدراجُ في عمودِ هويّةٍ لا يحتاجُ USAGE — الكتابةُ المشروعةُ تبقى تعمل.
    await h.root.renewLease(w.credential.role_name);
    const ins = await c.query(
      `INSERT INTO state.events (event_id, type, actor, payload, hash, occurred_at)
       VALUES ('evt-wl536', 'fence.probe', 'actor-wl536', '{}'::jsonb, repeat('a', 64), now())
       RETURNING seq`,
    );
    assert.ok(Number(ins.rows[0].seq) > 0, 'الهويّةُ تتولّدُ للعاملِ بلا USAGE');
    await c.query(`DELETE FROM state.events WHERE event_id = 'evt-wl536'`);
    await h.root.revokeCredential(w.credential.role_name, 'test');
  });

  test('WL-537: لا pg_logical_emit_message للعامل — رسالةُ WAL لا معامليّةٌ تتجاوزُ الزنادَ وتصلُ مستهلكي الفكِّ المنطقيّ', async () => {
    // سلبيّ (يفشلُ قبلَ الإصلاح): الدالّةُ مُنفَّذةٌ لـPUBLIC، فعاملٌ بإيجارٍ منقضٍ يكتبُ في WAL رسالةً
    // (transactional=false) تبقى بعدَ ROLLBACK، ويراها كلُّ مستهلكٍ منطقيٍّ (CDC) — أثرٌ خارجيٌّ بلا xf_guard.
    const fns = await h.db.pool.query(
      `SELECT p.oid::regprocedure::text AS f, has_function_privilege('xuux_worker', p.oid, 'EXECUTE') AS x
         FROM pg_proc p WHERE p.pronamespace = 'pg_catalog'::regnamespace AND p.proname = 'pg_logical_emit_message'
        ORDER BY 1`,
    );
    assert.ok(fns.rows.length >= 2, 'نسختا الدالّة (text وbytea)');
    for (const { f, x } of fns.rows) assert.equal(x, false, `${f}: لا EXECUTE للعامل`);
    const w = await h.boot('beta');
    const c = /** @type {pg.Client} */ (w.client);
    await h.db.pool.query(
      `UPDATE fence.run_lease SET expires_at = clock_timestamp() - interval '1 second' WHERE role_name = $1`,
      [w.credential.role_name],
    );
    const lsn0 = (await h.db.pool.query('SELECT pg_current_wal_insert_lsn()::text AS l')).rows[0].l;
    await rejectsWith(
      () => c.query(`SELECT pg_logical_emit_message(false, 'xuux', 'after-expiry')`),
      ['42501'],
      'رسالةٌ لا معامليّةٌ بإيجارٍ منقضٍ',
    );
    await rejectsWith(
      () => c.query(`SELECT pg_logical_emit_message(true, 'xuux', '\\x00'::bytea)`),
      ['42501'],
      'رسالةٌ معامليّةٌ (bytea) بلا كتابةٍ في جدول',
    );
    // إيجابيّ: الكتابةُ المشروعةُ بإيجارٍ صالحٍ تبقى تعمل، وسجلُّ WAL يتقدّمُ بها لا بالرسالة.
    await h.root.renewLease(w.credential.role_name);
    await c.query(
      `INSERT INTO state.events (event_id, type, actor, payload, hash, occurred_at)
       VALUES ('evt-wl537', 'fence.probe', 'actor-wl537', '{}'::jsonb, repeat('a', 64), now())`,
    );
    await c.query(`DELETE FROM state.events WHERE event_id = 'evt-wl537'`);
    assert.ok(typeof lsn0 === 'string' && lsn0.includes('/'), lsn0);
    await h.root.revokeCredential(w.credential.role_name, 'test');
  });

  test('WL-538: العاملُ يُغيّرُ كلمةَ مرورِه وإعداداتِ دورِه (‏ALTER ROLE الذاتيّ) — لا دخولَ بها، ولا كتابةَ بعدَها، وتُمحى عندَ الإلغاءِ والإيقاف', async () => {
    // ‏PostgreSQL يسمحُ لكلِّ دورٍ بـALTER ROLE ‎<نفسه>‎ PASSWORD و‎SET‎ بلا امتيازٍ يُسحَب، ولا يُطلِقُ لها
    // مُطلِقَ أحداث (‏أوامرُ كائناتٍ عامّة) — فهي كتاباتٌ دائمةٌ في pg_authid/pg_db_role_setting لا تمرُّ
    // بـxf_guard. قبلَ الإصلاح: كلمةُ المرورِ تصيرُ سرّاً حاملاً يدخلُ به غيرُ مستخدمِ peer، والإعداداتُ تبقى
    // بعدَ الإلغاء، والعاملُ يكتبُ وقد عبثَ بدورِه.
    const roleState = async (/** @type {string} */ r) =>
      (
        await h.db.pool.query(
          `SELECT a.rolpassword IS NULL AS no_secret, a.rolvaliduntil = '-infinity' AS pw_dead,
                  (SELECT count(*)::int FROM pg_db_role_setting s WHERE s.setrole = a.oid) AS settings
             FROM pg_authid a WHERE a.rolname = $1`,
          [r],
        )
      ).rows[0];
    if ((await h.sovereign.status()).effective.state !== 'RUNNING') await h.resume();
    // (‏1) الإصدار: دورُ الإقلاعِ لا يقبلُ كلمةَ مرورٍ أبداً (‏VALID UNTIL '-infinity' لا يغيّرُه إلا CREATEROLE).
    const w = await h.boot('beta', { seal: false });
    const c = /** @type {pg.Client} */ (w.client);
    const role = String(w.credential.role_name);
    assert.equal(w.issuedWithoutSecret, true, 'صدرَ بلا سرّ');
    assert.equal((await roleState(role)).pw_dead, true, 'VALID UNTIL -infinity عندَ الإصدار');
    // (‏2) نافذةُ ما قبلَ الختم (‏الدورُ LOGIN): العاملُ يضعُ كلمةَ مرور — يقبلُها PostgreSQL ولا مانعَ له —
    // لكنّها لا تُدخِلُ أحداً عبرَ TCP: الهويّةُ لا تُصدَّرُ سرّاً حاملاً إلى غيرِ مستخدمِ peer.
    await c.query(`ALTER ROLE CURRENT_USER PASSWORD 'exported-by-worker'`);
    const url = new URL(databaseUrl() ?? '');
    url.username = role;
    url.password = 'exported-by-worker';
    url.pathname = `/${h.db.name}`;
    const thief = new pg.Client({ connectionString: url.toString() });
    thief.on('error', () => {});
    const stolen = await thief.connect().then(
      () => null,
      (/** @type {any} */ e) => e,
    );
    if (stolen === null) await thief.end().catch(() => {});
    assert.ok(
      stolen !== null,
      'كلمةُ مرورٍ وضعَها العاملُ أدخلَت جلسةً عبرَ TCP — هويّةٌ مُصدَّرة',
    );
    assert.equal(stolen.code, '28P01', `رفضُ المصادقةِ لا غيرُه: ${stolen.code} ${stolen.message}`);
    await rejectsWith(
      () => c.query(`ALTER ROLE CURRENT_USER VALID UNTIL 'infinity'`),
      ['42501'],
      'العاملُ لا يُحيي كلمةَ المرور',
    );
    // (‏3) الختمُ يمحو ما وضعَه قبلَه.
    const live = (await h.sovereign.status()).live;
    await sealFencedSessions([c], h.keys.beta, {
      db: h.db.name,
      sysid: String(live.sysid),
      workerId: 'beta',
      bootId: w.bootId,
      epoch: w.credential.epoch,
      roleName: role,
    });
    assert.deepEqual(
      await roleState(role),
      { no_secret: true, pw_dead: true, settings: 0 },
      'الختمُ يمحو كلمةَ المرورِ والإعدادات',
    );
    await c.query(`INSERT INTO state.fence_probe VALUES (538, 'sealed')`);
    // (‏4) بإيجارٍ منقضٍ: الكتابةُ مرفوضةٌ (‏XF009)، وALTER ROLE الذاتيُّ يقبلُه PostgreSQL — كتابةٌ دائمة.
    await h.db.pool.query(
      `UPDATE fence.run_lease SET expires_at = clock_timestamp() - interval '1 second' WHERE role_name = $1`,
      [role],
    );
    await rejectsWith(
      () => c.query(`UPDATE state.fence_probe SET v = 'late' WHERE id = 538`),
      ['XF009'],
      'إيجارٌ منقضٍ',
    );
    await c.query(`ALTER ROLE CURRENT_USER SET search_path = public`);
    await c.query(
      `ALTER ROLE CURRENT_USER IN DATABASE ${quoteIdent(h.db.name)} SET statement_timeout = 1`,
    );
    await c.query(`ALTER ROLE CURRENT_USER PASSWORD 'after-expiry'`);
    assert.equal((await roleState(role)).settings, 2, 'الإعداداتُ كُتِبَت دائمةً بإيجارٍ منقضٍ');
    // (‏5) تجديدُ الإيجارِ لا يُعيدُ عاملاً عبثَ بدورِه: كتابتُه وقراءتُه مرفوضتان ما بقيَ الأثر (‏XF013).
    await h.root.renewLease(role);
    await rejectsWith(
      () => c.query(`UPDATE state.fence_probe SET v = 'tampered' WHERE id = 538`),
      ['XF013'],
      'كتابةُ عاملٍ عبثَ بإعداداتِ دورِه',
    );
    const seen = await c.query(`SELECT count(*)::int AS n FROM state.fence_probe WHERE id = 538`);
    assert.equal(seen.rows[0].n, 0, 'وقراءتُه مسدودة (‏read_ok)');
    let chk = await h.root.checkFenced();
    const tamper = chk.problems.find((/** @type {any} */ p) => p.kind === 'worker_role_settings');
    assert.ok(tamper && tamper.roles.includes(role), JSON.stringify(chk.problems));
    assert.ok(
      chk.residuals.some((/** @type {any} */ r) => r.kind === 'worker_self_alter_role'),
      'الحدُّ معلن',
    );
    // (‏6) الإلغاءُ (‏بعدَ إنهاءِ الجلسات) يمحو الأثرَ كلَّه — ولا جلسةَ تبقى لتُعيدَه.
    await h.root.revokeCredential(role, 'wl-538');
    assert.deepEqual(
      await roleState(role),
      { no_secret: true, pw_dead: true, settings: 0 },
      'الإلغاءُ يمحو',
    );
    await rejection(() => c.query('SELECT 1'));
    // (‏7) انحدار: أثرٌ على دورِ عاملٍ ملغى لم يُسقَط بعد (‏superuser، تحتَ HALTED) أو دورٌ يقبلُ كلمةَ مرور
    // ⇒ check_fenced يُظهِرُه وRESUME يرفضُ (‏XF415) — لا يُستأنَفُ فوقَ هويّةٍ عُبِثَ بها.
    await h.db.pool.query(`DELETE FROM state.fence_probe WHERE id = 538`);
    await h.root.halt('wl-538', { effects: NO_EFFECTS });
    await h.db.pool.query(`CREATE ROLE xw_alpha_0538053805380538 NOLOGIN IN ROLE xuux_worker`);
    await h.db.pool.query(`ALTER ROLE xw_alpha_0538053805380538 SET search_path = public`);
    await h.db.pool.query(`ALTER ROLE xw_alpha_0538053805380538 VALID UNTIL 'infinity'`);
    chk = await h.root.checkFenced();
    const kinds = chk.problems.map((/** @type {any} */ p) => p.kind);
    assert.ok(kinds.includes('worker_role_settings'), JSON.stringify(kinds));
    assert.ok(kinds.includes('worker_password_auth_enabled'), JSON.stringify(kinds));
    await rejectsWith(() => h.resume(), ['XF415'], 'أثرُ عبثٍ على دورِ عاملٍ يمنعُ الاستئناف');
    // ودورٌ كهذا لا يُديرُه السياجُ لا يُسقِطُ RECOVER (‏مسارُ الطوارئ، كان 42501) — والأثرُ يبقى ظاهراً.
    // إفسادُ الختمِ بتغييرِ النافذةِ ثمّ إعادتُها باسترجاعٍ ثانٍ، فلا يرثُ ما بعدَه شيئاً.
    const corruptWindow = async (/** @type {number} */ w) => {
      await h.db.pool
        .query(`ALTER TABLE fence.control DISABLE TRIGGER xf_control_row`)
        .catch(() => {});
      await h.db.pool.query(`UPDATE fence.control SET lease_window_s = $1`, [w]);
      await h.db.pool
        .query(`ALTER TABLE fence.control ENABLE ALWAYS TRIGGER xf_control_row`)
        .catch(() => {});
      assert.equal((await h.sovereign.status()).effective.state, 'RECOVERY_REQUIRED');
      assert.equal((await h.sovereign.recover()).state, 'HALTED');
    };
    const window0 = Number(
      (await h.db.pool.query(`SELECT lease_window_s FROM fence.control`)).rows[0].lease_window_s,
    );
    await corruptWindow(window0 + 2);
    chk = await h.root.checkFenced();
    assert.ok(
      chk.problems.some((/** @type {any} */ p) => p.kind === 'worker_role_settings'),
      'بعدَ RECOVER يبقى الأثرُ ظاهراً',
    );
    await h.db.pool.query(`DROP ROLE xw_alpha_0538053805380538`);
    await corruptWindow(window0);
    await h.resume();
  });

  const clockFile = process.env['XUUX_FENCE_FAKETIME_FILE'] ?? '';
  test(
    'الهجوم 24 (WL-536): ساعةُ القاعدةِ تتقدّمُ فيُغلَق، وتتراجعُ قبلَ آخرِ تجديدٍ فيُرفَضُ (XF012) — والتراجعُ دونَه حدٌّ معلن',
    {
      skip:
        clockFile === ''
          ? 'NOT RUN — XUUX_FENCE_FAKETIME_FILE غيرُ مضبوط (خادمٌ تحتَ libfaketime يقرأُ الإزاحةَ من الملف)'
          : false,
    },
    async () => {
      /** @param {string} offset إزاحةُ libfaketime النسبيّة (ثوانٍ بإشارة) */
      const setClock = (offset) => {
        // استبدالٌ ذرّيٌّ: libfaketime يقرأُ الملفَّ في كلِّ نداءٍ، فلا يرى ملفاً نصفَ مكتوب.
        writeFileSync(`${clockFile}.tmp`, `${offset}\n`);
        renameSync(`${clockFile}.tmp`, clockFile);
      };
      const skew = async () => {
        const r = await h.db.pool.query(
          'SELECT extract(epoch FROM clock_timestamp())::float8 AS t',
        );
        return Number(r.rows[0].t) - Date.now() / 1000;
      };
      setClock('+0');
      assert.ok(Math.abs(await skew()) < 5, 'الساعةُ حقيقيّةٌ قبلَ البدء');
      const w = await h.boot('beta');
      const c = /** @type {pg.Client} */ (w.client);
      const role = w.credential.role_name;
      try {
        await c.query(`INSERT INTO state.fence_probe VALUES (40, 'clock-0')`);
        const win = Number(
          (await h.db.pool.query('SELECT lease_window_s AS s FROM fence.control WHERE id')).rows[0]
            .s,
        );
        // (1) التقدّم: الإيجارُ منقضٍ بساعةِ القاعدة ⇒ رفضٌ مغلقٌ، والقراءةُ محجوبة.
        setClock(`+${win * 2 + 60}`);
        assert.ok((await skew()) > win, 'الساعةُ تقدّمت فعلاً');
        await rejectsWith(
          () => c.query(`INSERT INTO state.fence_probe VALUES (41, 'fwd')`),
          ['XF009'],
          'تقدّمُ الساعة',
        );
        assert.equal((await c.query('SELECT id FROM state.fence_probe')).rows.length, 0, 'RLS');
        setClock('+0');
        await c.query(`INSERT INTO state.fence_probe VALUES (41, 'back-to-real')`);
        // (2) سلبيّ (يفشلُ قبلَ الإصلاح): إيجارٌ منقضٍ ثمّ ساعةٌ مُرجَعةٌ ساعةً كاملة — كانت تُحييه.
        await h.db.pool.query(
          `UPDATE fence.run_lease SET expires_at = clock_timestamp() - interval '1 second' WHERE role_name = $1`,
          [role],
        );
        await rejectsWith(
          () => c.query(`INSERT INTO state.fence_probe VALUES (42, 'expired')`),
          ['XF009'],
          'منقضٍ بالساعةِ الحقيقيّة',
        );
        setClock('-3600');
        assert.ok((await skew()) < -3000, 'الساعةُ تراجعت فعلاً');
        await rejectsWith(
          () => c.query(`INSERT INTO state.fence_probe VALUES (42, 'revived')`),
          ['XF012'],
          'تراجعٌ قبلَ آخرِ تجديدٍ لا يُحيي الإيجار',
        );
        assert.equal(
          (await c.query('SELECT id FROM state.fence_probe')).rows.length,
          0,
          'ولا القراءة',
        );
        await rejectsWith(() => h.root.renewLease(role), ['XF012'], 'ولا تجديدَ على ساعةٍ مُرجَعة');
        // (3) إيجابيّ: بالساعةِ الحقيقيّةِ يعودُ الحكمُ إلى الانقضاءِ ثمّ التجديدُ يعمل.
        setClock('+0');
        await rejectsWith(
          () => c.query(`INSERT INTO state.fence_probe VALUES (42, 'still-expired')`),
          ['XF009'],
          'ما زالَ منقضياً',
        );
        await h.root.renewLease(role);
        await c.query(`INSERT INTO state.fence_probe VALUES (42, 'renewed')`);
        // (4) الحدُّ المعلن: تراجعٌ أصغرُ من (الآن − آخرِ تجديد) يُحيي إيجاراً منقضياً بما لا يزيدُ على نافذة.
        await h.db.pool.query(
          `UPDATE fence.run_lease SET renewed_at = clock_timestamp() - interval '30 seconds',
                  expires_at = clock_timestamp() - interval '1 second' WHERE role_name = $1`,
          [role],
        );
        setClock('-10');
        await c.query(`INSERT INTO state.fence_probe VALUES (43, 'bounded-residual')`);
      } finally {
        setClock('+0');
        await h.db.pool.query('DELETE FROM state.fence_probe WHERE id BETWEEN 40 AND 43');
        await h.root.revokeCredential(role, 'test').catch(() => {});
      }
    },
  );

  test('حافظُ الإيجار يتوقّفُ أوّلَ قراءةٍ غيرِ RUNNING ولا يُعيدُ التجديد', async () => {
    const w = await h.boot('beta', { connect: false });
    let running = true;
    let renewals = 0;
    const realRenew = h.root.renewLease.bind(h.root);
    h.root.renewLease = async (role) => {
      renewals++;
      return realRenew(role);
    };
    try {
      const stopped = new Promise((resolve) => {
        h.root.startLeaseKeeper(
          w.credential.role_name,
          {
            assertOperational: () => {
              if (!running) throw new Error('HALTED');
            },
          },
          { intervalMs: 30, onStop: resolve },
        );
      });
      await new Promise((r) => setTimeout(r, 120));
      running = false;
      const reason = await stopped;
      assert.match(String(/** @type {Error} */ (reason).message), /HALTED/);
      const n = renewals;
      assert.ok(n >= 1, 'جدَّدَ ما دام RUNNING');
      await new Promise((r) => setTimeout(r, 120));
      assert.equal(renewals, n, 'لا تجديدَ بعدَ التوقّف');
    } finally {
      Object.assign(h.root, { renewLease: realRenew });
      await h.root.revokeCredential(w.credential.role_name, 'test');
    }
  });

  test('REPEATABLE READ: لقطةٌ قبلَ الإيقافِ لا تكتبُ بعدَه (خطّيّةُ FOR SHARE على صفِّ التحكّم)', async () => {
    const w = await h.boot('alpha');
    const c = /** @type {pg.Client} */ (w.client);
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await c.query('SELECT count(*) FROM state.fence_probe');
    const hid = Number(
      (await h.rootClient.query(`SELECT fence.halt_request('rr-test') AS r`)).rows[0].r,
    );
    await h.rootClient.query('SELECT fence.halt_lock($1)', [hid]);
    await rejectsWith(
      () => c.query(`INSERT INTO state.fence_probe VALUES (30, 'rr')`),
      ['40001', 'XF004', 'XF005'],
      'كتابةٌ من لقطةٍ قديمة',
    );
    await c.query('ROLLBACK');
    const after = await h.root.halt('rr-test-complete', { effects: null });
    assert.equal(after.dbFenced, true);
    assert.equal(after.systemHaltComplete, false, 'DB_FENCED وحده ليس اكتمالاً (لا آثار)');
    const rows = await h.db.pool.query(
      `SELECT count(*)::int AS n FROM state.fence_probe WHERE id = 30`,
    );
    assert.equal(rows.rows[0].n, 0);
    await h.resume();
  });

  test('T-EFF-01: إيقافٌ كاملٌ مع معاملةٍ جاريةٍ تمسكُ القفل — تُنهى، والكتابةُ لا تلتزم، وكلُّ مسارِ كتابةٍ بعدَه مرفوض', async () => {
    const w = await h.boot('alpha');
    const c = /** @type {pg.Client} */ (w.client);
    const reader = await h.boot('beta');
    const rc = /** @type {pg.Client} */ (reader.client);
    await c.query('BEGIN');
    await c.query(`INSERT INTO state.fence_probe VALUES (40, 'in-flight')`);
    await c.query('SELECT pg_advisory_lock(4242)');
    await c.query(`NOTIFY xuux_fence_probe, 'before-halt'`);
    let stopped = false;
    const result = await h.root.halt('t-eff-01', {
      effects: {
        stop: async () => {
          stopped = true;
          return { ok: true, detail: { scopes: [], egress: [], note: 'harness' } };
        },
      },
    });
    assert.equal(result.dbFenced, true, JSON.stringify(result));
    assert.equal(result.systemHaltComplete, true);
    assert.equal(stopped, true);
    assert.ok(
      result.steps.some((/** @type {any} */ s) => s.step === 4 && s.lockTimeout),
      'القفلُ انتظرَ ثمّ أُنهيت المعاملةُ الجارية',
    );
    await rejection(() => c.query('COMMIT'));
    const n = await h.db.pool.query(
      `SELECT count(*)::int AS n FROM state.fence_probe WHERE id = 40`,
    );
    assert.equal(n.rows[0].n, 0, 'الكتابةُ الجاريةُ لم تلتزم');
    await rejection(() => rc.query('SELECT 1'));
    for (const role of [w.credential.role_name, reader.credential.role_name]) {
      const re = await rejection(() => h.login(role));
      assert.match(String(re.message), /does not exist|not permitted/, 'لا عودةَ بعدَ الإيقاف');
    }
    const chk = await h.root.checkFenced();
    assert.equal(chk.ok, true, JSON.stringify(chk.problems));
    assert.ok(
      chk.residuals.some((/** @type {any} */ r) => r.kind === 'notify_not_revocable'),
      'NOTIFY خطرٌ متبقٍّ مُعلَن (E3)',
    );
    assert.ok(
      chk.residuals.some((/** @type {any} */ r) => r.kind === 'declared_breakglass_outside_fence'),
      'superuser مُعلَنٌ خارجَ السياج',
    );
    const ev = await h.rootClient.query(
      `SELECT kind FROM fence.evidence WHERE epoch = $1 ORDER BY id`,
      [chk.epoch],
    );
    assert.deepEqual(ev.rows.map((r) => r.kind).slice(-2), ['DB_FENCED', 'EFFECTS_HALTED']);
    await h.resume();
  });

  test('الحقنُ بالأعطال: انقطاعٌ بعدَ كلِّ خطوةٍ يُبقي القاعدةَ مغلقةً للعامل، ولا يُستأنَفُ دونَ إكمال', async () => {
    for (const point of ['afterRequest', 'afterLock', 'afterRevoke', 'afterDbFenced']) {
      const w = await h.boot('alpha');
      const c = /** @type {pg.Client} */ (w.client);
      await rejection(() =>
        h.root.halt(`fault-${point}`, {
          faults: {
            [point]: () => {
              throw new Error(`crash@${point}`);
            },
          },
          effects: { stop: async () => ({ ok: true, detail: {} }) },
        }),
      );
      await rejection(() =>
        c.query(`INSERT INTO state.fence_probe VALUES (60, ${quoteLiteral(point)})`),
      );
      const n = await h.db.pool.query(
        `SELECT count(*)::int AS n FROM state.fence_probe WHERE id = 60`,
      );
      assert.equal(n.rows[0].n, 0, `لا كتابةَ بعدَ انقطاعِ ${point}`);
      const st = (await h.sovereign.status()).effective.state;
      assert.notEqual(st, 'RUNNING', `الحالةُ بعدَ انقطاعِ ${point} ليست RUNNING`);
      if (st === 'HALTED') {
        // HALTED بلا دليلِ آثار: RESUME يُرفَضُ بالدليلِ الغائب.
        const s = await h.sovereign.status();
        const signed = h.sovereign.sign('resume', s, {
          roster_hash: s.bound.roster_hash,
          pm_start_epoch: String(s.live.pm_start_epoch),
          effects_evidence_sha256: '0'.repeat(64),
        });
        await rejectsWith(
          () => h.sovClient.query('SELECT fence.resume($1,$2)', [signed.payload, signed.signature]),
          ['XF414'],
          'لا استئنافَ بلا دليلِ آثار',
        );
      } else {
        await rejectsWith(() => h.resume(), ['XF507', 'XF409'], `لا استئنافَ من ${st}`);
      }
      // إعادةُ الإيقافِ تُكمِل (الإيقافُ متكرّرٌ آمن).
      const again = await h.root.halt(`retry-${point}`, {
        effects: { stop: async () => ({ ok: true, detail: {} }) },
      });
      assert.equal(again.systemHaltComplete, true, JSON.stringify(again));
      await h.resume();
    }
  });

  test('جدولٌ جديدٌ بلا زناد، أو زنادٌ معطَّل، أو دالّةُ سياجٍ مُستبدَلة (superuser) ⇒ RESUME يرفض', async () => {
    await h.root.halt('ddl-tests', { effects: { stop: async () => ({ ok: true, detail: {} }) } });
    // الهجرةُ تحتَ HALTED: الجدولُ الجديدُ يُغطّى تلقائياً.
    await h.db.pool.query('CREATE TABLE state.fence_new (id int)');
    const cov = await h.db.pool.query(
      `SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'state.fence_new'::regclass AND tgname = 'xf_guard'`,
    );
    assert.equal(cov.rows[0].n, 1, 'التغطيةُ التلقائية');
    await rejectsWith(
      () => h.db.pool.query('DROP TRIGGER xf_guard ON state.fence_new'),
      ['XF204'],
      'إسقاطُ الزناد',
    );
    await rejectsWith(
      () =>
        h.db.pool.query(
          'CREATE OR REPLACE FUNCTION fence.read_ok() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$',
        ),
      ['XF202'],
      'استبدالُ دالّةِ سياج',
    );
    await rejectsWith(
      () =>
        h.db.pool
          .query('CREATE TABLE state.fence_part (id int) PARTITION BY RANGE (id)')
          .then(() =>
            h.db.pool.query(
              'CREATE TABLE state.fence_part_1 PARTITION OF state.fence_part FOR VALUES FROM (0) TO (10)',
            ),
          )
          .then(async () => {
            const p = await h.db.pool.query(
              `SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'state.fence_part_1'::regclass AND tgname = 'xf_guard'`,
            );
            assert.equal(p.rows[0].n, 1, 'القسمُ الجديدُ مُغطّى');
            throw Object.assign(new Error('ok'), { code: 'PARTITION_OK' });
          }),
      ['PARTITION_OK'],
      'الأقسام',
    );
    // superuser يعطّلُ المُطلِقاتِ ويُنشئُ جدولاً بلا زناد: لا حمايةَ من superuser — لكنّ RESUME يرفض.
    await h.db.pool.query('ALTER EVENT TRIGGER xf_ddl_end DISABLE');
    await h.db.pool.query('CREATE TABLE state.fence_unfenced (id int)');
    let chk = await h.root.checkFenced();
    const kinds = chk.problems.map((/** @type {any} */ p) => p.kind);
    assert.ok(kinds.includes('uncovered_relation'), JSON.stringify(kinds));
    assert.ok(kinds.includes('event_triggers_missing_or_disabled'));
    await rejectsWith(() => h.resume(), ['XF415'], 'جدولٌ غيرُ مُسيَّج يمنعُ الاستئناف');
    await h.db.pool.query('DROP TABLE state.fence_unfenced');
    // دالّةُ سياجٍ مُستبدَلة (والمُطلِقُ معطَّل)
    const orig = (
      await h.db.pool.query(`SELECT pg_get_functiondef('fence.read_ok()'::regprocedure) AS d`)
    ).rows[0].d;
    await h.db.pool.query(
      `CREATE OR REPLACE FUNCTION fence.read_ok() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$ SELECT true $$`,
    );
    chk = await h.root.checkFenced();
    assert.ok(
      chk.problems.some((/** @type {any} */ p) => p.kind === 'fence_function_tampered'),
      JSON.stringify(chk.problems),
    );
    await rejectsWith(() => h.resume(), ['XF415'], 'دالّةٌ مُستبدَلة');
    await h.db.pool.query(orig);
    // WL-536: إعادةُ منحِ USAGE على تسلسلاتِ state للعاملِ تُكشَفُ وتمنعُ الاستئناف.
    await h.db.pool.query('GRANT USAGE ON ALL SEQUENCES IN SCHEMA state TO xuux_worker');
    chk = await h.root.checkFenced();
    assert.ok(
      chk.problems.some((/** @type {any} */ p) => p.kind === 'worker_sequence_write'),
      JSON.stringify(chk.problems),
    );
    await rejectsWith(() => h.resume(), ['XF415'], 'تسلسلٌ قابلٌ للكتابةِ للعامل');
    await h.db.pool.query('REVOKE USAGE ON ALL SEQUENCES IN SCHEMA state FROM xuux_worker');
    // WL-537: إعادةُ EXECUTE على pg_logical_emit_message لـPUBLIC تُكشَفُ وتمنعُ الاستئناف.
    await h.db.pool.query(
      'GRANT EXECUTE ON FUNCTION pg_catalog.pg_logical_emit_message(boolean, text, text, boolean) TO PUBLIC',
    );
    chk = await h.root.checkFenced();
    assert.ok(
      chk.problems.some((/** @type {any} */ p) => p.kind === 'worker_wal_message_write'),
      JSON.stringify(chk.problems),
    );
    await rejectsWith(() => h.resume(), ['XF415'], 'رسالةُ WAL مُتاحةٌ للعامل');
    await h.db.pool.query(
      'REVOKE EXECUTE ON FUNCTION pg_catalog.pg_logical_emit_message(boolean, text, text, boolean) FROM PUBLIC',
    );
    // زنادٌ معطَّل: والمُطلِقُ مفعَّلٌ، يرفضُ فحصُ الالتزامِ المؤجَّلِ المعاملةَ نفسَها (XF203)…
    await h.db.pool.query('ALTER EVENT TRIGGER xf_ddl_end ENABLE ALWAYS');
    await rejectsWith(
      () => h.db.pool.query('ALTER TABLE state.fence_probe DISABLE TRIGGER xf_guard'),
      ['XF203'],
      'تعطيلُ الزنادِ يُرفَضُ عندَ الالتزام',
    );
    // …وsuperuser يعطّلُ المُطلِقَ أوّلاً فيمرّ — لكنّ check_fenced وRESUME يرفضان.
    await h.db.pool.query('ALTER EVENT TRIGGER xf_ddl_end DISABLE');
    await h.db.pool.query('ALTER TABLE state.fence_probe DISABLE TRIGGER xf_guard');
    chk = await h.root.checkFenced();
    assert.ok(
      chk.problems.some((/** @type {any} */ p) => p.kind === 'uncovered_relation'),
      'زنادٌ معطَّلٌ = غيرُ مُغطّى',
    );
    await rejectsWith(() => h.resume(), ['XF415'], 'زنادٌ معطَّل');
    await h.db.pool.query('ALTER TABLE state.fence_probe ENABLE ALWAYS TRIGGER xf_guard');
    await h.db.pool.query('ALTER EVENT TRIGGER xf_ddl_end ENABLE ALWAYS');
    // قاعدةٌ كاتبة (RULE)
    await rejectsWith(
      () => h.db.pool.query(`CREATE RULE xr AS ON INSERT TO state.fence_new DO ALSO NOTIFY x`),
      ['XF203'],
      'RULE يُرفَضُ عندَ الالتزام',
    );
    await h.db.pool.query('ALTER EVENT TRIGGER xf_ddl_end DISABLE');
    await h.db.pool.query(`CREATE RULE xr AS ON INSERT TO state.fence_new DO ALSO NOTIFY x`);
    chk = await h.root.checkFenced();
    assert.ok(chk.problems.some((/** @type {any} */ p) => p.kind === 'writing_rule'));
    await rejectsWith(() => h.resume(), ['XF415'], 'قاعدةٌ كاتبة');
    await h.db.pool.query(`DROP RULE xr ON state.fence_new`);
    await h.db.pool.query('ALTER EVENT TRIGGER xf_ddl_end ENABLE ALWAYS');
    // المعاملاتُ المُعدَّة: الإعدادُ مُطفأٌ في المختبر/CI؛ check_fenced يرفضُه إن فُعِّل.
    const mpt = (await h.db.pool.query(`SHOW max_prepared_transactions`)).rows[0]
      .max_prepared_transactions;
    chk = await h.root.checkFenced();
    assert.equal(
      chk.problems.some((/** @type {any} */ p) => p.kind === 'max_prepared_transactions_enabled'),
      Number(mpt) > 0,
    );
    if (Number(mpt) === 0) {
      assert.equal(chk.ok, true, JSON.stringify(chk.problems));
      await h.resume();
    }
  });

  test('T-REC-05: نسخةٌ من القاعدةِ (قاعدةٌ أخرى من القالب) تبدأ RECOVERY_REQUIRED؛ الأمرُ المُعادُ والكتابةُ مرفوضان', async () => {
    const s = await h.sovereign.status();
    if (s.effective.state !== 'HALTED')
      await h.root.halt('copy', { effects: { stop: async () => ({ ok: true, detail: {} }) } });
    const st = await h.sovereign.status();
    const replay = h.sovereign.sign('resume', st, {
      roster_hash: st.bound.roster_hash,
      pm_start_epoch: String(st.live.pm_start_epoch),
      effects_evidence_sha256: '0'.repeat(64),
    });
    const copyName = `${h.db.name}_copy`;
    // قطعُ وصلاتِ القاعدةِ المصدر (شرطُ القالب)، ثمّ النسخ.
    await h.admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [h.db.name],
    );
    await h.admin.query(
      `CREATE DATABASE ${quoteIdent(copyName)} TEMPLATE ${quoteIdent(h.db.name)}`,
    );
    const copyUrl = new URL(databaseUrl() ?? '');
    copyUrl.pathname = `/${copyName}`;
    const copy = new pg.Client({ connectionString: copyUrl.toString() });
    await copy.connect();
    try {
      const eff = (await copy.query('SELECT fence.effective_state() AS e')).rows[0].e;
      assert.equal(eff.state, 'RECOVERY_REQUIRED');
      assert.equal(eff.problem, 'incarnation_mismatch');
      await copy.query(`SET SESSION AUTHORIZATION xf_sovereign`);
      await rejectsWith(
        () => copy.query('SELECT fence.resume($1,$2)', [replay.payload, replay.signature]),
        ['XF406', 'XF409'],
        'إعادةُ أمرٍ على النسخة',
      );
      await copy.query('RESET SESSION AUTHORIZATION');
      const chk = (await copy.query('SELECT fence.check_fenced() AS c')).rows[0].c;
      assert.equal(chk.ok, false);
    } finally {
      await copy.end();
      await h.admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(copyName)} WITH (FORCE)`);
      await h.reconnect();
    }
  });

  test('T-REC-07: RECOVER يتطلّبُ أمراً موقَّعاً يُسمّي التجسُّدَ الحيّ، ويُفضي إلى HALTED لا RUNNING، ويُلغي الاعتمادات', async () => {
    const s0 = await h.sovereign.status();
    if (s0.effective.state === 'RUNNING')
      await h.root.halt('rec', { effects: { stop: async () => ({ ok: true, detail: {} }) } });
    // إفسادُ الختم (superuser يعدّلُ صفَّ التحكّمِ مباشرةً) ⇒ RECOVERY_REQUIRED.
    await h.db.pool
      .query(`ALTER TABLE fence.control DISABLE TRIGGER xf_control_row`)
      .catch(() => {});
    await h.db.pool.query(`UPDATE fence.control SET lease_window_s = 31`);
    await h.db.pool
      .query(`ALTER TABLE fence.control ENABLE ALWAYS TRIGGER xf_control_row`)
      .catch(() => {});
    const s = await h.sovereign.status();
    assert.equal(s.effective.state, 'RECOVERY_REQUIRED');
    assert.equal(s.effective.problem, 'control_seal_mismatch');
    await rejectsWith(() => h.resume(), ['XF002', 'XF507', 'XF409'], 'لا استئنافَ من ختمٍ فاسد');
    // RECOVER بلا reseal_from مرفوض، وبتجسُّدٍ خاطئٍ مرفوض.
    const noReseal = h.sovereign.sign('recover', s, {
      pm_start_epoch: String(s.live.pm_start_epoch),
      timeline: Number(s.live.timeline),
    });
    await rejectsWith(
      () =>
        h.sovClient.query('SELECT fence.recover($1,$2)', [noReseal.payload, noReseal.signature]),
      ['XF002'],
      'بلا reseal_from',
    );
    const wrongInc = h.sovereign.sign('recover', s, {
      pm_start_epoch: '1',
      timeline: Number(s.live.timeline),
      reseal_from: s.bound.seal,
    });
    await rejectsWith(
      () =>
        h.sovClient.query('SELECT fence.recover($1,$2)', [wrongInc.payload, wrongInc.signature]),
      ['XF410'],
      'تجسُّدٌ خاطئ',
    );
    const r = await h.sovereign.recover();
    assert.equal(r.state, 'HALTED', 'الاستردادُ إلى HALTED لا RUNNING');
    assert.ok(Number(r.epoch) > Number(s.bound.epoch), 'العهدُ رُفِع');
    const active = await h.rootClient.query(
      `SELECT count(*)::int AS n FROM fence.credentials WHERE status = 'ACTIVE'`,
    );
    assert.equal(active.rows[0].n, 0);
    await h.resume();
    assert.equal((await h.sovereign.status()).effective.state, 'RUNNING');
  });

  test('ربطُ العامل (§7): prepareFencedWorker — حارسٌ مركّب، مصافحةٌ بتوقيعِ العامل، دورُ إقلاعٍ بلا سرّ، وcreatePool يرفضُ غيرَه', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'fence-worker-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const halt = new HaltSwitch(join(dir, 'halt.json'), new KingIdentity(), {
      fsync: false,
      allowUnsignedTestHalt: true,
    });
    halt.halt('provision');
    halt.resume('provision');
    const floor = join(dir, 'floor');
    writeFileSync(floor, '2\n');
    const keyFile = join(dir, 'alpha.pem');
    writeFileSync(keyFile, h.keys.alpha.privateKeyPem, { mode: 0o600 });
    const env = {
      XUUX_FENCE_WORKER_ID: 'alpha',
      XUUX_FENCE_WORKER_KEY: keyFile,
      XUUX_HALT_EPOCH_FLOOR: floor,
      DATABASE_URL: databaseUrl(),
    };
    /** قناتا IPC في الذاكرة (العاملُ ⇄ المُشرِف) بتسليمٍ غيرِ متزامنٍ كـprocess.send. */
    const pair = () => {
      const toWorker = new EventEmitter();
      const toSupervisor = new EventEmitter();
      const worker = {
        send: (/** @type {any} */ m) => setImmediate(() => toSupervisor.emit('message', m)),
        on: toWorker.on.bind(toWorker),
        off: toWorker.off.bind(toWorker),
      };
      const child = /** @type {any} */ ({
        send: (/** @type {any} */ m) => setImmediate(() => toWorker.emit('message', m)),
        on: toSupervisor.on.bind(toSupervisor),
        off: toSupervisor.off.bind(toSupervisor),
      });
      return { worker, child };
    };
    assert.throws(
      () => dbFenceMode({ XUUX_DB_FENCE: 'maybe' }),
      (e) => e instanceof FenceError && e.code === FENCE_ERRORS.WORKER_CONFIG,
    );
    assert.equal(dbFenceMode({}), '');
    await assert.rejects(
      () => prepareFencedWorker({ env: { ...env, XUUX_FENCE_WORKER_KEY: '' }, halt }),
      (e) => e instanceof FenceError && e.code === FENCE_ERRORS.WORKER_CONFIG,
    );
    // حدُّ عهدٍ أعلى من التاريخ: لا مصافحةَ أصلاً (الحارسُ الصارمُ قبلَ الاعتماد).
    writeFileSync(floor, '9\n');
    await assert.rejects(
      () => prepareFencedWorker({ env, halt, channel: pair().worker, timeoutMs: 500 }),
      (e) => /** @type {any} */ (e).code === 'RECOVERY_REQUIRED',
    );
    writeFileSync(floor, '2\n');
    // المُشرِفُ ينتظرُ عاملاً آخر ⇒ رفضٌ صريح.
    {
      const { worker, child } = pair();
      const sup = superviseWorkerHandshake(h.root, child, { expectedWorkerId: 'beta' }).catch(
        (e) => e,
      );
      await assert.rejects(
        () => prepareFencedWorker({ env, halt, channel: worker, timeoutMs: 2000 }),
        (e) => e instanceof FenceError && e.code === FENCE_ERRORS.HANDSHAKE_FAILED,
      );
      assert.ok((await sup) instanceof Error);
    }
    const { worker, child } = pair();
    const [issued, fw] = await Promise.all([
      superviseWorkerHandshake(h.root, child, { expectedWorkerId: 'alpha' }),
      prepareFencedWorker({ env, halt, channel: worker, timeoutMs: 5000 }),
    ]);
    assert.equal(fw.credential.role_name, issued.role_name);
    assert.equal(fw.hardwareBacked, false, 'مفتاحُ ملفٍّ لا يُدّعى عتادياً');
    const url = new URL(fw.databaseUrl);
    assert.equal(url.username, issued.role_name);
    assert.equal(url.password, '', 'لا سرَّ في الوصلة');
    const c = await h.login(String(issued.role_name));
    // جلسةٌ غيرُ مختومة: لا تُقبَلُ للعاملِ قبلَ الختم.
    await assert.rejects(
      () => fw.verify(c),
      (e) => e instanceof FenceError && e.code === FENCE_ERRORS.SESSION_NOT_FENCED,
    );
    const onePool = /** @type {any} */ ({
      connect: async () => Object.assign(c, { release: () => {} }),
    });
    const [confirmed, sealedSessions] = await Promise.all([
      confirmWorkerSeal(h.root, child, issued, { timeoutMs: 5000 }),
      fw.seal(onePool, 1),
    ]);
    assert.equal(sealedSessions.length, 1);
    assert.deepEqual(confirmed, sealedSessions, 'المُشرِفُ يرى ما ختمه العامل');
    const who = await fw.verify(c);
    assert.equal(who.worker_id, 'alpha');
    assert.equal(who.boot_id, fw.bootId);
    // جلسةٌ بغيرِ دورِ الإقلاع: إمّا لا تملكُ whoami أصلاً (42501) أو تُرفَضُ بالمطابقة.
    await assert.rejects(
      () => fw.verify(h.rootClient),
      (e) =>
        (e instanceof FenceError && e.code === FENCE_ERRORS.SESSION_NOT_FENCED) ||
        /** @type {any} */ (e).code === '42501',
    );
    const other = await h.boot('alpha');
    await assert.rejects(
      () => fw.verify(/** @type {pg.Client} */ (other.client)),
      (e) => e instanceof FenceError && e.code === FENCE_ERRORS.SESSION_NOT_FENCED,
      'إقلاعٌ آخرُ للعاملِ نفسِه ليس هذا الإقلاع',
    );
    await h.root.revokeCredential(other.credential.role_name, 'test');
    // db.mjs: وضعُ السياجِ يرفضُ وصلةً بغيرِ دورِ إقلاعٍ أو بسرّ.
    const prev = process.env['XUUX_DB_FENCE'];
    process.env['XUUX_DB_FENCE'] = 'required';
    try {
      assert.throws(
        () => createPool({ url: databaseUrl() }),
        (e) => /** @type {any} */ (e).code === DB_ERRORS.FENCE_ROLE_REQUIRED,
      );
      const withSecret = new URL(fw.databaseUrl);
      withSecret.password = 'x';
      assert.throws(
        () => createPool({ url: withSecret.toString() }),
        (e) => /** @type {any} */ (e).code === DB_ERRORS.FENCE_ROLE_REQUIRED,
      );
      const ok = createPool({ url: fw.databaseUrl });
      await ok.end();
    } finally {
      if (prev === undefined) delete process.env['XUUX_DB_FENCE'];
      else Object.assign(process.env, { XUUX_DB_FENCE: prev });
    }
    // الحارسُ المركّب: إيقافُ HaltSwitch ⇒ يرمي؛ والقراءةُ الصارمةُ تُفسَدُ ⇒ يرمي.
    assert.doesNotThrow(() => fw.haltGuard.assertOperational());
    writeFileSync(halt.epochFile, '7\n');
    assert.throws(() => fw.haltGuard.assertOperational());
    await h.root.revokeCredential(String(issued.role_name), 'test');
  });

  test('صفُّ التحكّم: لا حذفَ ولا خفضَ للعهد ولا انتقالَ ممنوعٌ حتى لـsuperuser عبرَ المسارِ العادي', async () => {
    await rejectsWith(() => h.db.pool.query('DELETE FROM fence.control'), ['XF101'], 'حذفُ الصفّ');
    await rejectsWith(
      () => h.db.pool.query('UPDATE fence.control SET epoch = epoch - 1'),
      ['XF102'],
      'خفضُ العهد',
    );
    await rejectsWith(
      () =>
        h.db.pool
          .query(`UPDATE fence.control SET state = 'RECOVERY_REQUIRED', epoch = epoch + 1`)
          .then(() =>
            h.db.pool.query(`UPDATE fence.control SET state = 'RUNNING', epoch = epoch + 1`),
          ),
      ['XF103'],
      'RECOVERY_REQUIRED → RUNNING',
    );
    await rejectsWith(
      () => h.db.pool.query('DELETE FROM fence.events'),
      ['XF104'],
      'سجلُّ الأحداثِ إلحاقٌ فقط',
    );
    await rejectsWith(
      () => h.db.pool.query('TRUNCATE fence.evidence'),
      ['XF104'],
      'الأدلّةُ إلحاقٌ فقط',
    );
  });

  test('سلسلةُ الأحداث: هاشٌ متّصلٌ من GENESIS_FENCE بلا فجوة', async () => {
    const rows = (
      await h.db.pool.query('SELECT seq, kind, prev_hash, hash FROM fence.events ORDER BY seq')
    ).rows;
    assert.ok(rows.length > 5);
    let prev = 'GENESIS_FENCE';
    rows.forEach((r, i) => {
      assert.equal(Number(r.seq), i + 1);
      assert.equal(r.prev_hash, prev);
      prev = r.hash;
    });
  });
});

/** @param {string} v */
function quoteLiteral(v) {
  return `'${v.replace(/'/g, "''")}'`;
}

// ─── WL-539: جردٌ آليٌّ لقدراتِ العاملِ الدائمة ومدقّقٌ مستمرّ ─────────────────────────────────────
describe('WL-539: مدقّقُ قدراتِ العامل', { skip: skipWithoutDatabase }, () => {
  /** @type {Awaited<ReturnType<typeof harness>>} */
  let h;
  /** @type {Record<string, any>} */
  let policy;
  /** الجلسةُ المختومةُ الحاليّةُ للعامل (‏تُستبدَلُ بإقلاعٍ جديد). @type {{ c: pg.Client }} */
  const w = { c: /** @type {any} */ (null) };
  const audit = async () => auditWorkerCapabilitiesLive(/** @type {any} */ (h.rootClient), policy);
  const problems = async () =>
    /** @type {Array<{ kind: string, object: string }>} */ (
      (await h.rootClient.query('SELECT fence.capability_problems() AS p')).rows[0].p
    );
  before(async () => {
    policy = await loadCapabilityPolicy();
    h = await harness('wl539');
    // أهدافُ مسابيرِ BRIN/GIN: تُنشَأُ تحتَ HALTED فيغطّيها السياجُ تلقائياً.
    await h.db.pool.query(`CREATE TABLE state.wl539_t (a integer, t tsvector)`);
    await h.db.pool.query(`CREATE INDEX wl539_brin ON state.wl539_t USING brin (a)`);
    await h.db.pool.query(
      `CREATE INDEX wl539_gin ON state.wl539_t USING gin (t) WITH (fastupdate = on)`,
    );
    await h.db.pool.query(`GRANT SELECT, INSERT ON state.wl539_t TO xuux_worker`);
    await h.resume();
    w.c = /** @type {pg.Client} */ ((await h.boot('alpha')).client);
  });
  after(async () => h?.close());

  test('القاعدةُ السليمة: جردٌ غيرُ تافهٍ، صفرُ قدرةٍ غيرِ مصنّفة، صفرُ مشكلة', async () => {
    const r = await audit();
    if (process.env['XUUX_CAPABILITY_REPORT']) {
      writeFileSync(
        process.env['XUUX_CAPABILITY_REPORT'],
        `${JSON.stringify({ ...r, classified: undefined }, null, 2)}\n`,
      );
    }
    assert.deepEqual(r.unclassified, [], 'قدرةٌ غيرُ مصنّفة');
    // ضدّ «النجاحِ الزائفِ من قاعدةٍ فارغة»: الجردُ يرى فعلاً كلَّ محور، والهويّةَ الحيّة.
    assert.ok(r.total > 300, `الجردُ ${r.total}`);
    for (const cls of [
      'FENCE_API',
      'READ_ONLY',
      'SESSION_TRANSIENT',
      'HANDLER',
      'QUERY_EXECUTOR',
      'INTERNAL_CHECK',
      'GUARDED_WRITE',
      'RESIDUAL',
    ])
      assert.ok((r.byClass[cls] ?? 0) > 0, `صنفُ ${cls} فارغ`);
    const inv = r.classified;
    assert.ok(
      inv.some((c) => c.axis === 'membership' && c.object === 'identity -> xuux_worker'),
      'الهويّةُ الحيّةُ مجرودة',
    );
    assert.ok(
      inv.some(
        (c) =>
          c.axis === 'relation' &&
          c.object === 'state.wl539_t' &&
          c.privilege === 'INSERT' &&
          c.class === 'GUARDED_WRITE',
      ),
    );
    assert.ok(
      r.residual.some((c) => c.detail?.name === 'pg_notify'),
      'pg_notify متبقٍّ معلن (E3)',
    );
    assert.deepEqual(await problems(), []);
    const cf = (await h.rootClient.query('SELECT fence.check_fenced() AS r')).rows[0].r;
    assert.ok(
      !cf.problems.some(
        (/** @type {any} */ p) =>
          String(p.kind).startsWith('worker_') && p.kind !== 'worker_sessions',
      ),
      JSON.stringify(cf.problems),
    );
  });

  test('INTERNAL_CHECK: كلُّ دالّةٍ يُنفّذُها العاملُ بفحصٍ داخليٍّ تُرفَضُ فعلاً بدورِ العاملِ المختوم', async () => {
    const r = await audit();
    const rootPid = Number((await h.rootClient.query('SELECT pg_backend_pid() AS p')).rows[0].p);
    const checked = r.classified.filter((c) => c.class === 'INTERNAL_CHECK');
    assert.ok(checked.length >= 40, `${checked.length}`);
    const sample = {
      int4: '0',
      int8: '0',
      oid: '0',
      text: "'x'",
      name: "'x'",
      bool: 'false',
      regclass: "'state.wl539_t'",
      pg_lsn: "'0/0'",
      xid8: "'0'",
      int2: '0',
      char: "'x'",
    };
    for (const c of checked) {
      const spec = policy.internal_check[c.detail?.name];
      /** @type {string[]} */
      let sqls;
      /** @type {string[]} */
      let rejects;
      if (spec) {
        sqls = [String(spec.probe).replace('{root_pid}', String(rootPid))];
        rejects = spec.rejects;
      } else {
        const prefix = Object.keys(policy.internal_check_prefix).find((p) =>
          c.detail?.name.startsWith(p),
        );
        assert.ok(prefix, c.object);
        rejects = policy.internal_check_prefix[/** @type {string} */ (prefix)].rejects;
        const types = (
          await h.rootClient.query(
            `SELECT array(SELECT format_type(t, NULL) FROM unnest(p.proargtypes) t) AS a
             FROM pg_proc p WHERE p.oid = $1::regprocedure`,
            [`pg_catalog.${c.object}`],
          )
        ).rows[0].a;
        const args = types.map((/** @type {string} */ t) =>
          t.endsWith('[]')
            ? `'{}'::${t}`
            : `${
                sample[
                  /** @type {keyof typeof sample} */ (
                    t
                      .replace(/^"|"$/g, '')
                      .replace(/^integer$/, 'int4')
                      .replace(/^bigint$/, 'int8')
                      .replace(/^boolean$/, 'bool')
                      .replace(/^smallint$/, 'int2')
                  )
                ] ?? `'0'`
              }::${t}`,
        );
        sqls = [`SELECT pg_catalog.${quoteIdent(c.detail?.name)}(${args.join(', ')})`];
      }
      for (const sql of sqls) {
        const e = await rejection(() => w.c.query(sql));
        assert.ok(
          e && rejects.includes(e.code),
          `${c.object}: ${sql} ⇒ ${e?.code ?? 'قُبِلَ'} ${e?.message ?? ''}`,
        );
      }
    }
  });

  test('الأوامرُ بلا صلاحية: NOTIFY متبقٍّ مقبول، وANALYZE/VACUUM بلا أثرٍ مقيس، وALTER ROLE الذاتيُّ مكشوفٌ ومعطَّلُ الأثر', async () => {
    // إن صار NOTIFY مرفوضاً تغيّرَ المتبقّي E3 — يجبُ تحديثُ التصنيفِ لا إسكاتُ الاختبار.
    await w.c.query(`NOTIFY wl539, 'residual'`);
    await w.c.query(`SELECT pg_notify('wl539', 'residual')`);
    const before = (
      await h.db.pool.query(
        `SELECT reltuples, (SELECT last_analyze FROM pg_stat_user_tables WHERE relid = 'state.fence_probe'::regclass) AS la FROM pg_class WHERE oid = 'state.fence_probe'::regclass`,
      )
    ).rows[0];
    await w.c.query('ANALYZE state.fence_probe').catch(() => {});
    await w.c.query('VACUUM state.fence_probe').catch(() => {});
    const afterRow = (
      await h.db.pool.query(
        `SELECT reltuples, (SELECT last_analyze FROM pg_stat_user_tables WHERE relid = 'state.fence_probe'::regclass) AS la FROM pg_class WHERE oid = 'state.fence_probe'::regclass`,
      )
    ).rows[0];
    assert.deepEqual(afterRow, before, 'ANALYZE/VACUUM غيرُ المالكِ بلا أثر');
    // ALTER ROLE الذاتيُّ: يقبلُه PG (‏كتابةٌ دائمة)، فيكشفُه المدقّقُ محوراً غيرَ مصنّف، وأثرُه معطَّل (‏XF013)،
    // وإقلاعٌ جديدٌ (‏يُلغي القديم) يمحوه — CAP-ALTER-ROLE-SELF ‹EFFECT_DISABLED›.
    await w.c.query(`ALTER ROLE CURRENT_USER SET work_mem = '1MB'`);
    const flagged = await audit();
    assert.ok(
      flagged.unclassified.some((c) => c.axis === 'role_setting' && c.object === 'identity'),
      JSON.stringify(flagged.unclassified),
    );
    await rejectsWith(
      () => w.c.query(`INSERT INTO state.fence_probe VALUES (539, 'x')`),
      ['XF013'],
      'كتابةُ عاملٍ عبثَ بدورِه',
    );
    const reboot = await h.boot('alpha');
    Object.assign(w, { c: reboot.client });
    assert.deepEqual((await audit()).unclassified, [], 'الإلغاءُ محا الإعداد');
    for (const id of [
      'CAP-ALTER-ROLE-SELF',
      'CAP-NOTIFY',
      'CAP-XID',
      'CAP-SESSION',
      'CAP-MAINTENANCE',
      'CAP-CROSS-DB',
    ]) {
      const e = policy.privilege_free.find((/** @type {any} */ x) => x.id === id);
      assert.ok(e, id);
      for (const f of [
        'name',
        'source',
        'class',
        'persistent',
        'rollback',
        'after_lease',
        'after_seal',
        'readable',
        'fence_check',
        'privilege_block',
        'deeper',
        'proof',
      ])
        assert.ok(typeof e[f] === 'string' && e[f].trim() !== '', `${id}.${f}`);
    }
  });

  test('تحتَ RUNNING: DDL/GRANT على الكائناتِ مرفوضٌ حتى للمالكِ الأعلى (‏XF201) — الطفراتُ التاليةُ تحتَ HALTED', async () => {
    await rejectsWith(
      () => h.db.pool.query('GRANT EXECUTE ON FUNCTION pg_catalog.pg_stat_reset() TO xuux_worker'),
      ['XF201'],
      'GRANT تحتَ RUNNING',
    );
    await h.root.halt('wl539-mutations', { effects: NO_EFFECTS });
    assert.equal((await h.sovereign.status()).effective.state, 'HALTED');
    assert.deepEqual((await audit()).unclassified, [], 'HALTED نظيف');
  });

  // كلُّ طفرةٍ تُطبَّقُ بالمالكِ الأعلى (superuser) ثمّ تُعكَس: المدقّقُ وcheck_fenced يكشفانِها كلتاهما.
  /** @type {Array<{ name: string, apply: string[], revert: string[], kind: string | null, axis: string }>} */
  const mutations = [
    {
      name: 'EXECUTE على دالّةِ كتالوجٍ مُقيَّدة',
      apply: ['GRANT EXECUTE ON FUNCTION pg_catalog.pg_stat_reset() TO xuux_worker'],
      revert: ['REVOKE EXECUTE ON FUNCTION pg_catalog.pg_stat_reset() FROM xuux_worker'],
      kind: 'worker_catalog_privilege_drift',
      axis: 'function',
    },
    {
      name: 'SECURITY DEFINER في public يُنفّذُها PUBLIC',
      apply: [
        `CREATE FUNCTION public.wl539_secdef() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'`,
      ],
      revert: ['DROP FUNCTION public.wl539_secdef()'],
      kind: 'worker_secdef_execute',
      axis: 'function',
    },
    {
      name: 'عضويةُ دورٍ مُعرَّفٍ مسبقاً لـxuux_worker',
      apply: ['GRANT pg_read_all_data TO xuux_worker'],
      revert: ['REVOKE pg_read_all_data FROM xuux_worker'],
      kind: 'worker_membership',
      axis: 'membership',
    },
    {
      name: 'ملكيةُ كائنٍ لـxuux_worker',
      apply: [
        'CREATE FUNCTION public.wl539_owned() RETURNS int LANGUAGE sql AS $$SELECT 1$$',
        'ALTER FUNCTION public.wl539_owned() OWNER TO xuux_worker',
      ],
      revert: ['DROP FUNCTION public.wl539_owned()'],
      kind: 'worker_owns_objects',
      axis: 'ownership',
    },
    {
      name: 'صلاحياتٌ افتراضية',
      apply: [
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO xuux_worker',
      ],
      revert: [
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM xuux_worker',
      ],
      kind: 'worker_default_acl_privilege',
      axis: 'default_acl',
    },
    {
      name: 'SET على مُعامِل',
      apply: ['GRANT SET ON PARAMETER session_replication_role TO xuux_worker'],
      revert: ['REVOKE SET ON PARAMETER session_replication_role FROM xuux_worker'],
      kind: 'worker_parameter_privilege',
      axis: 'parameter',
    },
    {
      name: 'منحُ عمودٍ على جدولِ السياج',
      apply: ['GRANT UPDATE (lease_window_s) ON fence.control TO xuux_worker'],
      revert: ['REVOKE UPDATE (lease_window_s) ON fence.control FROM xuux_worker'],
      kind: 'worker_unguarded_write',
      axis: 'relation',
    },
    {
      name: 'مشهدٌ قابلٌ للكتابةِ فوقَ fence.control (‏يكتبُ بصلاحياتِ مالكِه)',
      apply: [
        'CREATE VIEW state.wl539_v AS SELECT id, lease_window_s FROM fence.control',
        'GRANT UPDATE ON state.wl539_v TO xuux_worker',
      ],
      revert: ['DROP VIEW state.wl539_v'],
      kind: 'worker_unguarded_write',
      axis: 'relation',
    },
    {
      name: 'CREATE على القاعدة',
      apply: ['GRANT CREATE ON DATABASE {db} TO xuux_worker'],
      revert: ['REVOKE CREATE ON DATABASE {db} FROM xuux_worker'],
      kind: 'worker_database_create',
      axis: 'database',
    },
    {
      name: 'TEMPORARY عبرَ PUBLIC على القاعدة',
      apply: ['GRANT TEMPORARY ON DATABASE {db} TO PUBLIC'],
      revert: ['REVOKE TEMPORARY ON DATABASE {db} FROM PUBLIC'],
      kind: null,
      axis: 'database',
    },
    {
      // انحدارٌ لخللٍ وجدَه الجردُ نفسُه: has_table_privilege(تسلسل, 'USAGE') كان يرمي 22023 فيُسقِطُ check_fenced.
      name: 'USAGE على تسلسلٍ في state (‏nextval لا معامليّ — WL-536)',
      apply: ['GRANT USAGE ON SEQUENCE state.events_seq_seq TO xuux_worker'],
      revert: ['REVOKE USAGE ON SEQUENCE state.events_seq_seq FROM xuux_worker'],
      kind: null,
      axis: 'sequence',
    },
    {
      name: 'كائنٌ كبير',
      apply: ['SELECT lo_create(95390)', 'GRANT SELECT ON LARGE OBJECT 95390 TO xuux_worker'],
      revert: ['SELECT lo_unlink(95390)'],
      kind: 'worker_large_object_privilege',
      axis: 'large_object',
    },
    {
      name: 'مساحةُ جداول',
      apply: ['GRANT CREATE ON TABLESPACE pg_default TO xuux_worker'],
      revert: ['REVOKE CREATE ON TABLESPACE pg_default FROM xuux_worker'],
      kind: 'worker_tablespace_privilege',
      axis: 'tablespace',
    },
    {
      name: 'سمةُ دور',
      apply: ['ALTER ROLE xuux_worker CREATEDB'],
      revert: ['ALTER ROLE xuux_worker NOCREATEDB'],
      kind: 'worker_role_attributes',
      axis: 'role_attribute',
    },
  ];
  for (const m of mutations) {
    test(`طفرة: ${m.name} ⇒ يكشفُها المدقّق${m.kind ? ` وcheck_fenced (${m.kind})` : ''}`, async () => {
      const sql = (/** @type {string} */ s) => s.replaceAll('{db}', quoteIdent(h.db.name));
      for (const s of m.apply) await h.db.pool.query(sql(s));
      try {
        const r = await audit();
        assert.ok(
          !r.ok &&
            r.unclassified.some((c) => c.axis === m.axis || c.axis === 'catalog_privilege_drift'),
          `المدقّقُ لم يكشف: ${JSON.stringify(r.unclassified)}`,
        );
        if (m.kind)
          assert.ok(
            (await problems()).some((p) => p.kind === m.kind),
            JSON.stringify(await problems()),
          );
      } finally {
        for (const s of m.revert) await h.db.pool.query(sql(s));
      }
      assert.deepEqual((await audit()).unclassified, [], 'العكسُ يعيدُ النظافة');
      assert.deepEqual(await problems(), []);
    });
  }

  test('منعٌ من المصدر: TRUNCATE لعاملٍ على جدولٍ محروسٍ يُرفَضُ عندَ المنحِ نفسِه', async () => {
    await rejectsWith(
      () => h.db.pool.query('GRANT TRUNCATE ON state.fence_probe TO xuux_worker'),
      ['XF203'],
      'منحُ TRUNCATE',
    );
  });

  test('الإيجابيُّ الكاذبُ مستبعد: منحُ قراءةٍ ودالّةُ مستدعٍ في state لا يُفشلان المدقّقَ ولا check_fenced', async () => {
    await h.db.pool.query(`GRANT SELECT ON state.wl539_t TO xuux_worker`);
    await h.db.pool.query(
      `CREATE FUNCTION state.wl539_invoker(integer) RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT $1 + 1'`,
    );
    try {
      const r = await audit();
      assert.deepEqual(r.unclassified, []);
      assert.ok(
        r.classified.some(
          (c) => c.object === 'state.wl539_invoker(integer)' && c.class === 'INVOKER',
        ),
      );
      assert.deepEqual(await problems(), []);
    } finally {
      await h.db.pool.query(`DROP FUNCTION state.wl539_invoker(integer)`);
    }
  });

  test('الطفرةُ تمنعُ الاستئناف: إيقافٌ ثمّ RESUME يُرفَضُ ما بقيت قدرةٌ غيرُ مصنّفة', async () => {
    await h.db.pool.query('GRANT EXECUTE ON FUNCTION pg_catalog.pg_stat_reset() TO xuux_worker');
    try {
      await rejectsWith(() => h.resume(), ['XF415'], 'RESUME فوقَ قدرةٍ غيرِ مصنّفة');
      const cf = (await h.rootClient.query('SELECT fence.check_fenced() AS r')).rows[0].r;
      assert.ok(
        cf.problems.some((/** @type {any} */ p) => p.kind === 'worker_catalog_privilege_drift'),
        JSON.stringify(cf.problems),
      );
    } finally {
      await h.db.pool.query(
        'REVOKE EXECUTE ON FUNCTION pg_catalog.pg_stat_reset() FROM xuux_worker',
      );
    }
    await h.resume();
    assert.equal((await h.sovereign.status()).effective.state, 'RUNNING');
  });
});

describe('WL-540: احتواءُ الوصولِ عبرَ القواعد', { skip: skipWithoutDatabase }, () => {
  /** @type {Awaited<ReturnType<typeof harness>>} */
  let h;
  /** @type {Record<string, any>} */
  let policy;
  /** هويّةُ إقلاعٍ حيّةٌ (‏دورُ الدخولِ الفعليّ للعامل). */
  let identity = '';
  const audit = async () => auditWorkerCapabilitiesLive(/** @type {any} */ (h.rootClient), policy);
  const problems = async () =>
    /** @type {Array<{ kind: string, object: string }>} */ (
      (await h.rootClient.query('SELECT fence.capability_problems() AS p')).rows[0].p
    );
  const reach = async () => (await problems()).filter((p) => p.kind === 'worker_database_reach');
  /** كلُّ قاعدةٍ أخرى يُمكنُ الدخولُ إليها (‏ALLOW_CONNECTIONS) في العنقود. */
  const otherDatabases = async () =>
    /** @type {string[]} */ (
      (
        await h.db.pool.query(
          `SELECT datname FROM pg_database WHERE datname <> current_database() AND datallowconn ORDER BY 1`,
        )
      ).rows.map((r) => r.datname)
    );
  /** هجومٌ فعليٌّ بهويّةِ العامل: دخولٌ إلى قاعدةٍ ثمّ CREATE TEMP فيها. */
  const attack = async (/** @type {string} */ database) => {
    try {
      const c = await h.login(identity, { database });
      try {
        await c.query('CREATE TEMP TABLE wl540_tmp (a integer)');
      } finally {
        await c.end().catch(() => {});
      }
      return 'ok';
    } catch (e) {
      return String(/** @type {any} */ (e).code);
    }
  };
  before(async () => {
    policy = await loadCapabilityPolicy();
    h = await harness('wl540');
    await h.resume();
    identity = String(
      (await h.boot('alpha', { seal: false, connect: false })).credential.role_name,
    );
  });
  after(async () => h?.close());

  test('حصرٌ بعدَ الاحتواء: لا CONNECT ولا TEMPORARY لهويّةِ العاملِ ولا لـxuux_worker ولا لـPUBLIC على أيِّ قاعدةٍ أخرى', async () => {
    const dbs = await otherDatabases();
    // ضدّ النجاحِ الزائف: العنقودُ فيه فعلاً قواعدُ أخرى (‏postgres وtemplate1 على الأقل).
    assert.ok(dbs.includes('postgres') && dbs.includes('template1'), JSON.stringify(dbs));
    const granted = (
      await h.db.pool.query(
        `SELECT d.datname, r.rolname, p.priv FROM pg_database d
         CROSS JOIN (VALUES ('public'), ('xuux_worker'), ($1)) r(rolname)
         CROSS JOIN (VALUES ('CONNECT'), ('TEMPORARY'), ('CREATE')) p(priv)
         WHERE d.datname <> current_database() AND d.datallowconn
           AND has_database_privilege(r.rolname, d.oid, p.priv)`,
        [identity],
      )
    ).rows;
    assert.deepEqual(granted, [], 'صلاحيةٌ متبقّيةٌ على قاعدةٍ أخرى');
    assert.deepEqual(await reach(), []);
    const r = await audit();
    assert.deepEqual(r.unclassified, []);
    // ما بقيَ في محورِ القواعدِ خارجَ القاعدةِ الحاليّة: قواعدُ لا يُدخَلُ إليها أصلاً (‏template0) — بلا أثر.
    const foreign = r.classified.filter((c) => c.axis === 'database' && c.object !== 'current');
    for (const c of foreign) {
      assert.equal(/** @type {any} */ (c.detail).allowconn, false, JSON.stringify(c));
      assert.equal(c.class, 'EFFECT_DISABLED');
    }
    // في القاعدةِ الحاليّة: CONNECT وحدَه (‏TEMPORARY مسحوبٌ منذ WL-532).
    assert.deepEqual(
      r.classified
        .filter((c) => c.axis === 'database' && c.object === 'current')
        .map((c) => c.privilege),
      ['CONNECT'],
    );
  });

  test('هجومٌ بعدَ الاحتواء: هويّةُ العاملِ تُرفَضُ عندَ الدخولِ إلى كلِّ قاعدةٍ أخرى (‏42501)، وTEMP في قاعدتِه مرفوض', async () => {
    for (const d of await otherDatabases()) assert.equal(await attack(d), '42501', d);
    const c = await h.login(identity);
    try {
      await rejectsWith(
        () => c.query('CREATE TEMP TABLE wl540_tmp (a integer)'),
        // تحتَ RUNNING يسبقُ مُطلِقُ DDL (‏XF201) فحصَ الصلاحية؛ وتحتَ HALTED تُرفَضُ بالصلاحية (‏42501).
        ['42501', 'XF201'],
        'TEMP في القاعدةِ المسيَّجة',
      );
    } finally {
      await c.end().catch(() => {});
    }
  });

  test('إعادةُ إنتاجِ الهجوم: منحُ PUBLIC على postgres (‏حالُ ما قبلَ WL-540) يُدخِلُ العاملَ ويُنشئُ TEMP — فيُكشَفُ ويمنعُ RESUME، والاحتواءُ يعالجه', async () => {
    // GRANT على قاعدة (‏كائنٌ مشتركٌ في العنقود) لا تراه مُطلِقاتُ DDL — يمرُّ تحتَ RUNNING: حدٌّ موثَّق، فالكشفُ عند الانتقال.
    await h.db.pool.query('GRANT CONNECT, TEMPORARY ON DATABASE postgres TO PUBLIC');
    try {
      assert.equal(await attack('postgres'), 'ok', 'الهجومُ يُعادُ إنتاجُه قبلَ الإصلاح');
      assert.deepEqual(
        (await reach()).map((p) => p.object),
        ['postgres:CONNECT', 'postgres:TEMPORARY'],
      );
      const r = await audit();
      assert.ok(
        r.unclassified.some((c) => c.axis === 'database' && c.object === 'postgres'),
        JSON.stringify(r.unclassified),
      );
      // الإيقافُ نفسُه لا يكتملُ فوقَ الانحراف: check_fenced يُعلنُ القاعدةَ غيرَ مُسيَّجة فتبقى HALT_REQUESTED
      // (‏مغلقةً للكتابة)، فلا HALTED ولا RESUME.
      const hr = /** @type {any} */ (await h.root.halt('wl540-reach', { effects: NO_EFFECTS }));
      assert.equal(hr.dbFenced, false);
      assert.equal(hr.reason, 'DB_NOT_FENCED');
      assert.ok(
        hr.check.problems.some((/** @type {any} */ p) => p.kind === 'worker_database_reach'),
        JSON.stringify(hr.check.problems),
      );
      assert.equal((await h.sovereign.status()).effective.state, 'HALT_REQUESTED');
      await rejectsWith(() => h.resume(), ['XF415', 'XF507'], 'RESUME فوقَ وصولٍ عبرَ القواعد');
      assert.notEqual((await h.sovereign.status()).effective.state, 'RUNNING');
    } finally {
      const fix = await h.containDatabases();
      assert.deepEqual(fix.revoked, [{ database: 'postgres', from: 'PUBLIC' }]);
      assert.deepEqual(fix.unresolved, []);
    }
    assert.deepEqual(await reach(), []);
    const hr = /** @type {any} */ (
      await h.root.halt('wl540-reach-contained', { effects: NO_EFFECTS })
    );
    assert.equal(hr.dbFenced, true, JSON.stringify(hr.check?.problems));
    await h.resume();
    assert.equal((await h.sovereign.status()).effective.state, 'RUNNING');
    // الإيقافُ ألغى الهويّة (‏NOLOGIN ⇒ 28000 حتى في قاعدتِه): إقلاعٌ جديدٌ يُثبتُ أنّ الصلاحيةَ نفسَها هي ما يرفض.
    identity = String(
      (await h.boot('alpha', { seal: false, connect: false })).credential.role_name,
    );
    assert.equal(await attack('postgres'), '42501', 'بعدَ الاحتواء');
  });

  test('الاحتواءُ لـsuperuser وحدَه: لا EXECUTE للجذرِ ولا للسياديِّ ولا لهويّةِ العامل', async () => {
    const c = await h.login(identity);
    try {
      for (const client of [h.rootClient, h.sovClient, c])
        await rejectsWith(
          () => client.query('SELECT fence.contain_database_reach()'),
          ['42501'],
          'احتواءٌ بغيرِ superuser',
        );
    } finally {
      await c.end().catch(() => {});
    }
    await h.root.halt('wl540-mutations', { effects: NO_EFFECTS });
  });

  // الطفراتُ تحتَ HALTED بالمالكِ الأعلى: كلٌّ يُكشَفُ بالمدقّقِ وcheck_fenced ويمنعُ RESUME، ثمّ يُعالَج.
  /** @type {Array<{ name: string, apply: string[], revert: string[], objects: string[], unresolved?: string[] }>} */
  const mutations = [
    {
      name: 'إعادةُ منحِ CONNECT لـPUBLIC على postgres',
      apply: ['GRANT CONNECT ON DATABASE postgres TO PUBLIC'],
      revert: [],
      objects: ['postgres:CONNECT'],
    },
    {
      name: 'إعادةُ منحِ TEMPORARY وحدَه لـPUBLIC على template1',
      apply: ['GRANT TEMPORARY ON DATABASE template1 TO PUBLIC'],
      revert: [],
      objects: ['template1:TEMPORARY'],
    },
    {
      name: 'منحٌ مباشرٌ لـxuux_worker (‏تَرِثُه الهويّة)',
      apply: ['GRANT CONNECT, TEMPORARY ON DATABASE postgres TO xuux_worker'],
      revert: [],
      objects: ['postgres:CONNECT', 'postgres:TEMPORARY'],
    },
    {
      name: 'منحٌ موروثٌ عبرَ عضويّةِ دورٍ وسيط (‏لا يُسحَبُ صامتاً — يبقى مكشوفاً)',
      apply: [
        'CREATE ROLE wl540_bridge NOLOGIN',
        'GRANT CONNECT ON DATABASE postgres TO wl540_bridge',
        'GRANT wl540_bridge TO xuux_worker',
      ],
      revert: [
        'REVOKE wl540_bridge FROM xuux_worker',
        'REVOKE CONNECT ON DATABASE postgres FROM wl540_bridge',
        'DROP ROLE wl540_bridge',
      ],
      objects: ['postgres:CONNECT'],
      unresolved: ['postgres'],
    },
    {
      name: 'قاعدةٌ جديدة (‏CREATE DATABASE يمنحُ PUBLIC افتراضاً)',
      apply: ['CREATE DATABASE wl540_new'],
      revert: ['DROP DATABASE IF EXISTS wl540_new'],
      objects: ['wl540_new:CONNECT', 'wl540_new:TEMPORARY'],
    },
    {
      name: 'فتحُ template0 للاتّصال (‏ALLOW_CONNECTIONS true ⇒ منحُ PUBLIC القائمُ يصيرُ ذا أثر)',
      apply: ['ALTER DATABASE template0 ALLOW_CONNECTIONS true'],
      revert: ['ALTER DATABASE template0 ALLOW_CONNECTIONS false'],
      objects: ['template0:CONNECT'],
    },
  ];
  for (const m of mutations) {
    test(`طفرة: ${m.name} ⇒ المدقّقُ وcheck_fenced (‏worker_database_reach) يكشفان وRESUME يُرفَض`, async () => {
      for (const s of m.apply) await h.db.pool.query(s);
      try {
        const objects = (await reach()).map((p) => p.object);
        for (const o of m.objects)
          assert.ok(objects.includes(o), `${o} ∉ ${JSON.stringify(objects)}`);
        const r = await audit();
        assert.ok(
          !r.ok && r.unclassified.some((c) => c.axis === 'database'),
          JSON.stringify(r.unclassified),
        );
        assert.equal((await h.sovereign.status()).effective.state, 'HALTED');
        await rejectsWith(() => h.resume(), ['XF415'], m.name);
        const cf = (await h.rootClient.query('SELECT fence.check_fenced() AS r')).rows[0].r;
        assert.ok(
          cf.problems.some((/** @type {any} */ p) => p.kind === 'worker_database_reach'),
          JSON.stringify(cf.problems),
        );
        if (m.unresolved) {
          const fix = await h.containDatabases();
          assert.deepEqual(fix.unresolved, m.unresolved, 'الموروثُ لا يُخفى');
          assert.ok((await reach()).length > 0, 'ما زال مكشوفاً بعدَ الاحتواء');
        }
      } finally {
        for (const s of m.revert) await h.db.pool.query(s);
        await h.containDatabases();
      }
      assert.deepEqual(await reach(), []);
      assert.deepEqual((await audit()).unclassified, [], 'المعالجةُ تعيدُ النظافة');
    });
  }

  test('لا كسرَ للإدارةِ والاسترداد: superuser يدخلُ postgres، ودورٌ غيرُ عاملٍ مُنِحَ صراحةً يدخلُ بلا إنذارٍ كاذب، والجذرُ والسياديُّ يعيدانِ الاتّصال، وRESUME ينجح', async () => {
    const su = new URL(process.env['DATABASE_URL'] ?? '');
    su.pathname = '/postgres';
    const admin = new pg.Client({ connectionString: su.toString() });
    await admin.connect();
    try {
      assert.equal((await admin.query('SELECT current_database() AS d')).rows[0].d, 'postgres');
    } finally {
      await admin.end();
    }
    await h.db.pool.query('CREATE ROLE wl540_operator LOGIN');
    await h.db.pool.query('GRANT CONNECT ON DATABASE postgres TO wl540_operator');
    try {
      const op = await h.login('wl540_operator', { database: 'postgres' });
      await op.end();
      assert.deepEqual(await reach(), [], 'منحٌ صريحٌ لدورٍ غيرِ عاملٍ ليس انحرافاً');
    } finally {
      await h.db.pool.query('REVOKE CONNECT ON DATABASE postgres FROM wl540_operator');
      await h.db.pool.query('DROP ROLE wl540_operator');
    }
    await h.reconnect();
    await h.resume();
    assert.equal((await h.sovereign.status()).effective.state, 'RUNNING');
    const w = await h.boot('beta');
    await w.client?.query('SELECT 1');
  });
});
