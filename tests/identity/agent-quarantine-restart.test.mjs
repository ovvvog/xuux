// @ts-nocheck
// R6-A-05 — الجزءُ الرابع: ثباتُ حالةِ حجرِ الوكيلِ عبرَ إعادةِ التشغيل.
//
// العيب (R6-A-05): حالةُ «محجور» كانت تُفقَدُ بإعادةِ التشغيل.
//
// الإ saliح: المستودعُ هو طبقةُ الثباتِ — `transition()` يكتبُ الحالةَ في
// المستودعِ، وقراءةُ الوكيلِ من مستودعٍ جديدٍ على نفسِ البياناتِ تُرجعُ
// الحالةَ المحجورة. هذا الاختبارُ يُثبتُ ذلك بلا قاعدةِ بياناتٍ: مستودعُ
// ملفاتٍ بسيطٌ يكتبُ ويقرأُ من JSON.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { KingIdentity, CertificateAuthority, EventLog } from '../../src/root-of-trust/index.mjs';
import { AgentRegistry, AgentState } from '../../src/identity/agent-registry.mjs';

/**
 * مستودعُ ملفاتٍ بسيطٌ للاختبار: يكتبُ كلَّ سجلٍّ في ملفٍّ JSON واحد.
 * يُحاكي الثباتَ عبرَ إعادةِ التشغيل: مستودعٌ جديدٌ على نفسِ المجلدِّ يقرأُ
 * ما كُتبَ سابقاً.
 */
function createFileRepository(_spec) {
  const dir = mkdtempSync(join(tmpdir(), 'xuux-file-repo-'));
  const ext = '.json';

  function pathFor(id) {
    return join(dir, id + ext);
  }

  return {
    dir,
    async insert(record) {
      const id = record.id ?? String(Date.now());
      writeFileSync(pathFor(id), JSON.stringify({ ...record, id, version: 1 }), 'utf8');
      return { ...record, id, version: 1 };
    },
    async findById(id) {
      const p = pathFor(id);
      if (!existsSync(p)) return null;
      return JSON.parse(readFileSync(p, 'utf8'));
    },
    async list() {
      // Not needed for this test.
      return [];
    },
    async count() {
      return 0;
    },
    async update(id, expectedVersion, patch) {
      const p = pathFor(id);
      if (!existsSync(p)) throw new Error('NOT_FOUND');
      const current = JSON.parse(readFileSync(p, 'utf8'));
      if (current.version !== expectedVersion) throw new Error('VERSION_CONFLICT');
      const updated = { ...current, ...patch, version: expectedVersion + 1 };
      writeFileSync(p, JSON.stringify(updated), 'utf8');
      return updated;
    },
  };
}

