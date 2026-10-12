// @ts-nocheck
// sim/tpm/manifest_seal_sim.mjs
//
// محاكاة جذر الثقة v3 مع مرساة TPM NV — تطبق ADR 0007 §4.4 (مسار الختم
// وقواعد التعافي) و§4.3 (ربط الشهادة). غير إنتاجي: تحقيق/محاكاة فقط.
//
// مثال تصميمي لا كود إنتاج: يُتحقق به من منطق كشف الإعادة وحالات التمزّق
// وربط الشهادة على محاكي swtpm. مصدر الحقيقة في المواصفة هو ADR 0007.

import { randomBytes, createHash, generateKeyPairSync, sign as edSign, verify as edVerify } from 'node:crypto';
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, copyFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export const STATE_TPM_COUNTER_MISMATCH = 'STATE_TPM_COUNTER_MISMATCH';
export const STATE_MANIFEST_TPM_TORN = 'STATE_MANIFEST_TPM_TORN';
export const STATE_TPM_ATTEST_INVALID = 'STATE_TPM_ATTEST_INVALID';
export const STATE_TPM_INDEX_MISSING = 'STATE_TPM_INDEX_MISSING';
export const STATE_TPM_UNAVAILABLE = 'STATE_TPM_UNAVAILABLE';
export const HALT = 'halted';
export const RUNNING = 'running';
export const STATE_HALT_SOVEREIGN = 'STATE_HALT_SOVEREIGN';

const MANIFEST = 'root-of-trust.manifest.json';
const STAGED = 'root-of-trust.manifest.staged.json';
const HALT_FILE = 'halt.json';
// (WL-376) التزامُ staged قبلَ الزيادةِ — يُحتَّمُ على الانتشارِ لا الاستئنافِ.
// يحاكي ختمَ HSM للمتنِ داخلَ التوكنِ (‏ADR 0007 §10 حدٌّ 2، WL-098): في الإنتاجِ
// يمنعُ المهاجمَ من تعويضَ staged بمحتوى آخرَ بعدَ الزيادةِ لأنّ الختمَ في التوكنِ لا القرصِ.
// حالةُ التوكنِ البرمجيِّ المُحاكى (مقابلُ tokenSerial + الختمِ داخلَ التوكنِ في
// النظامِ الحقيقيِّ — WL-098). تدخلُ في اللقطةِ والاستعادةِ كاملةً حتى يُثبَتَ أنّ
// تراجعَ التوكنِ نفسِهِ لا ينفعُ ما دامَ عدّادُ TPM متقدّماً.
const TOKEN_STATE = 'token-state.json';

/**
 * محاكاة عقد TPM2_NV_Certify — عقدُ التحقق هو ما يُختبر، لا أمر TPM نفسه.
 * شهادة حقيقية ستأتي من tpm2 nvcertify؛ هنا نُحاكي بنيتها وعقد تحققها.
 */
export class CertifySim {
  /**
   * @param {string} akName اسم مفتاح الشهادة (مُثبَت في التخصيص)
   * @param {string} nvIndexName اسم فهرس العدّاد (مُثبَت في التخصيص)
   */
  constructor(akName, nvIndexName) {
    this.akName = akName;
    this.nvIndexName = nvIndexName;
    const pair = generateKeyPairSync('ed25519');
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
  }

  /** qualifyingData = SHA256(instanceId ‖ sequence ‖ digest(bodyWithoutCertify)). */
  static qualifyingData(body) {
    const { instanceId, sequence } = body;
    const bodyDigest = createHash('sha256').update(canonical(body)).digest();
    return createHash('sha256')
      .update(Buffer.from(String(instanceId), 'utf8'))
      .update(Buffer.from([0]))
      .update(Buffer.from(String(sequence), 'utf8'))
      .update(bodyDigest)
      .digest();
  }

  /** ينتج شهادة موقّعة على {nvIndexName, counter, qualifyingData}. */
  attest(counter, qualifyingData) {
    const attest = {
      magic: 'TPM_SIM_ATTEST',
      qualifiedSigner: this.akName,
      name: this.nvIndexName,
      counterValue: counter,
      qualifyingData: qualifyingData.toString('hex'),
    };
    const sig = edSign(null, canonical(attest), this.privateKey);
    return { attest, signature: sig.toString('hex') };
  }

