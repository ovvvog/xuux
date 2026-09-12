/**
 * إنهاءُ TLS لبابِ الدولةِ — الشطرُ الباقي من الدَينِ `D-1`.
 *
 * نصُّ الدَينِ في `docs/REMAINING_WORK.md` عن `M9.03`: «لا طبقةَ نقلٍ (HTTP/TLS)».
 * وقد سُدِّدَ شطرُ `HTTP` في `WL-124`، وبقيَ `TLS` مُعلَناً في كلِّ ردٍّ بترويسةِ
 * `x-state-transport: plaintext; terminate-tls-upstream`. وهذه الوحدةُ تُنهيه.
 *
 * ## لماذا وحدةٌ منفصلةٌ ولا شهادةٌ في المستودعِ
 *
 * **لا مادّةَ سرِّيّةً في هذه الشفرةِ ولا في المستودعِ.** الشهادةُ والمفتاحُ
 * يُقرآنِ من **مسارَي ملفَّينِ مُعلَنَينِ في البيئةِ** لا من نصٍّ مُضمَّنٍ ولا من
 * وسيطٍ افتراضيٍّ: مفتاحٌ في مستودعٍ مُسرَّبٌ من يومِ كتابتِه، ومفتاحٌ في متغيّرِ
 * بيئةٍ نصّاً يُقرأُ في قائمةِ العمليّاتِ وفي تقريرِ عَطَبٍ.
 *
 * ## العهودُ المُثبَّتةُ — وكلُّها مقيسةٌ في `tests/transport/tls.test.mjs`
 *
 * 1. **`rejectUnauthorized: true` مُثبَّتٌ حرفيّاً** في خيارِ العميلِ وفي تحقُّقِ
 *    الطرفِ المُقابِلِ، **ولا يُحسَبُ ولا يُمرَّرُ من وسيطٍ ولا من بيئةٍ**. خيارٌ
 *    واحدٌ يُسقِطُ التحقُّقَ يُستَعمَلُ يومَ يضيقُ الوقتُ **ويبقى**.
 * 2. **لا سبيلَ إلى تعطيلِ التحقُّقِ:** لا عَلَمَ `insecure`، ولا `--no-verify`،
 *    ولا قراءةَ لـ`NODE_TLS_REJECT_UNAUTHORIZED`. وإن وجدتْه الوحدةُ مُعطَّلاً في
 *    البيئةِ **رفضتِ التشغيلَ** ولم تُكمِلْ: عمليّةٌ يُعطَّلُ فيها تحقُّقُ TLS عالميّاً
 *    لا يُصلِحُها خيارٌ صحيحٌ في وحدةٍ واحدةٍ.
 * 3. **لا رجوعَ إلى نصٍّ صريحٍ (fallback):** إن نقصتْ مادّةُ TLS **لا يُنشَأُ
 *    خادمٌ** — لا خادمٌ غيرُ مُشفَّرٍ «مؤقّتاً». والرجوعُ الصامتُ إلى النصِّ الصريحِ
 *    أخطرُ من الفشلِ، لأنّ المُنادي يظنُّ نفسَه في قناةٍ مُعمّاةٍ وهو في العراءِ.
 * 4. **جهةُ إصدارٍ مُعلَنةٌ لا مُخمَّنةٌ:** `STATE_TLS_CA_FILE` تُضافُ إلى المخزنِ
 *    الموثوقِ عندَ التحقُّقِ. ومَن لزمتْه جهةُ إصدارٍ خاصّةٌ **أعلَنَها فوَصَلَ
 *    بتحقُّقٍ كاملٍ**، لا أسقطَ التحقُّقَ ليمرَّ — وهو نفسُ الدرسِ الذي أُغلِقَ في
 *    `src/persistence/db.mjs` للقاعدةِ (`D-12`).
 * 5. **أدنى إصدارٍ مُعلَنٌ `TLSv1.2`، والمُفضَّلُ `TLSv1.3`:** إصداراتٌ أقدمُ فيها
 *    عَيبٌ معروفٌ، وتركُ الأدنى للافتراضِ يجعلُ أمنَ القناةِ تابعاً لنسخةِ Node.
 */

import fs from 'node:fs';
import https from 'node:https';
import process from 'node:process';

/** رموزُ رفضِ إعدادِ TLS. مُعلَنةٌ كي تُترجَمَ ولا تُخمَّنَ. */
export const TLS_ERRORS = Object.freeze({
  CERT_MISSING: 'TLS_CERT_MISSING',
  KEY_MISSING: 'TLS_KEY_MISSING',
  MATERIAL_UNREADABLE: 'TLS_MATERIAL_UNREADABLE',
  CA_UNREADABLE: 'TLS_CA_UNREADABLE',
  VERIFICATION_DISABLED: 'TLS_VERIFICATION_DISABLED',
});

/** خطأُ إعدادِ TLS. ورسالتُه **لا تحملُ مادّةً سرِّيّةً** بحالٍ: مساراتٌ لا مفاتيحُ. */
export class TransportTlsError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'TransportTlsError';
    /** @type {string} */
    this.code = code;
  }
}

