// اختبارات الفشل المطلوبة في P0 (الخطوة M2.09) — خمس حالات من الستّ:
// انقطاع الشبكة، فشل التخزين، هوية مغشوشة، توقيع تالف، أمر منتهي الصلاحية.
// الحالة السادسة (انزياح الساعة) في `clock.test.mjs` لأنها تحتاج حقن ساعتين.
//
// القاعدة الحاكمة لهذا الملف: كل حالة تُفشِل النظام **فعلاً** — خادم HTTP حقيقي
// يُعطَب، ومسار على القرص تُنزع صلاحيته، وشهادة تُلفَّق بسلطة تصديق أخرى — ثم
// يُثبت الاختبار أن الرفض واقع، وأن رمزه معلوم، وأن الرفض لم يُتلف حالةً
// مشروعة. فمحاكاة الفشل بكائن مزيّف تُثبت أن الكائن المزيّف يعمل، لا النظام.
// التشغيل: node --test tests/root-of-trust/failure-modes.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CertificateAuthority,
  CommandLedger,
  CrownGateway,
  EventLog,
  FileAnchorStore,
  HaltSwitch,
  KingIdentity,
  PersistentEventLog,
  PolicyEngine,
  RemoteSecretStoreKeyProvider,
  createAnchor,
  createRoyalCommand,
  describeKingKeyBinding,
  loadKingIdentity,
  provisionKingKey,
} from '../../src/root-of-trust/index.mjs';

/** @param {() => unknown} fn @returns {Error} */
function capture(fn) {
  try {
    fn();
  } catch (error) {
    return /** @type {Error} */ (error);
  }
  throw new Error('كان يجب أن يفشل ولم يفشل');
}

/** @param {() => Promise<unknown>} fn @returns {Promise<Error>} */
async function captureAsync(fn) {
  try {
    await fn();
  } catch (error) {
    return /** @type {Error} */ (error);
  }
  throw new Error('كان يجب أن يفشل ولم يفشل');
}

function scratch() {
  return mkdtempSync(join(tmpdir(), 'failure-'));
}

/** ملكية جاهزة: ملك وسلطة تصديق وسجل وبوابة. */
function crown(/** @type {Record<string, unknown>} */ options = {}) {
  const king = new KingIdentity();
  const ca = new CertificateAuthority(king);
  const log = new EventLog();
  return { king, ca, log, gateway: new CrownGateway(king, ca, log, options) };
}

// ═══════════════════════════════ ١) انقطاع الشبكة ═══════════════════════════

/**
 * خادم حقيقي مُعطَّب على أنحاء مختلفة: كلها انقطاعُ خدمة من منظور العميل، وكلها
 * يجب أن تُقرأ رمزاً واحداً لا نصوصاً متفرقة.
 * @param {'hang' | 'reset' | 'error' | 'garbage' | 'empty-body'} mode
 */
async function startBrokenStore(mode) {
  /** @type {Set<import('node:net').Socket>} */
  const sockets = new Set();
  const server = createServer((_request, response) => {
    if (mode === 'hang') return; // لا يرد أبداً ⇒ يجب أن تقطعه المهلة
    if (mode === 'reset') {
      response.socket?.destroy();
      return;
    }
    if (mode === 'error') {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'unavailable' }));
      return;
    }
    if (mode === 'garbage') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('<html>proxy interception page</html>');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ name: 'king-signing-key' })); // بلا مادة
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve(undefined));
      }),
  };
}

/** @param {string} origin */
function remoteProvider(origin) {
  return new RemoteSecretStoreKeyProvider({
    endpoint: origin,
    token: 'test-token-not-a-secret',
    timeoutMs: 250,
    allowInsecureTransport: true,
  });
}

test('انقطاع الشبكة بكل أنحائه يُقرأ PROVIDER_UNAVAILABLE لا نصاً شبكياً', async () => {
  for (const mode of /** @type {const} */ (['hang', 'reset', 'error', 'garbage', 'empty-body'])) {
    const store = await startBrokenStore(mode);
    const provider = remoteProvider(store.origin);
    try {
      const error = await captureAsync(() => provider.get('king-signing-key'));
      assert.equal(error.message, 'PROVIDER_UNAVAILABLE', `النحو: ${mode}`);
      // ولا يتسرّب التوكن ولا العنوان في نص الخطأ: نص الخطأ الشبكي يحمل كليهما.
      assert.ok(!String(error.stack).includes('test-token-not-a-secret'));
    } finally {
      await store.close();
    }
  }
});

