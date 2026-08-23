// جذر الثقة — تطبيق العقد على مخزن أسرار خارجي عبر HTTP (M2.02).
//
// هذا هو التطبيق المقصود للإنتاج: المادة لا تقيم على قرص الخدمة، بل تُطلب من
// مخزن أسرار (Vault أو Secrets Manager أو HSM بواجهة HTTP) بتوكن يصل من البيئة.
// لا يُخزَّن التوكن في المستودع، ولا يُطبع، ولا يدخل رسالة خطأ.
//
// حدوده بصراحة: يظل عقد **مادة**، فهو يُخرج السرّ إلى الذاكرة عند الطلب. مخزن
// يمنع الإخراج كليًّا (HSM يوقّع داخله) يُخدَم بعقد توقيع لا بعقد مادة، وذلك
// مسار M2.03 وM2.04. ولذلك `canExport` هنا صحيح ولا يُدَّعى غير ذلك.

import {
  assertKeyMaterial,
  assertKeyName,
  KeyProviderError,
  type KeyProvider,
  type KeyProviderDescription,
  type KeyRecord,
  type PutOptions,
} from './key-provider.mjs';

/** شكل الاستجابة عند قراءة سرّ واحد. */
interface SecretResponse {
  name?: string;
  material?: string;
  createdAt?: string;
}

/** شكل الاستجابة عند جرد الأسرار. */
interface SecretListResponse {
  keys?: KeyRecord[];
}

/** إعداد المخزن الخارجي. كله يصل من البيئة أو من مُنسِّق التشغيل، لا من المستودع. */
export interface RemoteKeyProviderConfig {
  endpoint: string;
  token: string;
  timeoutMs?: number;
  /**
   * السماح بنقل غير مشفَّر. الافتراضي `false`، ولا يُقبل إلا على العنوان المحلي
   * حيث لا تخرج الحزمة من الجهاز — وهي الثغرة التي يستعملها اختبار العقد
   * ليتحدث إلى مخزن حقيقي مُشغَّل في العملية نفسها بلا شبكة خارجية.
   */
  allowInsecureTransport?: boolean;
}

/** المضيفات التي يُقبل عليها النقل غير المشفَّر لأن الحزمة لا تترك الجهاز. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export class RemoteSecretStoreKeyProvider implements KeyProvider {
  readonly endpoint: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly secure: boolean;

  /**
   * @param config - عنوان المخزن وتوكنه ومهلته
   */
  constructor(config: RemoteKeyProviderConfig) {
    if (!config?.endpoint || !config?.token) {
      throw new KeyProviderError('PROVIDER_NOT_CONFIGURED');
    }
    let url: URL;
    try {
      url = new URL(config.endpoint);
    } catch {
      throw new KeyProviderError('PROVIDER_NOT_CONFIGURED');
    }
    this.secure = url.protocol === 'https:';
    const localAllowed =
      config.allowInsecureTransport === true && LOCAL_HOSTS.has(url.hostname.toLowerCase());
    if (!this.secure && !localAllowed) {
      // توكن يمشي على HTTP يُقرأ من الشبكة، فمخزن الأسرار يصير مصدر تسريب.
      throw new KeyProviderError('PROVIDER_NOT_CONFIGURED');
    }
    this.endpoint = config.endpoint.replace(/\/+$/, '');
    this.token = config.token;
    this.timeoutMs = config.timeoutMs ?? 5000;
  }

  describe(): KeyProviderDescription {
    return {
      kind: 'remote-secret-store',
      location: this.endpoint,
      canExport: true,
      // النقل غير المشفَّر مسموح للاختبار المحلي فقط، ولا يُعلَن جاهزاً للإنتاج.
      productionReady: this.secure,
    };
  }

  /**
   * يكتب السرّ في المخزن الخارجي.
   * @param name - اسم المفتاح
   * @param material - المادة السرية
   * @param options - خيارات الكتابة؛ الطمس ممنوع افتراضياً
   * @returns سجل المفتاح دون مادته
   */
  async put(name: string, material: string, options?: PutOptions): Promise<KeyRecord> {
    assertKeyName(name);
    assertKeyMaterial(material);
    const response = await this.request('PUT', `/secrets/${encodeURIComponent(name)}`, {
      material,
      overwrite: options?.overwrite === true,
    });
    if (response.status === 409) throw new KeyProviderError('KEY_ALREADY_EXISTS');
    if (response.status !== 200 && response.status !== 201) {
      throw new KeyProviderError('PROVIDER_UNAVAILABLE');
    }
    const body = (await this.readJson(response)) as SecretResponse;
    return { name, createdAt: body.createdAt ?? new Date().toISOString() };
  }

  /**
   * @param name - اسم المفتاح
   * @returns المادة كما كُتبت حرفاً بحرف
   */
  async get(name: string): Promise<string> {
    assertKeyName(name);
    const response = await this.request('GET', `/secrets/${encodeURIComponent(name)}`);
    if (response.status === 404) throw new KeyProviderError('KEY_NOT_FOUND');
    if (response.status !== 200) throw new KeyProviderError('PROVIDER_UNAVAILABLE');
    const body = (await this.readJson(response)) as SecretResponse;
    if (typeof body.material !== 'string') throw new KeyProviderError('PROVIDER_UNAVAILABLE');
    return body.material;
  }

  /**
   * @param name - اسم المفتاح
   * @returns صحيح إن كان المخزن يعرفه
   */
  async has(name: string): Promise<boolean> {
    assertKeyName(name);
    const response = await this.request('HEAD', `/secrets/${encodeURIComponent(name)}`);
    if (response.status === 200) return true;
    if (response.status === 404) return false;
    throw new KeyProviderError('PROVIDER_UNAVAILABLE');
  }

  /**
   * @returns جرد المفاتيح مرتَّباً بالاسم، بلا مادة
   */
  async list(): Promise<KeyRecord[]> {
    const response = await this.request('GET', '/secrets');
    if (response.status !== 200) throw new KeyProviderError('PROVIDER_UNAVAILABLE');
    const body = (await this.readJson(response)) as SecretListResponse;
    const keys = Array.isArray(body.keys) ? body.keys : [];
    // الترتيب يُفرض هنا ولا يُؤتمن عليه المخزن: العقد يقول «مرتَّب بالاسم».
    return [...keys].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * @param name - اسم المفتاح
   */
  async destroy(name: string): Promise<void> {
    assertKeyName(name);
    const response = await this.request('DELETE', `/secrets/${encodeURIComponent(name)}`);
    if (response.status === 404) throw new KeyProviderError('KEY_NOT_FOUND');
    if (response.status !== 200 && response.status !== 204) {
      throw new KeyProviderError('PROVIDER_UNAVAILABLE');
    }
  }

  /**
   * ينفّذ الطلب بمهلة. كل فشل شبكي أو مهلة يُترجم إلى `PROVIDER_UNAVAILABLE`
   * دون تمرير نص الخطأ الأصلي، لأن نص الخطأ الشبكي قد يحمل العنوان والتوكن.
   * @param method - فعل HTTP
   * @param path - المسار داخل المخزن
   * @param body - جسم الطلب إن وُجد
   * @returns استجابة المخزن
   */
  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(`${this.endpoint}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new KeyProviderError('PROVIDER_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * @param response - استجابة المخزن
   * @returns جسمها المُفكَّك، أو خطأ توفّر إن لم يكن JSON صالحاً
   */
  private async readJson(response: Response): Promise<unknown> {
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new KeyProviderError('PROVIDER_UNAVAILABLE');
    }
  }
}
