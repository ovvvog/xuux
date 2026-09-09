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

const MANIFEST = 'root-of-trust.manifest.json';
const STAGED = 'root-of-trust.manifest.staged.json';
const HALT_FILE = 'halt.json';

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

  readManifest() {
    if (!existsSync(this.manifestPath())) return null;
    return JSON.parse(readFileSync(this.manifestPath(), 'utf8'));
  }
  readStaged() {
    if (!existsSync(this.stagedPath())) return null;
    return JSON.parse(readFileSync(this.stagedPath(), 'utf8'));
  }
  writeHalt(state) { writeFileSync(this.haltPath(), JSON.stringify({ state, epoch: state === HALT ? 1 : 0 })); }
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
    this.writeHalt(RUNNING);
    return body;
  }

  /**
   * مسار الختم الذرّي (ADR 0007 §4.4). يرفض العمل بعد إغلاق النظام.
   * @param {{beforeIncrement?: Function, beforeCertify?: Function, beforeRename?: Function, beforeUnlinkStaged?: Function}} [hooks]
   */
  async seal(hooks = {}) {
    if (this.readHalt().state === HALT) {
      throw new Error('HALTED: system halted, seal refused');
    }
    const current = this.readManifest();
    if (!current) throw new Error('UNPROVISIONED');
    const C = current.tpm.counter;
    const body = {
      ...current,
      sequence: current.sequence + 1,
      journalHead: 'checkpoint:' + String(current.sequence + 1),
      tpm: { akName: this.akName, nvIndexName: this.nvIndexName, counter: C + 1, certify: null },
    };
    // 1+2: staged بلا شهادة
    writeFileSync(this.stagedPath(), JSON.stringify(body));
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
    if (hooks.beforeUnlinkStaged) hooks.beforeUnlinkStaged();
    // 6: حذف staged
    if (existsSync(this.stagedPath())) rmSync(this.stagedPath());
    return { ok: true, counter: C + 1 };
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

    if (staged) {
      const S = staged.tpm.counter;
      // الانقطاع قبل الزيادة: staged.counter == C+1 والمتن الملتزم B == C
      if (S === C + 1 && B === C) {
        // يُهمَل staged، المتن القديم صالح (B==C)
        if (existsSync(this.stagedPath())) rmSync(this.stagedPath());
        this.writeHalt(RUNNING);
        return { state: RUNNING, counter: C, bodyCounter: B, recovered: 'discard-staged' };
      }
      // الانقطاع بعد الزيادة قبل الإتمام: staged.counter == C
      if (S === C && (B === C - 1 || B === C)) {
        // إعادة شهادة فقط (بلا زيادة) وإتمام الكتابة — خاملة التكرار
        const qd = CertifySim.qualifyingData(staged);
        const certify = this.certify.attest(C, qd);
        const finalBody = { ...staged, tpm: { ...staged.tpm, counter: C, certify } };
        const tmp = this.stagedPath() + '.final';
        writeFileSync(tmp, JSON.stringify(finalBody));
        renameSync(tmp, this.manifestPath());
        if (existsSync(this.stagedPath())) rmSync(this.stagedPath());
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

/** يأخذ لقطة من ملفات الجذر فقط (لا تشمل TPM — عمداً). */
export function snapshotState(srcDir, snapDir) {
  mkdirSync(snapDir, { recursive: true });
  for (const f of [MANIFEST, STAGED, HALT_FILE]) {
    const s = join(srcDir, f);
    if (existsSync(s)) copyFileSync(s, join(snapDir, f));
  }
}

/** يستعيد لقطة ملفات الجذر فوق الحالية (لا يمسّ TPM). */
export function restoreState(snapDir, dstDir) {
  for (const f of [MANIFEST, STAGED, HALT_FILE]) {
    const s = join(snapDir, f);
    const d = join(dstDir, f);
    if (existsSync(d)) rmSync(d);
    if (existsSync(s)) copyFileSync(s, d);
  }
}
