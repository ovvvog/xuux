// مخزن أسرار مُشغَّل للاختبار — أُخرج من اختبار عقد M2.02 في M2.03.
//
// لماذا مُشترك: صار له مستهلكان — اختبار عقد المخزن (M2.02) واختبار ربط مفتاح
// الملك (M2.03). ونسخُه في الملفين كان سيُنتج مخزنين يتفارق سلوكهما، فيصير
// «نجح الاختبار» عن مخزنين مختلفين لا عن عقد واحد.
//
// هذا ليس ملف اختبار: نمط التشغيل `tests/*/*.test.mjs` لا يجمعه، ويُستورد فقط.

import { createServer } from 'node:http';

/**
 * يُشغّل مخزن أسرار بسيط لكنه حقيقي: يفرض التوكن، ويُرجع 409 عند وجود السرّ،
 * و404 عند غيابه، ويُرجع الجرد **بترتيب معاكس** كي يُثبت أن العميل هو من يفرض
 * الترتيب الذي يعِد به العقد.
 * @param {string} token - التوكن المتوقَّع في ترويسة التفويض
 * @returns {Promise<{ origin: string, close: () => Promise<void>, count: () => number }>}
 */
export async function startSecretStore(token) {
  /** @type {Map<string, { material: string, createdAt: string }>} */
  const vault = new Map();

  const server = createServer((req, res) => {
    /**
     * @param {number} status - رمز الحالة
     * @param {unknown} [body] - الجسم إن وُجد
     */
    const send = (status, body) => {
      const payload = body === undefined ? '' : JSON.stringify(body);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(req.method === 'HEAD' ? undefined : payload);
    };

    if (req.headers.authorization !== `Bearer ${token}`)
      return send(401, { error: 'unauthorized' });

    const url = new URL(req.url ?? '/', 'http://store.local');
    const match = /^\/secrets\/(.+)$/.exec(url.pathname);
    const name = match?.[1] === undefined ? null : decodeURIComponent(match[1]);

    if (req.method === 'GET' && url.pathname === '/secrets') {
      const keys = [...vault.entries()]
        .map(([key, value]) => ({ name: key, createdAt: value.createdAt }))
        .sort((a, b) => b.name.localeCompare(a.name));
      return send(200, { keys });
    }
    if (name === null) return send(404, { error: 'not_found' });

    if (req.method === 'HEAD') return send(vault.has(name) ? 200 : 404);
    if (req.method === 'GET') {
      const found = vault.get(name);
      return found === undefined
        ? send(404, { error: 'not_found' })
        : send(200, { name, material: found.material, createdAt: found.createdAt });
    }
    if (req.method === 'DELETE') {
      if (!vault.delete(name)) return send(404, { error: 'not_found' });
      return send(204);
    }
    if (req.method === 'PUT') {
      /** @type {Buffer[]} */
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const body = /** @type {{ material?: string, overwrite?: boolean }} */ (
          JSON.parse(Buffer.concat(chunks).toString('utf8'))
        );
        if (vault.has(name) && body.overwrite !== true) return send(409, { error: 'exists' });
        const createdAt = new Date().toISOString();
        vault.set(name, { material: String(body.material), createdAt });
        return send(201, { name, createdAt });
      });
      return undefined;
    }
    return send(405, { error: 'method_not_allowed' });
  });

  await new Promise((resolve) => {
    server.listen({ port: 0, host: '127.0.0.1' }, () => resolve(undefined));
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
    count: () => vault.size,
  };
}
