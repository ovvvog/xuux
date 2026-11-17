-- الهجرة 0028 (تقديم) — عضويّةُ xf_owner تمنعُ RESUME (‏WL-551).
--
-- **العيبُ المقيس (‏`c4f45e1f`، PG 18.6، مختبرُ WL-548 (‏ب)):** دورٌ غيرُ superuser عضوٌ في xf_owner — مباشرةً، أو عبرَ سلسلةٍ
-- بعمق 3، أو INHERIT وحدَه، أو ADMIN وحدَه، أو SET وحدَه — وcheck_fenced().ok = true وRESUME ينجح. والعضويّةُ قدرةٌ فعليّة:
-- بعدَ SET ROLE xf_owner مُدَّ إيجارٌ سنةً، وأُحيِيَ اعتمادٌ ملغى، وأُنشِئَ دورُ دخولٍ ومُنِحَ xuux_worker.
--
-- ما تغيّرُه: دالّةٌ جديدة fence._owner_membership_problems() (‏جردٌ تكراريٌّ بلا حدٍّ للعمقِ وآمنٌ من الدورات، بالمسارِ وخصائصِ
-- كلِّ حلقة) يُناديها check_fenced داخلَ كتلةٍ مغلقةِ الفشل، ومتبقٍّ مُعلَنٌ (‏owner_membership_detect_only). لا تغييرَ في
-- صلاحياتِ xf_owner أو xf_root أو xf_sovereign، ولا في 0024. الدالّةُ الجديدةُ مسحوبةٌ من PUBLIC ولا تُمنَحُ لأحد.
-- **أثرُ HALT (‏يُعلَن):** halt_complete يُنادي check_fenced — فعضويّةٌ قائمةٌ تُبقي الإيقافَ HALT_REQUESTED (‏مغلقاً، كأيِّ
-- مشكلةٍ أخرى منذُ 0024) حتى تُسحَب؛ لا انتقالَ جديدٌ ولا دلالةٌ جديدة.
--
-- **شرطُ التطبيق:** superuser، وغيرُ RUNNING (‏D-13)، وxf_ddl_end على ENABLE ALWAYS.

DO $pre$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'fence: تقديمُ 0028 يتطلّبُ superuser (‏xf_ddl_end يُعطَّلُ داخلَ المعاملة)';
  END IF;
  IF (fence.effective_state()->>'state') = 'RUNNING' THEN
    RAISE EXCEPTION 'fence: لا تقديمُ 0028 تحتَ RUNNING — أوقِف أولاً (D-13)';
  END IF;
  IF (SELECT evtenabled FROM pg_catalog.pg_event_trigger WHERE evtname = 'xf_ddl_end') IS DISTINCT FROM 'A' THEN
    RAISE EXCEPTION 'fence: xf_ddl_end ليس ENABLE ALWAYS — حالةٌ غيرُ متوقَّعة، لا تُعادُ صامتاً';
  END IF;
END
$pre$;

-- البيانُ (‏fence.manifest) يُطابقُ الدوالَّ الحيّةَ قبلَ أيِّ تغيير (‏فشلٌ مغلق — كما في 0025..0027).
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

-- دوالُّ السياجِ يملكُها xf_owner (‏NOSUPERUSER) — كما في 0024..0027.
SET LOCAL ROLE xf_owner;

