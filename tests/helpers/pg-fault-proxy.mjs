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
 *
 * و`thenRefuseDatabase: name` (‏`WL-627`): بعدَ القطعِ يُرفَضُ كلُّ اتصالٍ **جديدٍ** تُسمّي حزمةُ بدئِه القاعدةَ
 * `name` (‏مقبسٌ يُغلَقُ حالَ وصولِها)، وتبقى الاتصالاتُ القائمةُ والاتصالاتُ إلى غيرِها — فالسؤالُ عن نتيجةِ
 * `COMMIT` على الهدفِ يتعذّرُ ووصلةُ الإدارةِ حيّة. (‏بلا TLS: الحزمةُ نصٌّ يُرى.)
 *
 * و`severOn(pattern, { mode: 'stall' })` (‏`WL-629`): **انقطاعٌ صامت** لا قطع — البايتاتُ التي تحوي النمطَ لا تُمرَّر،
 * ولا شيءَ بعدَها في الاتجاهين، والمقبسان مفتوحان: العميلُ لا يرى خطأً ولا نهاية (‏كشبكةٍ تُسقِطُ الحزمَ بصمت)،
 * والخادمُ ينتظرُ ما لا يصل. وإغلاقُ أيِّ طرفٍ لا يبلغُ الآخر (‏حتى `close()`). و`thenStallDatabase: name`: كلُّ اتصالٍ
 * **جديدٍ** إلى `name` بعدَها يُقبَلُ ويُبتلَعُ بلا ردّ.
 */

import net from 'node:net';

/**
 * @param {{ host: string, port: number }} target
 */
export async function startFaultProxy(target) {
  /** @type {Set<net.Socket>} */
  const sockets = new Set();
  /** @type {null | { pattern: Buffer, mode: 'before' | 'after-commit' | 'stall', thenDown: boolean, fired: (() => void) }} */
  let trap = null;
  let port = 0;
  /** @type {net.Server | null} */
  let server = null;
  let connections = 0;
  /** @type {Buffer | null} */
  let refuseStartup = null;
  /** @type {Buffer | null} */
  let stallStartup = null;

  const COMMIT = Buffer.from('COMMIT');

  /** @param {net.Socket} client */
  function onConnection(client) {
    connections += 1;
    const upstream = net.connect(target.port, target.host);
    sockets.add(client);
    sockets.add(upstream);
    let armedForCommit = false;
    let dropResponse = false;
    let startup = true;
    let stalled = false;
    const kill = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on('close', () => {
      sockets.delete(client);
      // ‏انقطاعٌ صامت: موتُ العميلِ لا يبلغُ الخادم (‏لا FIN ولا RST) — الخلفيّةُ تبقى تنتظرُ حتى حدِّ خمولِها.
      if (!stalled) upstream.destroy();
    });
    upstream.on('close', () => {
      sockets.delete(upstream);
      // ‏انقطاعٌ صامت: إغلاقُ الخادمِ لا يبلغُ العميل.
      if (!stalled) client.destroy();
    });
    client.on('error', () => {});
    upstream.on('error', () => {});

    client.on('data', (chunk) => {
      if (startup) {
        startup = false;
        if (refuseStartup !== null && chunk.includes(refuseStartup)) {
          kill();
          return;
        }
        if (stallStartup !== null && chunk.includes(stallStartup)) {
          stalled = true;
          return;
        }
      }
      if (stalled) return;
      const current = trap;
      if (current !== null && !armedForCommit && chunk.includes(current.pattern)) {
        if (current.mode === 'stall') {
          trap = null;
          stalled = true;
          current.fired();
          return;
        }
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
      if (stalled) return;
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
     * @param {{ mode: 'before' | 'after-commit' | 'stall', thenDown?: boolean, thenRefuseDatabase?: string, thenStallDatabase?: string }} options
     * @returns {Promise<void>} يُحلّ حين يقع القطع
     */
    severOn(pattern, options) {
      return new Promise((resolve) => {
        trap = {
          pattern: Buffer.from(pattern),
          mode: options.mode,
          thenDown: options.thenDown === true,
          fired: () => {
            if (options.thenRefuseDatabase !== undefined) {
              refuseStartup = Buffer.from(`database\0${options.thenRefuseDatabase}\0`);
            }
            if (options.thenStallDatabase !== undefined) {
              stallStartup = Buffer.from(`database\0${options.thenStallDatabase}\0`);
            }
            if (options.thenDown === true) void down().then(() => resolve(undefined));
            else resolve(undefined);
          },
        };
      });
    },
    async close() {
      trap = null;
      refuseStartup = null;
      stallStartup = null;
      await down();
    },
  };
}
