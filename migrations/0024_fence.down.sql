-- الهجرة 0024 (رجوع) — إزالةُ سياجِ قاعدةِ البيانات.
--
-- **يُرفَضُ الرجوعُ تحتَ RUNNING** (`D-13`: الهجراتُ تحتَ HALTED): إزالةُ السياجِ
-- والعمالُ يكتبون هي بعينِها الثغرةُ التي يسدّها. ويتطلّبُ superuser (إسقاطُ
-- مُطلِقاتِ الأحداث). الأدوارُ على مستوى العنقودِ **لا تُسقَط** (قد تعتمدُ عليها
-- قواعدُ أخرى في العنقود)، لكن تُسحَبُ امتيازاتُها في هذه القاعدة، وتُسقَطُ أدوارُ
-- الإقلاعِ التي أصدرها هذا السياج. وبعدَ الرجوعِ تعودُ الكتابةُ غيرَ مُسيَّجةٍ —
-- أي يعودُ الدَّينُ الذي أغلقته هذه الهجرة، ويُعلَنُ ولا يُستَر.

DO $pre$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'fence: رجوعُ 0024 يتطلّبُ superuser';
  END IF;
  IF (fence.effective_state()->>'state') = 'RUNNING' THEN
    RAISE EXCEPTION 'fence: لا رجوعَ عن السياجِ تحتَ RUNNING — أوقِف أولاً (D-13)';
  END IF;
END
$pre$;

DROP EVENT TRIGGER IF EXISTS xf_ddl_start;
DROP EVENT TRIGGER IF EXISTS xf_ddl_end;
DROP EVENT TRIGGER IF EXISTS xf_ddl_drop;

DO $uncover$
DECLARE r record;
BEGIN
  FOR r IN SELECT t.tgrelid::regclass AS rel FROM pg_trigger t WHERE t.tgname = 'xf_guard' LOOP
    EXECUTE format('DROP TRIGGER xf_guard ON %s', r.rel);
  END LOOP;
  FOR r IN SELECT po.polrelid::regclass AS rel FROM pg_policy po WHERE po.polname = 'xf_read' LOOP
    EXECUTE format('DROP POLICY xf_read ON %s', r.rel);
    EXECUTE format('ALTER TABLE %s DISABLE ROW LEVEL SECURITY', r.rel);
  END LOOP;
  -- الملكيّةُ تعودُ إلى ما كانت (الجداولُ التي أُنشئت بعدَ 0024 تبقى لمالكِها).
  FOR r IN SELECT o.relid, o.owner FROM fence.original_owners o
           JOIN pg_class c ON c.oid = o.relid WHERE pg_catalog.pg_get_userbyid(c.relowner) = 'xuux_owner' LOOP
    EXECUTE format('ALTER TABLE %s OWNER TO %I', r.relid::regclass, r.owner);
  END LOOP;
  FOR r IN SELECT o.owner FROM fence.original_owners o JOIN pg_namespace n ON n.oid = o.relid WHERE n.nspname = 'state' LOOP
    EXECUTE format('ALTER SCHEMA state OWNER TO %I', r.owner);
  END LOOP;
  -- أدوارُ الإقلاعِ التي أصدرها هذا السياج.
  FOR r IN SELECT c.role_name FROM fence.credentials c WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = c.role_name) LOOP
    EXECUTE format('DROP ROLE %I', r.role_name);
  END LOOP;
  EXECUTE format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO PUBLIC', current_database());
  EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM xuux_worker, xf_root, xf_sovereign, xf_auditor, xuux_migrator', current_database());
END
$uncover$;

GRANT EXECUTE ON FUNCTION pg_catalog.lo_creat(integer), pg_catalog.lo_create(oid), pg_catalog.lo_from_bytea(oid, bytea),
  pg_catalog.lo_put(oid, bigint, bytea), pg_catalog.lowrite(integer, bytea), pg_catalog.lo_unlink(oid),
  pg_catalog.lo_truncate(integer, integer), pg_catalog.lo_truncate64(integer, bigint), pg_catalog.lo_open(oid, integer) TO PUBLIC;

REVOKE ALL ON ALL TABLES IN SCHEMA state FROM xuux_worker, xuux_migrator;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA state FROM xuux_worker;
REVOKE ALL ON SCHEMA state FROM xuux_worker, xuux_migrator;
REVOKE ALL ON public.schema_migrations FROM xuux_migrator;
REVOKE EXECUTE ON FUNCTION pg_catalog.pg_control_system(), pg_catalog.pg_control_checkpoint() FROM xf_owner;

DROP SCHEMA fence CASCADE;