  /**
   * يتحقق من شهادة ضد الروابط المتوقعة.
   * @returns {{ok: boolean, error?: string}}
   */
  verify(certify, expected) {
    if (!certify || !certify.attest || !certify.signature) {
      return { ok: false, error: 'malformed' };
    }
    const { attest, signature } = certify;
    if (attest.qualifiedSigner !== expected.akName) {
      return { ok: false, error: 'akName_mismatch' };
    }
    if (attest.name !== expected.nvIndexName) {
      return { ok: false, error: 'nvIndexName_mismatch' };
    }
    if (attest.counterValue !== expected.counter) {
      return { ok: false, error: 'counter_mismatch' };
    }
    const expectedQd = CertifySim.qualifyingData(expected.body);
    if (attest.qualifyingData !== expectedQd.toString('hex')) {
      return { ok: false, error: 'qualifyingData_mismatch' };
    }
    let ok;
    try {
      ok = edVerify(null, canonical(attest), this.publicKey, Buffer.from(signature, 'hex'));
    } catch {
      ok = false;
    }
    if (!ok) return { ok: false, error: 'signature_invalid' };
    return { ok: true };
  }
}

/** تسلسل كانونيكي مستقر. */
function canonical(obj) {
  return Buffer.from(JSON.stringify(sortKeys(obj)), 'utf8');
}
function sortKeys(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  return Object.keys(obj).sort().reduce((acc, k) => { acc[k] = sortKeys(obj[k]); return acc; }, {});
}

/**
 * جذر ثقة محاكى v3 مع مرساة TPM NV.
 */
export class FreshnessAnchorSim {
  /**
   * @param {string} dir دليل جذر الحالة
   * @param {object} tpm عميل TPM ({nvIncrement, nvReadCounter}) — أو null لـ absent
   * @param {string} akName
   * @param {string} nvIndexName
   * @param {number} nvIndex
   */
  constructor(dir, tpm, akName, nvIndexName, nvIndex) {
    this.dir = dir;
    this.tpm = tpm;
    this.certify = new CertifySim(akName, nvIndexName);
    this.nvIndex = nvIndex;
    this.nvIndexName = nvIndexName;
    this.akName = akName;
    mkdirSync(dir, { recursive: true });
  }

  manifestPath() { return join(this.dir, MANIFEST); }
  stagedPath() { return join(this.dir, STAGED); }
  haltPath() { return join(this.dir, HALT_FILE); }
  tokenStatePath() { return join(this.dir, TOKEN_STATE); }

  readTokenState() {
    if (!existsSync(this.tokenStatePath())) return null;
    return JSON.parse(readFileSync(this.tokenStatePath(), 'utf8'));
  }
  // (WL-376) التزامُ staged: SHA-256 للمتنِ المرجعيِّ للمحتوى المُلزَمِ قبلَ الزيادةِ.
  // يُحسَبُ على المتنِ بلا `certify` (نفسُ شكلِ qualifyingData). يُكتبُ في التوكنِ
  // قبلَ الزيادةِ ويُتحقَّقُ منه في التعافي — التزامٌ لا استئناف.
  static stagedCommitHash(body) {
    const { tpm: { certify: _ignored, ...restTpm } = {}, ...restBody } = body;
    return createHash('sha256')
      .update(canonical({ ...restBody, tpm: restTpm }))
      .digest('hex');
  }
  writeTokenState(state) { writeFileSync(this.tokenStatePath(), JSON.stringify(state)); }

