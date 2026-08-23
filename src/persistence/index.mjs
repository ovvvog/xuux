/**
 * طبقة الاستمرارية — مدخل الوحدة (المسار `M3`).
 *
 * ما هو جاهز اليوم: بيئة قاعدة بأمر واحد (`M3.01`)، ومخطَّط أول مقيَّد (`M3.02`)،
 * وهجرات مُرقَّمة قابلة للتقديم والتراجع (`M3.03`)، وعقد مستودع بتطبيقَي ذاكرة
 * وPostgreSQL يجري عليهما اختبار عقد واحد (`M3.04`).
 *
 * ما لم يجهز بعد ومكانه معلَن في خارطة الطريق: تحويل السجلات القائمة إلى هذه
 * المستودعات (`M3.05`)، والمعاملات على العمليات المركّبة وإثبات ذرّيتها
 * (`M3.06`)، والنسخ الاحتياطي والاستعادة المُجرَّبة (`M3.07`)، وسياسة الاحتفاظ
 * والمحو (`M3.08`). فلا يُقرأ وجود هذا الملف قدرةً كاملة.
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
  ENTITY_SPECS,
  MODEL_SPEC,
  REPOSITORY_ERRORS,
  RepositoryError,
  validateRecord,
} from './entities.mjs';

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
