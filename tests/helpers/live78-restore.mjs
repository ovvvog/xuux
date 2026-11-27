// مُعيناتُ اختباراتِ `LIVE-78` (‏الاستعادة) المشتركة — مَنقولةٌ حرفيّاً من `tests/persistence/atomicity.test.mjs`
// في `WL-625` ليستعملَها `tests/persistence/restore-atomicity.test.mjs` أيضاً؛ لا تغييرَ في أجسامِها.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { up } from '../../src/persistence/migrator.mjs';
import {
  createIsolatedDatabase,
  databaseUrl,
  LIVE78_NOTICE_TAIL,
  live78DigestBlock,
  live78PrototypeBackup,
} from './pg.mjs';

/** وصلةُ الإدارة (‏superuser الاختبار). */
export function l78AdminUrl() {
  return /** @type {string} */ (databaseUrl());
}

/** @param {string} name */
export function l78Url(name) {
  const url = new URL(/** @type {string} */ (process.env.DATABASE_URL));
  url.pathname = `/${name}`;
  return url.toString();
}

/**
 * صورةُ الهدفِ كلِّه للمقارنة قبلُ/بعد: بصمةُ `state` و`fence` و`public` (‏بنيةً ومحتوى) وقوادحُ الأحداث.
 * @param {import('pg').Pool} pool
 * @returns {Promise<string>}
 */
export async function l78TargetImage(pool) {
  const client = await pool.connect();
  try {
    let digest = '';
    const onNotice = (/** @type {any} */ n) => {
      const m = /^XUUX_L78_DIGEST=(.*)$/s.exec(String(n.message));
      if (m) digest = String(m[1]);
    };
    client.on('notice', onNotice);
    await client.query('BEGIN');
    const ledger = (
      await client.query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS l`)
    ).rows[0].l;
    await client.query(
      live78DigestBlock(
        ['state', 'fence', 'public'],
        ledger ? 'public.schema_migrations' : null,
        LIVE78_NOTICE_TAIL,
      ),
    );
    await client.query('ROLLBACK');
    client.off('notice', onNotice);
    const evt = await client.query(
      `SELECT string_agg(evtname || ':' || evtevent || ':' || evtenabled::text, ',' ORDER BY evtname) AS e FROM pg_event_trigger`,
    );
    return `${digest}|evt=${evt.rows[0].e ?? ''}`;
  } finally {
    client.release();
  }
}

/**
 * مصدرٌ مُهاجَرٌ بمحتوى، ونسختُه النموذجيّة (‏البيانُ يحملُ `prototypeDigest` — حقلٌ مختبريٌّ باسمٍ مستقلٍّ عن `contentDigest` الإنتاجيّ منذُ `WL-606`، فلا تُقرأُ صيغةٌ بالأخرى؛ والإنتاجُ يرى نسخةَ النموذجِ بلا بصمة).
 * @param {string} label
 * `bodyRepeat` يكبّرُ الأرشيفَ فوقَ سعةِ الأنبوب.
 * @param {{ to?: number, bodyRepeat?: number }} [options]
 */
export async function l78Source(label, options = {}) {
  const source = await createIsolatedDatabase(label);
  await up(source.pool, options.to === undefined ? {} : { to: options.to });
  const body =
    options.bodyRepeat === undefined ? `'نصّ '` : `repeat('نصّ ', ${Number(options.bodyRepeat)})`;
  await source.pool.query(
    `INSERT INTO state.laws (id, title, body, status, scope, proposer)
     SELECT 'law-' || lpad(g::text, 6, '0'), 'عنوان ' || g, ${body} || g, 'draft', 'testing', 'agent-001'
       FROM generate_series(1, 300) g`,
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `l78-${label}-`));
  const dump = path.join(dir, 'state.dump');
  const manifest = await live78PrototypeBackup(dump, l78Url(source.name));
  return {
    source,
    dir,
    dump,
    manifest,
    cleanup: async () => {
      fs.rmSync(dir, { recursive: true, force: true });
      await source.drop();
    },
  };
}

/** هدفٌ «مُهاجَرٌ مشغول» قبلَ السياج (‏الحالُ الوحيدُ الذي يستبدلُه `--force`) ومعه صفٌّ قديم. */
export async function l78BusyTarget(/** @type {string} */ label) {
  const target = await createIsolatedDatabase(label);
  await up(target.pool, { to: 23 });
  await target.pool.query(
    `INSERT INTO state.laws (id, title, body, status, scope, proposer)
     VALUES ('law-stale1', 'قديم', 'صفٌّ قبلَ الاستعادة', 'draft', 'testing', 'agent-001')`,
  );
  return target;
}

/** قادحُ أحداثٍ خارجَ `state` (‏ينجو من المحو) يرفضُ أوّلَ `CREATE INDEX` ⇒ `pg_restore` يفشلُ في منتصفه. */
export async function l78InstallMidRestoreFailure(/** @type {import('pg').Pool} */ pool) {
  await pool.query(`CREATE FUNCTION public.l78_fail_index() RETURNS event_trigger LANGUAGE plpgsql AS $f$
    BEGIN RAISE EXCEPTION 'L78_INJECTED_MID_RESTORE_FAILURE'; END $f$`);
  await pool.query(`CREATE EVENT TRIGGER l78_fail_index ON ddl_command_end
    WHEN TAG IN ('CREATE INDEX') EXECUTE FUNCTION public.l78_fail_index()`);
}

/**
 * قادحُ أحداثٍ خارجَ `state` يُلحقُ بـ`state.laws` حالَ إنشائها قادحَ صفوفٍ يغيّرُ كلَّ نصٍّ يُنسَخ —
 * فالأعدادُ تتطابقُ والمحتوى يختلف. (‏قادحُ الأحداثِ يتطلّبُ superuser: التهديدُ بقيّةٌ في الهدفِ أو مُشغِّلٌ.)
 */
export async function l78InstallContentTamper(/** @type {import('pg').Pool} */ pool) {
  await pool.query(`CREATE FUNCTION public.l78_tamper_row() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN NEW.body := 'مُبدَّل'; RETURN NEW; END $f$`);
  await pool.query(`CREATE FUNCTION public.l78_attach_tamper() RETURNS event_trigger LANGUAGE plpgsql AS $f$
    DECLARE o record;
    BEGIN
      FOR o IN SELECT * FROM pg_event_trigger_ddl_commands() WHERE object_identity = 'state.laws' AND command_tag = 'CREATE TABLE' LOOP
        EXECUTE 'CREATE TRIGGER l78_tamper BEFORE INSERT ON state.laws FOR EACH ROW EXECUTE FUNCTION public.l78_tamper_row()';
      END LOOP;
    END $f$`);
  await pool.query(`CREATE EVENT TRIGGER l78_attach_tamper ON ddl_command_end
    WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION public.l78_attach_tamper()`);
}

/** @param {import('pg').Pool} pool */
export async function l78DropInjected(pool) {
  await pool.query('DROP EVENT TRIGGER IF EXISTS l78_fail_index');
  await pool.query('DROP EVENT TRIGGER IF EXISTS l78_attach_tamper');
}
