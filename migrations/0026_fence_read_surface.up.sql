-- الهجرة 0026 (تقديم) — قراءةُ العاملِ خارجَ state ومشتقّاتُ fence (‏WL-544).
--
-- **العيبُ المقيس:** قاعدةُ التصنيف تعدُّ كلَّ SELECT للعامل قراءةً سليمة أينما كانت. فمنحُ SELECT لـPUBLIC (‏أو عبرَ دورٍ
-- وسيط) على fence.credentials أو fence.challenges أو fence.sovereign_commands، أو مشهدٌ يملكُه دورٌ مميَّزٌ فوقَها، كان
-- يجتازُ check_fenced() والمدقّقَ معاً فلا يمنعُ RESUME. خطُّ الأساسِ المقيسُ على قاعدةٍ جديدة: لا يقرأُ العاملُ إلا
-- جداولَ state وتسلسلاتِها، ولا مشهدَ يعتمدُ على fence — فلا سحبَ لأيِّ امتيازٍ قائم، والتغييرُ كشفٌ يربطُ الانحرافَ بالبوابة.
--
-- ما تغيّرُه: worker_capabilities() تضيفُ reads_fence لكلِّ علاقة (‏إغلاقٌ متعدٍّ على قواعدِ المشاهد)، وcapability_problems()
-- تضيفُ worker_read_outside_state وworker_fence_derived_read. لا دالّةَ جديدة، ولا منحَ جديد.
--
-- **شرطُ التطبيق:** superuser، وغيرُ RUNNING (‏D-13)، وxf_ddl_end على ENABLE ALWAYS.

DO $pre$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'fence: تقديمُ 0026 يتطلّبُ superuser (‏مُطلِقُ الأحداثِ xf_ddl_end يُعطَّلُ داخلَ المعاملة)';
  END IF;
  IF (fence.effective_state()->>'state') = 'RUNNING' THEN
    RAISE EXCEPTION 'fence: لا تقديمُ 0026 تحتَ RUNNING — أوقِف أولاً (D-13)';
  END IF;
  IF (SELECT evtenabled FROM pg_catalog.pg_event_trigger WHERE evtname = 'xf_ddl_end') IS DISTINCT FROM 'A' THEN
    RAISE EXCEPTION 'fence: xf_ddl_end ليس ENABLE ALWAYS — حالةٌ غيرُ متوقَّعة، لا تُعادُ صامتاً';
  END IF;
END
$pre$;

-- البيانُ (‏fence.manifest) يُطابقُ الدوالَّ الحيّةَ قبلَ أيِّ تغيير: هجرةٌ تُعيدُ تسجيلَ البصماتِ فوقَ دالّةٍ
-- عُبِثَ بها تُشرعِنُ العبث — فيُرفَضُ التطبيقُ بدلَ ذلك (‏فشلٌ مغلق).
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

-- مخطّطُ fence مُغلَقٌ أمامَ DDL (‏xf_ddl_end ⇒ XF202) ولو لـsuperuser. التعطيلُ داخلَ معاملةِ الهجرةِ وحدَها،
-- والإعادةُ إلى ENABLE ALWAYS في آخرِها؛ فشلُ أيِّ أمرٍ يُرجِعُ المعاملةَ كلَّها ومعها التعطيل.
ALTER EVENT TRIGGER xf_ddl_end DISABLE;

-- دوالُّ السياجِ يملكُها xf_owner (‏NOSUPERUSER) — كما في 0024 و0025.
SET LOCAL ROLE xf_owner;

