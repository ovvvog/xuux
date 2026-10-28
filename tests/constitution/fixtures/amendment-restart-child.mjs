// عمليةٌ مستقلّةٌ تُركِّبُ مسارَ التعديلِ على سجلٍّ دائمٍ ومخزنِ دستورٍ ملفّيٍّ،
// فيُختبَرُ الاسترجاعُ بعدَ **إعادةِ تشغيلٍ حقيقيّةٍ** لا بإعادةِ بناءِ كائنٍ في
// العمليةِ نفسِها (WL-484، R6-A-05 — شطرُ المقترحاتِ الدستوريّة).
//
// الاستعمال: node amendment-restart-child.mjs <phase> <dir>
//   الساعةُ من `XUUX_TEST_NOW_MS`، والنتيجةُ سطرُ JSON واحدٌ على stdout.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  CertificateAuthority,
  CrownGateway,
  KingIdentity,
  PersistentEventLog,
} from '../../../src/root-of-trust/index.mjs';
import {
  ConstitutionStore,
  loadConstitutionPolicy,
} from '../../../src/constitution/constitution.mjs';
import { AmendmentPath } from '../../../src/constitution/amendment-path.mjs';

const phase = String(process.argv[2]);
const dir = String(process.argv[3]);
const now = () => new Date(Number(process.env.XUUX_TEST_NOW_MS));
const keyFile = path.join(dir, 'king.json');
if (!existsSync(keyFile)) {
  const pair = generateKeyPairSync('ed25519');
  writeFileSync(
    keyFile,
    JSON.stringify({
      privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }),
    }),
  );
}
const material = JSON.parse(readFileSync(keyFile, 'utf8'));
const king = new KingIdentity({
  privateKey: createPrivateKey(material.privateKey),
  publicKey: createPublicKey(material.publicKey),
});
const stateFile = path.join(dir, 'state.json');
/** @type {Record<string, any>} */
const saved = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
/** @param {Record<string, unknown>} patch */
const save = (patch) => writeFileSync(stateFile, JSON.stringify({ ...saved, ...patch }));

/**
 * @param {() => unknown} fn
 * @returns {{ ok: true, value: unknown } | { ok: false, code: string }}
 */
const attempt = (fn) => {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    return { ok: false, code: /** @type {{ code?: string }} */ (error).code ?? String(error) };
  }
};

const policy = loadConstitutionPolicy();
/** @type {{ log: PersistentEventLog, store: ConstitutionStore, amendment: AmendmentPath } | null} */
let composed = null;
// الإقلاعُ كلُّه — تحميلُ السجلِّ والمخزنِ وبناءُ المسار — تحتَ المحاولةِ نفسِها
const boot = attempt(() => {
  const log = new PersistentEventLog(path.join(dir, 'events.jsonl'), {
    fsync: false,
    env: { NODE_ENV: 'test' },
  });
  const store = new ConstitutionStore({
    policy,
    signer: king,
    dir: path.join(dir, 'constitution'),
    now,
  });
  composed = { log, store, amendment: new AmendmentPath({ policy, store, log, now }) };
  return true;
});
/** @type {Record<string, unknown>} */
const out = { boot };
if (!boot.ok || composed === null) {
  process.stdout.write(JSON.stringify(out) + '\n');
  process.exit(0);
}
const {
  log,
  store,
  amendment: path_,
} = /** @type {{ log: PersistentEventLog, store: ConstitutionStore, amendment: AmendmentPath }} */ (
  composed
);
const gateway = new CrownGateway(king, new CertificateAuthority(king), log);
/**
 * @param {string} action
 * @param {string} target
 * @param {Record<string, unknown>} [payload]
 */
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
const ARTICLE = 'art:03'; // مادةٌ غيرُ مختومة
const crown = { id: king.id, roles: ['role:king'] };
const justice = { id: 'judge:chief', roles: ['role:chief-justice'] };
const TEXT =
  'مفتاحُ الملك أصلُ كلِّ تحقُّقٍ في الدولة، ويُحفظ في وحدةِ عتادٍ لا في ملفٍّ على قرص، وتدويرُه فعلٌ سياديٌّ يُعاد به توقيعُ كلِّ عهدٍ سابق.';
const REASON = 'حفظُ المفتاح في ملفٍّ صار أضعفَ حلقةٍ في جذر الثقة، ويلزم رفعُه إلى عتادٍ معزول.';
const OPINION = 'التعديلُ يشدّ المادةَ ولا يخالف مادةً مختومةً؛ فهو متوافقٌ مع النصّ.';

if (phase === 'propose') {
  const command = issue(policy.amendment.proposeAction, ARTICLE);
  const proposal = path_.propose({
    actor: crown,
    articleId: ARTICLE,
    text: TEXT,
    reason: REASON,
    command,
  });
  save({ proposalId: proposal.id, proposalHash: proposal.proposalHash, proposeCommand: command });
  out.proposal = { id: proposal.id, state: proposal.state, proposedAt: proposal.proposedAt };
} else if (phase === 'review-compatible' || phase === 'review-conflict') {
  out.review = attempt(
    () =>
      path_.review({
        actor: justice,
        proposalId: saved.proposalId,
        verdict: phase === 'review-compatible' ? 'compatible' : 'conflict',
        opinion: OPINION,
      }).state,
  );
} else if (phase === 'inspect') {
  const p = path_.proposals.get(saved.proposalId);
  out.known = Boolean(p);
  out.state = p?.state ?? null;
  out.proposedAt = p?.proposedAt ?? null;
  out.reviewer = p?.review?.reviewer ?? null;
  out.unrecoverable = Array.from(path_.unrecoverable ?? []);
  // إعادةُ تقديمِ أمرِ الطرحِ المستهلَكِ نفسِهِ بعدَ إعادةِ التشغيل
  out.replay = attempt(
    () =>
      path_.propose({
        actor: crown,
        articleId: ARTICLE,
        text: TEXT + ' ويُعادُ.',
        reason: REASON,
        command: saved.proposeCommand,
      }).id,
  );
} else if (phase === 'ratify') {
  const command = issue(policy.amendment.ratifyAction, ARTICLE, {
    proposalHash: saved.proposalHash,
  });
  out.ratify = attempt(
    () => path_.ratify({ actor: crown, proposalId: saved.proposalId, command }).revision.epoch,
  );
  out.epoch = store.epoch();
  out.ratifiedWithoutWitness = path_.ratifiedWithoutWitness ?? null;
}
process.stdout.write(JSON.stringify(out) + '\n');
