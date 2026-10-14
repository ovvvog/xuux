/**
 * وسيطُ TCP بين العامل وPostgres يحقنُ أعطاباً **حقيقيةً** قابلةً للتكرار (`WL-387`).
 *
 * لا محاكاةَ لـ`pg` ولا استبدالَ لدوالّ الطابور: الوسيطُ يقطعُ مقابسَ حقيقيةً ويرفضُ
 * اتصالاتٍ حقيقية، فيرى العاملُ ما يراه في الإنتاج بالضبط (‏`ECONNREFUSED`،
 * «Connection terminated unexpectedly»). والقاعدةُ المشتركةُ لا تُمسّ: الوسيطُ
 * وحدَه يُغلق، فتبقى الاختباراتُ الأخرى على القاعدة سليمة.
 *
 * ثلاثةُ أعطاب:
 * - `down()` / `up()`: لا خادمَ يُصغي ⇒ رفضُ اتصال، وكلُّ مقبسٍ قائمٍ يُقطع.
 * - `severOn(pattern, { mode: 'before' })`: حين يرسل العميلُ بايتاتٍ تحوي النمط
 *   (‏SQL الحجز مثلاً) يُقطع الاتصالُ **قبل** تمريرها — فالمعاملةُ لم تُلتزَم حتماً.
 * - `severOn(pattern, { mode: 'after-commit' })`: يُمرَّر النمطُ، ثم يُمرَّر `COMMIT`
 *   التالي على الاتصالِ نفسِه، ويُقطع الاتصالُ **عند وصولِ ردِّ** الخادم عليه فلا يبلغ
 *   العميل — فالمعاملةُ التُزمت حتماً وضاع ردُّها. وهذا هو «حدُّ الحجز» محدّداً
 *   حتمياً: الخادمُ لا يردُّ على `COMMIT` قبل أن يلتزم.
 *
 * وكلا القطعين يقبل `thenDown: true` فيُغلق الوسيطُ بعدهما، كي لا يُعيد المجمّعُ
 * الاتصالَ في الحال ويخفي الانقطاع.
 */

import net from 'node:net';

/**
 * @param {{ host: string, port: number }} target
 */
export async function startFaultProxy(target) {
  /** @type {Set<net.Socket>} */
  const sockets = new Set();
  /** @type {null | { pattern: Buffer, mode: 'before' | 'after-commit', thenDown: boolean, fired: (() => void) }} */
  let trap = null;
  let port = 0;
  /** @type {net.Server | null} */
  let server = null;
  let connections = 0;

  const COMMIT = Buffer.from('COMMIT');

  /** @param {net.Socket} client */
  function onConnection(client) {
    connections += 1;
    const upstream = net.connect(target.port, target.host);
    sockets.add(client);
    sockets.add(upstream);
    let armedForCommit = false;
    let dropResponse = false;
    const kill = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on('close', () => {
      sockets.delete(client);
      upstream.destroy();
    });
    upstream.on('close', () => {
      sockets.delete(upstream);
      client.destroy();
    });
    client.on('error', () => {});
    upstream.on('error', () => {});

    client.on('data', (chunk) => {
      const current = trap;
      if (current !== null && !armedForCommit && chunk.includes(current.pattern)) {
        if (current.mode === 'before') {
          trap = null;
          kill();
          current.fired();
          return;
        }
        armedForCommit = true;
        upstream.write(chunk);
        return;
      }
      if (armedForCommit && chunk.includes(COMMIT)) {
        dropResponse = true;
        upstream.write(chunk);
        return;
      }
      upstream.write(chunk);
    });
    upstream.on('data', (chunk) => {
      if (dropResponse) {
        // ردُّ الخادم على COMMIT وصل ⇒ الالتزامُ وقع. لا يبلغ العميل.
        const current = trap;
        trap = null;
        kill();
        current?.fired();
        return;
      }
      client.write(chunk);
    });
  }

  async function listen() {
    server = net.createServer(onConnection);
    await new Promise((resolve, reject) => {
      /** @type {net.Server} */ (server).once('error', reject);
      /** @type {net.Server} */ (server).listen(port, '127.0.0.1', () => resolve(undefined));
    });
    const address = /** @type {net.AddressInfo} */ (server.address());
    port = address.port;
  }

  async function down() {
    const closing = server;
    server = null;
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    if (closing !== null) await new Promise((resolve) => closing.close(() => resolve(undefined)));
  }

  await listen();

  return {
    get port() {
      return port;
    },
    get connections() {
      return connections;
    },
    /** @param {string} databaseUrl رابطُ القاعدةِ الأصلُ؛ يُعاد بمنفذِ الوسيط. */
    urlFor(databaseUrl) {
      const url = new URL(databaseUrl);
      url.hostname = '127.0.0.1';
      url.port = String(port);
      return url.toString();
    },
    down,
    async up() {
      if (server === null) await listen();
    },
    /**
     * @param {string} pattern
     * @param {{ mode: 'before' | 'after-commit', thenDown?: boolean }} options
     * @returns {Promise<void>} يُحلّ حين يقع القطع
     */
    severOn(pattern, options) {
      return new Promise((resolve) => {
        trap = {
          pattern: Buffer.from(pattern),
          mode: options.mode,
          thenDown: options.thenDown === true,
          fired: () => {
            if (options.thenDown === true) void down().then(() => resolve(undefined));
            else resolve(undefined);
          },
        };
      });
    },
    async close() {
      trap = null;
      await down();
    },
  };
}
