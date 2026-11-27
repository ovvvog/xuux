-- الهجرة 0036 (تراجع) — يُعيدُ xf_read إلى `(SELECT fence.read_ok())`، ويُعيدُ الدوالَّ الستَّ بنصِّ آخرِ تعريفٍ لها حرفيّاً
-- (‏0024: _worker_allowed_execute وcoverage_problems وcover_relation؛ 0034: _fence_acl_problems؛ 0030: reaper_capability_problems؛
-- 0035: check_fenced)، ويُسقِطُ fence.read_window(). **التراجعُ يُعيدُ العيبَ المقيس** (‏LIVE-75/RLS-INITPLAN).
--
-- **شرطُ التراجع:** superuser، وغيرُ RUNNING (‏D-13)، وxf_ddl_end وxf_ddl_drop على ENABLE ALWAYS.

DO $pre$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'fence: تراجعُ 0036 يتطلّبُ superuser (‏xf_ddl_end يُعطَّلُ داخلَ المعاملة)';
  END IF;
  IF (fence.effective_state()->>'state') = 'RUNNING' THEN
    RAISE EXCEPTION 'fence: لا تراجعُ 0036 تحتَ RUNNING — أوقِف أولاً (D-13)';
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
ALTER EVENT TRIGGER xf_ddl_drop DISABLE;

RESET ROLE;

-- ‏كلُّ xf_read على علاقةٍ محميّة (صيغةُ 0024). ALTER POLICY لمالكِ الجدولِ أو superuser — فخارجَ xf_owner.
DO $pol$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT po.polrelid::regclass::text AS rel FROM fence.protected_relations() pr
           JOIN pg_policy po ON po.polrelid = pr.relid AND po.polname = 'xf_read' ORDER BY 1 LOOP
    EXECUTE format('ALTER POLICY xf_read ON %s USING ((SELECT fence.read_ok())) WITH CHECK ((SELECT fence.read_ok()))', r.rel);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'fence 0036: xf_read على % علاقة', n;
END
$pol$;

SET LOCAL ROLE xf_owner;

CREATE OR REPLACE FUNCTION fence._worker_allowed_execute() RETURNS SETOF text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $f$
  VALUES ('fence.whoami()'), ('fence.read_ok()'), ('fence.effective_state()'), ('fence.session_tag()'),
         ('fence.seal_sessions(jsonb,bytea)')
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
      EXECUTE format('CREATE POLICY xf_read ON %s AS PERMISSIVE FOR ALL TO PUBLIC USING ((SELECT fence.read_ok())) WITH CHECK ((SELECT fence.read_ok()))', q);
    END IF;
  END IF;
END
$f$;

