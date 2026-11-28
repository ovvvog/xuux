-- الهجرة 0038 (تراجع) — يُعيدُ window_breach وcoverage_problems وcover_relation بنصِّ 0037 حرفيّاً، ويُسقِطُ xf_guard_end
-- من كلِّ علاقة. **التراجعُ يُعيدُ العيبَين المقيسَين** (‏المؤشّرُ يُبتَرُ صامتاً، وDELETE بـHash Join يلتزمُ بعدَ الانقضاء).
--
-- **شرطُ التراجع:** superuser، وغيرُ RUNNING (‏D-13)، وxf_ddl_end وxf_ddl_drop على ENABLE ALWAYS.


DO $pre$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'fence: تراجعُ 0038 يتطلّبُ superuser (‏xf_ddl_end يُعطَّلُ داخلَ المعاملة)';
  END IF;
  IF (fence.effective_state()->>'state') = 'RUNNING' THEN
    RAISE EXCEPTION 'fence: لا تراجعُ 0038 تحتَ RUNNING — أوقِف أولاً (D-13)';
  END IF;
  IF (SELECT evtenabled FROM pg_catalog.pg_event_trigger WHERE evtname = 'xf_ddl_end') IS DISTINCT FROM 'A' THEN
    RAISE EXCEPTION 'fence: xf_ddl_end ليس ENABLE ALWAYS — حالةٌ غيرُ متوقَّعة، لا تُعادُ صامتاً';
  END IF;
  IF (SELECT evtenabled FROM pg_catalog.pg_event_trigger WHERE evtname = 'xf_ddl_drop') IS DISTINCT FROM 'A' THEN
    RAISE EXCEPTION 'fence: xf_ddl_drop ليس ENABLE ALWAYS — حالةٌ غيرُ متوقَّعة، لا تُعادُ صامتاً';
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
    RAISE EXCEPTION 'fence: % دالّةٍ في fence خارجَ البيان — عبثٌ أو حالةٌ غيرُ متوقَّعة؛ لا تُعادُ البصماتُ فوقَه', n;
  END IF;
END
$manifest_pre$;


ALTER EVENT TRIGGER xf_ddl_end DISABLE;

SET LOCAL ROLE xf_owner;

CREATE OR REPLACE FUNCTION fence.window_breach(w tstzrange) RETURNS boolean
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $f$
BEGIN
  IF w IS NOT NULL AND isempty(w) THEN RETURN false; END IF;
  IF w IS NOT NULL AND NOT lower_inf(w) AND clock_timestamp() < lower(w) THEN
    RAISE EXCEPTION USING ERRCODE = 'XF012', MESSAGE = 'fence: ساعةُ القاعدةِ تراجعت قبلَ بدايةِ نافذةِ الإيجارِ أثناءَ العبارة — تُلغى كلُّها';
  END IF;
  IF w IS NOT NULL AND NOT upper_inf(w) AND statement_timestamp() >= upper(w) THEN RETURN false; END IF;
  RAISE EXCEPTION USING ERRCODE = 'XF009', MESSAGE = 'fence: الإيجارُ انقضى أثناءَ العبارة — تُلغى كلُّها (‏لا تخطّيَ صامتاً لصفّ)';
END
$f$;

