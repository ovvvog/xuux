// sim/tpm-host/wb_helper_protocol.mjs
//
// WL-511 — بروتوكولُ مساعدِ W-B (‏المساعدُ عبرَ التشغيلِ البينيِّ في WSL — الملحق و §4.1).
// طبقةُ نقلٍ فقط: لا يبني المساعدَ ولا يكلّمُ TBS ولا TPM ولا Windows.
//
// **هذه وحدةُ قياسٍ على بيئةِ المحاكاةِ قبلَ أيِّ بناءٍ على Windows** (تكليفُ WL-511):
// تُختبَرُ على Linux في CI بمساعدٍ زائفٍ (‏tests/sim/fixtures/wb_fake_helper.mjs)،
// فتُقاسُ بصمةُ المساعدِ والفشلُ المغلقُ وسلامةُ مدخلاتِ ومخرجاتِ البروتوكولِ —
// قبلَ أن يُبنى المساعدُ الحقيقيُّ الذي يفتحُ سياقَ TBS ويغلقه (‏W-P1 بإذنٍ، ثمّ S1/H).
//
// العقدُ (‏كلُّ خرقٍ رفضٌ مسمّى لا صمتٌ):
//   - البصمةُ تُتحقَّقُ قبلَ التشغيل: SHA-256 لملفِّ المساعدِ يطابقُ المثبَّتَ، وإلّا
//     WB_HELPER_FINGERPRINT_MISMATCH، وبلا بصمةٍ مثبَّتةٍ أصلاً WB_HELPER_FINGERPRINT_UNPINNED.
//   - طلبٌ واحدٌ وردٌّ واحدٌ على stdin/stdout: تأطيرُ قناةِ TPM نفسُهُ (sim/tpm/channel_protocol.mjs)
//     — magic/counter/len/payload/crc16 — والردُّ يعيدُ نداءَ الطلبِ (nonce) حرفيًا وإلّا
//     WB_HELPER_NONCE_MISMATCH. أيُّ بايتاتٍ بعدَ الردِّ ⇒ WB_HELPER_EXTRA_OUTPUT.
//   - الفشلُ مغلقٌ: لا مخرجَ، أو إطارٌ تالفٌ (magic/CRC/طول) ⇒ WB_HELPER_BAD_FRAME؛
//     خروجٌ غيرُ الصفرِ ⇒ WB_HELPER_EXIT_<code>؛ أيُّ بايتٍ على stderr ⇒ WB_HELPER_STDERR؛
//     تجاوزُ المهلةِ ⇒ WB_HELPER_TIMEOUT ويُقتَلُ المساعد.
//   - سلامةُ المدخلات: op سلسلةٌ بلا محارفِ تحكّمٍ وبطولٍ محدود، وargs مصفوفةٌ JSON
//     محدودةُ الحجم؛ وأيُّ تجاوزٍ يُرفَضُ قبلَ تشغيلِ المساعدِ (WB_HELPER_REQUEST_*).
//   - لا يُنشئُ المساعدُ الحقيقيُّ إلا الأشكالَ المسموحةَ — التحقّقُ السلوكيُّ (T6) أنّ
//     مساعدًا مزيّفًا لا يملكُ مفتاحَ PolicySigned، وهنا: لا يُقبَلُ ردٌّ إلا مطابقًا
//     للعقدِ كلِّهِ (بصمةٌ + إطارٌ + نداءٌ + خروجٌ صفرٌ + لا stderr).
//
// ليست إنتاجيّةً ولا تُوصَّلُ بمسارِ الإنتاج: أداتُ قياسٍ للتصميمِ (كما sim/freshness-nv).
//
// WL-514 — تصليبٌ بعيوبٍ مقيسةٍ على النسخةِ المدموجةِ (‏docs/decisions/WL-514-production-blockers.md، الجزء 5 §3):
//   - مسارُ المساعدِ مطلقٌ ويُحَلُّ بـrealpath، فالملفُّ المبصومُ هو المُشغَّلُ نفسُه — كانَ `'true'`
//     يُبصَمُ من ‎./true ويُشغَّلُ من PATH ⇒ WB_HELPER_PATH_NOT_ABSOLUTE.
//   - كلُّ ملفٍّ في spawnArgs يُشغِّلُه مفسِّرٌ مبصومٌ يُبصَمُ هو أيضًا (‏spawnArgsSha256)، وإلّا
//     WB_HELPER_ARGS_UNPINNED — كانَ المفسِّرُ مبصومًا والسكربتُ حرًّا.
//   - فشلُ spawn ⇒ WB_HELPER_SPAWN_FAILED (كانَ استثناءً غيرَ ملتقَطٍ يُسقطُ العمليّة)؛ والخروجُ بإشارةٍ
//     ⇒ WB_HELPER_SIGNALLED؛ وstdout محدودٌ بإطارٍ واحدٍ ⇒ WB_HELPER_OUTPUT_TOO_LARGE؛ وعدّادُ الإطارِ 0.
//   - شكلُ الردِّ مغلقٌ: {schema, ok, nonce, op, result|error} حرفيًّا، وop يعيدُ المطلوبَ ⇒ WB_HELPER_BAD_RESPONSE.
//   - رمزُ فشلِ المساعدِ لا يصيرُ رمزَنا: WB_HELPER_REPORTED_FAILURE دائمًا، ورمزُه المنقّى في remoteCode.
//   - **طبقةُ النقلِ لا تحملُ ادّعاءَ دليل:** ردٌّ فيه freshnessProven/productionEligible/hardwareVerified/
//     evidenceClass في أيِّ عمقٍ ⇒ WB_HELPER_EVIDENCE_CLAIM. فالمساعدُ — زائفًا كانَ أو حقيقيًّا — لا يرقّي
//     نتيجتَه إلى «عتاد» أو «حداثةٍ مثبتة»؛ ذاكَ حكمُ المُقيِّمِ والمالكِ لا حمولةُ قناة.

import { spawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { frame, parseMessage, MAX_PAYLOAD } from '../tpm/channel_protocol.mjs';

export const WB_HELPER_SCHEMA = 'xuux.wb-helper/1';
/** مهلةٌ افتراضيّةٌ مبرَّرةٌ بالقياسِ المقيسِ في `WL-507` لإلقاءِ الجثثِ العابرةِ (1–2ms):
 * ألفُ ضعفِها ميزانيّةُ انتظارِ الردِّ؛ تجاوزُها قتلٌ وفشلٌ مغلق. */
export const WB_HELPER_DEFAULT_TIMEOUT_MS = 2000;
export const WB_HELPER_MAX_OP_LEN = 64;
export const WB_HELPER_MAX_ARGS = 16;
export const WB_HELPER_MAX_REQUEST_JSON = 4096;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
/** أقصى مخرجٍ مقبول: إطارٌ واحدٌ بحمولتِه القصوى (‏14 ترويسة + حمولة + 2 CRC). */
export const WB_HELPER_MAX_OUTPUT = 14 + MAX_PAYLOAD + 2;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const REMOTE_CODE = /^[A-Z0-9_]{1,40}$/;
/** مفاتيحُ ادّعاءِ الدليلِ التي لا تحملُها طبقةُ النقل. */
export const WB_HELPER_EVIDENCE_CLAIM_KEYS = Object.freeze([
  'freshnessProven',
  'productionEligible',
  'hardwareVerified',
  'evidenceClass',
]);

/** @param {unknown} value @param {number} depth @returns {string | null} */
function findEvidenceClaim(value, depth = 0) {
  if (depth > 32 || value === null || typeof value !== 'object') return null;
  for (const [k, v] of Object.entries(value)) {
    if (WB_HELPER_EVIDENCE_CLAIM_KEYS.includes(k)) return k;
    const inner = findEvidenceClaim(v, depth + 1);
    if (inner) return inner;
  }
  return null;
}

/** @param {string} [message] @param {string} [code] */
export class WbHelperError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ stderr?: string, remoteCode?: string }} [extra]
   */
  constructor(code, message, extra = {}) {
    super(`${code}: ${message}`);
    this.name = 'WbHelperError';
    this.code = code;
    this.stderr = extra.stderr;
    this.remoteCode = extra.remoteCode;
  }
}

/** @param {string} path @returns {string} */
export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * سلامةُ مدخلاتِ الطلب — تُرفَضُ قبلَ تشغيلِ المساعدِ كلِّه.
 * @param {unknown} op
 * @param {unknown} args
 * @returns {asserts op is string}
 */
