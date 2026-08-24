/**
 * تحديد مسار أدوات PostgreSQL المستخدَمة في النسخ والاستعادة — إصلاح WL-022.
 *
 * العيب الذي يعالجه هذا الملف: كان `scripts/backup.mjs` و`scripts/restore.mjs`
 * يثبّتان المسار `/usr/bin/pg_dump` نصّاً. وعلى منصّة الفحص كان ذلك المسار يشير
 * إلى عميل الإصدار 16 بينما الخدمة المعلَنة `postgres:18.6-alpine`، و`pg_dump`
 * يرفض قراءة خادمٍ أحدث منه. فصار الفشل حتمياً وغامضاً: رمز خرج 1 من أداة
 * خارجية لا يقول للقارئ إن السبب فرقُ إصدار.
 *
 * فالمعالجة شيئان لا شيء واحد:
 *   1) اختيار الأداة من أعلى إصدار مثبَّت فعلاً (`/usr/lib/postgresql/<n>/bin`)
 *      لا من مسارٍ ثابت، مع إمكان التغلّب عليه بمتغيّر بيئة معلَن.
 *   2) فحص قَبْليّ يقارن الإصدار الأكبر للعميل بالإصدار الأكبر للخادم، فيرفع
 *      خطأً مُسمّى يشرح الإصلاح قبل أن تُنفَّذ الأداة أصلاً.
 *
 * حدٌّ معلن: هذا الملف لا يثبّت شيئاً ولا يحدّث نظام التشغيل؛ إن لم يكن العميل
 * المطابق مثبَّتاً فهو يفشل فشلاً معلناً — وذلك هو المقصود، لأن تثبيت الحِزم من
 * داخل أداة نسخٍ احتياطي بابٌ خلفي لتغيير البيئة بلا قرار.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

/** جذر التثبيت المتعدّد الإصدارات على توزيعات دبيان وأوبنتو. */
export const VERSIONED_ROOT = '/usr/lib/postgresql';

/** المسار الأخير الذي يُجرَّب إن لم يوجد تثبيت متعدّد الإصدارات. */
export const FALLBACK_DIR = '/usr/bin';

export const PG_TOOL_ERRORS = Object.freeze({
  NOT_FOUND: 'PG_TOOL_NOT_FOUND',
  VERSION_UNREADABLE: 'PG_TOOL_VERSION_UNREADABLE',
  CLIENT_OLDER_THAN_SERVER: 'PG_TOOL_CLIENT_OLDER_THAN_SERVER',
});

/** خطأ مُسمّى كي تميّز الأتمتة والبوابات سبب الفشل من رمزه لا من نصّه. */
export class PgToolError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'PgToolError';
    /** @type {string} */
    this.code = code;
  }
}

/**
 * يستخرج الإصدار الأكبر من نصّ إصدار PostgreSQL كما تكتبه الأدوات والخادم:
 * `pg_dump (PostgreSQL) 16.15 (Ubuntu 16.15-1.pgdg24.04+2)` أو `18.6` أو
 * `PostgreSQL 18.6 on x86_64-pc-linux-musl`.
 * @param {string} text
 * @returns {number} الإصدار الأكبر، أو `NaN` إن لم يُقرأ.
 */
export function majorVersionOf(text) {
  if (typeof text !== 'string') return Number.NaN;
  const match = /(?:^|[^\d.])(\d{1,3})(?:\.\d+)*(?:[^\d]|$)/.exec(text.replace(/^\D*/u, ' '));
  if (match === null || match[1] === undefined) return Number.NaN;
  const major = Number.parseInt(match[1], 10);
  return Number.isFinite(major) ? major : Number.NaN;
}

/**
 * أسماء متغيّرات البيئة التي تتغلّب على الاختيار التلقائي.
 * @param {string} tool
 * @returns {string}
 */
export function envVarFor(tool) {
  return tool.toUpperCase();
}

/**
 * يختار مسار الأداة: متغيّر البيئة إن وُجد، ثم أعلى إصدار مثبَّت، ثم `/usr/bin`.
 *
 * الحُقن (`exists` و`listVersions`) موجود للاختبار: قابلية الفحص شرطٌ في هذا
 * المستودع، وأيُّ منطقِ اختيارٍ لا يُختبَر إلا على المنصّة الحقيقية لا يُختبَر.
 * @param {string} tool اسم الأداة، مثل `pg_dump`.
 * @param {{ env?: Record<string, string | undefined>, exists?: (p: string) => boolean, listVersions?: () => string[] }} [deps]
 * @returns {string} مسار مطلق لأداة موجودة.
 */