CREATE OR REPLACE FUNCTION fence.coverage_problems() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
  SELECT coalesce(jsonb_agg(p ORDER BY p->>'kind', p->>'object'), '[]'::jsonb) FROM (
    SELECT jsonb_build_object('kind', 'uncovered_relation', 'object', pr.schema_name || '.' || pr.rel_name) AS p
    FROM fence.protected_relations() pr
    WHERE NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = pr.relid AND t.tgname = 'xf_guard'
                        AND t.tgenabled = 'A' AND t.tgfoid = 'fence.guard_write()'::regprocedure
                        AND (t.tgtype & 1) = 0 AND (t.tgtype & 2) = 2 AND (t.tgtype & 60) = 60)
    UNION ALL
    SELECT jsonb_build_object('kind', 'rls_missing', 'object', pr.schema_name || '.' || pr.rel_name)
    FROM fence.protected_relations() pr JOIN pg_class c ON c.oid = pr.relid
    WHERE pr.relkind IN ('r', 'p') AND (NOT c.relrowsecurity
       OR NOT EXISTS (SELECT 1 FROM pg_policy po WHERE po.polrelid = pr.relid AND po.polname = 'xf_read'))
    UNION ALL
    -- WL-619 (‏LIVE-75/RLS-INITPLAN): xf_read بصيغتِه القانونيّةِ وحدَها — الساعةُ لكلِّ صفٍّ داخلَ نافذةِ الإيجار، لكلِّ أمرٍ ولـPUBLIC،
    -- متساهلةً. صيغةٌ أخرى (‏InitPlan قديم، أو USING (true)) سياجُ قراءةٍ وصفٍّ مُعطَّل.
    -- ‏**بلا قفل:** pg_get_expr(e, relid) يفتحُ العلاقةَ (‏AccessShareLock)، وهذه الدالّةُ تُستدعى عندَ التزامِ كلِّ DDL (‏xf_ddl_end) —
    -- فكانَ إنشاءُ جدولٍ ينتظرُ قفلاً على أيِّ جدولٍ محميّ (‏مقيس: WL-592 B2). الصيغةُ القانونيّةُ بلا عمود: relid = 0 لا يفتحُ
    -- شيئاً، وأيُّ Var (‏مرجعُ عمود) انحرافٌ قبلَ التفكيك (‏CASE يقصُر، فلا خطأَ «expression contains variables»).
    SELECT jsonb_build_object('kind', 'rls_policy_drift', 'object', pr.schema_name || '.' || pr.rel_name)
    FROM fence.protected_relations() pr JOIN pg_policy po ON po.polrelid = pr.relid AND po.polname = 'xf_read'
    WHERE po.polcmd <> '*' OR NOT po.polpermissive OR po.polroles <> '{0}'::oid[]
       OR CASE WHEN po.polqual IS NULL OR po.polqual::text LIKE '%{VAR %' THEN true
               ELSE btrim(regexp_replace(pg_get_expr(po.polqual, 0), '\s+', ' ', 'g')) IS DISTINCT FROM 'CASE WHEN (clock_timestamp() <@ ( SELECT fence.read_window() AS read_window)) THEN true ELSE fence.window_breach(( SELECT fence.read_window() AS read_window)) END' END
       OR CASE WHEN po.polwithcheck IS NULL OR po.polwithcheck::text LIKE '%{VAR %' THEN true
               ELSE pg_get_expr(po.polwithcheck, 0) IS DISTINCT FROM '(clock_timestamp() <@ ( SELECT fence.read_window() AS read_window))' END
    UNION ALL
    -- WL-619: سياسةٌ متساهلةٌ أخرى تُضَمُّ إلى xf_read بـOR فتُبطِلُه (‏المقيِّدةُ تُضيِّقُ فلا تُعَدّ).
    SELECT jsonb_build_object('kind', 'rls_extra_permissive_policy', 'object', pr.schema_name || '.' || pr.rel_name || ':' || po.polname)
    FROM fence.protected_relations() pr JOIN pg_policy po ON po.polrelid = pr.relid
    WHERE po.polname <> 'xf_read' AND po.polpermissive
    UNION ALL
    SELECT jsonb_build_object('kind', 'writing_rule', 'object', n.nspname || '.' || c.relname || ':' || r.rulename)
    FROM pg_rewrite r JOIN pg_class c ON c.oid = r.ev_class JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE r.ev_type <> '1' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    UNION ALL
    SELECT jsonb_build_object('kind', 'worker_owns_relation', 'object', pr.schema_name || '.' || pr.rel_name)
    FROM fence.protected_relations() pr JOIN pg_class c ON c.oid = pr.relid
    WHERE fence.is_worker_role(c.relowner) OR c.relowner = 'xuux_worker'::regrole
    UNION ALL
    SELECT jsonb_build_object('kind', 'forbidden_table_privilege', 'object', pr.schema_name || '.' || pr.rel_name || ':' || a.grantee::regrole::text || ':' || a.privilege_type)
    FROM fence.protected_relations() pr JOIN pg_class c ON c.oid = pr.relid,
         LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    WHERE a.grantee = 0
       OR (a.grantee <> 0 AND a.grantee <> c.relowner AND (fence.is_worker_role(a.grantee) OR a.grantee = 'xuux_worker'::regrole)
           AND a.privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN'))
       OR (a.grantee <> 0 AND a.grantee <> c.relowner AND fence.is_worker_role(a.grantee))
  ) q