CREATE OR REPLACE FUNCTION fence._fence_acl_problems() RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $f$
DECLARE fence_ns oid; owner_oid oid; out jsonb;
BEGIN
  SELECT n.oid INTO fence_ns FROM pg_namespace n WHERE n.nspname = 'fence';
  SELECT r.oid INTO owner_oid FROM pg_roles r WHERE r.rolname = 'xf_owner';
  IF fence_ns IS NULL OR owner_oid IS NULL THEN
    RAISE EXCEPTION 'fence: المخطّطُ fence أو الدورُ xf_owner غائب — لا جردَ للامتيازات';
  END IF;
  WITH fn_base(sig, grantee) AS (
    VALUES
      ('fence._ddl_note(text)', 'xuux_migrator'),
      ('fence._ddl_note(text)', 'xuux_owner'),
      ('fence._worker_capability_problems()', 'xf_auditor'),
      ('fence._worker_capability_problems()', 'xf_root'),
      ('fence._worker_capability_problems()', 'xf_sovereign'),
      ('fence._worker_capability_problems()', 'xuux_migrator'),
      ('fence.breakglass_set(text,bytea)', 'xf_sovereign'),
      ('fence.capability_problems()', 'xf_auditor'),
      ('fence.capability_problems()', 'xf_root'),
      ('fence.capability_problems()', 'xf_sovereign'),
      ('fence.capability_problems()', 'xuux_migrator'),
      ('fence.check_fenced()', 'xf_auditor'),
      ('fence.check_fenced()', 'xf_root'),
      ('fence.check_fenced()', 'xf_sovereign'),
      ('fence.check_fenced()', 'xuux_migrator'),
      ('fence.cover_relation(oid)', 'xuux_migrator'),
      ('fence.cover_relation(oid)', 'xuux_owner'),
      ('fence.coverage_problems()', 'xuux_migrator'),
      ('fence.coverage_problems()', 'xuux_owner'),
      ('fence.credential_seal(name)', 'xf_root'),
      ('fence.ed25519_key_ok(bytea)', 'xf_sovereign'),
      ('fence.ed25519_verify(bytea,bytea,bytea)', 'xf_sovereign'),
      ('fence.effective_state()', 'xf_auditor'),
      ('fence.effective_state()', 'xf_root'),
      ('fence.effective_state()', 'xf_sovereign'),
      ('fence.effective_state()', 'xuux_migrator'),
      ('fence.effective_state()', 'xuux_worker'),
      ('fence.guard_write()', 'xuux_migrator'),
      ('fence.guard_write()', 'xuux_owner'),
      ('fence.halt_complete(bigint)', 'xf_root'),
      ('fence.halt_lock(bigint)', 'xf_root'),
      ('fence.halt_request(text)', 'xf_root'),
      ('fence.halt_request(text)', 'xf_sovereign'),
      ('fence.halt_revoke_and_terminate(bigint)', 'xf_root'),
      ('fence.issue_challenge(text,text)', 'xf_root'),
      ('fence.issue_credential(text,bytea)', 'xf_root'),
      ('fence.key_rotate(text,bytea)', 'xf_sovereign'),
      ('fence.lease_set(text,bytea)', 'xf_sovereign'),
      ('fence.notify_surface()', 'xf_auditor'),
      ('fence.notify_surface()', 'xf_root'),
      ('fence.notify_surface()', 'xf_sovereign'),
      ('fence.notify_surface()', 'xuux_migrator'),
      ('fence.protected_relations()', 'xuux_migrator'),
      ('fence.protected_relations()', 'xuux_owner'),
      ('fence.read_ok()', 'PUBLIC'),
      ('fence.read_ok()', 'xuux_migrator'),
      ('fence.read_ok()', 'xuux_owner'),
      ('fence.read_ok()', 'xuux_worker'),
      ('fence.reap_lapsed()', 'xf_root'),
      ('fence.reap_lapsed()', 'xf_sovereign'),
      ('fence.reaper_capabilities()', 'xf_auditor'),
      ('fence.reaper_capabilities()', 'xf_root'),
      ('fence.reaper_capabilities()', 'xf_sovereign'),
      ('fence.reaper_capabilities()', 'xuux_migrator'),
      ('fence.reaper_capability_problems()', 'xf_auditor'),
      ('fence.reaper_capability_problems()', 'xf_root'),
      ('fence.reaper_capability_problems()', 'xf_sovereign'),
      ('fence.reaper_capability_problems()', 'xuux_migrator'),
      ('fence.reaper_health(integer)', 'xf_auditor'),
      ('fence.reaper_health(integer)', 'xf_root'),
      ('fence.reaper_health(integer)', 'xf_sovereign'),
      ('fence.reaper_tick(uuid,integer,integer)', 'xf_reaper'),
      ('fence.record_effects_evidence(text,jsonb)', 'xf_root'),
      ('fence.recover(text,bytea)', 'xf_sovereign'),
      ('fence.renew_lease(name)', 'xf_root'),
      ('fence.resume(text,bytea)', 'xf_sovereign'),
      ('fence.revoke_credential(name,text)', 'xf_root'),
      ('fence.roster_set(text,bytea)', 'xf_sovereign'),
      ('fence.seal_sessions(jsonb,bytea)', 'xuux_worker'),
      ('fence.session_tag()', 'xuux_worker'),
      ('fence.status()', 'xf_auditor'),
      ('fence.status()', 'xf_root'),
      ('fence.status()', 'xf_sovereign'),
      ('fence.status()', 'xuux_migrator'),
      ('fence.whoami()', 'xuux_worker'),
      ('fence.worker_capabilities()', 'xf_auditor'),
      ('fence.worker_capabilities()', 'xf_root'),
      ('fence.worker_capabilities()', 'xf_sovereign'),
      ('fence.worker_capabilities()', 'xuux_migrator')
  ), items AS (
    SELECT 'relation'::text AS axis, c.oid::regclass::text AS object, c.relowner AS owner, a.grantee, a.privilege_type, a.is_grantable
    FROM pg_class c, LATERAL aclexplode(coalesce(c.relacl,
      acldefault(CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END::"char", c.relowner))) a
    WHERE c.relnamespace = fence_ns AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    UNION ALL
    SELECT 'column', c.oid::regclass::text || '.' || quote_ident(att.attname), c.relowner, a.grantee, a.privilege_type, a.is_grantable
    FROM pg_class c JOIN pg_attribute att ON att.attrelid = c.oid, LATERAL aclexplode(att.attacl) a
    WHERE c.relnamespace = fence_ns AND att.attacl IS NOT NULL
    UNION ALL
    SELECT 'function', p.oid::regprocedure::text, p.proowner, a.grantee, a.privilege_type, a.is_grantable
    FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.pronamespace = fence_ns
    UNION ALL
    SELECT 'schema', 'fence', n.nspowner, a.grantee, a.privilege_type, a.is_grantable
    FROM pg_namespace n, LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
    WHERE n.oid = fence_ns
    UNION ALL
    SELECT 'default_acl', pg_get_userbyid(d.defaclrole) || '/' || coalesce(d.defaclnamespace::regnamespace::text, '*') || '/'
           || d.defaclobjtype::text, d.defaclrole, a.grantee, a.privilege_type, a.is_grantable
    FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) a
    WHERE d.defaclnamespace = fence_ns OR d.defaclrole = owner_oid
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', 'fence_acl_drift', 'axis', i.axis, 'object', i.object,
           'grantee', CASE WHEN i.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(i.grantee) END,
           'privilege', i.privilege_type, 'grantable', i.is_grantable)
           ORDER BY i.axis, i.object, i.grantee, i.privilege_type), '[]'::jsonb)
  INTO out
  FROM items i
  WHERE i.grantee <> i.owner
    AND (i.is_grantable
      OR CASE i.axis
           WHEN 'relation' THEN i.privilege_type <> 'SELECT'
           WHEN 'column' THEN i.privilege_type <> 'SELECT'
           WHEN 'default_acl' THEN i.privilege_type <> 'SELECT'
           WHEN 'schema' THEN i.privilege_type <> 'USAGE'
           WHEN 'function' THEN NOT EXISTS (
             SELECT 1 FROM fn_base b WHERE b.sig = i.object
               AND b.grantee = CASE WHEN i.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(i.grantee) END)
         END);
  RETURN out;
END
$f$;