CREATE OR REPLACE FUNCTION fence.worker_capabilities() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
  -- WL-544: العلاقاتُ المشتقّةُ من fence — قواعدُ إعادةِ الكتابة (‏المشاهدُ والمشاهدُ المُجسَّدة) تعتمدُ على علاقةٍ في fence
  -- أو على مشتقٍّ منها (‏إغلاقٌ متعدٍّ عبرَ pg_depend).
  WITH RECURSIVE fence_derived(oid) AS (
    SELECT c.oid FROM pg_class c WHERE c.relnamespace = 'fence'::regnamespace
    UNION
    SELECT rw.ev_class FROM pg_rewrite rw
    JOIN pg_depend d ON d.classid = 'pg_rewrite'::regclass AND d.objid = rw.oid AND d.refclassid = 'pg_class'::regclass
    JOIN fence_derived f ON f.oid = d.refobjid
    WHERE rw.ev_class <> d.refobjid
  )
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'axis', x->>'object', x->>'privilege'), '[]'::jsonb) FROM (
    -- خصائصُ الأدوار.
    SELECT jsonb_build_object('axis', 'role_attribute', 'object', CASE WHEN w.base THEN 'xuux_worker' ELSE 'identity' END,
      'privilege', concat_ws(',', CASE WHEN r.rolsuper THEN 'SUPERUSER' END, CASE WHEN r.rolcreaterole THEN 'CREATEROLE' END,
        CASE WHEN r.rolcreatedb THEN 'CREATEDB' END, CASE WHEN r.rolreplication THEN 'REPLICATION' END,
        CASE WHEN r.rolbypassrls THEN 'BYPASSRLS' END, CASE WHEN NOT r.rolinherit THEN 'NOINHERIT' END,
        CASE WHEN w.base AND r.rolcanlogin THEN 'LOGIN' END,
        CASE WHEN NOT w.base AND r.rolvaliduntil IS DISTINCT FROM '-infinity'::timestamptz THEN 'PASSWORD_USABLE' END),
      'detail', jsonb_build_object('role', r.rolname, 'connlimit', r.rolconnlimit)) AS x
    FROM fence._worker_principals() w JOIN pg_roles r ON r.oid = w.oid
    UNION ALL
    -- العضويّات: ما يرثُه العامل، ومن يرثُ العامل.
    SELECT jsonb_build_object('axis', 'membership',
      'object', CASE WHEN mw.base THEN 'xuux_worker' WHEN mw.oid IS NOT NULL THEN 'identity' ELSE m.member::regrole::text END
        || ' -> ' || CASE WHEN rw.base THEN 'xuux_worker' WHEN rw.oid IS NOT NULL THEN 'identity' ELSE m.roleid::regrole::text END,
      'privilege', concat_ws(',', CASE WHEN m.admin_option THEN 'ADMIN' END, CASE WHEN m.inherit_option THEN 'INHERIT' END,
        CASE WHEN m.set_option THEN 'SET' END),
      'detail', jsonb_build_object('member', m.member::regrole::text, 'role', m.roleid::regrole::text))
    FROM pg_auth_members m
    LEFT JOIN fence._worker_principals() mw ON mw.oid = m.member
    LEFT JOIN fence._worker_principals() rw ON rw.oid = m.roleid
    WHERE mw.oid IS NOT NULL OR rw.oid IS NOT NULL
    UNION ALL
    -- اعتمادُ أدوارِ العمّالِ في كلِّ قاعدةٍ من العنقود: ملكيّة (‏o)، ومنح (‏a)، وسياسة (‏r)، وامتيازٌ أوّليّ (‏i).
    SELECT jsonb_build_object('axis', CASE d.deptype WHEN 'o' THEN 'ownership' ELSE 'shared_dependency' END,
      'object', CASE WHEN d.dbid IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))
                     THEN pg_describe_object(d.classid, d.objid, d.objsubid)
                     ELSE format('db:%s class:%s oid:%s', d.dbid, d.classid::regclass, d.objid) END,
      'privilege', d.deptype::text,
      'detail', jsonb_build_object('role', CASE WHEN w.base THEN 'xuux_worker' ELSE 'identity' END, 'class', d.classid::regclass::text,
        'local', d.dbid IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))))
    FROM pg_shdepend d JOIN fence._worker_principals() w ON w.oid = d.refobjid
    WHERE d.refclassid = 'pg_authid'::regclass
    UNION ALL
    -- القواعد (‏على مستوى العنقود).
    -- WL-540: لكلِّ مَن يدخلُ فعلاً (‏xuux_worker وكلُّ هويّةِ إقلاع — الدخولُ يفحصُ CONNECT بدورِ الدخولِ وما يرثُه)،
    -- ومصدرُ الصلاحية: PUBLIC أم منحٌ مباشر/موروث.
    SELECT jsonb_build_object('axis', 'database', 'object', CASE WHEN db.datname = current_database() THEN 'current' ELSE db.datname::text END,
      'privilege', p.priv, 'detail', jsonb_build_object('datname', db.datname, 'allowconn', db.datallowconn,
        'via_public', has_database_privilege('public', db.oid, p.priv),
        'principals', (SELECT jsonb_agg(DISTINCT CASE WHEN w.base THEN 'xuux_worker' ELSE 'identity' END)
                       FROM fence._worker_principals() w WHERE has_database_privilege(w.oid, db.oid, p.priv))))
    FROM pg_database db CROSS JOIN (VALUES ('CONNECT'), ('TEMPORARY'), ('CREATE')) p(priv)
    WHERE EXISTS (SELECT 1 FROM fence._worker_principals() w WHERE has_database_privilege(w.oid, db.oid, p.priv))
    UNION ALL
    SELECT jsonb_build_object('axis', 'schema', 'object', n.nspname::text, 'privilege', p.priv)
    FROM pg_namespace n CROSS JOIN (VALUES ('USAGE'), ('CREATE')) p(priv)
    WHERE n.nspname NOT LIKE 'pg\_toast%' AND n.nspname NOT LIKE 'pg\_temp\_%'
      AND has_schema_privilege('xuux_worker', n.oid, p.priv)
    UNION ALL
    -- العلاقات: كلُّ امتيازٍ غيرِ القراءة (‏على الجدولِ أو على أيِّ عمود)، والقراءةُ خارجَ الكتالوج.
    SELECT jsonb_build_object('axis', CASE WHEN c.relkind = 'S' THEN 'sequence' ELSE 'relation' END,
      'object', c.oid::regclass::text, 'privilege', p.priv,
      'detail', jsonb_build_object('relkind', c.relkind::text, 'schema', n.nspname,
        'guarded', EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgname = 'xf_guard' AND t.tgenabled = 'A'),
        -- CASE لا AND: PG لا يضمنُ ترتيبَ تقييمِ AND، وhas_table_privilege يرفضُ USAGE (‏للتسلسلاتِ وحدَها).
        'column_only', CASE WHEN c.relkind = 'S' THEN false ELSE NOT has_table_privilege('xuux_worker', c.oid, p.priv) END,
        -- WL-544: مشهدٌ (‏أو مشهدٌ مُجسَّد) يقرأُ علاقةً في fence مباشرةً أو عبرَ مشهدٍ آخر — يقرأُ بصلاحياتِ مالكِه.
        'reads_fence', c.oid IN (SELECT fd.oid FROM fence_derived fd)))
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN'), ('USAGE')) p(priv)
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S') AND n.nspname NOT LIKE 'pg\_toast%' AND n.nspname NOT LIKE 'pg\_temp\_%'
      AND NOT (p.priv = 'SELECT' AND n.nspname IN ('pg_catalog', 'information_schema'))
      AND CASE
        WHEN c.relkind = 'S' THEN CASE WHEN p.priv IN ('SELECT', 'UPDATE', 'USAGE') THEN has_sequence_privilege('xuux_worker', c.oid, p.priv) ELSE false END
        WHEN p.priv = 'USAGE' THEN false
        WHEN has_table_privilege('xuux_worker', c.oid, p.priv) THEN true
        WHEN p.priv IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') THEN has_any_column_privilege('xuux_worker', c.oid, p.priv)
        ELSE false END
    UNION ALL
    -- الدوالّ: كلُّ ما يُنفَّذُ خارجَ الكتالوج، وكلُّ SECURITY DEFINER، وكلُّ دالّةٍ متطايرةٍ في pg_catalog.
    SELECT jsonb_build_object('axis', 'function', 'object', p.oid::regprocedure::text, 'privilege', 'EXECUTE',
      'detail', jsonb_build_object('schema', n.nspname, 'name', p.proname, 'language', l.lanname, 'volatile', p.provolatile::text,
        'secdef', p.prosecdef, 'owner', pg_get_userbyid(p.proowner), 'kind', p.prokind::text,
        'pinned_search_path', coalesce(array_to_string(p.proconfig, ',') LIKE '%search_path=%', false)))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
    WHERE has_function_privilege('xuux_worker', p.oid, 'EXECUTE')
      AND (n.nspname NOT IN ('pg_catalog', 'information_schema') OR p.prosecdef OR (p.provolatile = 'v' AND p.prokind IN ('f', 'p')))
    UNION ALL
    -- USAGE على لغةٍ غيرِ موثوقةٍ لا يُنشئُ بها إلا superuser — يُجرَدُ ولا يُعَدُّ مشكلة.
    SELECT jsonb_build_object('axis', 'language', 'object', l.lanname::text, 'privilege', 'USAGE',
      'detail', jsonb_build_object('trusted', l.lanpltrusted))
    FROM pg_language l WHERE has_language_privilege('xuux_worker', l.oid, 'USAGE')
    UNION ALL
    SELECT jsonb_build_object('axis', 'tablespace', 'object', t.spcname::text, 'privilege', 'CREATE')
    FROM pg_tablespace t WHERE has_tablespace_privilege('xuux_worker', t.oid, 'CREATE')
    UNION ALL
    SELECT jsonb_build_object('axis', 'foreign', 'object', 'fdw:' || f.fdwname, 'privilege', 'USAGE')
    FROM pg_foreign_data_wrapper f WHERE has_foreign_data_wrapper_privilege('xuux_worker', f.oid, 'USAGE')
    UNION ALL
    SELECT jsonb_build_object('axis', 'foreign', 'object', 'server:' || s.srvname, 'privilege', 'USAGE')
    FROM pg_foreign_server s WHERE has_server_privilege('xuux_worker', s.oid, 'USAGE')
    UNION ALL
    SELECT jsonb_build_object('axis', 'parameter', 'object', pa.parname::text, 'privilege', a.privilege_type)
    FROM pg_parameter_acl pa, LATERAL aclexplode(pa.paracl) a
    WHERE a.grantee = 0 OR a.grantee IN (SELECT w.oid FROM fence._worker_principals() w)
    UNION ALL
    SELECT jsonb_build_object('axis', 'default_acl', 'object', da.defaclrole::regrole::text || ':' || da.defaclobjtype::text
        || ':' || coalesce(da.defaclnamespace::regnamespace::text, '*'), 'privilege', a.privilege_type)
    FROM pg_default_acl da, LATERAL aclexplode(da.defaclacl) a
    WHERE da.defaclrole IN (SELECT w.oid FROM fence._worker_principals() w)
       OR a.grantee = 0 OR a.grantee IN (SELECT w.oid FROM fence._worker_principals() w)
    UNION ALL
    SELECT jsonb_build_object('axis', 'large_object', 'object', lo.oid::text, 'privilege', a.privilege_type)
    FROM pg_largeobject_metadata lo, LATERAL aclexplode(coalesce(lo.lomacl, acldefault('L', lo.lomowner))) a
    WHERE a.grantee = 0 OR a.grantee IN (SELECT w.oid FROM fence._worker_principals() w)
    UNION ALL
    SELECT jsonb_build_object('axis', 'role_setting', 'object', CASE WHEN w.base THEN 'xuux_worker' ELSE 'identity' END,
      'privilege', 'SETTING', 'detail', jsonb_build_object('role', w.rolname, 'database', st.setdatabase))
    FROM pg_db_role_setting st JOIN fence._worker_principals() w ON w.oid = st.setrole
    UNION ALL
    SELECT jsonb_build_object('axis', 'catalog_privilege_drift', 'object', q.obj, 'privilege', q.priv,
      'detail', jsonb_build_object('grantee', q.grantee))
    FROM fence._catalog_privilege_drift() q
  ) s
