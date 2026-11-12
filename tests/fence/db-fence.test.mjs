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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  signCredentialChallenge,
} from '../../src/fence/db-fence.mjs';
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