export function assertValidRequest(op, args) {
  if (typeof op !== 'string' || op.length === 0 || op.length > WB_HELPER_MAX_OP_LEN) {
    throw new WbHelperError('WB_HELPER_REQUEST_OP_INVALID', `op ليس سلسلةً بحدِّ ${WB_HELPER_MAX_OP_LEN}`);
  }
  if (CONTROL_CHARS.test(op)) {
    throw new WbHelperError('WB_HELPER_REQUEST_OP_INVALID', 'op يحمل محارفَ تحكّم');
  }
  if (!Array.isArray(args) || args.length > WB_HELPER_MAX_ARGS) {
    throw new WbHelperError('WB_HELPER_REQUEST_ARGS_INVALID', `args ليست مصفوفةً بحدِّ ${WB_HELPER_MAX_ARGS}`);
  }
  let json;
  try {
    json = JSON.stringify({ schema: WB_HELPER_SCHEMA, op, args });
  } catch {
    throw new WbHelperError('WB_HELPER_REQUEST_ARGS_INVALID', 'args ليست قابلةً للتسلسل JSON');
  }
  if (Buffer.byteLength(json, 'utf8') > WB_HELPER_MAX_REQUEST_JSON) {
    throw new WbHelperError('WB_HELPER_REQUEST_ARGS_INVALID', `الطلبُ يتجاوزُ ${WB_HELPER_MAX_REQUEST_JSON} بايتًا`);
  }
}

/**
 * تشغيلُ المساعدِ وطلبٌ واحدٌ وردٌّ واحدٌ — فشلٌ مغلقٌ بكلِّ الطرقِ المسمّاةِ أعلاه.
 * @param {{
 *   helperPath: string,
 *   fingerprintSha256: string,
 *   op: string,
 *   args?: unknown[],
 *   timeoutMs?: number,
 *   spawnArgs?: string[],
 *   spawnArgsSha256?: (string | null)[],
 * }} opts
 * @returns {Promise<unknown>} ناتجُ `result` من ردِّ المساعدِ
 */