-- ‏كلُّ دورٍ غيرِ superuser يصلُ إلى xf_owner عبرَ pg_auth_members، بأقصرِ مسارٍ وبخصائصِ كلِّ حلقةٍ فيه.
-- **مجموعةٌ لا تعدادُ مسارات:** reach يضمُّ (‏الدور، العمق) بـUNION — فلا انفجارَ في المخطّطاتِ الماسيّة — والعمقُ لا يتجاوزُ
-- عددَ الأدوار (‏أطولُ مسارٍ بسيط)، فتنتهي ولو وُجِدت دورة، ولا حدَّ اعتباطيّاً للعمق. الأبُ على أقصرِ مسار: xf_owner
-- للعمقِ 1، وإلا أصغرُ oid في العمقِ الأقلِّ بواحد (‏حتميّ)؛ والمشيُ إلى الأعلى يُنقِصُ العمقَ فينتهي.
-- الوسيطُ superuser يُعبَرُ (‏ما تحتَه يُبلَّغ)؛ والمُبلَّغُ عنه الدورُ غيرُ superuser وحدَه. لا كلمةَ مرورٍ ولا إعدادَ في الناتج.
CREATE FUNCTION fence._owner_membership_problems() RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $f$
DECLARE owner_oid oid; out jsonb;
BEGIN
  SELECT r.oid INTO owner_oid FROM pg_roles r WHERE r.rolname = 'xf_owner';
  IF owner_oid IS NULL THEN
    RAISE EXCEPTION 'fence: الدورُ xf_owner غائب — لا جردَ للعضويّة';
  END IF;
  WITH RECURSIVE e AS (
    SELECT am.roleid, am.member, bool_or(am.admin_option) AS admin, bool_or(am.inherit_option) AS inherit,
           bool_or(am.set_option) AS set_
    FROM pg_auth_members am GROUP BY am.roleid, am.member
  ), reach(member, depth) AS (
    SELECT e.member, 1 FROM e WHERE e.roleid = owner_oid
    UNION
    SELECT e.member, r.depth + 1 FROM reach r JOIN e ON e.roleid = r.member
    WHERE r.depth < (SELECT count(*) FROM pg_roles)
  ), d AS (
    SELECT member, min(depth) AS depth FROM reach GROUP BY member
  ), par AS (
    SELECT d.member, d.depth,
           (SELECT e.roleid FROM e WHERE e.member = d.member
              AND CASE WHEN d.depth = 1 THEN e.roleid = owner_oid
                       ELSE e.roleid IN (SELECT d2.member FROM d d2 WHERE d2.depth = d.depth - 1) END
            ORDER BY e.roleid LIMIT 1) AS parent
    FROM d
  ), walk(start, parent, path, edges) AS (
    SELECT p.member, p.parent,
           jsonb_build_array(pg_get_userbyid(p.member), pg_get_userbyid(p.parent)),
           jsonb_build_array(jsonb_build_object('role', pg_get_userbyid(p.parent), 'member', pg_get_userbyid(p.member),
             'admin', e.admin, 'inherit', e.inherit, 'set', e.set_))
    FROM par p JOIN e ON e.roleid = p.parent AND e.member = p.member
    UNION ALL
    SELECT w.start, p.parent, w.path || jsonb_build_array(pg_get_userbyid(p.parent)),
           w.edges || jsonb_build_array(jsonb_build_object('role', pg_get_userbyid(p.parent), 'member', pg_get_userbyid(p.member),
             'admin', e.admin, 'inherit', e.inherit, 'set', e.set_))
    FROM walk w JOIN par p ON p.member = w.parent JOIN e ON e.roleid = p.parent AND e.member = p.member
    WHERE w.parent <> owner_oid
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', 'owner_membership', 'role', r.rolname, 'login', r.rolcanlogin,
           'depth', jsonb_array_length(w.edges), 'path', w.path, 'edges', w.edges) ORDER BY r.rolname), '[]'::jsonb)
  INTO out
  FROM walk w JOIN pg_roles r ON r.oid = w.start
  WHERE w.parent = owner_oid AND NOT r.rolsuper;
  RETURN out;
