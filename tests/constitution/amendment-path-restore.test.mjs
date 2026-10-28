// WL-484 — استرجاعُ الطروحِ الدستوريّةِ بعدَ إعادةِ التشغيل (R6-A-05، شطرُ المقترحات).
//
// قبلَ الإصلاح (مُعادٌ إنتاجُهُ على main@2ea0b8c7 بالعمليّةِ المستقلّةِ نفسِها):
//   - طرحٌ مُراجَعٌ يختفي بإعادةِ التشغيل: `review`/`ratify` ⇒ CONSTITUTION_PROPOSAL_UNKNOWN؛
//   - وأمرُ الطرحِ المستهلَكُ **يُقبَلُ ثانيةً** فيُنتجُ طرحاً جديداً بأمرٍ ملكيٍّ واحد.
// والاختبارُ الأوّلُ أدناه هوَ ذلك السيناريو نفسُهُ بعمليّاتٍ منفصلة.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CertificateAuthority,
  CrownGateway,
  EventLog,
  KingIdentity,
} from '../../src/root-of-trust/index.mjs';
import { ConstitutionStore, loadConstitutionPolicy } from '../../src/constitution/constitution.mjs';
import {
  AMENDMENT_ERRORS,
  AmendmentPath,
  ProposalState,
} from '../../src/constitution/amendment-path.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHILD = path.join(HERE, 'fixtures', 'amendment-restart-child.mjs');
const T0 = 1_790_000_000_000;
const WEEK_PLUS = 700_000_000;

/**
 * @param {string} dir
 * @param {string} phase
 * @param {number} at
 * @returns {Record<string, any>}
 */
function child(dir, phase, at) {
  const out = execFileSync(process.execPath, [CHILD, phase, dir], {
    env: { ...process.env, NODE_ENV: 'test', XUUX_TEST_NOW_MS: String(at) },
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split('\n').at(-1) ?? '{}');
}

/** @param {(dir: string) => void} body */
function withDir(body) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'xuux-amend-restore-'));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('R6-A-05/1: طرحٌ مُراجَعٌ متوافقٌ ينجو من إعادةِ التشغيلِ ويُبرَمُ بعدَها — بعمليّاتٍ منفصلة', () => {
  withDir((dir) => {
    const proposed = child(dir, 'propose', T0);
    assert.equal(proposed.proposal.state, ProposalState.PROPOSED);
    assert.deepEqual(child(dir, 'review-compatible', T0 + 1000).review, {
      ok: true,
      value: 'reviewed',
    });
    const seen = child(dir, 'inspect', T0 + 2000);
    assert.equal(seen.known, true);
    assert.equal(seen.state, ProposalState.REVIEWED);
    // المهلةُ تُقاسُ من وقتِ الطرحِ الأصليِّ لا من وقتِ الإقلاع
    assert.equal(seen.proposedAt, new Date(T0).toISOString());
    assert.equal(seen.reviewer, 'judge:chief');
    const ratified = child(dir, 'ratify', T0 + WEEK_PLUS);
    assert.deepEqual(ratified.ratify, { ok: true, value: 2 });
    assert.deepEqual(ratified.ratifiedWithoutWitness, []);
    const after = child(dir, 'inspect', T0 + WEEK_PLUS + 1000);
    assert.equal(after.state, ProposalState.RATIFIED);
  });
});

test('R6-A-05/2: أمرُ الطرحِ المستهلَكُ لا يُقبَلُ ثانيةً بعدَ إعادةِ التشغيل', () => {
  withDir((dir) => {
    child(dir, 'propose', T0);
    const seen = child(dir, 'inspect', T0 + 1000);
    assert.deepEqual(seen.replay, { ok: false, code: AMENDMENT_ERRORS.COMMAND_REPLAYED });
  });
});

test('R6-A-05/3: حكمُ التعارضِ ينجو من إعادةِ التشغيلِ فلا يُحيا الطرحُ المرفوض', () => {
  withDir((dir) => {
    child(dir, 'propose', T0);
    assert.deepEqual(child(dir, 'review-conflict', T0 + 1000).review, {
      ok: true,
      value: 'refused',
    });
    assert.equal(child(dir, 'inspect', T0 + 2000).state, ProposalState.REFUSED);
    const ratified = child(dir, 'ratify', T0 + WEEK_PLUS);
    assert.deepEqual(ratified.ratify, { ok: false, code: AMENDMENT_ERRORS.REVIEW_CONFLICT });
    assert.equal(ratified.epoch, 1);
  });
});