  readManifest() {
    if (!existsSync(this.manifestPath())) return null;
    return JSON.parse(readFileSync(this.manifestPath(), 'utf8'));
  }
  readStaged() {
    if (!existsSync(this.stagedPath())) return null;
    return JSON.parse(readFileSync(this.stagedPath(), 'utf8'));
  }
  // (WL-372) الإيقافُ صنفانِ: سياديٌّ (قرارُ مالكٍ — epoch=1) لا يُفتحُهُ recover()
  //، وسياديُّ الانقطاعِ/العطبِ (epoch=0) يُعادُ بعدَ إصلاحِ السببِ.
  //
  // (WL-374) ولا يُخفَّضُ إيقافٌ سياديٌّ بكتابةِ إغلاقِ عطبٍ فوقَه: مسارُ
  // `STATE_TPM_INDEX_MISSING` كانَ يكتبُ `epoch: 0` فوقَ `epoch: 1` فيُفتَحُ الإيقافُ
  // عندَ عودةِ TPM. فكلُّ `writeHalt(HALT)` يحملُ الصنفَ السياديَّ إن وُجِدَ دليلُه.
  // والكتابةُ إلى `RUNNING` لا تُبلَغُ وثمّةَ دليلٌ سياديٌّ (‏`recover()` يعودُ قبلَها).
  writeHalt(state, sovereign = false) {
    const keepSovereign = state === HALT && (sovereign || this.sovereignEvidence());
    writeFileSync(this.haltPath(), JSON.stringify({
      state,
      epoch: keepSovereign ? 1 : 0,
    }));
  }
  /**
   * (WL-374) دليلُ الإيقافِ السياديِّ: المتنُ الملتزمُ المختومُ (‏`halted: true`) — وهو
   * المرجعُ لأنّه داخلَ الختمِ ويتقدّمُ معه العدّادُ — أو صيغةُ `halt.json` القديمةُ
   * (‏`epoch: 1`، WL-372) تُحترَمُ إغلاقاً لا فتحاً. أيُّ دليلٍ يكفي للإبقاءِ؛ غيابُ
   * الملفِّ لا يكفي للفتحِ. والمتنُ هنا غيرُ متحقَّقٍ عمداً: ادّعاءُ إيقافٍ في متنٍ
   * مزوَّرٍ لا يُنتِجُ إلّا إيقافاً (‏رفضٌ آمنٌ)، ولا يُفتَحُ به شيءٌ.
   */
  sovereignEvidence() {
    let file = null;
    try { file = existsSync(this.haltPath()) ? JSON.parse(readFileSync(this.haltPath(), 'utf8')) : null; } catch { file = { state: HALT, epoch: 1 }; }
    if (file && file.state === HALT && file.epoch === 1) return true;
    let body = null;
    try { body = this.readManifest(); } catch { body = null; }
    return Boolean(body && body.halted === true);
  }
  readHalt() {
    if (!existsSync(this.haltPath())) return { state: RUNNING, epoch: 0 };
    return JSON.parse(readFileSync(this.haltPath(), 'utf8'));
  }

  /** يقرأ قيمة عدّاد TPM الحالية. */
  async readCounter() {
    if (!this.tpm) return null;
    const r = await this.tpm.nvReadCounter(this.nvIndex);
    if (r.rc !== 0) return null;
    return r.counter;
  }

  /**
   * يخصّص البيان الابتدائي. يهيّئ عدّاد TPM إن لم يُهيّأ، ويضبط
   * body.counter = قيمة العدّاد الفعلية (لا يفترض 0، لأن swtpm قد يكمل من قيمة سابقة).
   */
  async provision(instanceId) {
    let counter = await this.readCounter();
    if (!counter) {
      // غير مهيّأ (null) أو صفر: زيارة واحدة للتهيئة، ثم قراءة القيمة الفعلية.
      await this.tpm.nvIncrement(this.nvIndex);
      counter = await this.readCounter();
    }
    const body = {
      version: 3,
      instanceId: instanceId ?? randomBytes(16).toString('hex'),
      sequence: 1,
      anchoredCount: 0,
      haltEpoch: 0,
      ledgerCommitted: 0,
      journalHead: 'genesis',
      tpm: { akName: this.akName, nvIndexName: this.nvIndexName, counter, certify: null },
    };
    writeFileSync(this.manifestPath(), JSON.stringify(body));
    // حالةُ التوكنِ البرمجيِّ: التسلسلُ وأوّلُ عدّادٍ مختومٍ داخلَهُ.
    this.writeTokenState({ tokenSerial: 'sim-token-' + body.instanceId, sealEpoch: 1, lastSealedCounter: counter });
    this.writeHalt(RUNNING);
    return body;
  }