END
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
  residuals := residuals || jsonb_build_array(
    -- WL-551: الكشفُ لا المنع. عضوٌ في xf_owner يملكُ fence.* (‏يكتبُ control بعهدٍ أعلى ويُعيدُ الختمَ بـ_reseal) فيتخطّى RESUME
    -- كلَّه؛ ومنعُه يحتاجُ تغييرَ نموذجِ xf_owner (‏قرارُ مالك). هذا الفحصُ يُظهِرُ العضويّةَ ويمنعُ المسارَ المشروعَ وحدَه.
    jsonb_build_object('kind', 'owner_membership_detect_only', 'note', 'عضويّةُ xf_owner تُكشَفُ (‏owner_membership) فيُرفَضُ RESUME ويبقى HALT_REQUESTED؛ لكنّ العضوَ النشِطَ مالكٌ للسياج: يكتبُ fence.* ويُعيدُ الختمَ فيتخطّى RESUME — المنعُ يحتاجُ تغييرَ نموذجِ xf_owner (‏قرارُ مالك)، وsuperuser خارجَ السياج (‏T-OWN-04)'),
    -- WL-541: السطحُ مقيسٌ لا مُفترَض — مَن يستطيعُ الدخولَ (‏= LISTEN) ومن أين؛ مَن يستمعُ فعلاً لا يُرى.
    jsonb_build_object('kind', 'notify_not_revocable', 'surface', fence.notify_surface(), 'note', 'أمرُ NOTIFY بلا امتيازٍ يُسحَب (‏pg_notify مسحوبةٌ من PUBLIC — WL-541): العاملُ يُرسِلُ ما دامت جلستُه حيّة — بعدَ الختمِ، وبعدَ انقضاءِ الإيجارِ حتى الحصادِ (‏reap_lapsed، WL-542: للجذرِ أو السياديّ، والانقضاءُ نهائيّ) أو الإلغاءِ أو الإيقاف؛ والإشعارُ الملتزَمُ قبلَ إنهاءِ الجلسةِ يصلُ مستمعاً كان متّصلاً ولو بعدَه، ولا يُخزَّنُ لمستمعٍ لاحق. المستمعُ: كلُّ مَن يدخلُ هذه القاعدة (‏surface.listeners) — لا مستهلكَ في المستودع، وما خارجَه لا يُثبَتُ غيابُه؛ والمنعُ من أصلِه يحتاجُ خطّافاً بلغةِ C (‏قرارُ معمار، E3)'),
    jsonb_build_object('kind', 'db_clock_trusted', 'note', 'الإيجارُ يُقاسُ بساعةِ القاعدة: التقدّمُ يُغلِق، والتراجعُ قبلَ آخرِ تجديدٍ يُرفَضُ (XF012)، وما دونَه يمدُّ الإيجارَ بما لا يزيدُ على نافذةٍ واحدة؛ العبثُ بها خارجَ السياج'),
    jsonb_build_object('kind', 'worker_self_alter_role', 'note', 'ALTER ROLE <نفسه> PASSWORD/SET بلا امتيازٍ يُسحَب ولا مُطلِقِ أحداث (WL-538): الإعداداتُ تُرفَضُ كتابتُها (XF013) وتُمحى عندَ الختمِ والإلغاءِ والإيقاف، وكلمةُ المرورِ لا تُدخِلُ أحداً (VALID UNTIL -infinity) وتُمحى كذلك؛ لكنّ الكتابةَ نفسَها تبقى ممكنةً بإيجارٍ منقضٍ حتى الانتقالِ التالي: إعداداتٌ يقرؤُها كلُّ دور، وبصمةٌ بمحتوًى يختارُه العاملُ لا يراها إلا superuser؛ ومنعُ الأمرِ من أصلِه يحتاجُ خطّافاً بلغةِ C (قرارُ معمار)'));
  RETURN jsonb_build_object('ok', jsonb_array_length(problems) = 0, 'problems', problems, 'residuals', residuals,
    'state', eff->'state', 'epoch', c.epoch, 'roster_version', c.roster_version, 'roster_hash', c.roster_hash,
    'incarnation', live, 'checked_at', clock_timestamp());
END
$f$;

REVOKE ALL ON FUNCTION fence._owner_membership_problems() FROM PUBLIC;

-- البيان: تُعادُ بصمتا ما غيّرته هذه الهجرةُ وحدَه (‏بالتعبيرِ نفسِه في 0024..0027).
DELETE FROM fence.manifest WHERE function_signature IN (
  'fence.check_fenced()',
  'fence._owner_membership_problems()');
INSERT INTO fence.manifest (function_signature, digest)
SELECT p.oid::regprocedure::text,
       encode(sha256(convert_to(concat_ws('|', p.prosrc, p.prosecdef::text, pg_get_userbyid(p.proowner),
         coalesce(array_to_string(p.proconfig, ','), ''), p.provolatile::text), 'UTF8')), 'hex')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'fence' AND p.oid::regprocedure::text IN (
  'fence.check_fenced()',
  'fence._owner_membership_problems()');

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