test('مخزن ميت (لا خادم أصلاً) يُقرأ انقطاعاً لا انهياراً', async () => {
  const store = await startBrokenStore('error');
  const origin = store.origin;
  await store.close(); // المنفذ صار مغلقاً: ECONNREFUSED
  const provider = remoteProvider(origin);
  assert.equal((await captureAsync(() => provider.has('any'))).message, 'PROVIDER_UNAVAILABLE');
  assert.equal((await captureAsync(() => provider.list())).message, 'PROVIDER_UNAVAILABLE');
  assert.equal(
    (await captureAsync(() => provider.put('k', 'material'))).message,
    'PROVIDER_UNAVAILABLE',
  );
  assert.equal((await captureAsync(() => provider.destroy('k'))).message, 'PROVIDER_UNAVAILABLE');
});

test('انقطاع الشبكة لا يُولّد ملكاً جديداً ولا يُقرأ «المفتاح غير مُهيَّأ»', async () => {
  const store = await startBrokenStore('hang');
  try {
    const provider = remoteProvider(store.origin);
    // الخطر: لو قُرئ الانقطاع «غياباً» لصار كل انقطاع شبكة يُنتج ملكاً جديداً،
    // فتنشأ دولتان بمفتاحين وكلٌّ تراه الشرعي.
    assert.equal(
      (await captureAsync(() => loadKingIdentity(provider))).message,
      'PROVIDER_UNAVAILABLE',
    );
    assert.equal(
      (await captureAsync(() => provisionKingKey(provider))).message,
      'PROVIDER_UNAVAILABLE',
    );
    assert.equal(
      (await captureAsync(() => describeKingKeyBinding(provider))).message,
      'PROVIDER_UNAVAILABLE',
    );
  } finally {
    await store.close();
  }
});

// ═══════════════════════════════ ٢) فشل التخزين ═════════════════════════════