test('R6-A-05/4: طرحٌ لم يُراجَعْ ينجو ويبقى محتاجاً إلى المراجعة (لا قفزَ عن الخطوة)', () => {
  withDir((dir) => {
    child(dir, 'propose', T0);
    const seen = child(dir, 'inspect', T0 + 1000);
    assert.equal(seen.state, ProposalState.PROPOSED);
    const ratified = child(dir, 'ratify', T0 + WEEK_PLUS);
    assert.deepEqual(ratified.ratify, { ok: false, code: AMENDMENT_ERRORS.REVIEW_MISSING });
  });
});

test('التكرار: إعادةُ التشغيلِ مراراً حتميّةٌ ولا تكتبُ في السجلِّ شيئاً', () => {
  withDir((dir) => {
    child(dir, 'propose', T0);
    child(dir, 'review-compatible', T0 + 1000);
    const logFile = path.join(dir, 'events.jsonl');
    // `inspect` يحاولُ إعادةَ الأمرِ فيُسجِّلُ رفضاً؛ فنقيسُ الأحداثَ غيرَ الرفضِ
    const nonRefusal = () =>
      readFileSync(logFile, 'utf8')
        .trim()
        .split('\n')
        .filter((line) => !line.includes('constitution.amendment.refused')).length;
    const before = nonRefusal();
    const states = [1, 2, 3].map((i) => child(dir, 'inspect', T0 + 2000 + i).state);
    assert.deepEqual(states, [
      ProposalState.REVIEWED,
      ProposalState.REVIEWED,
      ProposalState.REVIEWED,
    ]);
    assert.equal(nonRefusal(), before, 'الإقلاعُ قراءةٌ لا واقعة');
  });
});

test('الفساد: تعديلُ متنِ حدثِ الطرحِ على القرصِ يُسقِطُ الإقلاعَ مغلقاً', () => {
  withDir((dir) => {
    child(dir, 'propose', T0);
    const logFile = path.join(dir, 'events.jsonl');
    const tampered = readFileSync(logFile, 'utf8').replace(
      'مفتاحُ الملك أصلُ',
      'مفتاحُ الوزير أصلُ',
    );
    writeFileSync(logFile, tampered);
    const boot = child(dir, 'inspect', T0 + 1000);
    // السجلُّ الدائمُ يكشفُ الكسرَ عندَ تحميلِه، أو يكشفُهُ الاسترجاعُ — والحصيلةُ رفض.
    assert.equal(boot.boot?.ok ?? false, false, JSON.stringify(boot));
  });
});

// —— حالاتٌ في العمليّةِ نفسِها: شهودٌ مزوَّرةٌ بسلسلةٍ سليمة ——

function env() {
  const king = new KingIdentity();
  const log = new EventLog();
  const gateway = new CrownGateway(king, new CertificateAuthority(king), log);
  const policy = loadConstitutionPolicy();
  let clock = new Date(T0);
  const now = () => clock;
  const dir = mkdtempSync(path.join(os.tmpdir(), 'xuux-amend-restore-mem-'));
  const store = new ConstitutionStore({ policy, signer: king, dir, now });
  const crown = { id: king.id, roles: ['role:king'] };
  const justice = { id: 'judge:chief', roles: ['role:chief-justice'] };
  /** @param {string} action @param {string} target @param {object} [payload] */
  const issue = (action, target, payload = {}) => {
    const body = {
      id: `cmd:${randomUUID()}`,
      action,
      target,
      payload,
      issuedAt: new Date().toISOString(),
    };
    return gateway.command(body, king.sign(body));
  };
  const make = () => new AmendmentPath({ policy, store, log, now });
  const TEXT =
    'مفتاحُ الملك أصلُ كلِّ تحقُّقٍ في الدولة، ويُحفظ في وحدةِ عتادٍ لا في ملفٍّ على قرص، وتدويرُه فعلٌ سياديٌّ يُعاد به توقيعُ كلِّ عهدٍ سابق.';
  const REASON = 'حفظُ المفتاح في ملفٍّ صار أضعفَ حلقةٍ في جذر الثقة، ويلزم رفعُه إلى عتادٍ معزول.';
  const OPINION = 'التعديلُ يشدّ المادةَ ولا يخالف مادةً مختومةً؛ فهو متوافقٌ مع النصّ.';
  const advance = (/** @type {number} */ ms) => {
    clock = new Date(clock.getTime() + ms);
  };
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  return {
    king,
    log,
    policy,
    store,
    crown,
    justice,
    issue,
    make,
    TEXT,
    REASON,
    OPINION,
    advance,
    now,
    dir,
    cleanup,
  };
}

/** @param {() => unknown} fn @param {string} code */
const throwsCode = (fn, code) => assert.throws(fn, (/** @type {any} */ e) => e.code === code);