  /**
   * مسار الختم الذرّي (ADR 0007 §4.4). يرفض العمل بعد إغلاق النظام.
   * @param {{beforeIncrement?: Function, beforeCertify?: Function, beforeRename?: Function, beforeUnlinkStaged?: Function}} [hooks]
   */
  async seal(hooks = {}, mutate = null) {
    if (this.readHalt().state === HALT) {
      throw new Error('HALTED: system halted, seal refused');
    }
    const current = this.readManifest();
    if (!current) throw new Error('UNPROVISIONED');
    // (WL-374) المتنُ المختومُ موقوفاً يرفضُ الختمَ ولو حُذِفَ `halt.json` أو كُتِبَ فوقَه.
    if (current.halted === true) {
      throw new Error('HALTED: sovereign halt sealed in manifest, seal refused');
    }
    const C = current.tpm.counter;
    const base = {
      ...current,
      sequence: current.sequence + 1,
      journalHead: 'checkpoint:' + String(current.sequence + 1),
      tpm: { akName: this.akName, nvIndexName: this.nvIndexName, counter: C + 1, certify: null },
    };
    const body = mutate ? { ...mutate(base), tpm: base.tpm, sequence: base.sequence, instanceId: base.instanceId } : base;
    // 1+2: staged بلا شهادة
    writeFileSync(this.stagedPath(), JSON.stringify(body));
    // (WL-376) التزامُ staged في التوكنِ قبلَ الزيادةِ: SHA-256 للمتنِ المرجعيِّ
    // (بلا certify). يمنعُ تعويضَ staged بمحتوى آخرَ بعدَ الزيادةِ في التعافي.
    const stagedCommit = FreshnessAnchorSim.stagedCommitHash(body);
    const ts = this.readTokenState();
    this.writeTokenState({ ...(ts ?? { tokenSerial: 'sim-token-unknown', sealEpoch: 0 }), lastSealedCounter: ts?.lastSealedCounter ?? 0, stagedCommit });
    if (hooks.beforeIncrement) hooks.beforeIncrement();
    // 3: زيادة العدّاد
    const inc = await this.tpm.nvIncrement(this.nvIndex);
    if (inc.rc !== 0) return { ok: false, error: STATE_TPM_UNAVAILABLE };
    const actualCounter = await this.readCounter();
    if (actualCounter !== C + 1) return { ok: false, error: STATE_TPM_COUNTER_MISMATCH };
    if (hooks.beforeCertify) hooks.beforeCertify();
    // 4: شهادة
    const qd = CertifySim.qualifyingData(body);
    const certify = this.certify.attest(C + 1, qd);
    if (hooks.beforeRename) hooks.beforeRename();
    // 5: كتابة نهائية + rename ذرّي
    const finalBody = { ...body, tpm: { ...body.tpm, counter: C + 1, certify } };
    const tmp = this.stagedPath() + '.final';
    writeFileSync(tmp, JSON.stringify(finalBody));
    renameSync(tmp, this.manifestPath());
    // 5 (تتمّتُهُ): الختمُ داخلَ التوكنِ جزءٌ من كتابةِ المتنِ النهائيِّ —
    // آخرُ عدّادٍ مختومٍ داخلَ التوكنِ صارَ C+1 معَ rename نفسِهِ. staged مُلتزَمٌ
    // فالتزامُهُ في التوكنِ يُستهلَكُ (لا يُبقي على staged مُتأكّدٍ).
    this.writeTokenState({ ...(this.readTokenState() ?? { tokenSerial: 'sim-token-unknown', sealEpoch: 0 }), lastSealedCounter: C + 1, stagedCommit: null });
    if (hooks.beforeUnlinkStaged) hooks.beforeUnlinkStaged();
    // 6: حذف staged
    if (existsSync(this.stagedPath())) rmSync(this.stagedPath());
    return { ok: true, counter: C + 1 };
  }