export function resolvePgTool(tool, deps = {}) {
  const env = deps.env ?? process.env;
  const exists = deps.exists ?? ((p) => fs.existsSync(p));
  const listVersions =
    deps.listVersions ??
    (() => {
      try {
        return fs.readdirSync(VERSIONED_ROOT);
      } catch {
        return [];
      }
    });

  const override = env[envVarFor(tool)];
  if (typeof override === 'string' && override.trim() !== '') {
    if (!exists(override)) {
      throw new PgToolError(
        PG_TOOL_ERRORS.NOT_FOUND,
        `المسار المعلَن في ${envVarFor(tool)} غير موجود: ${override}`,
      );
    }
    return override;
  }

  const versions = listVersions()
    .map((name) => ({ name, major: majorVersionOf(name) }))
    .filter((entry) => Number.isFinite(entry.major))
    .sort((a, b) => b.major - a.major);
  for (const entry of versions) {
    const candidate = path.join(VERSIONED_ROOT, entry.name, 'bin', tool);
    if (exists(candidate)) return candidate;
  }

  const fallback = path.join(FALLBACK_DIR, tool);
  if (exists(fallback)) return fallback;
  throw new PgToolError(
    PG_TOOL_ERRORS.NOT_FOUND,
    `لم توجد الأداة ${tool} لا في ${VERSIONED_ROOT}/<الإصدار>/bin ولا في ${FALLBACK_DIR}. عيّن ${envVarFor(tool)} بمسارها أو ثبّت حزمة عميل PostgreSQL المطابقة لإصدار الخادم.`,
  );
}

/**
 * يقارن إصدار العميل بإصدار الخادم ويرفع خطأً يشرح الإصلاح.
 *
 * الاتجاه واحد مقصود: عميلٌ أحدث من الخادم مقبول (`pg_dump` يقرأ الأقدم)، وعميلٌ
 * أقدم مرفوض قبل التنفيذ لا بعده، لأن الرفض بعد التنفيذ يترك ملفاً ناقصاً على
 * القرص يُظنّ نسخةً.
 * @param {{ toolPath: string, clientVersion: string, serverVersion: string }} input
 * @returns {{ clientMajor: number, serverMajor: number }}
 */
export function assertClientNotOlder({ toolPath, clientVersion, serverVersion }) {
  const clientMajor = majorVersionOf(clientVersion);
  const serverMajor = majorVersionOf(serverVersion);
  if (!Number.isFinite(clientMajor) || !Number.isFinite(serverMajor)) {
    throw new PgToolError(
      PG_TOOL_ERRORS.VERSION_UNREADABLE,
      `لم يُقرأ إصدار: العميل «${clientVersion}» والخادم «${serverVersion}».`,
    );
  }
  if (clientMajor < serverMajor) {
    throw new PgToolError(
      PG_TOOL_ERRORS.CLIENT_OLDER_THAN_SERVER,
      `أداة ${toolPath} إصدارها ${clientMajor} والخادم ${serverMajor}؛ العميل الأقدم يرفض الخادم الأحدث. ثبّت postgresql-client-${serverMajor} أو عيّن ${'PG_DUMP'} و${'PG_RESTORE'} بمسار العميل المطابق.`,
    );
  }
  return { clientMajor, serverMajor };
}

/**
 * يقرأ إصدار الأداة بتشغيل `--version`.
 * @param {string} toolPath
 * @param {(command: string, args: string[]) => Promise<{ code: number, stdout: string, stderr: string }>} [runner]
 * @returns {Promise<string>}
 */
export async function readToolVersion(toolPath, runner = runCapture) {
  const result = await runner(toolPath, ['--version']);
  if (result.code !== 0 || result.stdout.trim() === '') {
    throw new PgToolError(
      PG_TOOL_ERRORS.VERSION_UNREADABLE,
      `فشل قراءة إصدار ${toolPath} برمز ${result.code}: ${result.stderr.trim()}`,
    );
  }
  return result.stdout.trim();
}

/**
 * تشغيل أمرٍ والتقاط خرجه.
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function runCapture(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => resolve({ code: 127, stdout, stderr: String(error) }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