/** أدنى إصدارِ بروتوكولٍ مقبولٌ — مُعلَنٌ لا متروكٌ لافتراضِ المُشغِّلِ. */
export const MIN_TLS_VERSION = 'TLSv1.2';

/**
 * يَرفضُ التشغيلَ إن كان تحقُّقُ TLS مُعطَّلاً في العمليّةِ كلِّها.
 *
 * `NODE_TLS_REJECT_UNAUTHORIZED=0` يُبطِلُ تحقُّقَ الشهاداتِ في **كلِّ** وصلةٍ
 * تُنشِئُها هذه العمليّةُ. فوحدةٌ تُثبِّتُ `rejectUnauthorized: true` ثمّ تعملُ في
 * عمليّةٍ كهذه تُعطي **إيهامَ تحقُّقٍ**، وهو أسوأُ من انعدامِه. فالفشلُ مُغلَقٌ.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {void}
 */
export function assertVerificationEnabled(env = process.env) {
  const raw = env['NODE_TLS_REJECT_UNAUTHORIZED'];
  if (raw === undefined) return;
  if (raw.trim() === '0') {
    throw new TransportTlsError(
      TLS_ERRORS.VERIFICATION_DISABLED,
      'NODE_TLS_REJECT_UNAUTHORIZED=0 يُبطِلُ تحقُّقَ الشهاداتِ في العمليّةِ كلِّها: لا تُنهى TLS في عمليّةٍ عُطِّلَ فيها التحقُّقُ.',
    );
  }
}

/**
 * يقرأُ ملفّاً مُعلَناً ويُفشِلُ مُغلَقاً إن أُعلِنَ ما لا يُقرأُ أو ما ليس PEM.
 *
 * والرسالةُ تحملُ **المسارَ والسببَ ولا تحملُ المحتوى**: نصُّ خطأٍ يُطبَعُ في
 * سجلٍّ، ومفتاحٌ خاصٌّ في سجلٍّ مُسرَّبٌ لكلِّ من يقرأُ السجلَّ.
 * @param {string} file
 * @param {string} variable اسمُ المتغيّرِ المُعلَنِ — يُذكَرُ في الرسالةِ.
 * @param {string} marker الوسمُ المُنتظَرُ في PEM.
 * @param {string} code
 * @returns {Buffer}
 */
function readPem(file, variable, marker, code) {
  /** @type {Buffer} */
  let content;
  try {
    content = fs.readFileSync(file);
  } catch (error) {
    throw new TransportTlsError(
      code,
      `${variable} مُعلَنٌ ولا يُقرأُ: ${file} — ${/** @type {Error} */ (error).message}`,
    );
  }
  // الفحصُ على أوّلِ ٢ ك.ب فقط: الوسمُ في رأسِ الملفِّ، وقراءةُ الملفِّ كلِّه نصّاً
  // لأجلِ فحصٍ تُنشِئُ نسخةً ثانيةً من المفتاحِ في الذاكرةِ بلا حاجةٍ.
  const head = content.subarray(0, 2048).toString('utf8');
  if (!head.includes(marker)) {
    throw new TransportTlsError(code, `${variable} لا يحملُ ${marker} بصيغةِ PEM: ${file}`);
  }
  return content;
}

/**
 * يَحُلُّ شهادةَ جهةِ الإصدارِ الموثوقةِ إن أُعلِنتْ.
 *
 * **مسارُ ملفٍّ لا نصٌّ في البيئةِ**: النصُّ في متغيّرِ بيئةٍ يُقرأُ في قائمةِ
 * العمليّاتِ وفي تقاريرِ العَطَبِ. وغيابُها **ليس عَيباً**: فمعناه الاعتمادُ على
 * المخزنِ الموثوقِ في النظامِ، وهو تحقُّقٌ كاملٌ لا إسقاطٌ له.
 * @param {object} [options]
 * @param {string} [options.caFile]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {Buffer | null}
 */
export function resolveTrustedAuthority(options = {}) {
  const env = options.env ?? process.env;
  const declared = options.caFile ?? env['STATE_TLS_CA_FILE'];
  if (typeof declared !== 'string' || declared.trim() === '') return null;
  return readPem(
    declared.trim(),
    'STATE_TLS_CA_FILE',
    'BEGIN CERTIFICATE',
    TLS_ERRORS.CA_UNREADABLE,
  );
}

/**
 * خياراتُ عميلٍ يَصِلُ ببابِ الدولةِ **بتحقُّقٍ كاملٍ**.
 *
 * `rejectUnauthorized: true` **مكتوبٌ حرفيّاً هنا ولا يُمرَّرُ**: لو كان وسيطاً
 * لصارَ لكلِّ نادٍ سبيلٌ إلى إسقاطِه، ولو كان محسوباً لصارَ قابلاً لأن يصيرَ
 * `false` بمتغيّرِ بيئةٍ. ومَن لزمتْه جهةُ إصدارٍ خاصّةٌ أعلنَها في
 * `STATE_TLS_CA_FILE`.
 * @param {object} [options]
 * @param {string} [options.caFile]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {{ rejectUnauthorized: true, minVersion: 'TLSv1.2', ca?: Buffer }}
 */