/** مجلد مقروء غير قابل للكتابة، ثم يُفتح في التنظيف كي يُحذف. */
function lockedDirectory() {
  const root = scratch();
  const locked = join(root, 'locked');
  mkdirSync(locked);
  chmodSync(locked, 0o500);
  return {
    path: locked,
    release: () => {
      chmodSync(locked, 0o700);
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('السجل الدائم يفشل مُغلقاً عند تعذّر الكتابة ولا يزعم تثبيتاً', () => {
  const dir = lockedDirectory();
  try {
    const error = capture(() =>
      new PersistentEventLog(join(dir.path, 'log.jsonl')).append('e', 'k', {}),
    );
    const errno = /** @type {NodeJS.ErrnoException} */ (error);
    assert.ok(/EACCES|EPERM|LOG_/.test(`${errno.message}${errno.code ?? ''}`));
  } finally {
    dir.release();
  }
});

test('دفتر الأوامر والمرساة والإيقاف الشامل كلها تفشل مُغلقة عند تعذّر الكتابة', () => {
  const dir = lockedDirectory();
  try {
    const command = createRoyalCommand('inspect', 'agent:one');
    assert.ok(capture(() => new CommandLedger(join(dir.path, 'l.jsonl')).begin(command)));
    const king = new KingIdentity();
    const record = createAnchor({ count: 3, lastHash: 'hash-of-third-event' }, null, king);
    assert.ok(capture(() => new FileAnchorStore(join(dir.path, 'a.jsonl')).append(record)));
    assert.ok(
      capture(() => {
        const halt = new HaltSwitch(join(dir.path, 'halt.json'), king);
        halt.registerNode('node:one');
      }),
    );
  } finally {
    dir.release();
  }
});

test('فشل تخزين السجل لا يُحرق معرّف الأمر — يبقى قابلاً لإعادة الإرسال', () => {
  const root = scratch();
  try {
    const king = new KingIdentity();
    const ledger = new CommandLedger(join(root, 'commands.jsonl'));
    let failNext = true;
    const log = new EventLog();
    const brittle = {
      /**
       * @param {string} type @param {string} actor @param {object} data
       */
      append(type, actor, data) {
        if (failNext) {
          failNext = false;
          throw new Error('DISK_FULL');
        }
        return log.append(type, actor, data);
      },
      events: log.events,
    };
    const gateway = new CrownGateway(
      king,
      new CertificateAuthority(king),
      /** @type {never} */ (brittle),
      { commandLedger: ledger },
    );
    const command = createRoyalCommand('inspect', 'agent:one');
    const signature = king.sign(command);
    assert.equal(capture(() => gateway.command(command, signature)).message, 'DISK_FULL');
    // الأمر لم يُنفَّذ، فلا يجوز أن يكون قد صار «مستهلكاً»: إعادة الإرسال تنجح.
    const accepted = gateway.command(command, signature);
    assert.equal(accepted.id, command.id);
    assert.equal(ledger.state(command.id), 'committed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('رفض السياسة لا يُحرق معرّف الأمر: تفويض أصحّ يُقبل بالمعرّف نفسه', () => {
  const king = new KingIdentity();
  const ca = new CertificateAuthority(king);
  const policy = new PolicyEngine();
  policy.setRole('observer', ['action:inspect']);
  policy.setRole('regent', ['sovereign:delegate']);
  const gateway = new CrownGateway(king, ca, new EventLog(), { policy });
  const weak = {
    ...createRoyalCommand('change-policy', 'state'),
    certificate: ca.issue('agent:one', 'observer', ['action:inspect']),
  };
  assert.equal(capture(() => gateway.command(weak, king.sign(weak))).message, 'POLICY_DENIED');
  const strong = { ...weak, certificate: ca.issue('agent:one', 'regent', ['sovereign:delegate']) };
  assert.equal(gateway.command(strong, king.sign(strong)).id, weak.id);
});

// ═══════════════════════════════ ٣) هوية مغشوشة ═════════════════════════════

test('شهادة من سلطة تصديق أخرى تُرفض FORGED_CERTIFICATE', () => {
  const { king, gateway } = crown({ policy: new PolicyEngine() });
  const usurper = new KingIdentity();
  const rogue = new CertificateAuthority(usurper).issue('agent:one', 'regent', [
    'sovereign:delegate',
  ]);
  const command = { ...createRoyalCommand('change-policy', 'state'), certificate: rogue };
  // التوقيع الملكي على الأمر صحيح — المغشوش هو التفويض داخله.
  assert.equal(
    capture(() => gateway.command(command, king.sign(command))).message,
    'FORGED_CERTIFICATE',
  );
});

test('ترقية الدور أو القدرات في شهادة صحيحة تُبطلها', () => {
  const { king, ca, gateway } = crown({ policy: new PolicyEngine() });
  const honest = ca.issue('agent:one', 'observer', ['action:inspect']);
  for (const tampered of [
    { ...honest, role: 'regent' },
    { ...honest, capabilities: [...honest.capabilities, 'sovereign:delegate'] },
    { ...honest, subject: 'agent:two' },
    { ...honest, signature: ca.issue('agent:one', 'observer', []).signature },
  ]) {
    assert.equal(ca.isValid(tampered), false);
    const command = { ...createRoyalCommand('change-policy', 'state'), certificate: tampered };
    assert.equal(
      capture(() => gateway.command(command, king.sign(command))).message,
      'FORGED_CERTIFICATE',
    );
  }
  assert.equal(ca.isValid(honest), true);
});

test('شهادة مسحوبة تُرفض ولو كان توقيعها سليماً', () => {
  const { king, ca, gateway } = crown({ policy: new PolicyEngine() });
  const cert = ca.issue('agent:one', 'regent', ['sovereign:delegate']);
  const first = { ...createRoyalCommand('change-policy', 'state'), certificate: cert };
  assert.ok(gateway.command(first, king.sign(first)).acceptedAt);
  ca.revoke(cert.id, 'انتهى تفويض الوكيل');
  const second = { ...createRoyalCommand('change-policy', 'state'), certificate: cert };
  assert.equal(
    capture(() => gateway.command(second, king.sign(second))).message,
    'FORGED_CERTIFICATE',
  );
});

test('شهادة ناقصة أو ليست كائناً تُقرأ باطلة ولا تُسقط الفاحص', () => {
  const { ca } = crown();
  for (const bad of [null, undefined, 'شهادة', 42, {}, { id: 7 }, []]) {
    assert.equal(ca.isValid(/** @type {never} */ (bad)), false);
  }
});

// ═══════════════════════════════ ٤) توقيع تالف ══════════════════════════════

test('التوقيع التالف بكل أشكاله يُرفض INVALID_ROYAL_SIGNATURE بلا انهيار', () => {
  const { king, gateway } = crown();
  const command = createRoyalCommand('inspect', 'agent:one');
  const good = king.sign(command);
  for (const bad of [
    '',
    'ليس توقيعاً',
    good.slice(0, good.length - 4),
    good.slice(4),
    `${good}AAAA`,
    good.replace(/^./, good[0] === 'A' ? 'B' : 'A'),
    Buffer.from('0'.repeat(64)).toString('base64url'),
  ]) {
    assert.equal(
      capture(() => gateway.command(command, /** @type {string} */ (bad))).message,
      'INVALID_ROYAL_SIGNATURE',
    );
  }
  // ولا نوع خاطئ يُخرج خطأً من نوع آخر.
  for (const bad of [null, undefined, 42, {}]) {
    assert.equal(
      capture(() => gateway.command(command, /** @type {never} */ (bad))).message,
      'INVALID_ROYAL_SIGNATURE',
    );
  }
  // وبعد كل هذا الرفض يبقى التوقيع الصحيح مقبولاً بالمعرّف نفسه.
  assert.equal(gateway.command(command, good).id, command.id);
});

test('توقيع صحيح لأمر آخر لا يُجيز هذا الأمر', () => {
  const { king, gateway } = crown();
  const first = createRoyalCommand('inspect', 'agent:one');
  const second = createRoyalCommand('inspect', 'agent:two');
  assert.equal(
    capture(() => gateway.command(second, king.sign(first))).message,
    'INVALID_ROYAL_SIGNATURE',
  );
});

test('توقيع ملك آخر لا يُجيز أمراً في هذه الدولة', () => {
  const { gateway } = crown();
  const usurper = new KingIdentity();
  const command = createRoyalCommand('inspect', 'agent:one');
  assert.equal(
    capture(() => gateway.command(command, usurper.sign(command))).message,
    'INVALID_ROYAL_SIGNATURE',
  );
});

// ═══════════════════════════════ ٥) أمر منتهي الصلاحية ══════════════════════

/** @param {number} ageMs */
function agedCommand(ageMs) {
  return {
    ...createRoyalCommand('inspect', 'agent:one'),
    issuedAt: new Date(Date.now() - ageMs).toISOString(),
  };
}

test('الأمر المنتهي يُرفض EXPIRED_COMMAND، والحدّ نفسه مقبول', () => {
  const { king, gateway } = crown({ maxCommandAgeMs: 1000, clockSkewMs: 100 });
  const expired = agedCommand(5000);
  assert.equal(
    capture(() => gateway.command(expired, king.sign(expired))).message,
    'EXPIRED_COMMAND',
  );
  const fresh = agedCommand(0);
  assert.ok(gateway.command(fresh, king.sign(fresh)).acceptedAt);
});

test('أمر من المستقبل خارج حدّ الانزياح يُرفض FUTURE_COMMAND', () => {
  const { king, gateway } = crown({ clockSkewMs: 1000 });
  const ahead = {
    ...createRoyalCommand('inspect', 'agent:one'),
    issuedAt: new Date(Date.now() + 60_000).toISOString(),
  };
  assert.equal(capture(() => gateway.command(ahead, king.sign(ahead))).message, 'FUTURE_COMMAND');
  const withinSkew = {
    ...createRoyalCommand('inspect', 'agent:one'),
    issuedAt: new Date(Date.now() + 200).toISOString(),
  };
  assert.ok(gateway.command(withinSkew, king.sign(withinSkew)).acceptedAt);
});

test('زمن غير قابل للقراءة يُرفض INVALID_COMMAND_TIME ولا يُقرأ صفراً', () => {
  const { king, gateway } = crown();
  for (const issuedAt of ['الآن', '2026-13-45T99:99:99Z', 'NaN']) {
    const command = { ...createRoyalCommand('inspect', 'agent:one'), issuedAt };
    assert.equal(
      capture(() => gateway.command(command, king.sign(command))).message,
      'INVALID_COMMAND_TIME',
    );
  }
  // والزمن الفارغ يُرفض قبل ذلك بفحص صحة الحقول: رفضان لا تناقض، والمهم أن
  // لا يمرّ أمرٌ بزمنٍ لا يُقرأ.
  const empty = { ...createRoyalCommand('inspect', 'agent:one'), issuedAt: '' };
  assert.equal(capture(() => gateway.command(empty, king.sign(empty))).message, 'INVALID_COMMAND');
});

test('رفض الانتهاء لا يُحرق المعرّف: أمر مُعاد إصداره بالمعرّف نفسه يُقبل', () => {
  const root = scratch();
  try {
    const king = new KingIdentity();
    const ledger = new CommandLedger(join(root, 'commands.jsonl'));
    const gateway = new CrownGateway(king, new CertificateAuthority(king), new EventLog(), {
      commandLedger: ledger,
      maxCommandAgeMs: 1000,
    });
    const stale = agedCommand(9000);
    assert.equal(
      capture(() => gateway.command(stale, king.sign(stale))).message,
      'EXPIRED_COMMAND',
    );
    assert.equal(ledger.has(stale.id), false);
    const reissued = { ...stale, issuedAt: new Date().toISOString() };
    assert.equal(gateway.command(reissued, king.sign(reissued)).id, stale.id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('الأمر المنتهي يبقى مرفوضاً ولو أُعيد إرساله مراراً — لا نافذة تسرُّب', () => {
  const { king, gateway } = crown({ maxCommandAgeMs: 500 });
  const expired = agedCommand(4000);
  const signature = king.sign(expired);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(capture(() => gateway.command(expired, signature)).message, 'EXPIRED_COMMAND');
  }
});

// ═══════════════ تكامل: ساعة مرجوعة إلى الوراء لا تُحيي أمراً منتهياً ═══════

test('ساعة مرجوعة إلى الوراء لا تُحيي أمراً منتهي الصلاحية عبر البوابة', () => {
  const king = new KingIdentity();
  const expired = agedCommand(600_000); // منتهٍ بعشرة أضعاف الحدّ الافتراضي
  const signature = king.sign(expired);

  // ساعة الجهاز العارية: المهاجم يُرجعها فيصير الأمر «حديثاً» ويُقبل.
  const naive = new CrownGateway(king, new CertificateAuthority(king), new EventLog(), {});
  assert.equal(capture(() => naive.command(expired, signature)).message, 'EXPIRED_COMMAND');
  // الرجوع مقدَّر: يُدخل الأمر داخل نافذة العمر المقبولة (‏٥ دقائق) بلا أن
  // يُخرجه إلى «المستقبل» فيُرفض بسبب آخر — أي أنه أنجح رجوعٍ ممكن للمهاجم.
  const rolledBack = { now: () => Date.now() - 500_000, assertTrusted: () => undefined };
  const fooled = new CrownGateway(king, new CertificateAuthority(king), new EventLog(), {
    clock: rolledBack,
  });
  assert.ok(fooled.command(expired, signature).acceptedAt); // هذا هو الخطر عياناً

  // وساعة تكشف انزياحها ترفع خطأها قبل أن يُحسب العمر، فلا قبول ولا استهلاك.
  const detecting = {
    now: () => {
      throw new Error('CLOCK_SKEW_DETECTED');
    },
    assertTrusted: () => {
      throw new Error('CLOCK_SKEW_DETECTED');
    },
  };
  const guarded = new CrownGateway(king, new CertificateAuthority(king), new EventLog(), {
    clock: detecting,
  });
  assert.equal(capture(() => guarded.command(expired, signature)).message, 'CLOCK_SKEW_DETECTED');
  assert.equal(guarded.seenCommands.has(expired.id), false);
});

test('حالة على القرص مكتوبة بيد غير النظام لا تُقرأ ثقةً', () => {
  const root = scratch();
  try {
    const path = join(root, 'commands.jsonl');
    writeFileSync(path, 'ليس سطر JSON\n');
    assert.ok(capture(() => new CommandLedger(path)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