$f$;

CREATE OR REPLACE FUNCTION fence.capability_problems() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
  WITH cap AS (SELECT x FROM jsonb_array_elements(fence.worker_capabilities()) x),
  p AS (
    SELECT 'worker_role_attributes' AS kind, x->'detail'->>'role' || ':' || (x->>'privilege') AS obj FROM cap
    WHERE x->>'axis' = 'role_attribute' AND x->>'privilege' <> '' AND NOT (x->>'object' = 'identity' AND x->>'privilege' = 'PASSWORD_USABLE')
    UNION ALL
    -- المتوقَّعُ وحدَه: الهويّةُ ترثُ xuux_worker (‏INHERIT بلا SET ولا ADMIN)، وxf_owner يُديرُهما (‏ADMIN وحدَه).
    SELECT 'worker_membership', x->>'object' || ':' || (x->>'privilege') FROM cap
    WHERE x->>'axis' = 'membership'
      AND NOT (x->>'object' = 'identity -> xuux_worker' AND x->>'privilege' = 'INHERIT')
      AND NOT (x->>'object' IN ('xf_owner -> xuux_worker', 'xf_owner -> identity') AND x->>'privilege' = 'ADMIN')
    UNION ALL
    SELECT 'worker_owns_objects', x->>'object' FROM cap WHERE x->>'axis' = 'ownership'
    UNION ALL
    -- هويّةُ الإقلاعِ لا تُمنَحُ شيئاً مباشرةً (‏كلُّ امتيازِها عبرَ xuux_worker)؛ ولا سياسةَ ولا امتيازَ أوّليَّ للعامل.
    SELECT 'worker_identity_direct_grant', x->>'object' FROM cap
    WHERE x->>'axis' = 'shared_dependency' AND x->'detail'->>'role' = 'identity'
    UNION ALL
    SELECT 'worker_secdef_execute', x->>'object' FROM cap
    WHERE x->>'axis' = 'function' AND (x->'detail'->>'secdef')::boolean
      AND (x->>'object') NOT IN (SELECT f FROM fence._worker_allowed_execute() f)
    UNION ALL
    -- دالّةٌ بلغةٍ غيرِ موثوقةٍ (‏C/internal أو غيرُ موثوقة) خارجَ الكتالوج: سلوكُها لا يُرى.
    SELECT 'worker_untrusted_function_execute', x->>'object' FROM cap
    WHERE x->>'axis' = 'function' AND x->'detail'->>'schema' NOT IN ('pg_catalog', 'information_schema')
      AND x->'detail'->>'language' NOT IN ('sql', 'plpgsql')
    UNION ALL
    -- كتابةٌ على علاقةٍ لا يحرسُها xf_guard (‏على الجدولِ أو عمودٍ منه). والمشهدُ يكتبُ بصلاحياتِ مالكِه
    -- (‏مشهدٌ يملكُه المالكُ فوقَ fence.* تجاوز) فكلُّ مشهدٍ قابلٍ للكتابةِ مشكلة، عدا pg_settings (‏= set_config للجلسة).
    SELECT 'worker_unguarded_write', x->>'object' || ':' || (x->>'privilege') FROM cap
    WHERE x->>'axis' = 'relation' AND x->>'privilege' IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'MAINTAIN', 'TRIGGER', 'REFERENCES')
      AND x->'detail'->>'relkind' IN ('r', 'p', 'f', 'm', 'v')
      AND NOT (x->>'object' = 'pg_settings' AND x->'detail'->>'schema' = 'pg_catalog' AND x->>'privilege' = 'UPDATE')
      AND NOT ((x->'detail'->>'guarded')::boolean AND x->>'privilege' IN ('INSERT', 'UPDATE', 'DELETE'))
    UNION ALL
    -- WL-544: القراءةُ المصنّفةُ للعاملِ في state وحدَها. قراءةُ علاقةٍ أو تسلسلٍ خارجَها (‏fence، public، مخطّطٌ جديد) —
    -- بمنحٍ مباشر، أو لـPUBLIC، أو عبرَ دورٍ وسيط — قدرةٌ غيرُ مصنّفة: داخليّاتُ السياج (‏الاعتمادات، التحدّيات، الأوامرُ
    -- الموقَّعة، الأدلّة) لا يقرؤُها العاملُ إلا عبرَ دوالِّه.
    SELECT 'worker_read_outside_state', x->>'object' || ':' || (x->>'privilege') FROM cap
    WHERE x->>'axis' IN ('relation', 'sequence') AND x->>'privilege' = 'SELECT'
      AND x->'detail'->>'schema' IS DISTINCT FROM 'state'
    UNION ALL
    -- WL-544: مشهدٌ يقرأُ fence (‏ولو في state) يُعطي العاملَ قراءتَها بصلاحياتِ مالكِ المشهد — مسارٌ غيرُ مباشر.
    SELECT 'worker_fence_derived_read', x->>'object' || ':' || (x->>'privilege') FROM cap
    WHERE x->>'axis' = 'relation' AND x->>'privilege' = 'SELECT'
      AND coalesce((x->'detail'->>'reads_fence')::boolean, true)
      AND x->'detail'->>'relkind' IN ('v', 'm')
    UNION ALL
    SELECT 'worker_database_create', x->>'object' FROM cap WHERE x->>'axis' = 'database' AND x->>'privilege' = 'CREATE'
    UNION ALL
    -- WL-540: العاملُ لا يدخلُ قاعدةً أخرى في العنقودِ ولا يُنشئُ فيها TEMP (‏PUBLIC الافتراضيُّ أو منحٌ). قاعدةٌ
    -- ALLOW_CONNECTIONS false (‏template0) لا يُدخَلُ إليها بأيِّ صلاحية — تُستثنى وتُكشَفُ إن فُتِحَت.
    -- العلاج: fence.contain_database_reach() بـsuperuser؛ وكلُّ قاعدةٍ جديدةٍ (‏CREATE DATABASE يمنحُ PUBLIC) تُعيدُ الكشف.
    SELECT 'worker_database_reach', (x->>'object') || ':' || (x->>'privilege') FROM cap
    WHERE x->>'axis' = 'database' AND x->>'object' <> 'current' AND x->>'privilege' IN ('CONNECT', 'TEMPORARY')
      AND (x->'detail'->>'allowconn')::boolean
    UNION ALL
    SELECT 'worker_' || (x->>'axis') || '_privilege', x->>'object' || ':' || (x->>'privilege') FROM cap
    WHERE x->>'axis' IN ('tablespace', 'foreign', 'parameter', 'default_acl', 'large_object')
    UNION ALL
    SELECT 'worker_catalog_privilege_drift', x->>'object' || ':' || (x->>'privilege') || ':' || (x->'detail'->>'grantee') FROM cap
    WHERE x->>'axis' = 'catalog_privilege_drift'
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'object', obj) ORDER BY kind, obj), '[]'::jsonb) FROM p
$f$;

-- البيان: تُعادُ بصمتا الدالّتَين وحدَهما (‏بالتعبيرِ نفسِه في 0024 و0025).
DELETE FROM fence.manifest WHERE function_signature IN (
  'fence.worker_capabilities()',
  'fence.capability_problems()');
INSERT INTO fence.manifest (function_signature, digest)
SELECT p.oid::regprocedure::text,
       encode(sha256(convert_to(concat_ws('|', p.prosrc, p.prosecdef::text, pg_get_userbyid(p.proowner),
         coalesce(array_to_string(p.proconfig, ','), ''), p.provolatile::text), 'UTF8')), 'hex')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'fence' AND p.oid::regprocedure::text IN (
  'fence.worker_capabilities()',
  'fence.capability_problems()');

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

ALTER EVENT TRIGGER xf_ddl_end ENABLE ALWAYS;