CREATE OR REPLACE FUNCTION fence.reaper_capability_problems() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
  WITH cap AS (SELECT x FROM jsonb_array_elements(fence.reaper_capabilities()) x),
  attr AS (SELECT x->'detail' AS d FROM cap WHERE x->>'axis' = 'role_attribute'),
  p AS (
    SELECT 'reaper_role_missing' AS kind, x->>'object' AS object, x->>'privilege' AS privilege, x->>'via' AS via
    FROM cap WHERE x->>'axis' = 'role_missing'
    UNION ALL
    SELECT 'reaper_role_attribute', 'xf_reaper', a.attr, 'direct' FROM attr,
      LATERAL (VALUES
        (CASE WHEN (d->>'superuser')::boolean THEN 'SUPERUSER' END),
        (CASE WHEN (d->>'createrole')::boolean THEN 'CREATEROLE' END),
        (CASE WHEN (d->>'createdb')::boolean THEN 'CREATEDB' END),
        (CASE WHEN (d->>'replication')::boolean THEN 'REPLICATION' END),
        (CASE WHEN (d->>'bypassrls')::boolean THEN 'BYPASSRLS' END),
        (CASE WHEN (d->>'inherit')::boolean THEN 'INHERIT' END),
        (CASE WHEN (d->>'connlimit')::int < 0 OR (d->>'connlimit')::int > 2 THEN 'CONNECTION_LIMIT:' || (d->>'connlimit') END),
        (CASE WHEN (d->>'password_usable')::boolean THEN 'PASSWORD_USABLE' END)) a(attr)
    WHERE a.attr IS NOT NULL
    UNION ALL
    SELECT 'reaper_membership', x->>'object', x->>'privilege', x->>'via' FROM cap WHERE x->>'axis' = 'membership'
    UNION ALL
    SELECT 'reaper_owns_objects', x->>'object', 'OWNER', x->>'via' FROM cap WHERE x->>'axis' = 'ownership'
    UNION ALL
    SELECT 'reaper_shared_dependency', x->>'object', x->>'privilege', x->>'via' FROM cap
    WHERE x->>'axis' = 'shared_dependency'
      AND NOT (x->>'privilege' = 'a' AND (x->'detail'->>'local')::boolean AND (
            (x->'detail'->>'class' = 'pg_database' AND (x->'detail'->>'objid')::oid = (SELECT oid FROM pg_database WHERE datname = current_database()))
         OR (x->'detail'->>'class' = 'pg_namespace' AND (x->'detail'->>'objid')::oid = 'fence'::regnamespace)
         OR (x->'detail'->>'class' = 'pg_proc' AND (x->'detail'->>'objid')::oid = to_regprocedure('fence.reaper_tick(uuid,integer,integer)'))))
      AND NOT (x->>'privilege' = 'a' AND (x->'detail'->>'peer')::boolean)
    UNION ALL
    SELECT CASE WHEN x->>'privilege' = 'CREATE' THEN 'reaper_database_create'
                WHEN x->>'privilege' = 'TEMPORARY' THEN 'reaper_database_temp'
                ELSE 'reaper_database_reach' END, x->>'object', x->>'privilege', x->>'via'
    FROM cap WHERE x->>'axis' = 'database'
      AND NOT (x->>'object' = 'current' AND x->>'privilege' = 'CONNECT' AND x->>'via' = 'direct')
      AND NOT (x->>'privilege' = 'CONNECT' AND NOT (x->'detail'->>'allowconn')::boolean)
      AND NOT (x->>'privilege' = 'CONNECT' AND x->>'via' = 'direct' AND (x->'detail'->>'peer')::boolean)
    UNION ALL
    SELECT 'reaper_schema_privilege', x->>'object', x->>'privilege', x->>'via' FROM cap
    WHERE x->>'axis' = 'schema'
      AND NOT (x->>'privilege' = 'USAGE' AND x->>'object' = 'fence' AND x->>'via' IN ('direct', 'PUBLIC'))
      AND NOT (x->>'privilege' = 'USAGE' AND x->>'via' = 'PUBLIC')
    UNION ALL
    SELECT 'reaper_' || (x->>'axis') || '_privilege', x->>'object', x->>'privilege', x->>'via' FROM cap
    WHERE x->>'axis' IN ('relation', 'sequence', 'column')
      -- استثناءٌ مُعلَّل: UPDATE على pg_settings عبر PUBLIC افتراضيٌّ في PG ويعادلُ SET للجلسة نفسِها فقط (لا يمسّ جلساتٍ أخرى).
      AND NOT (x->>'object' = 'pg_settings' AND x->>'privilege' = 'UPDATE' AND x->>'via' = 'PUBLIC')
    UNION ALL
    SELECT CASE WHEN (x->'detail'->>'schema') = 'fence' THEN 'reaper_fence_function_execute'
                WHEN (x->'detail'->>'schema') IN ('pg_catalog', 'information_schema') THEN 'reaper_catalog_sensitive_execute'
                WHEN NOT (x->'detail'->>'trusted')::boolean THEN 'reaper_untrusted_function_execute'
                WHEN (x->'detail'->>'secdef')::boolean THEN 'reaper_secdef_execute'
                ELSE 'reaper_function_execute' END, x->>'object', 'EXECUTE', x->>'via'
    FROM cap WHERE x->>'axis' = 'function'
      AND NOT (x->>'object' = 'fence.reaper_tick(uuid,integer,integer)' AND x->>'via' = 'direct')
      AND NOT (x->>'object' = 'fence.read_ok()' AND x->>'via' = 'PUBLIC')
      AND NOT (x->>'object' IN ('pg_terminate_backend(integer,bigint)', 'pg_cancel_backend(integer)') AND x->>'via' = 'PUBLIC')
      -- استثناءٌ مُعلَّل وضيّق: دالّةُ state بصلاحيةِ المستدعي (ليست SECURITY DEFINER)، IMMUTABLE، بلغةٍ موثوقة، عبر PUBLIC —
      -- لا تمنحُ قدرةً تتجاوزُ قدرةَ المستدعي نفسِه (موجودٌ: text_array_is_named و report_sections_declared لقيود CHECK).
      AND NOT (x->>'via' = 'PUBLIC' AND x->'detail'->>'schema' = 'state' AND NOT (x->'detail'->>'secdef')::boolean
               AND (x->'detail'->>'trusted')::boolean AND x->'detail'->>'volatile' = 'i')
    UNION ALL
    SELECT 'reaper_' || (x->>'axis') || '_privilege', x->>'object', x->>'privilege', x->>'via' FROM cap
    WHERE x->>'axis' IN ('tablespace', 'foreign', 'parameter', 'default_acl', 'large_object')
    UNION ALL
    SELECT 'reaper_role_setting', x->>'object', x->>'privilege', x->>'via' FROM cap WHERE x->>'axis' = 'role_setting'
    UNION ALL
    SELECT 'reaper_surface_extra_grantee', x->>'object', x->>'privilege', x->>'via' FROM cap
    WHERE x->>'axis' = 'reaper_surface_grantee'
      AND NOT (x->>'object' = 'fence.reaper_tick(uuid,integer,integer)' AND x->>'via' = 'xf_reaper' AND x->>'privilege' = 'EXECUTE')
      AND NOT (x->>'object' = 'fence.reaper_health(integer)' AND x->>'via' IN ('xf_root', 'xf_sovereign', 'xf_auditor') AND x->>'privilege' = 'EXECUTE')
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'object', object, 'privilege', privilege, 'via', via)
                            ORDER BY kind, object, privilege), '[]'::jsonb) FROM p
