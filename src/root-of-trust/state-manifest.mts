// جذرُ الثقة — بيانُ جذرِ الحالةِ الدائمُ (`WL-094`، إصلاحُ نتائجِ الجولةِ الثانية).
//
// **المشكلةُ التي أوجبَتْه** — أثبتَها عضوا الجولةِ الثانيةِ كلاهما بإعادةِ إنتاجٍ
// على توكنٍ حقيقيّ:
//   1. `UF-01`: حذفُ `events.log` و`events.log.head` معاً يجعلُ الإقلاعَ يبدأُ من
//      `GENESIS` **ويقبلُ حدثاً ملفَّقاً**، لأن لا شيءَ على القرصِ يقولُ «كان هنا
//      سجلٌّ بطولِ كذا». والمرساةُ الموقَّعةُ كانت قدرةً بلا مُلزِمٍ: مصنعُ الإنتاجِ
//      لا يشترطُها أصلاً.
//   2. `UF-03`: حذفُ ثلاثيةِ الإيقافِ (توجيهٌ + تاريخٌ + عهدٌ) يُرجعُ الحالةَ
//      `running` و`epoch=0` بعدَ إيقافٍ سياديّ — لأن حدَّ العهدِ الأعلى كان مخزوناً
//      **داخلَ** ما يُمحى.
//   3. `UF-07`: حذفُ دفترِ الأوامرِ ومجلَّدِ حجوزاتِه معاً يُعيدُ قبولَ أمرٍ ثُبِّت.
//
// والجامعُ بين الثلاثةِ واحدٌ: **كلُّ شاهدٍ كان يسكنُ ما يشهدُ عليه**. فمن ملكَ
// حذفَ المشهودِ ملكَ حذفَ الشاهدِ معه، فلا يبقى تناقضٌ يُكشَف.
//
// **ما تفعلُه هذه الوحدةُ:** ملفٌّ واحدٌ في جذرِ الحالةِ — خارجَ ملفِّ السجلِّ
// ورأسِه، وخارجَ مجلَّدِ `halt/`، وخارجَ الدفترِ ومجلَّدِ حجوزاتِه — يحملُ ثلاثةَ
// حدودٍ عليا **لا تتراجعُ**: عَدَّ المرساةِ، وعهدَ الإيقافِ، وعَدَّ الأوامرِ
// المُثبَّتة. ويحملُ معها **هويةَ الملكِ** التي هُيِّئ بها الجذرُ، فتوكنٌ بديلٌ
// بالاسمِ نفسِه يُرفَض (`UF-05`).
//
// **حدٌّ يُصرَّحُ به لا يُخفى:** هذا الملفُّ على القرصِ نفسِه. فهو يكشفُ كلَّ محوٍ
// **جزئيٍّ** — وهو عينُ ما أثبتَه العضوانِ — ويُفشِلُ الإقلاعَ فشلاً مغلقاً. أمّا
// محوُ جذرِ الحالةِ **كلِّه** فيصيرُ «جذراً غيرَ مُهيَّأٍ»: يتوقّفُ الإقلاعُ ويلزمُ
// إعلانُ تهيئةٍ صريحٌ من البيئةِ، فلا تكفي صلاحيةُ الكتابةِ على القرصِ وحدَها
// لإرجاعِ دولةٍ موقوفةٍ إلى العملِ. والحدُّ الأعلى — مرساةٌ داخلَ التوكنِ — يبقى
// مفتوحاً مُعلَناً، إذ يقتضي كتابةً في التوكنِ.

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

/** اسمُ الملفِّ في جذرِ الحالةِ — مثبَّتٌ كي لا يُخترَع في موضعينِ. */
export const STATE_MANIFEST_FILE = 'root-of-trust.manifest.json';

/** المتغيّرُ الذي يُعلَنُ به إذنُ التهيئةِ — إعلانٌ لا استنباط. */
export const STATE_PROVISION_ENV = 'XUUX_ROOT_OF_TRUST_PROVISION';

/** أخطاءُ البيانِ، مثبَّتةٌ نصاً كي تُختبرَ ولا تُخمَّن. */
export const StateManifestErrorCodes = [
  'STATE_ROOT_UNPROVISIONED',
  'STATE_MANIFEST_CORRUPT',
  'STATE_MANIFEST_KING_MISMATCH',
  'STATE_MANIFEST_REGRESSION',
  'STATE_PROVISION_NOT_DECLARED',
] as const;

export type StateManifestErrorCode = (typeof StateManifestErrorCodes)[number];

