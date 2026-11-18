-- الهجرة 0030 (رجوع) — يُعيدُ القاعدةَ إلى كتالوجِ 0029 بايتاً ببايت: capability_problems() بجسمِها وبصمتِها وACL (‏إعادةُ
-- تسميةٍ لا إعادةُ إنشاء)، وnotify_surface() بجسمِ 0024، ويُسقِطُ دوالَّ الحاصدِ وجدولَ نبضِه ومنحَه في هذه القاعدة.
--
-- **الدورُ xf_reaper (‏على مستوى العنقود) — لا ALTER ROLE في أيِّ مسار:**
--   • بلا وسمِ 0030 ⇒ يبقى كما هو (‏لم تُنشئه 0030؛ والتقديمُ كانَ يرفضُه أصلاً).
--   • بوسمِها وله اعتمادٌ باقٍ (‏قاعدةٌ نظيرةٌ طبّقت 0030) ⇒ يبقى كما هو (‏NOTICE): ملكُ تلك القاعدةِ كذلك.
--   • بوسمِها بلا اعتماد، وله عضويّةٌ أو إعدادٌ لم تُنشئهما 0030 ⇒ رفضٌ بـXF526 (‏لا إسقاطَ يمحو أثرَ غيرِها صامتاً).
--   • وإلا ⇒ تُنهى جلساتُه (‏أيُّ قاعدةٍ يدخلُها عبرَ PUBLIC) ويُسقَط — فيعودُ العنقودُ إلى ما قبلَ 0030.
-- جلساتُ xf_reaper في هذه القاعدة تُنهى قبلَ سحبِ بابِه (‏سحبُ CONNECT لا يُنهي جلسةً قائمة).
--
-- **الشرط:** superuser، وغيرُ RUNNING (‏D-13)، وxf_ddl_end وxf_ddl_drop على ENABLE ALWAYS، و0030 مطبَّقة، والبيانُ مطابق.

DO $pre$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'fence: رجوعُ 0030 يتطلّبُ superuser';
  END IF;
  IF (fence.effective_state()->>'state') = 'RUNNING' THEN
    RAISE EXCEPTION 'fence: لا رجوعَ 0030 تحتَ RUNNING — أوقِف أولاً (D-13)';
  END IF;
  IF (SELECT evtenabled FROM pg_catalog.pg_event_trigger WHERE evtname = 'xf_ddl_end') IS DISTINCT FROM 'A'
     OR (SELECT evtenabled FROM pg_catalog.pg_event_trigger WHERE evtname = 'xf_ddl_drop') IS DISTINCT FROM 'A' THEN
    RAISE EXCEPTION 'fence: xf_ddl_end/xf_ddl_drop ليسا ENABLE ALWAYS — حالةٌ غيرُ متوقَّعة، لا تُعادُ صامتاً';
  END IF;
  IF to_regprocedure('fence._worker_capability_problems()') IS NULL THEN
    RAISE EXCEPTION 'fence: 0030 غيرُ مطبَّقة (‏لا _worker_capability_problems)';
  END IF;
END
$pre$;

DO $manifest_pre$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM fence.manifest mf
  LEFT JOIN LATERAL (
    SELECT encode(sha256(convert_to(concat_ws('|', p.prosrc, p.prosecdef::text, pg_get_userbyid(p.proowner),
         coalesce(array_to_string(p.proconfig, ','), ''), p.provolatile::text), 'UTF8')), 'hex') AS digest
    FROM pg_proc p WHERE p.oid = to_regprocedure(mf.function_signature)) d ON true
  WHERE d.digest IS DISTINCT FROM mf.digest;
  IF n > 0 THEN
    RAISE EXCEPTION 'fence: البيانُ لا يطابقُ % دالّة — عبثٌ أو حالةٌ غيرُ متوقَّعة؛ لا تُعادُ البصماتُ فوقَه', n;
  END IF;
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'fence' AND p.oid::regprocedure::text NOT IN (SELECT function_signature FROM fence.manifest);
  IF n > 0 THEN
    RAISE EXCEPTION 'fence: % دالّةٍ في fence خارجَ البيان — لا تُسجَّلُ صامتاً', n;
  END IF;
END
$manifest_pre$;

