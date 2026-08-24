/**
 * مُعين اختبار: دفتر نسبٍ مركَّب على مستودع ذاكرة (‏`M7.04`).
 *
 * الفهرس والبوابة صارا يرفضان العمل بلا دفتر نسب، فبناءُ الدفتر بيدٍ في كل ملف
 * اختبار كان سيُنتج نُسخاً تختلف في قارئ الأصول — والقارئ هو ما يجعل السلف
 * محقَّقاً أو مُدّعىً. فجُمع هنا في موضعٍ واحد.
 *
 * وقارئ الأصول هو **مستودع الأصول** لا الفهرس: الفهرس يحتاج الدفتر ليسجّل،
 * فتمريرُ الفهرس إلى الدفتر اعتمادٌ دائري. وهذا هو نفس ما يفعله
 * `createRegistries` في `src/persistence/composition.mjs`، فلا يختبر المُعين
 * تركيباً غير التركيب المُشغَّل.
 */

import { loadClassificationLattice } from '../../src/data/classification.mjs';
import { LineageLedger } from '../../src/data/lineage.mjs';
import { DATA_LINEAGE_SPEC } from '../../src/persistence/entities.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';

/**
 * @param {object} deps
 * @param {import('../../src/root-of-trust/event-log.mjs').EventLog} deps.log
 * @param {{ findById: (id: string) => Promise<Record<string, unknown> | null> }} deps.assets مستودع أصول البيانات نفسه
 * @param {import('../../src/data/classification.mjs').ClassificationLattice} [deps.lattice]
 * @returns {{ ledger: LineageLedger, repository: ReturnType<typeof createMemoryRepository> }}
 */
export function createTestLedger({ log, assets, lattice }) {
  const repository = createMemoryRepository(DATA_LINEAGE_SPEC);
  const ledger = new LineageLedger({
    log,
    repository,
    catalog: { get: (id) => assets.findById(id) },
    lattice: lattice ?? loadClassificationLattice(),
  });
  return { ledger, repository };
}