  /**
   * (WL-374) الإيقافُ السياديُّ **التزامٌ مختومٌ** لا علامةٌ: متنٌ جديدٌ بـ`halted: true`
   * و`haltEpoch + 1` يمرُّ بمسارِ الختمِ الذرّيِّ نفسِه (‏staged ← زيادةُ العدّادِ ← شهادةٌ
   * ← rename) فيتقدّمُ عدّادُ TPM. فلا يفتحُه حذفُ `halt.json`، ولا تفتحُه استعادةُ لقطةِ
   * ما قبلَه (‏المتنُ القديمُ يتخلّفُ عن العدّادِ ⇒ `STATE_TPM_COUNTER_MISMATCH`).
   *
   * **حدودٌ مُعلَنةٌ:** (1) نجاحٌ لا يُعادُ إلّا بعدَ الالتزامِ؛ انقطاعٌ قبلَ الزيادةِ يُسقِطُ
   * الطلبَ (‏staged يُهمَلُ) ولطالبِه أن يُعيدَه. (2) مرفوضٌ فوقَ إغلاقِ عطبٍ (‏`HALTED`):
   * لا يُختَمُ متنٌ لم يُتحقَّقْ منه بعد. (3) لا مسارَ فتحٍ في المحاكي — الاستئنافُ قرارُ
   * مالكٍ بسلطةٍ (‏`HaltSwitch`/الأمرُ الملكيُّ في الإنتاجِ) لا يُحاكى هنا.
   * @param {string} reason
   * @param {object} [hooks] نقاطُ انقطاعِ seal() نفسِها
   */
  async haltSovereign(reason, hooks = {}) {
    const r = await this.seal(hooks, (b) => ({
      ...b,
      halted: true,
      haltEpoch: (b.haltEpoch ?? 0) + 1,
      haltReason: String(reason ?? ''),
    }));
    if (r.ok) this.writeHalt(HALT, true);
    return r;
  }