$f$;

CREATE OR REPLACE FUNCTION fence.check_fenced() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE
  problems jsonb := '[]'::jsonb;
  residuals jsonb := '[]'::jsonb;
  eff jsonb := fence.effective_state();
  live jsonb := fence._live_incarnation();
  c fence.control;
  n bigint;
  x jsonb;
  m record;
BEGIN
  IF eff->>'state' = 'MISSING' THEN
    RETURN jsonb_build_object('ok', false, 'problems', jsonb_build_array(jsonb_build_object('kind', 'control_missing')));
  END IF;
  SELECT * INTO c FROM fence.control WHERE id;
  IF eff ? 'problem' THEN
    problems := problems || jsonb_build_array(jsonb_build_object('kind', eff->>'problem'));
  END IF;
  IF c.timeline IS DISTINCT FROM (live->>'timeline')::int THEN
    problems := problems || jsonb_build_array(jsonb_build_object('kind', 'timeline_mismatch',
      'stored', c.timeline, 'live', live->'timeline'));
  END IF;
  -- جلساتُ العمال (كلُّ عضوٍ في xuux_worker، نشِطاً أو ملغى).
  SELECT count(*) INTO n FROM pg_stat_activity a
  WHERE a.usesysid IS NOT NULL AND fence.is_worker_role(a.usesysid);
  IF n > 0 THEN problems := problems || jsonb_build_array(jsonb_build_object('kind', 'worker_sessions', 'count', n)); END IF;
  -- اعتماداتٌ نشِطةٌ أو أدوارُ عمالٍ قادرةٌ على الدخول.
  SELECT count(*) INTO n FROM fence.credentials WHERE status = 'ACTIVE';
  IF n > 0 THEN problems := problems || jsonb_build_array(jsonb_build_object('kind', 'active_credentials', 'count', n)); END IF;
  SELECT coalesce(jsonb_agg(r.rolname ORDER BY r.rolname), '[]'::jsonb) INTO x FROM pg_roles r
  WHERE r.rolcanlogin AND fence.is_worker_role(r.oid);
  IF jsonb_array_length(x) > 0 THEN problems := problems || jsonb_build_array(jsonb_build_object('kind', 'worker_login_roles', 'roles', x)); END IF;
  -- WL-538: أثرُ ALTER ROLE الذاتيّ على أيِّ دورِ عامل (‏نشِطاً أو ملغى لم يُسقَط) أو على xuux_worker نفسِه:
  -- إعداداتٌ دائمة، أو دورٌ تُقبَلُ له كلمةُ مرور (‏VALID UNTIL ليس '-infinity'). البصمةُ المخزَّنةُ لا تُرى هنا.
  SELECT coalesce(jsonb_agg(DISTINCT r.rolname ORDER BY r.rolname), '[]'::jsonb) INTO x FROM pg_db_role_setting st
    JOIN pg_roles r ON r.oid = st.setrole WHERE fence._is_worker_identity(r.oid) OR r.rolname = 'xuux_worker';
  IF jsonb_array_length(x) > 0 THEN problems := problems || jsonb_build_array(jsonb_build_object('kind', 'worker_role_settings', 'roles', x)); END IF;
  SELECT coalesce(jsonb_agg(r.rolname ORDER BY r.rolname), '[]'::jsonb) INTO x FROM pg_roles r
  WHERE fence._is_worker_identity(r.oid) AND r.rolvaliduntil IS DISTINCT FROM '-infinity'::timestamptz;
  IF jsonb_array_length(x) > 0 THEN problems := problems || jsonb_build_array(jsonb_build_object('kind', 'worker_password_auth_enabled', 'roles', x)); END IF;
  SELECT count(*) INTO n FROM fence.run_lease WHERE expires_at > clock_timestamp();
  IF n > 0 THEN problems := problems || jsonb_build_array(jsonb_build_object('kind', 'unexpired_leases', 'count', n)); END IF;
  -- أدوارُ دخولٍ قادرةٌ على التجاوز: غيرُ المُعلَنةِ مشكلة، والمُعلَنةُ حدٌّ ظاهر.
  SELECT coalesce(jsonb_agg(r.rolname ORDER BY r.rolname), '[]'::jsonb) INTO x FROM pg_roles r
  WHERE r.rolcanlogin AND (r.rolsuper OR r.rolbypassrls OR r.rolreplication OR r.rolcreaterole)
    AND r.rolname NOT IN (SELECT role_name FROM fence.breakglass);
  IF jsonb_array_length(x) > 0 THEN problems := problems || jsonb_build_array(jsonb_build_object('kind', 'undeclared_bypass_login_roles', 'roles', x)); END IF;
  SELECT coalesce(jsonb_agg(b.role_name ORDER BY b.role_name), '[]'::jsonb) INTO x FROM fence.breakglass b;
  IF jsonb_array_length(x) > 0 THEN residuals := residuals || jsonb_build_array(jsonb_build_object('kind', 'declared_breakglass_outside_fence', 'roles', x, 'note', 'T-OWN-04: superuser/root خارجَ السياج')); END IF;
  -- المعاملاتُ المُعدَّة (2PC).
  SELECT count(*) INTO n FROM pg_prepared_xacts;
  IF n > 0 THEN problems := problems || jsonb_build_array(jsonb_build_object('kind', 'prepared_transactions', 'count', n)); END IF;
  IF current_setting('max_prepared_transactions')::int > 0 THEN
    problems := problems || jsonb_build_array(jsonb_build_object('kind', 'max_prepared_transactions_enabled', 'value', current_setting('max_prepared_transactions')));
  END IF;
  -- أقفالٌ استشاريةٌ يحملُها عمال.
  SELECT count(*) INTO n FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
  WHERE l.locktype = 'advisory' AND a.usesysid IS NOT NULL AND fence.is_worker_role(a.usesysid);
  IF n > 0 THEN problems := problems || jsonb_build_array(jsonb_build_object('kind', 'worker_advisory_locks', 'count', n)); END IF;
  -- التغطية.
  problems := problems || fence.coverage_problems();
  -- WL-539: ثوابتُ قدراتِ العاملِ البنيويّة (‏ملكيّة، منحٌ مباشر، عضويّة، SECURITY DEFINER، انجرافُ الكتالوج…).
  -- خطأٌ في الجردِ لا يُسقِطُ check_fenced (‏فالإيقافُ يكتمل) ويُغلَقُ عليه: مشكلةٌ تمنعُ RESUME.
  BEGIN
    problems := problems || fence.capability_problems();
  EXCEPTION WHEN OTHERS THEN
    problems := problems || jsonb_build_array(jsonb_build_object('kind', 'capability_inventory_failed', 'sqlstate', SQLSTATE, 'message', SQLERRM));
  END;
  -- WL-551: مَن يصيرُ xf_owner (‏مالكُ مخطّطِ السياجِ ودوالِّه، CREATEROLE، ADMIN على xuux_worker): كلُّ عضويّةٍ لدورٍ غيرِ
  -- superuser فيه — مباشرةً أو عبرَ أيِّ سلسلةٍ (‏ولو بدورٍ وسيطٍ NOLOGIN)، وبأيِّ تركيبٍ من ADMIN/INHERIT/SET — مشكلةٌ تمنعُ
  -- RESUME. خطأٌ في الجردِ مشكلةٌ كذلك (‏فشلٌ مغلق) ولا يُسقِطُ check_fenced (‏فالإيقافُ يُفحَصُ ويبقى HALT_REQUESTED).
  BEGIN
    problems := problems || fence._owner_membership_problems();
  EXCEPTION WHEN OTHERS THEN
    problems := problems || jsonb_build_array(jsonb_build_object('kind', 'owner_membership_inventory_failed', 'sqlstate', SQLSTATE, 'message', SQLERRM));
  END;
  -- WL-563: عضويّةُ xf_owner الصاعدة — دورٌ يصلُ إليه xf_owner خارجَ أساسِه (‏xf_root أو xf_sovereign أو superuser أو أيُّ دور)
  -- مشكلةٌ تمنعُ RESUME: `GRANT xf_root TO xf_owner` كانت تُعفي كلَّ عضوٍ في xf_owner من XF105/XF107 ولا يراها check_fenced.
  -- خطأٌ في الجردِ مشكلةٌ كذلك (‏فشلٌ مغلق) ولا يُسقِطُ check_fenced.
  BEGIN
    problems := problems || fence._owner_reach_problems();
  EXCEPTION WHEN OTHERS THEN
    problems := problems || jsonb_build_array(jsonb_build_object('kind', 'owner_reach_inventory_failed', 'sqlstate', SQLSTATE, 'message', SQLERRM));
  END;
  -- WL-564: امتيازٌ في fence لغيرِ المالكِ خارجَ أساسِه (‏كتابةٌ أو تنفيذٌ أو خيارُ منح) مشكلةٌ تمنعُ RESUME: منحٌ منجرفٌ من عضوٍ
  -- مُعفىً في xf_owner يبقى بعدَ سحبِ العضويّة، ولم يكن check_fenced يرى منه إلّا ما يخصُّ العاملَ والحاصد. خطأٌ في الجردِ مشكلةٌ
  -- كذلك (‏فشلٌ مغلق) ولا يُسقِطُ check_fenced.
  BEGIN
    problems := problems || fence._fence_acl_problems();
  EXCEPTION WHEN OTHERS THEN
    problems := problems || jsonb_build_array(jsonb_build_object('kind', 'fence_acl_inventory_failed', 'sqlstate', SQLSTATE, 'message', SQLERRM));
  END;
  -- WL-570: سياسةُ المالك — لا عضويّةَ بينَ xf_root وxf_sovereign وxf_owner في أيِّ اتّجاه، مباشرةً أو عبرَ وسيط، وبأيِّ خيارات
  -- (‏ADMIN/INHERIT/SET). كانت حافّةُ الجذرِ والسياديِّ بينهما لا تُرى (‏RESUME ينجح). خطأٌ في الجردِ مشكلةٌ كذلك (‏فشلٌ مغلق).
  BEGIN
    problems := problems || fence._sovereign_membership_problems();
  EXCEPTION WHEN OTHERS THEN
    problems := problems || jsonb_build_array(jsonb_build_object('kind', 'sovereign_membership_inventory_failed', 'sqlstate', SQLSTATE, 'message', SQLERRM));
  END;
  -- مُطلِقاتُ DDL حاضرةٌ ومُفعَّلة.
  SELECT count(*) INTO n FROM pg_event_trigger WHERE evtname IN ('xf_ddl_start', 'xf_ddl_end', 'xf_ddl_drop') AND evtenabled IN ('O', 'A');
  IF n <> 3 THEN problems := problems || jsonb_build_array(jsonb_build_object('kind', 'event_triggers_missing_or_disabled', 'enabled', n)); END IF;
  -- البيان: دوالُّ السياجِ كما ثُبِّتت عند الهجرة.
  FOR m IN
    SELECT mf.function_signature, mf.digest, d.digest AS live_digest FROM fence.manifest mf
    LEFT JOIN LATERAL (
      SELECT encode(sha256(convert_to(concat_ws('|', p.prosrc, p.prosecdef::text, pg_get_userbyid(p.proowner),
             coalesce(array_to_string(p.proconfig, ','), ''), p.provolatile::text), 'UTF8')), 'hex') AS digest
      FROM pg_proc p WHERE p.oid = to_regprocedure(mf.function_signature)) d ON true
    WHERE d.digest IS DISTINCT FROM mf.digest
  LOOP
    problems := problems || jsonb_build_array(jsonb_build_object('kind', 'fence_function_tampered', 'function', m.function_signature));
  END LOOP;
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'fence' AND p.oid::regprocedure::text NOT IN (SELECT function_signature FROM fence.manifest);
  IF n > 0 THEN problems := problems || jsonb_build_array(jsonb_build_object('kind', 'unlisted_fence_functions', 'count', n)); END IF;
  -- امتيازاتُ العامل: لا CREATE في أيِّ مخطّط، ولا TEMP، ولا كائناتٍ كبيرة، ولا عضويةَ أخرى.
  SELECT coalesce(jsonb_agg(ns.nspname ORDER BY ns.nspname), '[]'::jsonb) INTO x FROM pg_namespace ns
  WHERE has_schema_privilege('xuux_worker', ns.oid, 'CREATE');
  IF jsonb_array_length(x) > 0 THEN problems := problems || jsonb_build_array(jsonb_build_object('kind', 'worker_can_create', 'schemas', x)); END IF;
  IF has_database_privilege('xuux_worker', current_database(), 'TEMPORARY') THEN
    problems := problems || jsonb_build_array(jsonb_build_object('kind', 'worker_can_create_temp'));
  END IF;
  SELECT coalesce(jsonb_agg(p.oid::regprocedure::text ORDER BY 1), '[]'::jsonb) INTO x FROM pg_proc p
  WHERE p.pronamespace = 'pg_catalog'::regnamespace
    AND p.proname IN ('lo_creat', 'lo_create', 'lo_from_bytea', 'lo_put', 'lowrite', 'lo_unlink', 'lo_truncate', 'lo_truncate64', 'lo_open', 'lo_import')
    AND has_function_privilege('xuux_worker', p.oid, 'EXECUTE');
  IF jsonb_array_length(x) > 0 THEN problems := problems || jsonb_build_array(jsonb_build_object('kind', 'worker_large_object_write', 'functions', x)); END IF;
  -- WL-537: رسالةُ WAL المنطقيّةُ أثرٌ خارجَ الزنادِ يصلُ المستهلكين — لا EXECUTE للعامل.
  SELECT coalesce(jsonb_agg(p.oid::regprocedure::text ORDER BY 1), '[]'::jsonb) INTO x FROM pg_proc p
  WHERE p.pronamespace = 'pg_catalog'::regnamespace AND p.proname = 'pg_logical_emit_message'
    AND has_function_privilege('xuux_worker', p.oid, 'EXECUTE');
  IF jsonb_array_length(x) > 0 THEN problems := problems || jsonb_build_array(jsonb_build_object('kind', 'worker_wal_message_write', 'functions', x)); END IF;
  -- WL-541: pg_notify(text,text) مسحوبةٌ من PUBLIC — أعادتُها (‏لـPUBLIC، أو مباشرةً، أو عبرَ دورٍ يرثُه العامل) انحراف.
  -- أمرُ NOTIFY نفسُه بلا امتيازٍ يُسحَب: متبقٍّ مُعلَن أدناه (‏notify_not_revocable)، لا يُخفى هنا.
  SELECT coalesce(jsonb_agg(p.oid::regprocedure::text ORDER BY 1), '[]'::jsonb) INTO x FROM pg_proc p
  WHERE p.pronamespace = 'pg_catalog'::regnamespace AND p.proname = 'pg_notify'
    AND EXISTS (SELECT 1 FROM fence._worker_principals() w WHERE has_function_privilege(w.oid, p.oid, 'EXECUTE'));
  IF jsonb_array_length(x) > 0 THEN problems := problems || jsonb_build_array(jsonb_build_object('kind', 'worker_notify_function', 'functions', x)); END IF;
  -- WL-541: CONNECT لـPUBLIC على القاعدةِ المسيَّجة (‏سحبَته الهجرة) يجعلُ كلَّ دورِ دخولٍ في العنقودِ مستمعاً محتملاً لإشعاراتِ العامل.
  IF has_database_privilege('public', current_database(), 'CONNECT') THEN
    problems := problems || jsonb_build_array(jsonb_build_object('kind', 'notify_listener_public', 'database', current_database()));
  END IF;
  -- WL-536: nextval/setval كتابةٌ لا معامليّةٌ خارجَ الزناد — لا USAGE ولا UPDATE للعاملِ على أيِّ تسلسل.
  SELECT coalesce(jsonb_agg(c2.oid::regclass::text ORDER BY 1), '[]'::jsonb) INTO x FROM pg_class c2
  WHERE c2.relkind = 'S' AND (has_sequence_privilege('xuux_worker', c2.oid, 'USAGE') OR has_sequence_privilege('xuux_worker', c2.oid, 'UPDATE'));
  IF jsonb_array_length(x) > 0 THEN problems := problems || jsonb_build_array(jsonb_build_object('kind', 'worker_sequence_write', 'sequences', x)); END IF;
  SELECT coalesce(jsonb_agg(g.roleid::regrole::text ORDER BY 1), '[]'::jsonb) INTO x FROM pg_auth_members g
  WHERE g.member = 'xuux_worker'::regrole;
  IF jsonb_array_length(x) > 0 THEN problems := problems || jsonb_build_array(jsonb_build_object('kind', 'worker_inherits_roles', 'roles', x)); END IF;
  SELECT coalesce(jsonb_agg(p.oid::regprocedure::text ORDER BY 1), '[]'::jsonb) INTO x FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'fence' AND has_function_privilege('xuux_worker', p.oid, 'EXECUTE')
    AND p.oid NOT IN ('fence.whoami()'::regprocedure, 'fence.read_ok()'::regprocedure, 'fence.effective_state()'::regprocedure,
                      'fence.session_tag()'::regprocedure, 'fence.seal_sessions(jsonb, bytea)'::regprocedure);
  IF jsonb_array_length(x) > 0 THEN problems := problems || jsonb_build_array(jsonb_build_object('kind', 'worker_fence_execute', 'functions', x)); END IF;
  SELECT coalesce(jsonb_agg(e.extname ORDER BY 1), '[]'::jsonb) INTO x FROM pg_extension e
  WHERE e.extname IN ('dblink', 'postgres_fdw', 'file_fdw', 'adminpack', 'pg_background', 'plpython3u', 'plperlu');
  IF jsonb_array_length(x) > 0 THEN problems := problems || jsonb_build_array(jsonb_build_object('kind', 'escape_extensions', 'extensions', x)); END IF;
  -- WL-561: كلُّ جدولٍ في fence غيرِ control عليه xf_owner_writer مفعَّلاً ALWAYS (‏جدولٌ جديدٌ بلا حارسٍ أو حارسٌ معطَّلٌ ⇒ مشكلة).
  SELECT coalesce(jsonb_agg(rc.relname::text ORDER BY 1), '[]'::jsonb) INTO x FROM pg_class rc
  WHERE rc.relnamespace = 'fence'::regnamespace AND rc.relkind IN ('r', 'p') AND rc.relname <> 'control'
    AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = rc.oid AND t.tgname = 'xf_owner_writer' AND t.tgenabled = 'A'
                     AND t.tgfoid = 'fence._table_writer_guard()'::regprocedure);
  IF jsonb_array_length(x) > 0 THEN problems := problems || jsonb_build_array(jsonb_build_object('kind', 'fence_table_writer_unguarded', 'tables', x)); END IF;
  residuals := residuals || jsonb_build_array(
    -- WL-551: الكشفُ لا المنع. عضوٌ في xf_owner يملكُ fence.* (‏يكتبُ control بعهدٍ أعلى ويُعيدُ الختمَ بـ_reseal) فيتخطّى RESUME
    -- كلَّه؛ ومنعُه يحتاجُ تغييرَ نموذجِ xf_owner (‏قرارُ مالك). هذا الفحصُ يُظهِرُ العضويّةَ ويمنعُ المسارَ المشروعَ وحدَه.
    jsonb_build_object('kind', 'owner_membership_detect_only', 'note', 'عضويّةُ xf_owner تُكشَفُ (‏owner_membership) فيُرفَضُ RESUME ويبقى HALT_REQUESTED؛ لكنّ العضوَ النشِطَ مالكٌ للسياج: لا يكتبُ fence.control (‏0031: الكاتبُ session_user من xf_root أو xf_sovereign أو superuser ⇒ XF105، والعضوُ لا يكتبُ RUNNING ⇒ XF106) فلا استيلاءَ بـ_reseal؛ ولا يكتبُ جداولَ fence الأخرى (‏0032: XF107 — الإيجار، الاعتماد، الأدوار، البيان) ما لم يكن جذراً أو سياديّاً؛ والعضوُ الجذريُّ أو السياديُّ يبقى قادراً على كتابتِها، وكلُّ عضوٍ يقفلُ الصفوفَ ويُرسلُ الإشارات (‏توفّرٌ لا استيلاء) — منعُ ذلك يحتاجُ تغييرَ نموذجِ xf_owner (‏قرارُ مالك)، وsuperuser خارجَ السياج (‏T-OWN-04)'),
    -- WL-541: السطحُ مقيسٌ لا مُفترَض — مَن يستطيعُ الدخولَ (‏= LISTEN) ومن أين؛ مَن يستمعُ فعلاً لا يُرى.
    jsonb_build_object('kind', 'notify_not_revocable', 'surface', fence.notify_surface(), 'note', 'أمرُ NOTIFY بلا امتيازٍ يُسحَب (‏pg_notify مسحوبةٌ من PUBLIC — WL-541): العاملُ يُرسِلُ ما دامت جلستُه حيّة — بعدَ الختمِ، وبعدَ انقضاءِ الإيجارِ حتى الحصادِ (‏reap_lapsed، WL-542: للجذرِ أو السياديّ، والانقضاءُ نهائيّ) أو الإلغاءِ أو الإيقاف؛ والإشعارُ الملتزَمُ قبلَ إنهاءِ الجلسةِ يصلُ مستمعاً كان متّصلاً ولو بعدَه، ولا يُخزَّنُ لمستمعٍ لاحق. المستمعُ: كلُّ مَن يدخلُ هذه القاعدة (‏surface.listeners) — لا مستهلكَ في المستودع، وما خارجَه لا يُثبَتُ غيابُه؛ والمنعُ من أصلِه يحتاجُ خطّافاً بلغةِ C (‏قرارُ معمار، E3)'),
    -- WL-570: الكشفُ عندَ البوّابتين لا المنع — superuser يستطيعُ إنشاءَ العضويّةِ المخالفة، ولا ضابطَ داخلَ القاعدةِ بلا امتدادِ C.
    jsonb_build_object('kind', 'sovereign_membership_detect_only', 'note', 'سياسةُ «لا عضويّةَ بينَ xf_root وxf_sovereign وxf_owner» (‏قرارُ المالك، WL-570) تُكشَفُ عندَ RESUME وhalt_complete فيُرفَضُ الانتقال (‏sovereign_membership)؛ لا تُمنَعُ: غيرُ superuser لا يملكُ منحَها أصلاً، وsuperuser يملكُه ولا يُلتقَطُ GRANT ROLE داخلَ القاعدةِ بلا خطّافٍ بلغةِ C (‏T-OWN-04)؛ وحافّةٌ تُمنَحُ أثناءَ RUNNING لا تُرى حتى الانتقالِ التالي'),
    jsonb_build_object('kind', 'db_clock_trusted', 'note', 'الإيجارُ يُقاسُ بساعةِ القاعدة: التقدّمُ يُغلِق، والتراجعُ قبلَ آخرِ تجديدٍ يُرفَضُ (XF012)، وما دونَه يمدُّ الإيجارَ بما لا يزيدُ على نافذةٍ واحدة؛ العبثُ بها خارجَ السياج'),
    jsonb_build_object('kind', 'worker_self_alter_role', 'note', 'ALTER ROLE <نفسه> PASSWORD/SET بلا امتيازٍ يُسحَب ولا مُطلِقِ أحداث (WL-538): الإعداداتُ تُرفَضُ كتابتُها (XF013) وتُمحى عندَ الختمِ والإلغاءِ والإيقاف، وكلمةُ المرورِ لا تُدخِلُ أحداً (VALID UNTIL -infinity) وتُمحى كذلك؛ لكنّ الكتابةَ نفسَها تبقى ممكنةً بإيجارٍ منقضٍ حتى الانتقالِ التالي: إعداداتٌ يقرؤُها كلُّ دور، وبصمةٌ بمحتوًى يختارُه العاملُ لا يراها إلا superuser؛ ومنعُ الأمرِ من أصلِه يحتاجُ خطّافاً بلغةِ C (قرارُ معمار)'));
  RETURN jsonb_build_object('ok', jsonb_array_length(problems) = 0, 'problems', problems, 'residuals', residuals,
    'state', eff->'state', 'epoch', c.epoch, 'roster_version', c.roster_version, 'roster_hash', c.roster_hash,
    'incarnation', live, 'checked_at', clock_timestamp());
END
$f$;

DROP FUNCTION fence.read_window();

DELETE FROM fence.manifest WHERE function_signature = 'fence.read_window()';
DELETE FROM fence.manifest WHERE function_signature IN (
  'fence._worker_allowed_execute()',
  'fence.coverage_problems()',
  'fence.cover_relation(oid)',
  'fence._fence_acl_problems()',
  'fence.reaper_capability_problems()',
  'fence.check_fenced()');
INSERT INTO fence.manifest (function_signature, digest)
SELECT p.oid::regprocedure::text,
       encode(sha256(convert_to(concat_ws('|', p.prosrc, p.prosecdef::text, pg_get_userbyid(p.proowner),
         coalesce(array_to_string(p.proconfig, ','), ''), p.provolatile::text), 'UTF8')), 'hex')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'fence' AND p.oid::regprocedure::text IN (
  'fence._worker_allowed_execute()',
  'fence.coverage_problems()',
  'fence.cover_relation(oid)',
  'fence._fence_acl_problems()',
  'fence.reaper_capability_problems()',
  'fence.check_fenced()');

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

ALTER EVENT TRIGGER xf_ddl_drop ENABLE ALWAYS;
ALTER EVENT TRIGGER xf_ddl_end ENABLE ALWAYS;
