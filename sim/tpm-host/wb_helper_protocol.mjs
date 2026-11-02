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

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

/** @param {string} [message] @param {string} [code] */
export class WbHelperError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ stderr?: string }} [extra]
   */
  constructor(code, message, extra = {}) {
    super(`${code}: ${message}`);
    this.name = 'WbHelperError';
    this.code = code;
    this.stderr = extra.stderr;
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
  if (json.length > WB_HELPER_MAX_REQUEST_JSON) {
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
  if (typeof fingerprintSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(fingerprintSha256)) {
    throw new WbHelperError('WB_HELPER_FINGERPRINT_UNPINNED', 'بصمةُ المساعدِ مثبَّتةً مطلوبةٌ (T6)');
  }
  let actual;
  try {
    actual = sha256File(helperPath);
  } catch {
    throw new WbHelperError('WB_HELPER_FINGERPRINT_MISMATCH', `تعذّرت قراءةُ المساعدِ ${helperPath}`);
  }
  if (actual !== fingerprintSha256) {
    throw new WbHelperError('WB_HELPER_FINGERPRINT_MISMATCH', `بصمةُ المساعدِ ${actual} لا تطابقُ المثبَّتة`);
  }

  // (3) الطلب: إطارٌ واحدٌ على stdin ثمّ إغلاقُه.
  const nonce = randomBytes(16).toString('hex');
  const requestPayload = Buffer.from(JSON.stringify({ schema: WB_HELPER_SCHEMA, op, args, nonce }));
  const requestFrame = frame(requestPayload, 0);

  /** @type {import('node:child_process').ChildProcess} */
  const child = spawn(helperPath, spawnArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
  /** @type {string} */
  let stderrText = '';
  /** @type {Buffer[]} */
  const stdoutChunks = [];
  let killed = false;
  const timer = setTimeout(() => {
    killed = true;
    child.kill('SIGKILL');
  }, timeoutMs);

  child.stderr?.on('data', (/** @type {Buffer} */ d) => {
    stderrText += d.toString('utf8');
    if (stderrText.length > 1024) stderrText = stderrText.slice(0, 1024) + '…';
  });
  child.stdout?.on('data', (/** @type {Buffer} */ d) => stdoutChunks.push(d));

  /** @param {string} code @param {string} msg @param {{stderr?: string}} [extra] */
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

  const exitCode = await new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve(signal === null ? (code ?? -1) : -1));
  });

  if (killed) {
    fail('WB_HELPER_TIMEOUT', `لم يردَّ المساعدُ خلالَ ${timeoutMs}ms فقُتل`);
  }
  if (stderrText.length > 0) {
    fail('WB_HELPER_STDERR', 'المساعدُ كتبَ على stderr', { stderr: stderrText });
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
  if (response?.ok !== true) {
    const code = typeof response?.error === 'string' ? response.error : 'WB_HELPER_REPORTED_FAILURE';
    fail(code, `المساعدُ أبلغَ فشلًا: ${response?.error ?? 'بلا رمز'}`, { stderr: stderrText });
  }
  clearTimeout(timer);
  return response.result;
}

/** تصديرٌ للاختبارِ المباشرِ للتأطيرِ المشترك. */
export { frame as frameForTest, parseMessage as parseMessageForTest, MAX_PAYLOAD };