test('R6-A-05: حالةُ حجرِ الوكيلِ تدومُ عبرَ إعادةِ التشغيلِ بمستودعٍ جديد', async () => {
  const king = new KingIdentity();
  const ca = new CertificateAuthority(king);
  const log = new EventLog();
  const repo = createFileRepository(AgentRegistry.spec);

  // العمليةُ الأولى: تسجيلُ وكيلٍ ثمَّ حجرُه.
  const registry1 = new AgentRegistry({
    ca,
    log,
    repository: repo,
    maxAgents: 10,
  });
  const agent = await registry1.register({
    name: 'test-agent',
    role: 'observer',
    capabilities: ['action:inspect'],
    kind: 'service',
    owner: 'crown',
  });
  assert.equal(agent.state, AgentState.ACTIVE, 'نشط عند التسجيل');

  await registry1.transition(agent.id, AgentState.QUARANTINED, 'security incident');
  const quarantined = await registry1.get(agent.id);
  assert.equal(quarantined.state, AgentState.QUARANTINED, 'محجور قبل التوقف');

  // «إعادةُ التشغيل»: مستودعٌ جديدٌ على نفسِ المجلدِّ — يقرأُ ما كُتبَ سابقاً.
  // نُعيدُ تعيينَ المجلدِّ إلى نفسِهِ يدويّاً:
  // في الواقعِ مستودعُ الإنتاجِ (Postgres) يقرأُ من قاعدةِ البياناتِ نفسِها.
  // هنا نُحاكي ذلك بنسخِ المستودعِ الأول:
  const repo2dir = repo.dir;
  const repo2obj = {
    dir: repo2dir,
    async insert(record) {
      const id = record.id ?? String(Date.now());
      writeFileSync(
        join(repo2dir, id + '.json'),
        JSON.stringify({ ...record, id, version: 1 }),
        'utf8',
      );
      return { ...record, id, version: 1 };
    },
    async findById(id) {
      const p = join(repo2dir, id + '.json');
      if (!existsSync(p)) return null;
      return JSON.parse(readFileSync(p, 'utf8'));
    },
    async list() {
      return [];
    },
    async count() {
      return 0;
    },
    async update(id, expectedVersion, patch) {
      const p = join(repo2dir, id + '.json');
      if (!existsSync(p)) throw new Error('NOT_FOUND');
      const current = JSON.parse(readFileSync(p, 'utf8'));
      if (current.version !== expectedVersion) throw new Error('VERSION_CONFLICT');
      const updated = { ...current, ...patch, version: expectedVersion + 1 };
      writeFileSync(p, JSON.stringify(updated), 'utf8');
      return updated;
    },
  };

  const registry2 = new AgentRegistry({
    ca,
    log,
    repository: repo2obj,
    maxAgents: 10,
  });

  // الوكيلُ ما زال محجوراً بعدَ إعادةِ التشغيل.
  const recovered = await registry2.get(agent.id);
  assert.ok(recovered, 'الوكيل عاد بعد إعادة التشغيل');
  assert.equal(recovered.state, AgentState.QUARANTINED, 'ما زال محجوراً بعد إعادة التشغيل');
  assert.equal(recovered.stateReason, 'security incident', 'سبب الحجر بقي');

  // التنظيف.
  rmSync(repo.dir, { recursive: true, force: true });
});

test('R6-A-05: حالةُ التعليقِ تدومُ كذلك عبرَ إعادةِ التشغيل', async () => {
  const king = new KingIdentity();
  const ca = new CertificateAuthority(king);
  const log = new EventLog();
  const repo = createFileRepository(AgentRegistry.spec);

  const registry1 = new AgentRegistry({
    ca,
    log,
    repository: repo,
    maxAgents: 10,
  });
  const agent = await registry1.register({
    name: 'suspended-agent',
    role: 'observer',
    capabilities: ['action:inspect'],
    kind: 'service',
    owner: 'crown',
  });

  await registry1.transition(agent.id, AgentState.SUSPENDED, 'maintenance');
  const suspended = await registry1.get(agent.id);
  assert.equal(suspended.state, AgentState.SUSPENDED, 'معلَّق قبل التوقف');

  // إعادةُ التشغيل: مستودعٌ جديدٌ على نفسِ المجلدِّ.
  const repo2obj = {
    dir: repo.dir,
    async insert(record) {
      const id = record.id ?? String(Date.now());
      writeFileSync(
        join(repo.dir, id + '.json'),
        JSON.stringify({ ...record, id, version: 1 }),
        'utf8',
      );
      return { ...record, id, version: 1 };
    },
    async findById(id) {
      const p = join(repo.dir, id + '.json');
      if (!existsSync(p)) return null;
      return JSON.parse(readFileSync(p, 'utf8'));
    },
    async list() {
      return [];
    },
    async count() {
      return 0;
    },
    async update(id, expectedVersion, patch) {
      const p = join(repo.dir, id + '.json');
      if (!existsSync(p)) throw new Error('NOT_FOUND');
      const current = JSON.parse(readFileSync(p, 'utf8'));
      if (current.version !== expectedVersion) throw new Error('VERSION_CONFLICT');
      const updated = { ...current, ...patch, version: expectedVersion + 1 };
      writeFileSync(p, JSON.stringify(updated), 'utf8');
      return updated;
    },
  };

  const registry2 = new AgentRegistry({
    ca,
    log,
    repository: repo2obj,
    maxAgents: 10,
  });

  const recovered = await registry2.get(agent.id);
  assert.ok(recovered, 'الوكيل عاد');
  assert.equal(recovered.state, AgentState.SUSPENDED, 'ما زال معلَّقاً');
  assert.equal(recovered.stateReason, 'maintenance', 'سبب التعليق بقي');

  rmSync(repo.dir, { recursive: true, force: true });
});