$f$;

CREATE OR REPLACE FUNCTION fence.cover_relation(rel oid) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $f$
-- تُنفَّذُ بصلاحيةِ المُستدعي (مالكِ الجدول): لا SECURITY DEFINER هنا عمداً.
DECLARE q text := rel::regclass::text; k "char";
BEGIN
  SELECT relkind INTO k FROM pg_class WHERE oid = rel;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = rel AND tgname = 'xf_guard') THEN
    EXECUTE format('CREATE TRIGGER xf_guard BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION fence.guard_write()', q);
    EXECUTE format('ALTER TABLE %s ENABLE ALWAYS TRIGGER xf_guard', q);
  END IF;
  IF k IN ('r', 'p') THEN
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', q);
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = rel AND polname = 'xf_read') THEN
      EXECUTE format('CREATE POLICY xf_read ON %s AS PERMISSIVE FOR ALL TO PUBLIC USING (CASE WHEN clock_timestamp() <@ (SELECT fence.read_window()) THEN true ELSE fence.window_breach((SELECT fence.read_window())) END) WITH CHECK (clock_timestamp() <@ (SELECT fence.read_window()))', q);
    END IF;
  END IF;
END
$f$;

RESET ROLE;

DO $end$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT t.tgrelid::regclass::text AS rel FROM pg_trigger t WHERE t.tgname = 'xf_guard_end' ORDER BY 1 LOOP
    EXECUTE format('DROP TRIGGER xf_guard_end ON %s', r.rel);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'fence 0038 (تراجع): أُسقِطَ xf_guard_end من % علاقة', n;
END
$end$;

SET LOCAL ROLE xf_owner;

DELETE FROM fence.manifest WHERE function_signature IN (
  'fence.window_breach(tstzrange)',
  'fence.coverage_problems()',
  'fence.cover_relation(oid)');
INSERT INTO fence.manifest (function_signature, digest)
SELECT p.oid::regprocedure::text,
       encode(sha256(convert_to(concat_ws('|', p.prosrc, p.prosecdef::text, pg_get_userbyid(p.proowner),
         coalesce(array_to_string(p.proconfig, ','), ''), p.provolatile::text), 'UTF8')), 'hex')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'fence' AND p.oid::regprocedure::text IN (
  'fence.window_breach(tstzrange)',
  'fence.coverage_problems()',
  'fence.cover_relation(oid)');

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
    RAISE EXCEPTION 'fence: البيانُ لا يطابقُ % دالّة — بعدَ إعادةِ التسجيل', n;
  END IF;
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'fence' AND p.oid::regprocedure::text NOT IN (SELECT function_signature FROM fence.manifest);
  IF n > 0 THEN
    RAISE EXCEPTION 'fence: % دالّةٍ في fence خارجَ البيان — بعدَ إعادةِ التسجيل', n;
  END IF;
END
$manifest_post$;

RESET ROLE;

ALTER EVENT TRIGGER xf_ddl_end ENABLE ALWAYS;