/** خطأُ البيان: رسالتُه رمزُه، وتفصيلُه أسماءٌ وأعدادٌ لا أسرار. */
export class StateManifestError extends Error {
  readonly code: StateManifestErrorCode;
  readonly detail?: string;

  /**
   * @param code - رمزُ الخطأ
   * @param detail - تفصيلٌ يُقرأُ برمجياً، بلا قيمةِ سرٍّ فيه
   */
  constructor(code: StateManifestErrorCode, detail?: string) {
    super(code);
    this.name = 'StateManifestError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

/** متنُ البيانِ كما يُحفَظُ. لا يحملُ مادةَ مفتاحٍ ولا سرّاً. */
export interface StateManifestBody {
  version: 1;
  /** هويةُ الملكِ التي هُيِّئ بها الجذرُ — بصمةُ مفتاحٍ عامٍّ لا مادةٌ خاصّة. */
  kingId: string;
  createdAt: string;
  /** أعلى عَدِّ أحداثٍ شهدَتْ له مرساةٌ موقَّعة. */
  anchoredCount: number;
  /** أعلى عهدِ إيقافٍ بلغَتْه الدولةُ. */
  haltEpoch: number;
  /** أعلى عَدِّ أوامرَ مُثبَّتةٍ في الدفتر. */
  ledgerCommitted: number;
}

/** حدٌّ أدنى دائمٌ: يُقرأُ ويُرفَعُ ولا يُخفَض. عقدٌ بنيويٌّ كي يُحقَنَ في الاختبار. */
export interface MonotonicFloor {
  read(): number;
  raise(value: number): void;
}

/**
 * يقرأُ إعلانَ إذنِ التهيئةِ من البيئةِ. الإذنُ **يُعلَن** ولا يُستنبَطُ من
 * فراغِ القرصِ: جذرٌ ممحوٌّ وجذرٌ جديدٌ لا يُفرَّقانِ بالنظرِ إلى القرصِ وحدَه.
 * @param env - البيئةُ المقروءة
 * @returns هل أُعلِنَ الإذن
 */
export function stateProvisionDeclared(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env[STATE_PROVISION_ENV] ?? '').trim() === '1';
}

/**
 * يبني مسارَ البيانِ من جذرِ الحالة.
 * @param root - جذرُ الحالة
 * @returns مسارُ الملف
 */
export function stateManifestPath(root: string): string {
  return join(root, STATE_MANIFEST_FILE);
}

/**
 * بيانُ جذرِ الحالةِ: قراءةٌ ورفعٌ فقط. لا تخفيضَ ولا حذفَ — عن قصد.
 */
export class StateManifest {
  readonly location: string;
  #fsync: boolean;

  /**
   * @param file - مسارُ ملفِّ البيان
   * @param options - مزامنةُ القرصِ بعدَ كلِّ كتابة
   */
  constructor(file: string, options: { fsync?: boolean } = {}) {
    this.location = file;
    this.#fsync = options.fsync ?? true;
  }

  /**
   * هل البيانُ موجودٌ على القرصِ الآن؟ يُقرأُ في كلِّ نداءٍ بلا ذاكرةٍ مؤقّتةٍ،
   * لأن عمليةً أخرى قد تكون حذفَتْه قبلَ جزءٍ من الثانية.
   * @returns وجودُه
   */
  exists(): boolean {
    return existsSync(this.location);
  }