  /**
   * قواعد التعافي عند الإقلاع (ADR 0007 §4.4). كل ما لا يطابق ⇒ إغلاق.
   * @returns {Promise<{state: string, error?: string, counter?: number, bodyCounter?: number}>}
   */
  async recover() {
    const C = await this.readCounter();
    if (C === null) {
      this.writeHalt(HALT);
      return { state: HALT, error: STATE_TPM_INDEX_MISSING };
    }
    const committed = this.readManifest();
    if (!committed) return { state: HALT, error: 'STATE_ROOT_UNPROVISIONED' };
    const B = committed.tpm.counter;
    const staged = this.readStaged();

    // (WL-372) الإيقافُ السياديُّ (state: halted, epoch: 1) قرارٌ مالكٍ لا خللُ
    // انقطاعٍ؛ recover() لا يفتحُهُ. تُستأنفُ العمليةُ بقرارٍ صريحٍ (ownerAuth أو
    // رفعِ الملفِّ بإذنٍ) لا بإعادةِ إقلاعٍ. كلُّ ما دونَ epoch=1 (0 أو غيابٌ)
    // فهو تركُ إقلاعٍ عاديٌّ ويُعادُ إلى RUNNING بعدَ نجاحِ التعافي.
    //
    // (WL-374) الدليلُ السياديُّ يُقرأُ من المتنِ المختومِ أيضاً لا من الملفِّ وحدَه —
    // لكنْ **بعدَ** فحصِ العدّادِ: متنٌ موقوفٌ مُستعادٌ من لقطةٍ أقدمَ من العدّادِ هو إعادةٌ
    // (‏MISMATCH) قبلَ أن يكونَ إيقافاً. فهنا الملفُّ والمتنُ الملتزمُ المطابقُ للعدّادِ.
    const haltState = this.readHalt();
    const sovereignFile = haltState && haltState.state === HALT && haltState.epoch === 1;
    const sovereignBody = committed.halted === true && B === C && !staged;
    if (sovereignFile || sovereignBody) {
      if (sovereignBody && committed.tpm.certify) {
        const bodyForQd = { ...committed, tpm: { ...committed.tpm, certify: null } };
        const v = this.certify.verify(committed.tpm.certify, {
          akName: this.akName, nvIndexName: this.nvIndexName, counter: C, body: bodyForQd,
        });
        if (!v.ok) {
          this.writeHalt(HALT);
          return { state: HALT, error: STATE_TPM_ATTEST_INVALID, verifyError: v.error, counter: C };
        }
      }
      this.writeHalt(HALT, true);
      return { state: HALT, error: STATE_HALT_SOVEREIGN };
    }

    // اتساقُ التوكنِ البرمجيِّ معَ المتنِ: آخرُ عدّادٍ مختومٍ داخلَ التوكنِ يجبُ
    // أن يطابقَ عدّادَ المتنِ الملتزمِ. توكنٌ أقدمُ أو أحدثُ منَ المتنِ = تمزّقٌ
    // لا إقلاعَ معهُ (القاعدةُ: كلُّ ما لا يطابقُ ⇒ إغلاق).
    const tokenState = this.readTokenState();
    if (tokenState && tokenState.lastSealedCounter !== B) {
      this.writeHalt(HALT);
      return {
        state: HALT, error: STATE_MANIFEST_TPM_TORN, counter: C, bodyCounter: B,
        tokenSealedCounter: tokenState.lastSealedCounter,
        torn: 'token-manifest-inconsistent',
      };
    }

    if (staged) {
      const S = staged.tpm.counter;
      // (WL-374) متنٌ ملتزمٌ موقوفاً لا يُستبدَلُ بـstaged غيرِ موقوفٍ بأيِّ مسارٍ: seal()
      // يرفضُ فوقَ المتنِ الموقوفِ، فـstaged كهذا لم يُنتِجْه مسارُ الختمِ — رفضٌ آمنٌ.
      if (committed.halted === true && staged.halted !== true) {
        this.writeHalt(HALT, true);
        return { state: HALT, error: STATE_HALT_SOVEREIGN, counter: C, bodyCounter: B, stagedCounter: S, torn: 'staged-would-lift-sovereign-halt' };
      }
      // (WL-374) B === C === S: الإعادةُ الشرعيّةُ الوحيدةُ هنا انقطاعٌ بعدَ rename قبلَ حذفِ
      // staged، فـstaged **يطابقُ** المتنَ الملتزمَ (‏دونَ الشهادةِ). staged يختلفُ عنه عندَ
      // العدّادِ نفسِه لا يفسّرُه مسارُ ختمٍ ⇒ تمزّقٌ، لا إعادةُ شهادةٍ تستبدلُ المتنَ الملتزمَ.
      if (S === C && B === C) {
        const strip = (b) => JSON.stringify(sortKeys({ ...b, tpm: { ...b.tpm, certify: null } }));
        if (strip(staged) !== strip(committed)) {
          this.writeHalt(HALT);
          return { state: HALT, error: STATE_MANIFEST_TPM_TORN, counter: C, bodyCounter: B, stagedCounter: S, torn: 'staged-differs-from-committed' };
        }
      }
      // الانقطاع قبل الزيادة: staged.counter == C+1 والمتن الملتزم B == C
      if (S === C + 1 && B === C) {
        // يُهمَل staged، المتن القديم صالح (B==C)
        if (existsSync(this.stagedPath())) rmSync(this.stagedPath());
        // (WL-374) المتنُ الباقي هو الحكمُ: إن كانَ موقوفاً بقيَ موقوفاً.
        if (committed.halted === true) {
          this.writeHalt(HALT, true);
          return { state: HALT, error: STATE_HALT_SOVEREIGN, counter: C, bodyCounter: B, recovered: 'discard-staged' };
        }
        this.writeHalt(RUNNING);
        return { state: RUNNING, counter: C, bodyCounter: B, recovered: 'discard-staged' };
      }
      // الانقطاع بعد الزيادة قبل الإتمام: staged.counter == C
      if (S === C && (B === C - 1 || B === C)) {
        // (WL-376) تحقّقُ التزامِ staged — يُطبّقُ عندَ B === C-1 فقط:
        // حيثُ لا شاهِدَ مطابقةٍ للمتنِ الملتزمِ. عندَ B === C المسارُ الملتزمُ
        // موجودٌ ويَحرُسُهُ `staged-differs-from-committed` (WL-374) — والالتزامُ
        // استُهلِكَ بعدَ rename فلا يُنظَرُ إليه (tear 11: انقطاعٌ بعدَ rename قبلَ حذفِ staged).
        if (B === C - 1) {
          const ts = this.readTokenState();
          if (!ts?.stagedCommit) {
            this.writeHalt(HALT);
            return { state: HALT, error: STATE_MANIFEST_TPM_TORN, counter: C, bodyCounter: B, stagedCounter: S, torn: 'staged-commit-missing' };
          }
          if (FreshnessAnchorSim.stagedCommitHash(staged) !== ts.stagedCommit) {
            this.writeHalt(HALT);
            return { state: HALT, error: STATE_MANIFEST_TPM_TORN, counter: C, bodyCounter: B, stagedCounter: S, torn: 'staged-modified-after-commit' };
          }
        }
        // إعادة شهادة فقط (بلا زيادة) وإتمام الكتابة — خاملة التكرار
        const qd = CertifySim.qualifyingData(staged);
        const certify = this.certify.attest(C, qd);
        const finalBody = { ...staged, tpm: { ...staged.tpm, counter: C, certify } };
        const tmp = this.stagedPath() + '.final';
        writeFileSync(tmp, JSON.stringify(finalBody));
        renameSync(tmp, this.manifestPath());
        if (existsSync(this.stagedPath())) rmSync(this.stagedPath());
        // (WL-372) ختمُ التوكنِ على المتنِ المُستكمَلِ: التعافيُ المكتملُ لا
        // يُبقي فجوةً بينَ المتنِ والتوكنِ. كانَ seal() وحدهُ يَختمُ التوكنَ،
        // فالتعافيُ المزدوجُ بعدَ الانقطاعِ كانَ يُدخِلُ الإغلاقَ الزائفَ.
        const tokenState = this.readTokenState();
        if (tokenState) {
          this.writeTokenState({ ...tokenState, lastSealedCounter: C, stagedCommit: null });
        } else {
          // توكنٌ غائبٌ على مسارِ التعافي: إنشاءٌ بنفسِ صيغةِ provision().
          this.writeTokenState({ tokenSerial: 'sim-token-' + finalBody.instanceId, sealEpoch: 1, lastSealedCounter: C, stagedCommit: null });
        }
        // (WL-374) إيقافٌ سياديٌّ انقطعَ بعدَ زيادةِ العدّادِ: العدّادُ تقدّمَ فالالتزامُ وقعَ،
        // والإتمامُ يُتمُّه **موقوفاً** — لا يُكتبُ RUNNING فوقَ إيقافٍ مُلتزَمٍ.
        if (finalBody.halted === true) {
          this.writeHalt(HALT, true);
          return { state: HALT, error: STATE_HALT_SOVEREIGN, counter: C, bodyCounter: C, recovered: 'recertify-complete' };
        }
        this.writeHalt(RUNNING);
        return { state: RUNNING, counter: C, bodyCounter: C, recovered: 'recertify-complete' };
      }
      // staged غير مطابق ⇒ تمزّق
      this.writeHalt(HALT);
      return { state: HALT, error: STATE_MANIFEST_TPM_TORN, counter: C, bodyCounter: B, stagedCounter: S };
    }

    // لا staged
    if (B === C) {
      // تحقق من صحة الشهادة إن وُجدت
      if (committed.tpm.certify) {
        // qualifyingData تُحسب على المتن بلا certify (لا يمكن للشهادة أن تحتوي نفسها).
        const bodyForQd = { ...committed, tpm: { ...committed.tpm, certify: null } };
        const v = this.certify.verify(committed.tpm.certify, {
          akName: this.akName, nvIndexName: this.nvIndexName,
          counter: C, body: bodyForQd,
        });
        if (!v.ok) {
          this.writeHalt(HALT);
          return { state: HALT, error: STATE_TPM_ATTEST_INVALID, verifyError: v.error, counter: C };
        }
      }
      this.writeHalt(RUNNING);
      return { state: RUNNING, counter: C, bodyCounter: B };
    }
    if (B > C) {
      // المتن يتقدّم على العدّاد ⇒ تزوير/رجوع أمامي
      this.writeHalt(HALT);
      return { state: HALT, error: STATE_TPM_COUNTER_MISMATCH, counter: C, bodyCounter: B, direction: 'body-ahead' };
    }
    // B < C: المتن متخلّف عن العدّاد بلا staged يفسّره ⇒ إعادة (replay)
    this.writeHalt(HALT);
    return { state: HALT, error: STATE_TPM_COUNTER_MISMATCH, counter: C, bodyCounter: B, direction: 'replay' };
  }
}

/** يأخذ لقطة من ملفات الجذر والتوكن البرمجي معاً (لا تشمل TPM — عمداً). */
export function snapshotState(srcDir, snapDir) {
  mkdirSync(snapDir, { recursive: true });
  for (const f of [MANIFEST, STAGED, HALT_FILE, TOKEN_STATE]) {
    const s = join(srcDir, f);
    if (existsSync(s)) copyFileSync(s, join(snapDir, f));
  }
}

/** يستعيد لقطة ملفات الجذر والتوكن فوق الحالية (لا يمسّ TPM). */
export function restoreState(snapDir, dstDir) {
  for (const f of [MANIFEST, STAGED, HALT_FILE, TOKEN_STATE]) {
    const s = join(snapDir, f);
    const d = join(dstDir, f);
    if (existsSync(d)) rmSync(d);
    if (existsSync(s)) copyFileSync(s, d);
  }
}