export function secureClientOptions(options = {}) {
  assertVerificationEnabled(options.env ?? process.env);
  const ca = resolveTrustedAuthority(options);
  return {
    rejectUnauthorized: true,
    minVersion: MIN_TLS_VERSION,
    ...(ca === null ? {} : { ca }),
  };
}

/**
 * يَحُلُّ مادّةَ TLS للخادمِ من مساراتٍ مُعلَنةٍ.
 * @param {object} [options]
 * @param {string} [options.certFile]
 * @param {string} [options.keyFile]
 * @param {string} [options.caFile]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {{ cert: Buffer, key: Buffer, ca: Buffer | null }}
 */
export function resolveServerTlsMaterial(options = {}) {
  const env = options.env ?? process.env;
  assertVerificationEnabled(env);

  const certFile = (options.certFile ?? env['STATE_TLS_CERT_FILE'] ?? '').trim();
  if (certFile === '') {
    throw new TransportTlsError(
      TLS_ERRORS.CERT_MISSING,
      'STATE_TLS_CERT_FILE غيرُ مُعلَنٍ: لا شهادةَ افتراضيّةً في هذا المشروعِ، ولا خادمَ بلا شهادةٍ.',
    );
  }
  const keyFile = (options.keyFile ?? env['STATE_TLS_KEY_FILE'] ?? '').trim();
  if (keyFile === '') {
    throw new TransportTlsError(
      TLS_ERRORS.KEY_MISSING,
      'STATE_TLS_KEY_FILE غيرُ مُعلَنٍ: شهادةٌ بلا مفتاحٍ لا تُنهي TLS.',
    );
  }

  const cert = readPem(
    certFile,
    'STATE_TLS_CERT_FILE',
    'BEGIN CERTIFICATE',
    TLS_ERRORS.MATERIAL_UNREADABLE,
  );
  // الوسمُ `BEGIN` وحدَه لأنّ المفتاحَ يأتي `PRIVATE KEY` أو `RSA PRIVATE KEY`
  // أو `EC PRIVATE KEY`؛ ورفضُ صيغةٍ صحيحةٍ يدفعُ المُشغِّلَ إلى حلولٍ أسوأَ.
  const key = readPem(keyFile, 'STATE_TLS_KEY_FILE', 'PRIVATE KEY', TLS_ERRORS.MATERIAL_UNREADABLE);
  const ca = resolveTrustedAuthority({
    ...(options.caFile === undefined ? {} : { caFile: options.caFile }),
    env,
  });
  return { cert, key, ca };
}

/**
 * يُنشِئُ خادمَ الدولةِ **مُنهياً لـTLS في موضعِه**.
 *
 * ولا رجوعَ إلى نصٍّ صريحٍ: إن نقصتِ المادّةُ رُفِعَ الخطأُ ولم يُنشَأْ خادمٌ.
 * وإن أُعلِنتْ جهةُ إصدارٍ في `STATE_TLS_CA_FILE` **طُلِبتْ شهادةُ العميلِ
 * وتُحقَّقتْ** (`requestCert` مع `rejectUnauthorized: true`) — أي أنّ إعلانَ جهةِ
 * إصدارٍ يُشدِّدُ ولا يُرخِّصُ.
 * @param {object} options
 * @param {(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => void} options.handler
 * @param {string} [options.certFile]
 * @param {string} [options.keyFile]
 * @param {string} [options.caFile]
 * @param {boolean} [options.requestClientCertificate] طلبُ شهادةِ عميلٍ (افتراضُه: عندَ إعلانِ جهةِ إصدارٍ).
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {https.Server}
 */
export function createTlsServer(options) {
  const material = resolveServerTlsMaterial({
    ...(options.certFile === undefined ? {} : { certFile: options.certFile }),
    ...(options.keyFile === undefined ? {} : { keyFile: options.keyFile }),
    ...(options.caFile === undefined ? {} : { caFile: options.caFile }),
    ...(options.env === undefined ? {} : { env: options.env }),
  });
  const requestCert = options.requestClientCertificate ?? material.ca !== null;
  return https.createServer(
    {
      cert: material.cert,
      key: material.key,
      minVersion: MIN_TLS_VERSION,
      honorCipherOrder: true,
      // `rejectUnauthorized: true` حرفيٌّ: لا يُحسَبُ ولا يُقرأُ من بيئةٍ. وأثرُه
      // مشروطٌ بـ`requestCert` بحكمِ Node، فالتشديدُ يقعُ حينَ تُعلَنُ جهةُ إصدارٍ.
      rejectUnauthorized: true,
      requestCert,
      ...(material.ca === null ? {} : { ca: material.ca }),
    },
    options.handler,
  );
}