  /**
   * يقرأُ البيانَ. غيابُه **ليس حالةً افتراضيّةً**: جذرٌ غيرُ مُهيَّأٍ فشلٌ مغلقٌ
   * لا صفرٌ صامتٌ. وأيُّ عطبٍ في متنِه عبثٌ لا انقطاعٌ، فيُرفَعُ برمزِه.
   * @returns متنُ البيان
   */
  read(): StateManifestBody {
    if (!existsSync(this.location)) {
      throw new StateManifestError('STATE_ROOT_UNPROVISIONED', this.location);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.location, 'utf8'));
    } catch {
      throw new StateManifestError('STATE_MANIFEST_CORRUPT', 'تعذّر التحليل');
    }
    const body = parsed as Partial<StateManifestBody>;
    if (
      body.version !== 1 ||
      typeof body.kingId !== 'string' ||
      body.kingId.length === 0 ||
      typeof body.createdAt !== 'string' ||
      !Number.isSafeInteger(body.anchoredCount) ||
      !Number.isSafeInteger(body.haltEpoch) ||
      !Number.isSafeInteger(body.ledgerCommitted) ||
      (body.anchoredCount as number) < 0 ||
      (body.haltEpoch as number) < 0 ||
      (body.ledgerCommitted as number) < 0
    ) {
      throw new StateManifestError('STATE_MANIFEST_CORRUPT', 'حقولٌ ناقصةٌ أو غيرُ صحيحة');
    }
    return body as StateManifestBody;
  }

  /**
   * يقابلُ هويةَ الملكِ الحاضرةَ بالتي هُيِّئ بها الجذرُ. توكنٌ بديلٌ بالاسمِ
   * نفسِه يحملُ مفتاحاً آخرَ ⇒ هويةٌ أخرى ⇒ رفضٌ (‏`UF-05`).
   * @param kingId - هويةُ الملكِ الحاضرة
   */
  assertKing(kingId: string): void {
    const body = this.read();
    if (body.kingId !== kingId) {
      throw new StateManifestError('STATE_MANIFEST_KING_MISMATCH', `يُنتظَرُ ${body.kingId}`);
    }
  }

  /**
   * يُهيّئ جذرَ الحالةِ إن لم يكن مُهيَّأً، ويُلزِمُ إعلانَ الإذنِ قبلَ ذلك. وإن
   * كان مُهيَّأً فلا يُكتَبُ شيءٌ ويُقابَلُ الملكُ وحدَه — فالتهيئةُ لا تُعاد.
   * @param kingId - هويةُ الملكِ الحاضرة
   * @param env - البيئةُ المقروءة
   */
  provision(kingId: string, env: NodeJS.ProcessEnv = process.env): void {
    if (existsSync(this.location)) {
      this.assertKing(kingId);
      return;
    }
    if (!stateProvisionDeclared(env)) {
      throw new StateManifestError('STATE_PROVISION_NOT_DECLARED', STATE_PROVISION_ENV);
    }
    this.#write({
      version: 1,
      kingId,
      createdAt: new Date().toISOString(),
      anchoredCount: 0,
      haltEpoch: 0,
      ledgerCommitted: 0,
    });
  }

  /**
   * يرفعُ حدّاً أعلى. القيمةُ الأدنى **تُهمَل بلا خطأ** (فقراءةٌ متأخّرةٌ ليست
   * عبثاً)، أمّا الأدنى المطلوبُ فرضاً فيُرفَضُ من `#lower`.
   * @param key - الحدُّ المرفوع
   * @param value - القيمةُ الجديدة
   */
  raise(key: 'anchoredCount' | 'haltEpoch' | 'ledgerCommitted', value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new StateManifestError('STATE_MANIFEST_REGRESSION', `${key}=${String(value)}`);
    }
    const body = this.read();
    if (value <= body[key]) return;
    this.#write({ ...body, [key]: value });
  }

  /**
   * حدُّ عهدِ الإيقافِ كواجهةٍ صغيرةٍ تُحقَنُ في `HaltSwitch` بلا اقترانٍ بالوحدة.
   * @returns الحدُّ الأدنى الدائم
   */
  haltEpochFloor(): MonotonicFloor {
    return {
      read: (): number => this.read().haltEpoch,
      raise: (value: number): void => this.raise('haltEpoch', value),
    };
  }

  /**
   * شاهدُ عَدِّ الأوامرِ المُثبَّتةِ كواجهةٍ صغيرةٍ تُحقَنُ في `CommandLedger`.
   * @returns الحدُّ الأدنى الدائم
   */
  ledgerWitness(): MonotonicFloor {
    return {
      read: (): number => this.read().ledgerCommitted,
      raise: (value: number): void => this.raise('ledgerCommitted', value),
    };
  }

  /**
   * كتابةٌ ذريّةٌ: ملفٌّ مؤقّتٌ ثم `rename`. فانقطاعٌ في منتصفِ الكتابةِ لا يترك
   * بياناً نصفَ مكتوبٍ يُقرأُ «عطباً» فيُغلَقُ بابُ إقلاعٍ سليم.
   * @param body - المتنُ المكتوب
   */
  #write(body: StateManifestBody): void {
    mkdirSync(dirname(this.location), { recursive: true });
    const temporary = `${this.location}.tmp-${String(process.pid)}`;
    const line = Buffer.from(JSON.stringify(body, null, 2) + '\n', 'utf8');
    const fd = openSync(temporary, 'w');
    try {
      let written = 0;
      while (written < line.length) written += writeSync(fd, line, written);
      if (this.#fsync) fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, this.location);
  }
}