SELECT pg_terminate_backend(a.pid) FROM pg_stat_activity a
WHERE a.usename = 'xf_reaper' AND a.datname = current_database() AND a.pid <> pg_backend_pid();

ALTER EVENT TRIGGER xf_ddl_end DISABLE;
ALTER EVENT TRIGGER xf_ddl_drop DISABLE;

REVOKE ALL ON FUNCTION fence.reaper_tick(uuid, integer, integer) FROM xf_reaper;
REVOKE ALL ON SCHEMA fence FROM xf_reaper;
DO $c$ BEGIN EXECUTE format('REVOKE ALL ON DATABASE %I FROM xf_reaper', current_database()); END $c$;

SET LOCAL ROLE xf_owner;

DROP FUNCTION fence.capability_problems();
ALTER FUNCTION fence._worker_capability_problems() RENAME TO capability_problems;
DROP FUNCTION fence.reaper_health(integer);
DROP FUNCTION fence.reaper_capability_problems();
DROP FUNCTION fence.reaper_capabilities();
DROP FUNCTION fence.reaper_tick(uuid, integer, integer);
DROP TABLE fence.reaper_heartbeat;

CREATE OR REPLACE FUNCTION fence.notify_surface() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
  WITH db AS (SELECT d.oid, d.datname, d.datdba, coalesce(d.datacl, acldefault('d', d.datdba)) AS acl
              FROM pg_database d WHERE d.datname = current_database()),
  allowed AS (SELECT unnest(ARRAY['xuux_worker', 'xf_root', 'xf_sovereign', 'xf_auditor', 'xuux_migrator']::name[]) AS rolname),
  g AS (SELECT DISTINCT a.grantee FROM db, aclexplode(db.acl) a WHERE a.privilege_type = 'CONNECT'),
  grantees AS (
    SELECT CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE g.grantee::regrole::text END AS grantee,
           g.grantee <> 0 AND (g.grantee = (SELECT datdba FROM db)
             OR g.grantee IN (SELECT r.oid FROM pg_roles r JOIN allowed USING (rolname))) AS classified,
           g.grantee AS oid
    FROM g),
  live AS (SELECT a.usesysid, count(*)::int AS n FROM pg_stat_activity a
           WHERE a.datid = (SELECT oid FROM db) AND a.backend_type = 'client backend' GROUP BY a.usesysid),
  -- المستمعُ المحتمَل: دورُ دخولٍ يستطيعُ CONNECT هنا، أو دورٌ له جلسةٌ حيّةٌ هنا ولو صارَ NOLOGIN — الجلسةُ المختومةُ
  -- تبقى حيّةً وتستطيعُ LISTEN (‏قناةٌ بينَ العمّال)، وسحبُ CONNECT أو LOGIN لا يُنهي جلسةً قائمة.
  listeners AS (
    SELECT r.rolname, r.rolsuper, coalesce(l.n, 0) AS live_sessions,
      CASE WHEN r.rolsuper THEN ARRAY['superuser']
           ELSE ARRAY(SELECT gr.grantee FROM grantees gr
                      WHERE gr.oid = 0 OR (gr.oid <> 0 AND pg_has_role(r.oid, gr.oid, 'USAGE')) ORDER BY 1) END AS via
    FROM pg_roles r LEFT JOIN live l ON l.usesysid = r.oid
    WHERE coalesce(l.n, 0) > 0
       OR (r.rolcanlogin AND (r.rolsuper OR has_database_privilege(r.oid, (SELECT oid FROM db), 'CONNECT'))))
  SELECT jsonb_build_object(
    'database', (SELECT datname FROM db),
    'pg_notify_worker_execute', EXISTS (SELECT 1 FROM pg_proc p, fence._worker_principals() w
                                       WHERE p.pronamespace = 'pg_catalog'::regnamespace AND p.proname = 'pg_notify'
                                         AND has_function_privilege(w.oid, p.oid, 'EXECUTE')),
    'connect_via_public', has_database_privilege('public', (SELECT oid FROM db), 'CONNECT'),
    'active_listeners_observable', false,
    'grantees', coalesce((SELECT jsonb_agg(jsonb_build_object('grantee', grantee, 'classified', classified) ORDER BY grantee) FROM grantees), '[]'::jsonb),
    'unclassified_grantees', coalesce((SELECT jsonb_agg(grantee ORDER BY grantee) FROM grantees WHERE NOT classified), '[]'::jsonb),
    'listeners', coalesce((SELECT jsonb_agg(jsonb_build_object('role', rolname, 'superuser', rolsuper, 'live_sessions', live_sessions, 'via', to_jsonb(via)) ORDER BY rolname) FROM listeners), '[]'::jsonb))
