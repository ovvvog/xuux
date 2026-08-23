/**
 * طبقة الاستمرارية — مدخل الوحدة (المسار `M3`).
 *
 * ما هو جاهز اليوم: بيئة قاعدة بأمر واحد (`M3.01`)، ومخطَّط أول مقيَّد (`M3.02`)
 * مُواءَم لسجلات الدولة بالهجرة `0002`، وهجرات مُرقَّمة قابلة للتقديم والتراجع
 * (`M3.03`)، وعقد مستودع بتطبيقَي ذاكرة وPostgreSQL يجري عليهما اختبار عقد واحد
 * (`M3.04`)، والسجلات الخمس على هذه المستودعات مع إثبات إعادة تشغيل (`M3.05`)،
 * ووحدة عمل تجعل العمليات المركّبة ذرّية (`M3.06`)، ونسخ احتياطي واستعادة
 * مُجرَّبة بزمن معلَن (`M3.07`)، وسياسة احتفاظ ومحو (`M3.08`).
 *
 * وما لم يجهز بعد ومكانه معلَن: قضايا المحكمة وسجل الأحداث ما زالا في الذاكرة
 * (قرار مالك ومسار `M4`)، وقاعدة البذور ما زالت ملفات JSON مُوقَّعة. فلا يُقرأ
 * وجود هذا الملف قدرةً كاملة.
 */

export {
  DB_ERRORS,
  DatabaseConfigError,
  createPool,
  resolveDatabaseConfig,
  withTransaction,
} from './db.mjs';

export {
  AGENT_SPEC,
  DATA_ASSET_SPEC,
  ENTITY_SPECS,
  LAW_SPEC,
  MEMORY_SPEC,
  MODEL_SPEC,
  REPOSITORY_ERRORS,
  RepositoryError,
  validateRecord,
} from './entities.mjs';

export {
  createMemoryRepositories,
  createPostgresRegistries,
  createPostgresRepositories,
  createRegistries,
} from './composition.mjs';

export { createClientRepositories, withUnitOfWork } from './unit-of-work.mjs';

export { createMemoryRepository } from './repository-memory.mjs';
export { createPostgresRepository } from './repository-postgres.mjs';

export {
  DEFAULT_MIGRATIONS_DIR,
  MIGRATION_ERRORS,
  MigrationError,
  down,
  loadMigrations,
  status,
  up,
} from './migrator.mjs';