test('الفساد: حدثُ طرحٍ مزوَّرُ الحقولِ بسلسلةٍ سليمةٍ — التجزئةُ لا تطابق ⇒ WITNESS_INVALID', () => {
  const e = env();
  try {
    const path1 = e.make();
    const p = path1.propose({
      actor: e.crown,
      articleId: 'art:03',
      text: e.TEXT,
      reason: e.REASON,
      command: e.issue(e.policy.amendment.proposeAction, 'art:03'),
    });
    // مُزوِّرٌ يملكُ الإلحاقَ يكتبُ طرحاً بالمعرّفِ نفسِهِ ونصٍّ آخر
    e.log.append('constitution.amendment.proposed', e.crown.id, {
      proposalId: p.id,
      articleId: 'art:03',
      proposalHash: p.proposalHash,
      epoch: 1,
      commandId: 'cmd:forged',
      reason: e.REASON,
      text: e.TEXT + ' وتُلغى المراجعة.',
      previousText: p.previousText,
      proposedAt: p.proposedAt,
    });
    throwsCode(() => e.make(), AMENDMENT_ERRORS.WITNESS_INVALID);
  } finally {
    e.cleanup();
  }
});

test('التعارض: مراجعةٌ من الطارحِ نفسِهِ أو لطرحٍ غيرِ مشهودٍ في السجلّ ⇒ WITNESS_CONFLICT', () => {
  const e = env();
  try {
    const p = e.make().propose({
      actor: e.crown,
      articleId: 'art:03',
      text: e.TEXT,
      reason: e.REASON,
      command: e.issue(e.policy.amendment.proposeAction, 'art:03'),
    });
    e.log.append('constitution.amendment.reviewed', e.crown.id, {
      proposalId: p.id,
      articleId: 'art:03',
      verdict: 'compatible',
      opinion: e.OPINION,
      state: ProposalState.REVIEWED,
    });
    throwsCode(() => e.make(), AMENDMENT_ERRORS.WITNESS_CONFLICT);
  } finally {
    e.cleanup();
  }
  const f = env();
  try {
    f.log.append('constitution.amendment.reviewed', f.justice.id, {
      proposalId: 'ghost',
      articleId: 'art:03',
      verdict: 'compatible',
      opinion: f.OPINION,
      state: ProposalState.REVIEWED,
    });
    throwsCode(() => f.make(), AMENDMENT_ERRORS.WITNESS_CONFLICT);
  } finally {
    f.cleanup();
  }
});

test('التعارض: أمرٌ واحدٌ مشهودٌ في طرحين ⇒ WITNESS_CONFLICT', () => {
  const e = env();
  try {
    const command = e.issue(e.policy.amendment.proposeAction, 'art:03');
    const p = e
      .make()
      .propose({ actor: e.crown, articleId: 'art:03', text: e.TEXT, reason: e.REASON, command });
    const raw = /** @type {any} */ (
      e.log.events.find((ev) => ev.type === 'constitution.amendment.proposed')
    ).data;
    e.log.append('constitution.amendment.proposed', e.crown.id, { ...raw });
    assert.ok(p.id);
    throwsCode(() => e.make(), AMENDMENT_ERRORS.WITNESS_CONFLICT);
  } finally {
    e.cleanup();
  }
});

/** يجري المسارَ كاملاً حتى الإبرامِ ويعيدُ أدواتِ البيئة. */
function ratifiedEnv() {
  const e = env();
  const live = e.make();
  const p = live.propose({
    actor: e.crown,
    articleId: 'art:03',
    text: e.TEXT,
    reason: e.REASON,
    command: e.issue(e.policy.amendment.proposeAction, 'art:03'),
  });
  live.review({ actor: e.justice, proposalId: p.id, verdict: 'compatible', opinion: e.OPINION });
  e.advance(WEEK_PLUS);
  live.ratify({
    actor: e.crown,
    proposalId: p.id,
    command: e.issue(e.policy.amendment.ratifyAction, 'art:03', { proposalHash: p.proposalHash }),
  });
  return { ...e, proposal: p };
}

test('الرجوعُ إلى حالةٍ أقدم: سجلٌّ أقدمُ من السلسلة (عهدُ تعديلٍ بلا طرحٍ مشهود) ⇒ WITNESS_CONFLICT', () => {
  const e = ratifiedEnv();
  try {
    assert.equal(e.make().proposals.get(e.proposal.id)?.state, ProposalState.RATIFIED);
    // السجلُّ يُستبدَلُ بسجلٍّ أقدمَ لا يعرفُ الطرحَ ولا إبرامَه
    const stale = new EventLog();
    throwsCode(
      () => new AmendmentPath({ policy: e.policy, store: e.store, log: stale, now: e.now }),
      AMENDMENT_ERRORS.WITNESS_CONFLICT,
    );
  } finally {
    e.cleanup();
  }
});