$f$;

DELETE FROM fence.manifest WHERE function_signature IN (
  'fence._worker_capability_problems()', 'fence.capability_problems()', 'fence.notify_surface()',
  'fence.reaper_tick(uuid,integer,integer)', 'fence.reaper_health(integer)', 'fence.reaper_capabilities()',
  'fence.reaper_capability_problems()');
INSERT INTO fence.manifest (function_signature, digest)
SELECT p.oid::regprocedure::text,
       encode(sha256(convert_to(concat_ws('|', p.prosrc, p.prosecdef::text, pg_get_userbyid(p.proowner),
         coalesce(array_to_string(p.proconfig, ','), ''), p.provolatile::text), 'UTF8')), 'hex')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'fence' AND p.oid::regprocedure::text IN ('fence.capability_problems()', 'fence.notify_surface()');

DO $manifest_post$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM fence.manifest mf
  LEFT JOIN LATERAL (
    SELECT encode(sha256(convert_to(concat_ws('|', p.prosrc, p.prosecdef::text, pg_get_userbyid(p.proowner),
         coalesce(array_to_string(p.proconfig, ','), ''), p.provolatile::text), 'UTF8')), 'hex') AS digest
    FROM pg_proc p WHERE p.oid = to_regprocedure(mf.function_signature)) d ON true
  WHERE d.digest IS DISTINCT FROM mf.digest;
  IF n > 0 THEN
    RAISE EXCEPTION 'fence: البيانُ لا يطابقُ % دالّة — عبثٌ أو حالةٌ غيرُ متوقَّعة؛ بعدَ إعادةِ التسجيل', n;
  END IF;
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'fence' AND p.oid::regprocedure::text NOT IN (SELECT function_signature FROM fence.manifest);
  IF n > 0 THEN
    RAISE EXCEPTION 'fence: % دالّةٍ في fence خارجَ البيان — بعدَ إعادةِ التسجيل', n;
  END IF;
END
$manifest_post$;

RESET ROLE;

DO $drop_role$
DECLARE r oid; marker CONSTANT text := 'xuux-fence-0030:xf_reaper';
BEGIN
  SELECT oid INTO r FROM pg_catalog.pg_roles WHERE rolname = 'xf_reaper';
  IF r IS NULL THEN
    RAISE NOTICE 'fence: xf_reaper غائبٌ أصلاً — لا شيءَ يُسقَط';
    RETURN;
  END IF;
  IF shobj_description(r, 'pg_authid') IS DISTINCT FROM marker THEN
    RAISE NOTICE 'fence: xf_reaper بلا وسمِ 0030 — لم تُنشئه هذه الهجرةُ فيبقى كما هو';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_shdepend d WHERE d.refclassid = 'pg_authid'::regclass AND d.refobjid = r) THEN
    RAISE NOTICE 'fence: xf_reaper باقٍ كما هو — له اعتمادٌ في قاعدةٍ أخرى من العنقود (‏0030 مطبَّقةٌ هناك)';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member = r OR m.roleid = r)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s WHERE s.setrole = r) THEN
    RAISE EXCEPTION USING ERRCODE = 'XF526',
      MESSAGE = 'fence: xf_reaper له عضويّةٌ أو إعدادٌ لم تُنشئهما 0030 — لا يُسقَطُ صامتاً؛ أزِلهما أو أبقِ الدورَ يدويّاً';
  END IF;
  PERFORM pg_terminate_backend(a.pid) FROM pg_catalog.pg_stat_activity a WHERE a.usesysid = r;
  DROP ROLE xf_reaper;
END
$drop_role$;

ALTER EVENT TRIGGER xf_ddl_drop ENABLE ALWAYS;
ALTER EVENT TRIGGER xf_ddl_end ENABLE ALWAYS;