export async function runWbHelper(opts) {
  const { helperPath, fingerprintSha256, op } = opts;
  const args = opts.args ?? [];
  const timeoutMs = opts.timeoutMs ?? WB_HELPER_DEFAULT_TIMEOUT_MS;
  const spawnArgs = opts.spawnArgs ?? [];

  // (1) سلامةُ المدخلاتِ قبلَ أيِّ تشغيلٍ.
  assertValidRequest(op, args);

  // (2) البصمةُ قبلَ التشغيل: لا مساعدَ بلا مثبَّتٍ، ولا مساعدًا تبدَّلَت بايتاتُه.
  if (typeof fingerprintSha256 !== 'string' || !SHA256_HEX.test(fingerprintSha256)) {
    throw new WbHelperError('WB_HELPER_FINGERPRINT_UNPINNED', 'بصمةُ المساعدِ مثبَّتةً مطلوبةٌ (T6)');
  }
  // المسارُ المطلقُ وحدَه: مسارٌ نسبيٌّ يُبصَمُ من المجلّدِ الحاليِّ ويُشغَّلُ من PATH.
  if (typeof helperPath !== 'string' || !isAbsolute(helperPath)) {
    throw new WbHelperError('WB_HELPER_PATH_NOT_ABSOLUTE', 'مسارُ المساعدِ مطلقٌ مطلوب');
  }
  const resolvedHelper = pinFile(helperPath, fingerprintSha256, 'المساعد');

  // (2ب) ما يشغّلُه مفسِّرٌ مبصومٌ يُبصَمُ هو أيضًا: لكلِّ وسيطٍ بصمةٌ أو null صريح، والأوّلُ مبصومٌ حتمًا.
  const argPins = opts.spawnArgsSha256;
  /** @type {string[]} */
  const resolvedArgs = [];
  if (spawnArgs.length > 0) {
    if (!Array.isArray(argPins) || argPins.length !== spawnArgs.length || typeof argPins[0] !== 'string') {
      throw new WbHelperError('WB_HELPER_ARGS_UNPINNED', 'spawnArgs بلا بصماتٍ مطابقةِ الطول، أو أوّلُها غيرُ مبصوم');
    }
    for (let i = 0; i < spawnArgs.length; i++) {
      const pin = argPins[i];
      if (pin === null) {
        resolvedArgs.push(String(spawnArgs[i]));
        continue;
      }
      if (typeof pin !== 'string' || !SHA256_HEX.test(pin) || !isAbsolute(String(spawnArgs[i]))) {
        throw new WbHelperError('WB_HELPER_ARGS_UNPINNED', `الوسيطُ ${i} بلا بصمةٍ صالحةٍ أو بمسارٍ غيرِ مطلق`);
      }
      resolvedArgs.push(pinFile(String(spawnArgs[i]), pin, `الوسيط ${i}`));
    }
  }

  // (3) الطلب: إطارٌ واحدٌ على stdin ثمّ إغلاقُه.
  const nonce = randomBytes(16).toString('hex');
  const requestPayload = Buffer.from(JSON.stringify({ schema: WB_HELPER_SCHEMA, op, args, nonce }));
  const requestFrame = frame(requestPayload, 0);

  /** @type {import('node:child_process').ChildProcess} */
  const child = spawn(resolvedHelper, resolvedArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
  /** @type {Error | null} */
  let spawnError = null;
  /** @type {string} */
  let stderrText = '';
  /** @type {Buffer[]} */
  const stdoutChunks = [];
  let stdoutBytes = 0;
  let overflow = false;
  let killed = false;
  const timer = setTimeout(() => {
    killed = true;
    child.kill('SIGKILL');
  }, timeoutMs);
  // الإغلاقُ ('close') لا الخروجُ: stdio قد تبقى مفتوحةً بعدَ 'exit'. وفشلُ spawn يُحسَمُ برمزٍ لا باستثناءٍ طليق.
  const closed = new Promise((resolve) => {
    child.once('error', (/** @type {Error} */ e) => {
      spawnError = e;
      resolve({ code: null, signal: null });
    });
    child.once('close', (code, signal) => resolve({ code, signal }));
  });

  child.stderr?.on('data', (/** @type {Buffer} */ d) => {
    stderrText += d.toString('utf8');
    if (stderrText.length > 1024) stderrText = stderrText.slice(0, 1024) + '…';
  });
  child.stdout?.on('data', (/** @type {Buffer} */ d) => {
    if (overflow) return;
    stdoutBytes += d.length;
    if (stdoutBytes > WB_HELPER_MAX_OUTPUT) {
      overflow = true;
      child.kill('SIGKILL');
      return;
    }
    stdoutChunks.push(d);
  });

  /** @param {string} code @param {string} msg @param {{stderr?: string, remoteCode?: string}} [extra] */
  const fail = (code, msg, extra) => {
    clearTimeout(timer);
    if (!killed && child.exitCode === null) child.kill('SIGKILL');
    throw new WbHelperError(code, msg, extra);
  };

  // الطلبُ على stdin ثمّ إغلاقُه؛ انكسارُ الأنبوبِ (خروجٌ مبكرٌ) يُحسمُه رمزُ الخروجِ أدناه.
  await new Promise((resolve) => {
    child.stdin?.once('error', () => resolve(undefined));
    child.stdin?.end(requestFrame, () => resolve(undefined));
  });

  const { code: exitCode, signal } = /** @type {{code: number | null, signal: string | null}} */ (await closed);

  if (spawnError) {
    fail('WB_HELPER_SPAWN_FAILED', `تعذّرَ تشغيلُ المساعد: ${/** @type {any} */ (spawnError).code ?? 'unknown'}`);
  }
  if (overflow) {
    fail('WB_HELPER_OUTPUT_TOO_LARGE', `مخرجُ المساعدِ تجاوزَ ${WB_HELPER_MAX_OUTPUT} بايتًا فقُتل`);
  }
  if (killed) {
    fail('WB_HELPER_TIMEOUT', `لم يردَّ المساعدُ خلالَ ${timeoutMs}ms فقُتل`);
  }
  if (stderrText.length > 0) {
    fail('WB_HELPER_STDERR', 'المساعدُ كتبَ على stderr', { stderr: stderrText });
  }
  if (signal !== null) {
    fail('WB_HELPER_SIGNALLED', `المساعدُ أُنهيَ بإشارةِ ${signal}`);
  }
  if (exitCode !== 0) {
    fail('WB_HELPER_EXIT_' + exitCode, `المساعدُ خرجَ برمزِ ${exitCode}`, { stderr: stderrText });
  }

  // (4) الردُّ: إطارٌ واحدٌ لا زيادةَ عليه، ونداءُ الطلبِ حرفيًا.
  const raw = Buffer.concat(stdoutChunks);
  const parsed = parseMessage(raw);
  if (!parsed.ok) {
    fail('WB_HELPER_BAD_FRAME', `إطارُ الردِّ مرفوض: ${parsed.error ?? 'TOO_SHORT'}`);
  }
  if (parsed.counter !== 0) {
    fail('WB_HELPER_BAD_FRAME', `عدّادُ إطارِ الردِّ ${parsed.counter} لا يطابقُ عدّادَ الطلب 0`);
  }
  const consumed = 14 + (parsed.payload?.length ?? 0) + 2;
  if (raw.length > consumed) {
    fail('WB_HELPER_EXTRA_OUTPUT', `بايتاتٌ بعدَ إطارِ الردِّ (${raw.length} > ${consumed})`);
  }
  /** @type {any} */
  let response;
  try {
    response = JSON.parse(parsed.payload?.toString('utf8') ?? '');
  } catch {
    fail('WB_HELPER_BAD_FRAME', 'حمولةُ الردِّ ليست JSON');
  }
  if (response?.schema !== WB_HELPER_SCHEMA) {
    fail('WB_HELPER_BAD_FRAME', 'حمولةُ الردِّ تحملُ مخططًا غيرَ متّفقٍ عليه');
  }
  if (response?.nonce !== nonce) {
    fail('WB_HELPER_NONCE_MISMATCH', 'الردُّ لا يعيدُ نداءَ الطلبِ');
  }
  // شكلٌ مغلق: مفاتيحُ بعينِها لا زيادةَ عليها، وop يعيدُ المطلوب.
  const keys = Object.keys(response ?? {}).sort().join(',');
  const okShape = 'nonce,ok,op,result,schema';
  const failShape = 'error,nonce,ok,op,schema';
  if (response?.op !== op) {
    fail('WB_HELPER_BAD_RESPONSE', 'الردُّ لا يعيدُ op المطلوب');
  }
  if (response?.ok === true) {
    if (keys !== okShape) fail('WB_HELPER_BAD_RESPONSE', `مفاتيحُ ردِّ النجاحِ ${keys} لا ${okShape}`);
  } else if (response?.ok === false) {
    if (keys !== failShape) fail('WB_HELPER_BAD_RESPONSE', `مفاتيحُ ردِّ الفشلِ ${keys} لا ${failShape}`);
    const remote = typeof response.error === 'string' && REMOTE_CODE.test(response.error) ? response.error : 'UNPARSEABLE';
    fail('WB_HELPER_REPORTED_FAILURE', `المساعدُ أبلغَ فشلًا (remoteCode=${remote})`, { stderr: stderrText, remoteCode: remote });
  } else {
    fail('WB_HELPER_BAD_RESPONSE', 'ok ليسَ قيمةً منطقيّة');
  }
  const claim = findEvidenceClaim(response.result);
  if (claim) {
    fail('WB_HELPER_EVIDENCE_CLAIM', `طبقةُ النقلِ لا تحملُ ادّعاءَ دليل (${claim})`);
  }
  clearTimeout(timer);
  return response.result;
}

/**
 * يُحِلُّ المسارَ إلى ملفٍّ حقيقيٍّ ويبصمُه ويطابقُه، ويعيدُ المسارَ المُحَلَّ الذي يُشغَّل.
 * @param {string} p @param {string} pin @param {string} label @returns {string}
 */
function pinFile(p, pin, label) {
  let real;
  let actual;
  try {
    real = realpathSync(p);
    actual = sha256File(real);
  } catch {
    throw new WbHelperError('WB_HELPER_FINGERPRINT_MISMATCH', `تعذّرت قراءةُ ${label} ${p}`);
  }
  if (actual !== pin) {
    throw new WbHelperError('WB_HELPER_FINGERPRINT_MISMATCH', `بصمةُ ${label} ${actual} لا تطابقُ المثبَّتة`);
  }
  return real;
}

/** تصديرٌ للاختبارِ المباشرِ للتأطيرِ المشترك. */
export { frame as frameForTest, parseMessage as parseMessageForTest, MAX_PAYLOAD };