test('الرجوعُ إلى حالةٍ أقدم: سلسلةُ دستورٍ أقدمُ من السجلّ (إبرامٌ بلا عهد) ⇒ WITNESS_CONFLICT', () => {
  const e = ratifiedEnv();
  try {
    // سلسلةٌ جديدةٌ بلا العهدِ الثاني (حذفُ المخزنِ ومؤشّرِ ذروته معاً)
    const fresh = mkdtempSync(path.join(os.tmpdir(), 'xuux-amend-restore-fresh-'));
    try {
      const older = new ConstitutionStore({
        policy: e.policy,
        signer: e.king,
        dir: fresh,
        now: e.now,
      });
      throwsCode(
        () => new AmendmentPath({ policy: e.policy, store: older, log: e.log, now: e.now }),
        AMENDMENT_ERRORS.WITNESS_CONFLICT,
      );
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  } finally {
    e.cleanup();
  }
});

test('نافذةُ الانقطاع: عهدٌ أخيرٌ كُتبَ ولم يُقيَّدْ إبرامُهُ ⇒ يُعدُّ مُبرَماً ويُحصى صراحةً', () => {
  const e = env();
  try {
    const live = e.make();
    const p = live.propose({
      actor: e.crown,
      articleId: 'art:03',
      text: e.TEXT,
      reason: e.REASON,
      command: e.issue(e.policy.amendment.proposeAction, 'art:03'),
    });
    live.review({ actor: e.justice, proposalId: p.id, verdict: 'compatible', opinion: e.OPINION });
    // محاكاةُ الانقطاعِ بعدَ `appendAmendment` وقبلَ قيدِ `ratified`
    e.store.appendAmendment({
      articleId: 'art:03',
      text: e.TEXT,
      amendmentId: p.id,
      ratifiedBy: e.crown.id,
    });
    const restored = e.make();
    assert.equal(restored.proposals.get(p.id)?.state, ProposalState.RATIFIED);
    assert.deepEqual(restored.ratifiedWithoutWitness, [2]);
  } finally {
    e.cleanup();
  }
});

test('نافذةُ الانقطاعِ لا تُقبَلُ لطرحٍ لم يُراجَعْ متوافقاً', () => {
  const e = env();
  try {
    const p = e.make().propose({
      actor: e.crown,
      articleId: 'art:03',
      text: e.TEXT,
      reason: e.REASON,
      command: e.issue(e.policy.amendment.proposeAction, 'art:03'),
    });
    e.store.appendAmendment({
      articleId: 'art:03',
      text: e.TEXT,
      amendmentId: p.id,
      ratifiedBy: e.crown.id,
    });
    throwsCode(() => e.make(), AMENDMENT_ERRORS.WITNESS_CONFLICT);
  } finally {
    e.cleanup();
  }
});

test('حدثُ طرحٍ سابقٌ لـWL-484 (بلا نصّ): لا يُستعادُ الطرحُ، ويبقى أمرُهُ مستهلَكاً', () => {
  const e = env();
  try {
    const command = e.issue(e.policy.amendment.proposeAction, 'art:03');
    e.log.append('constitution.amendment.proposed', e.crown.id, {
      proposalId: 'legacy0000000000000000000000000',
      articleId: 'art:03',
      proposalHash: 'f'.repeat(64),
      epoch: 1,
      commandId: command.id,
      reason: e.REASON,
    });
    const restored = e.make();
    assert.equal(restored.proposals.size, 0);
    assert.deepEqual([...restored.unrecoverable], ['legacy0000000000000000000000000']);
    throwsCode(
      () =>
        restored.propose({
          actor: e.crown,
          articleId: 'art:03',
          text: e.TEXT,
          reason: e.REASON,
          command,
        }),
      AMENDMENT_ERRORS.COMMAND_REPLAYED,
    );
  } finally {
    e.cleanup();
  }
});

test('سجلٌّ مختومٌ يُرفَضُ صراحةً عندَ التركيب (لا قراءةَ متزامنةً لمتونِه)', () => {
  const e = env();
  try {
    const sealed = Object.assign(Object.create(EventLog.prototype), {
      events: [],
      sealed: true,
      append() {},
    });
    throwsCode(
      () => new AmendmentPath({ policy: e.policy, store: e.store, log: sealed, now: e.now }),
      AMENDMENT_ERRORS.WITNESS_INVALID,
    );
  } finally {
    e.cleanup();
  }
});
