-- الهجرة 0030 (تقديم) — حاصدٌ دائمٌ بدورِ دخولٍ مستقلّ xf_reaper وبابٍ واحد: fence.reaper_tick (‏WL-558؛ مسودّةُ WL-548
-- بعدَ مراجعتِها في مختبرِ WL-554 وتصحيحِ عيوبِها المقيسة).
--
-- **ما صُحِّحَ عن المسودّة (‏مقيساً في المختبر، PG 18.6):**
--   1. العضويّة: حدُّ العمقِ الثابت (‏depth < 16) كانَ يُفوِّتُ سلسلةً بـ18 حافّةً إلى xf_owner وpg_has_role = true. الجردُ
--      هنا مجموعةٌ لا تعدادُ مسارات (‏(‏دور، عمق) بـUNION) بحدٍّ = عددِ الأدوار — أطولُ مسارٍ بسيط — فلا حدَّ اعتباطيّاً، ولا
--      انفجارَ في المخطّطاتِ الماسيّة، وتنتهي ولو وُجدت دورة (‏PG يرفضُ الدورةَ أصلاً بـ0LP01). في الاتّجاهَين.
--   2. الدور: المسودّةُ كانت تُعيدُ ضبطَ دورٍ قائمٍ بالاسمِ نفسِه (‏ALTER ROLE) وتُسقِطُه في الرجوعِ بعضويّاتِه. هنا: الدورُ
--      يُنشأُ إن غاب ويُوسَمُ بتعليقٍ (‏COMMENT ON ROLE) يُعرِّفُ الهجرة؛ وإن وُجد **لا يُعدَّلُ أبداً** — يُقبَلُ إن حملَ الوسمَ
--      وطابقت خصائصُه حرفيّاً ولا عضويّةَ له في أيِّ اتّجاهٍ ولا إعداد (‏دورُ 0030 من قاعدةٍ أخرى في العنقودِ نفسِه)، وإلا
--      رفضٌ بـXF524 (‏لا تعديلَ ولا أثر). الرجوعُ لا يُسقِطُه إلا إن حملَ الوسمَ ولم يبقَ له اعتمادٌ في أيِّ قاعدة.
--   3. المهلة: عتبةُ «القِدَم» كانت ثابتةً (‏12000) والسقفُ والمهلةُ في العميلِ (‏5000 + 10000) — حاصدٌ سليمٌ يُحكَمُ عليه
--      بالقِدَم. هنا يُصرِّحُ الحاصدُ في كلِّ نبضةٍ بـceiling_ms وquery_timeout_ms (‏بحدود)، والعتبةُ لكلِّ نسخة =
--      ceiling_ms + 2 × query_timeout_ms + slack_ms (‏مُعامِلُ reaper_health): نومٌ ≤ السقف، ثمّ اتصالٌ ≤ المهلة (‏بعدَ
--      انقطاع) ونداءٌ ≤ المهلة؛ وquery_timeout_ms ≥ 2000 > lock_timeout (‏1 ث)
--      فانتظارُ القفلِ فشلٌ مُسجَّلٌ لا إلغاءٌ صامت.
--   4. النبض: فشلُ الحصادِ كان يُرجِعُ المعاملةَ كلَّها (‏لا أثرَ للمحاولة). هنا الحصادُ في كتلةٍ فرعيّة: المحاولةُ تُسجَّلُ
--      دائماً (‏last_tick_at، last_error بالـSQLSTATE)، والنجاحُ (‏last_ok_at) لا يُكتَبُ إلا لحصادٍ عادَ ok — وأثرُ الحصادِ
--      الفاشلِ مُرجَعٌ بالكتلةِ الفرعيّة. إلغاءُ النداءِ (‏statement_timeout، 57014) لا تلتقطُه الكتلة ⇒ لا نبض ⇒ القِدَمُ يُرى.
--   5. الصحّة: «سليم» = نسخةٌ واحدةٌ بالضبطِ موصولةٌ (‏pid + backend_start) حديثةُ المحاولةِ والنجاح، ولا جلسةَ xf_reaper
--      غيرُ مربوطة، ولا نسخةَ موصولةٌ قديمة، ولا شذوذَ ساعة، والامتيازاتُ سليمة. الحقولُ منفصلة: process_alive (‏غيرُ مرئيٍّ
--      من القاعدة) / db_connected / tick_attempted / tick_succeeded / privileges_intact.
--
-- **الامتياز:** CONNECT على هذه القاعدة، USAGE على fence، EXECUTE على reaper_tick(uuid,integer,integer) — لا غير. كلُّ ما
-- عداه مشكلةٌ في capability_problems() ⇒ check_fenced ⇒ RESUME يُرفَض (‏XF415). جردُ الحاصدِ يُربَطُ بـcheck_fenced **بلا تعديلِ
-- جسمِه**: الدالّةُ القائمةُ تُعادُ تسميتُها _worker_capability_problems() (‏جسمُها وACL كما هما) وتحلُّ محلَّها جامعة.
-- **المتبقّي المُعلَن:** xf_reaper دورُ دخولٍ على هذه القاعدة ⇒ يستطيعُ LISTEN وأمرَ NOTIFY (‏بلا امتيازٍ يُسحَب — كالعامل،
-- WL-541)، وpg_notify مسحوبةٌ من PUBLIC. ومصادقتُه (‏كلمةُ مرورٍ أو peer) خارجَ الهجرة (‏pg_hba، الخيار A).
--
-- **شرطُ التطبيق:** superuser، وغيرُ RUNNING (‏D-13)، وxf_ddl_end وxf_ddl_drop على ENABLE ALWAYS، و0029 مطبَّقة، والبيانُ مطابق.

DO $pre$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'fence: تقديمُ 0030 يتطلّبُ superuser (‏CREATE ROLE ومُطلِقُ الأحداثِ يُعطَّلُ داخلَ المعاملة)';
  END IF;
  IF (fence.effective_state()->>'state') = 'RUNNING' THEN
    RAISE EXCEPTION 'fence: لا تقديمُ 0030 تحتَ RUNNING — أوقِف أولاً (D-13)';
  END IF;
  IF (SELECT evtenabled FROM pg_catalog.pg_event_trigger WHERE evtname = 'xf_ddl_end') IS DISTINCT FROM 'A'
     OR (SELECT evtenabled FROM pg_catalog.pg_event_trigger WHERE evtname = 'xf_ddl_drop') IS DISTINCT FROM 'A' THEN
    RAISE EXCEPTION 'fence: xf_ddl_end/xf_ddl_drop ليسا ENABLE ALWAYS — حالةٌ غيرُ متوقَّعة، لا تُعادُ صامتاً';
  END IF;
  IF to_regprocedure('fence._signal_session(integer,timestamp with time zone,name)') IS NULL THEN
    RAISE EXCEPTION 'fence: 0029 غيرُ مطبَّقة — 0030 تفترضُها';
  END IF;
  IF to_regprocedure('fence.capability_problems()') IS NULL OR to_regprocedure('fence._worker_capability_problems()') IS NOT NULL THEN
    RAISE EXCEPTION 'fence: حالةُ capability_problems غيرُ متوقَّعة قبلَ 0030';
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

-- الدورُ على مستوى العنقود. **لا ALTER ROLE في أيِّ مسار:** يُنشأُ إن غابَ ويُوسَم؛ وإن وُجدَ يُقبَلُ كما هو أو يُرفَض.
-- الوسمُ ليس مصادقة: مَن يملكُ CREATEROLE يستطيعُ تزويرَه، لكنّ القبولَ يشترطُ الخصائصَ حرفيّاً وغيابَ كلِّ عضويّةٍ (‏ومنشئٌ
-- غيرُ superuser يصيرُ عضواً بـADMIN تلقائيّاً ⇒ مرفوض) وكلِّ إعداد — فالمقبولُ لا يملكُ أكثرَ ممّا تُنشئُه الهجرة.
-- كلمةُ المرورِ لا تُقارَن: المصادقةُ خارجَ الهجرة (‏pg_hba)، وVALID UNTIL '-infinity' شرطٌ للقبول.
DO $role$
DECLARE r pg_catalog.pg_roles; marker CONSTANT text := 'xuux-fence-0030:xf_reaper';
BEGIN
  SELECT * INTO r FROM pg_catalog.pg_roles WHERE rolname = 'xf_reaper';
  IF NOT FOUND THEN
    CREATE ROLE xf_reaper LOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS
      CONNECTION LIMIT 2 VALID UNTIL '-infinity';
    EXECUTE format('COMMENT ON ROLE xf_reaper IS %L', marker);
    RETURN;
  END IF;
  IF shobj_description(r.oid, 'pg_authid') IS DISTINCT FROM marker THEN
    RAISE EXCEPTION USING ERRCODE = 'XF524', MESSAGE = 'fence: الدورُ xf_reaper موجودٌ ولم تُنشئه 0030 (‏لا وسم) — لا يُعدَّلُ ولا يُتبنّى';
  END IF;
  IF NOT (r.rolcanlogin AND NOT r.rolinherit AND NOT r.rolsuper AND NOT r.rolcreaterole AND NOT r.rolcreatedb
          AND NOT r.rolreplication AND NOT r.rolbypassrls AND r.rolconnlimit = 2
          AND r.rolvaliduntil IS NOT DISTINCT FROM '-infinity'::timestamptz) THEN
    RAISE EXCEPTION USING ERRCODE = 'XF524', MESSAGE = 'fence: الدورُ xf_reaper بخصائصَ غيرِ خصائصِ 0030 — لا يُعدَّلُ ولا يُتبنّى';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member = r.oid OR m.roleid = r.oid) THEN
    RAISE EXCEPTION USING ERRCODE = 'XF524', MESSAGE = 'fence: الدورُ xf_reaper له عضويّة — لا يُعدَّلُ ولا يُتبنّى';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s WHERE s.setrole = r.oid) THEN
    RAISE EXCEPTION USING ERRCODE = 'XF524', MESSAGE = 'fence: الدورُ xf_reaper له إعداداتٌ دائمة — لا يُعدَّلُ ولا يُتبنّى';
  END IF;
END
$role$;

ALTER EVENT TRIGGER xf_ddl_end DISABLE;

SET LOCAL ROLE xf_owner;

-- النبض: صفٌّ لكلِّ نسخة، مربوطٌ بـ(‏backend_pid, backend_start). لا منحَ لأحد — الكتابةُ عبرَ reaper_tick وحدَها
-- (‏SECURITY DEFINER)، والقراءةُ عبرَ reaper_health.
CREATE TABLE fence.reaper_heartbeat (
  instance             uuid        PRIMARY KEY,
  backend_pid          integer     NOT NULL,
  backend_start        timestamptz NOT NULL,
  ceiling_ms           integer     NOT NULL,
  query_timeout_ms     integer     NOT NULL,
  first_tick_at        timestamptz NOT NULL,
  last_tick_at         timestamptz NOT NULL,
  last_ok_at           timestamptz,
  ticks                bigint      NOT NULL,
  ok_ticks             bigint      NOT NULL,
  failed_ticks         bigint      NOT NULL,
  reaped_total         bigint      NOT NULL,
  connects             integer     NOT NULL,
  last_result          jsonb       NOT NULL,
  last_error           jsonb,
  UNIQUE (backend_pid, backend_start)
);
REVOKE ALL ON fence.reaper_heartbeat FROM PUBLIC;

-- البابُ الوحيدُ لـxf_reaper. lock_timeout مثبَّتٌ هنا (‏1 ث، لا يُطيلُه إعدادُ جلسة)؛ statement_timeout يضعُه العميلُ لكلِّ
-- وصلة = query_timeout_ms المُصرَّحِ به.
CREATE FUNCTION fence.reaper_tick(instance uuid, ceiling_ms integer, query_timeout_ms integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET lock_timeout = '1s' AS $f$
DECLARE
  r jsonb; ok boolean := false; n bigint := 0; now_ timestamptz; err jsonb; res jsonb;
  me_pid integer := pg_backend_pid(); me_start timestamptz;
  h fence.reaper_heartbeat; existed boolean; rebound boolean := false;
BEGIN
  -- هويّةُ الدخولِ بالمساواة: لا عضويّةَ ولا SET ROLE تُغيّرُ session_user.
  IF session_user IS DISTINCT FROM 'xf_reaper'::name THEN
    RAISE EXCEPTION USING ERRCODE = 'XF520', MESSAGE = 'fence: reaper_tick لدخولِ xf_reaper وحدَه';
  END IF;
  IF current_user IS DISTINCT FROM 'xf_owner'::name THEN
    RAISE EXCEPTION USING ERRCODE = 'XF520', MESSAGE = 'fence: reaper_tick خارجَ سياقِ مالكِه';
  END IF;
  -- العلاقةُ الصريحة: query_timeout_ms ≥ 2000 > lock_timeout (‏1000) — انتظارُ قفلٍ يُلتقَطُ فشلاً مُسجَّلاً قبلَ إلغاءِ النداء.
  IF instance IS NULL OR ceiling_ms IS NULL OR query_timeout_ms IS NULL
     OR ceiling_ms NOT BETWEEN 1 AND 300000 OR query_timeout_ms NOT BETWEEN 2000 AND 300000 THEN
    RAISE EXCEPTION USING ERRCODE = 'XF521',
      MESSAGE = 'fence: reaper_tick(instance غيرُ فارغ، ceiling_ms ∈ [1، 300000]، query_timeout_ms ∈ [2000، 300000])';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting st JOIN pg_roles ro ON ro.oid = st.setrole WHERE ro.rolname = 'xf_reaper') THEN
    RAISE EXCEPTION USING ERRCODE = 'XF523', MESSAGE = 'fence: إعداداتٌ دائمةٌ على xf_reaper — مرفوضة (‏ALTER ROLE xf_reaper RESET ALL بـsuperuser)';
  END IF;
  PERFORM pg_stat_clear_snapshot();
  SELECT a.backend_start INTO me_start FROM pg_stat_activity a WHERE a.pid = me_pid;
  -- ربطُ النسخة: معرّفٌ مربوطٌ بخادمٍ آخرَ حيّ مرفوض (‏XF522، بلا نبض)؛ وصفُّ خادمٍ ميّتٍ يُستلَم (‏إعادةُ الاتصال، connects + 1).
  SELECT * INTO h FROM fence.reaper_heartbeat x WHERE x.instance = reaper_tick.instance FOR UPDATE;
  existed := FOUND;
  IF existed AND (h.backend_pid, h.backend_start) IS DISTINCT FROM (me_pid, me_start) THEN
    IF EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.pid = h.backend_pid AND a.backend_start = h.backend_start) THEN
      RAISE EXCEPTION USING ERRCODE = 'XF522', MESSAGE = 'fence: النسخةُ مربوطةٌ بوصلةٍ أخرى حيّة';
    END IF;
    rebound := true;
  END IF;
  IF EXISTS (SELECT 1 FROM fence.reaper_heartbeat x
             WHERE x.backend_pid = me_pid AND x.backend_start = me_start AND x.instance <> reaper_tick.instance) THEN
    RAISE EXCEPTION USING ERRCODE = 'XF522', MESSAGE = 'fence: هذه الوصلةُ تنبضُ بنسخةٍ أخرى';
  END IF;
  -- الحصادُ في كتلةٍ فرعيّة: فشلُه يُرجِعُ أثرَه وحدَه، والمحاولةُ تُسجَّل، ولا last_ok_at.
  BEGIN
    r := fence._reap_lapsed();
    IF r IS NULL OR jsonb_typeof(r) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE = 'XF525', MESSAGE = 'fence: نتيجةُ الحصادِ غيرُ مقروءة';
    END IF;
    ok := (r->>'ok')::boolean IS TRUE;
    n := coalesce(jsonb_array_length(r->'reaped'), 0);
  EXCEPTION WHEN OTHERS THEN
    err := jsonb_build_object('sqlstate', SQLSTATE, 'message', left(SQLERRM, 300));
    r := NULL; ok := false; n := 0;
  END;
  now_ := clock_timestamp();
  res := CASE WHEN err IS NULL
    THEN jsonb_build_object('ok', ok, 'reaped', n, 'unresolved', r->'unresolved', 'next_due_ms', r->'next_due_ms')
    ELSE jsonb_build_object('ok', false, 'error', err) END;
  IF NOT existed THEN
    -- INSERT لا ON CONFLICT: نسختان بالمعرّفِ نفسِه في اللحظةِ نفسِها ⇒ 23505 للثانية ورجوعُ حصادِها.
    INSERT INTO fence.reaper_heartbeat (instance, backend_pid, backend_start, ceiling_ms, query_timeout_ms, first_tick_at,
      last_tick_at, last_ok_at, ticks, ok_ticks, failed_ticks, reaped_total, connects, last_result, last_error)
    VALUES (instance, me_pid, me_start, ceiling_ms, query_timeout_ms, now_, now_, CASE WHEN ok THEN now_ END,
      1, ok::int, (err IS NOT NULL)::int, n, 1, res, err);
  ELSE
    UPDATE fence.reaper_heartbeat x SET
      backend_pid = me_pid, backend_start = me_start,
      ceiling_ms = reaper_tick.ceiling_ms, query_timeout_ms = reaper_tick.query_timeout_ms,
      last_tick_at = now_, last_ok_at = CASE WHEN ok THEN now_ ELSE x.last_ok_at END,
      ticks = x.ticks + 1, ok_ticks = x.ok_ticks + ok::int, failed_ticks = x.failed_ticks + (err IS NOT NULL)::int,
      reaped_total = x.reaped_total + n, connects = x.connects + rebound::int,
      last_result = res, last_error = err
    WHERE x.instance = reaper_tick.instance;
  END IF;
  DELETE FROM fence.reaper_heartbeat x WHERE x.last_tick_at < now_ - interval '1 day';
  RETURN CASE WHEN err IS NULL THEN r
    ELSE jsonb_build_object('ok', false, 'reaped', '[]'::jsonb, 'unresolved', '[]'::jsonb, 'tick_error', err) END;
END
$f$;

-- الجرد: كلُّ ما يملكُه xf_reaper أو يصلُ إليه، بمصدرِه (‏direct / PUBLIC / inherited / ALL_ROLES). لا كلمةَ مرورٍ ولا قيمةَ إعداد.
CREATE FUNCTION fence.reaper_capabilities() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
  WITH RECURSIVE rp AS (SELECT r.oid, r.rolname FROM pg_roles r WHERE r.rolname = 'xf_reaper'),
  -- العضويّاتُ في الاتّجاهَين، متعدّية. **مجموعةٌ لا تعدادُ مسارات:** (‏دور، عمق) بـUNION فلا انفجارَ في المخطّطاتِ
  -- الماسيّة، والعمقُ ≤ عددِ الأدوار (‏أطولُ مسارٍ بسيط) فتنتهي ولو وُجدت دورة؛ ولا حدَّ اعتباطيّاً (‏كانَ 16 فيُفوِّتُ 18).
  e AS (SELECT m.roleid, m.member, bool_or(m.admin_option) AS admin_edge FROM pg_auth_members m GROUP BY m.roleid, m.member),
  lim AS (SELECT count(*) AS n FROM pg_roles),
  up_(target, depth) AS (
    SELECT e.roleid, 1 FROM e WHERE e.member IN (SELECT oid FROM rp)
    UNION
    SELECT e.roleid, u.depth + 1 FROM up_ u JOIN e ON e.member = u.target WHERE u.depth < (SELECT n FROM lim)),
  down_(target, depth) AS (
    SELECT e.member, 1 FROM e WHERE e.roleid IN (SELECT oid FROM rp)
    UNION
    SELECT e.member, d.depth + 1 FROM down_ d JOIN e ON e.roleid = d.target WHERE d.depth < (SELECT n FROM lim)),
  upm AS (SELECT target, min(depth) AS depth FROM up_ GROUP BY target),
  downm AS (SELECT target, min(depth) AS depth FROM down_ GROUP BY target),
  curdb AS (SELECT oid FROM pg_database WHERE datname = current_database()),
  -- قاعدةٌ نظيرةٌ في العنقود (‏0030 مطبَّقةٌ فيها): اعتمادُ الدورِ فيها بالشكلِ نفسِه وحدَه — منحٌ واحدٌ على مخطّط، ومنحٌ واحدٌ
  -- على دالّة، ولا غير؛ وCONNECT وحدَه على القاعدة. **حدّ:** هويّةُ الكائنَين هناك لا تُرى من هنا (‏الكتالوجُ محلّيّ) — الشكلُ
  -- محدودٌ لا مُثبَت؛ ومَن يمنحُ هناك يملكُ تلك القاعدة.
  peer AS (
    SELECT d.dbid AS oid FROM pg_shdepend d
    WHERE d.refclassid = 'pg_authid'::regclass AND d.refobjid IN (SELECT oid FROM rp) AND d.dbid NOT IN (0, (SELECT oid FROM curdb))
    GROUP BY d.dbid
    HAVING bool_and(d.deptype = 'a') AND count(*) = 2
       AND count(*) FILTER (WHERE d.classid = 'pg_namespace'::regclass) = 1
       AND count(*) FILTER (WHERE d.classid = 'pg_proc'::regclass) = 1),
  peer_ok AS (
    SELECT p.oid FROM peer p JOIN pg_database db ON db.oid = p.oid
    WHERE NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(db.datacl, acldefault('d', db.datdba))) a
                      WHERE a.grantee IN (SELECT oid FROM rp) AND a.privilege_type <> 'CONNECT')),
  me AS (SELECT oid FROM rp)
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'axis', x->>'object', x->>'privilege'), '[]'::jsonb) FROM (
    SELECT jsonb_build_object('axis', 'role_missing', 'object', 'xf_reaper', 'privilege', 'EXISTS', 'via', 'catalog') AS x
    WHERE NOT EXISTS (SELECT 1 FROM rp)
    UNION ALL
    SELECT jsonb_build_object('axis', 'role_attribute', 'object', 'xf_reaper', 'privilege', 'ATTRIBUTES', 'via', 'direct',
      'detail', jsonb_build_object('login', r.rolcanlogin, 'superuser', r.rolsuper, 'createrole', r.rolcreaterole,
        'createdb', r.rolcreatedb, 'replication', r.rolreplication, 'bypassrls', r.rolbypassrls, 'inherit', r.rolinherit,
        'connlimit', r.rolconnlimit, 'password_usable', r.rolvaliduntil IS DISTINCT FROM '-infinity'::timestamptz))
    FROM pg_roles r WHERE r.oid IN (SELECT oid FROM me)
    UNION ALL
    SELECT jsonb_build_object('axis', 'membership', 'object', 'xf_reaper -> ' || u.target::regrole::text,
      'privilege', concat_ws(',', 'MEMBER', CASE WHEN pg_has_role((SELECT oid FROM me), u.target, 'USAGE') THEN 'USAGE' END,
        CASE WHEN pg_has_role((SELECT oid FROM me), u.target, 'SET') THEN 'SET' END),
      'via', CASE WHEN u.depth = 1 THEN 'direct' ELSE 'transitive' END,
      'detail', jsonb_build_object('direction', 'member_of', 'depth', u.depth,
        'pg_has_role_member', pg_has_role((SELECT oid FROM me), u.target, 'MEMBER'),
        'admin_edge', EXISTS (SELECT 1 FROM e WHERE e.roleid = u.target AND e.member IN (SELECT oid FROM me) AND e.admin_edge),
        'target_superuser', (SELECT rolsuper FROM pg_roles WHERE oid = u.target)))
    FROM upm u
    UNION ALL
    SELECT jsonb_build_object('axis', 'membership', 'object', d.target::regrole::text || ' -> xf_reaper',
      'privilege', 'MEMBER', 'via', CASE WHEN d.depth = 1 THEN 'direct' ELSE 'transitive' END,
      'detail', jsonb_build_object('direction', 'has_member', 'depth', d.depth,
        'member_can_login', (SELECT rolcanlogin FROM pg_roles WHERE oid = d.target),
        'member_superuser', (SELECT rolsuper FROM pg_roles WHERE oid = d.target)))
    FROM downm d
    UNION ALL
    -- اعتمادُ الدورِ في كلِّ قواعدِ العنقود: ملكيّة (‏o)، ومنح (‏a)، وسياسة (‏r)، وامتيازٌ أوّليّ (‏i).
    SELECT jsonb_build_object('axis', CASE d.deptype WHEN 'o' THEN 'ownership' ELSE 'shared_dependency' END,
      'object', CASE WHEN d.dbid IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))
                     THEN pg_describe_object(d.classid, d.objid, d.objsubid)
                     ELSE format('db:%s class:%s oid:%s', d.dbid, d.classid::regclass, d.objid) END,
      'privilege', d.deptype::text, 'via', 'direct',
      'detail', jsonb_build_object('class', d.classid::regclass::text, 'objid', d.objid, 'objsubid', d.objsubid,
        'local', d.dbid IN (0, (SELECT oid FROM pg_database WHERE datname = current_database())),
        'peer', d.dbid IN (SELECT oid FROM peer_ok)
             OR (d.dbid = 0 AND d.classid = 'pg_database'::regclass AND d.objid IN (SELECT oid FROM peer_ok))))
    FROM pg_shdepend d WHERE d.refclassid = 'pg_authid'::regclass AND d.refobjid IN (SELECT oid FROM me)
    UNION ALL
    SELECT jsonb_build_object('axis', 'database', 'object', CASE WHEN db.datname = current_database() THEN 'current' ELSE db.datname::text END,
      'privilege', p.priv,
      'via', CASE WHEN has_database_privilege('public', db.oid, p.priv) THEN 'PUBLIC'
                  WHEN EXISTS (SELECT 1 FROM aclexplode(coalesce(db.datacl, acldefault('d', db.datdba))) a
                               WHERE a.grantee IN (SELECT oid FROM me) AND a.privilege_type = p.priv) THEN 'direct'
                  ELSE 'inherited' END,
      'detail', jsonb_build_object('allowconn', db.datallowconn, 'peer', db.oid IN (SELECT oid FROM peer_ok)))
    FROM pg_database db CROSS JOIN (VALUES ('CONNECT'), ('TEMPORARY'), ('CREATE')) p(priv)
    WHERE EXISTS (SELECT 1 FROM me) AND has_database_privilege((SELECT oid FROM me), db.oid, p.priv)
    UNION ALL
    SELECT jsonb_build_object('axis', 'schema', 'object', n.nspname::text, 'privilege', p.priv,
      'via', CASE WHEN has_schema_privilege('public', n.oid, p.priv) THEN 'PUBLIC'
                  WHEN EXISTS (SELECT 1 FROM aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
                               WHERE a.grantee IN (SELECT oid FROM me) AND a.privilege_type = p.priv) THEN 'direct'
                  ELSE 'inherited' END)
    FROM pg_namespace n CROSS JOIN (VALUES ('USAGE'), ('CREATE')) p(priv)
    WHERE EXISTS (SELECT 1 FROM me) AND n.nspname NOT LIKE 'pg\_toast%' AND n.nspname NOT LIKE 'pg\_temp\_%'
      AND has_schema_privilege((SELECT oid FROM me), n.oid, p.priv)
    UNION ALL
    -- العلاقاتُ والتسلسلات: كلُّ امتياز، والقراءةُ كذلك عدا قراءةِ الكتالوج.
    SELECT jsonb_build_object('axis', CASE WHEN c.relkind = 'S' THEN 'sequence' ELSE 'relation' END,
      'object', c.oid::regclass::text, 'privilege', p.priv,
      'via', CASE WHEN c.relkind = 'S' AND has_sequence_privilege('public', c.oid, p.priv) THEN 'PUBLIC'
                  WHEN c.relkind <> 'S' AND has_table_privilege('public', c.oid, p.priv) THEN 'PUBLIC'
                  WHEN EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault(CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END::"char", c.relowner))) a
                               WHERE a.grantee IN (SELECT oid FROM me) AND a.privilege_type = p.priv) THEN 'direct'
                  ELSE 'inherited' END,
      'detail', jsonb_build_object('relkind', c.relkind::text, 'schema', n.nspname))
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN'), ('USAGE')) p(priv)
    WHERE EXISTS (SELECT 1 FROM me) AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
      AND n.nspname NOT LIKE 'pg\_toast%' AND n.nspname NOT LIKE 'pg\_temp\_%'
      AND NOT (p.priv = 'SELECT' AND n.nspname IN ('pg_catalog', 'information_schema'))
      AND CASE
        WHEN c.relkind = 'S' THEN CASE WHEN p.priv IN ('SELECT', 'UPDATE', 'USAGE') THEN has_sequence_privilege((SELECT oid FROM me), c.oid, p.priv) ELSE false END
        WHEN p.priv = 'USAGE' THEN false
        ELSE has_table_privilege((SELECT oid FROM me), c.oid, p.priv) END
    UNION ALL
    -- الأعمدة: امتيازُ عمودٍ دونَ الجدول (‏GRANT UPDATE (col) …).
    SELECT jsonb_build_object('axis', 'column', 'object', c.oid::regclass::text || '.' || quote_ident(a.attname), 'privilege', p.priv,
      'via', CASE WHEN has_column_privilege('public', c.oid, a.attnum, p.priv) THEN 'PUBLIC'
                  WHEN EXISTS (SELECT 1 FROM aclexplode(a.attacl) x WHERE x.grantee IN (SELECT oid FROM me) AND x.privilege_type = p.priv) THEN 'direct'
                  ELSE 'inherited' END,
      'detail', jsonb_build_object('schema', n.nspname))
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) p(priv)
    WHERE EXISTS (SELECT 1 FROM me) AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\_toast%'
      AND NOT has_table_privilege((SELECT oid FROM me), c.oid, p.priv)
      AND has_column_privilege((SELECT oid FROM me), c.oid, a.attnum, p.priv)
    UNION ALL
    -- الدوالّ: كلُّ ما خارجَ الكتالوج، وكلُّ SECURITY DEFINER، وقائمةٌ حسّاسةٌ من الكتالوج.
    SELECT jsonb_build_object('axis', 'function', 'object', p.oid::regprocedure::text, 'privilege', 'EXECUTE',
      'via', CASE WHEN has_function_privilege('public', p.oid, 'EXECUTE') THEN 'PUBLIC'
                  WHEN EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                               WHERE a.grantee IN (SELECT oid FROM me) AND a.privilege_type = 'EXECUTE') THEN 'direct'
                  ELSE 'inherited' END,
      'detail', jsonb_build_object('schema', n.nspname, 'language', l.lanname, 'trusted', l.lanpltrusted OR l.lanname IN ('sql', 'plpgsql'),
        'secdef', p.prosecdef, 'owner', pg_get_userbyid(p.proowner), 'volatile', p.provolatile::text))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
    WHERE EXISTS (SELECT 1 FROM me) AND has_function_privilege((SELECT oid FROM me), p.oid, 'EXECUTE')
      AND (n.nspname NOT IN ('pg_catalog', 'information_schema') OR p.prosecdef
           OR (n.nspname = 'pg_catalog' AND p.proname IN ('lo_creat', 'lo_create', 'lo_from_bytea', 'lo_put', 'lowrite', 'lo_unlink',
               'lo_truncate', 'lo_truncate64', 'lo_open', 'lo_import', 'lo_export', 'pg_logical_emit_message', 'pg_notify',
               'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir', 'pg_stat_file', 'pg_reload_conf', 'pg_rotate_logfile',
               'pg_terminate_backend', 'pg_cancel_backend')))
    UNION ALL
    SELECT jsonb_build_object('axis', 'tablespace', 'object', t.spcname::text, 'privilege', 'CREATE',
      'via', CASE WHEN has_tablespace_privilege('public', t.oid, 'CREATE') THEN 'PUBLIC' ELSE 'direct_or_inherited' END)
    FROM pg_tablespace t WHERE EXISTS (SELECT 1 FROM me) AND has_tablespace_privilege((SELECT oid FROM me), t.oid, 'CREATE')
    UNION ALL
    SELECT jsonb_build_object('axis', 'foreign', 'object', 'fdw:' || f.fdwname, 'privilege', 'USAGE',
      'via', CASE WHEN has_foreign_data_wrapper_privilege('public', f.oid, 'USAGE') THEN 'PUBLIC' ELSE 'direct_or_inherited' END)
    FROM pg_foreign_data_wrapper f WHERE EXISTS (SELECT 1 FROM me) AND has_foreign_data_wrapper_privilege((SELECT oid FROM me), f.oid, 'USAGE')
    UNION ALL
    SELECT jsonb_build_object('axis', 'foreign', 'object', 'server:' || s.srvname, 'privilege', 'USAGE',
      'via', CASE WHEN has_server_privilege('public', s.oid, 'USAGE') THEN 'PUBLIC' ELSE 'direct_or_inherited' END)
    FROM pg_foreign_server s WHERE EXISTS (SELECT 1 FROM me) AND has_server_privilege((SELECT oid FROM me), s.oid, 'USAGE')
    UNION ALL
    SELECT jsonb_build_object('axis', 'foreign', 'object', 'user_mapping:' || um.srvname, 'privilege', 'MAPPING',
      'via', CASE WHEN um.umuser = 0 THEN 'PUBLIC' ELSE 'direct' END)
    FROM pg_user_mappings um WHERE um.umuser = 0 OR um.umuser IN (SELECT oid FROM me)
    UNION ALL
    SELECT jsonb_build_object('axis', 'parameter', 'object', pa.parname::text, 'privilege', a.privilege_type,
      'via', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE 'direct' END)
    FROM pg_parameter_acl pa, LATERAL aclexplode(pa.paracl) a
    WHERE a.grantee = 0 OR a.grantee IN (SELECT oid FROM me)
    UNION ALL
    SELECT jsonb_build_object('axis', 'default_acl', 'object', da.defaclrole::regrole::text || ':' || da.defaclobjtype::text
        || ':' || coalesce(da.defaclnamespace::regnamespace::text, '*'), 'privilege', a.privilege_type,
      'via', CASE WHEN a.grantee = 0 THEN 'PUBLIC' WHEN da.defaclrole IN (SELECT oid FROM me) THEN 'owner' ELSE 'direct' END)
    FROM pg_default_acl da, LATERAL aclexplode(da.defaclacl) a
    WHERE da.defaclrole IN (SELECT oid FROM me) OR a.grantee = 0 OR a.grantee IN (SELECT oid FROM me)
    UNION ALL
    SELECT jsonb_build_object('axis', 'large_object', 'object', lo.oid::text, 'privilege', a.privilege_type,
      'via', CASE WHEN a.grantee = 0 THEN 'PUBLIC' WHEN lo.lomowner IN (SELECT oid FROM me) THEN 'owner' ELSE 'direct' END)
    FROM pg_largeobject_metadata lo, LATERAL aclexplode(coalesce(lo.lomacl, acldefault('L', lo.lomowner))) a
    WHERE a.grantee = 0 OR a.grantee IN (SELECT oid FROM me) OR lo.lomowner IN (SELECT oid FROM me)
    UNION ALL
    -- إعداداتُ الدورِ والقاعدة: أسماءُ المعاملاتِ وحدَها (‏لا قيم — لا أسرارَ في الدليل).
    SELECT jsonb_build_object('axis', 'role_setting',
      'object', CASE WHEN st.setrole = 0 THEN 'ALL_ROLES' ELSE 'xf_reaper' END || '@' ||
                CASE WHEN st.setdatabase = 0 THEN '*' ELSE coalesce((SELECT datname::text FROM pg_database WHERE oid = st.setdatabase), st.setdatabase::text) END,
      'privilege', (SELECT string_agg(split_part(s, '=', 1), ',' ORDER BY 1) FROM unnest(st.setconfig) s),
      'via', CASE WHEN st.setrole = 0 THEN 'ALL_ROLES' ELSE 'direct' END)
    FROM pg_db_role_setting st
    WHERE st.setrole IN (SELECT oid FROM me)
       OR (st.setrole = 0 AND st.setdatabase IN (0, (SELECT oid FROM pg_database WHERE datname = current_database())))
    UNION ALL
    -- من يملكُ بابَ الحاصدِ أو جدولَ نبضِه أو قراءتَه غيرُ المقرَّرين.
    SELECT jsonb_build_object('axis', 'reaper_surface_grantee', 'object', o.obj, 'privilege', a.privilege_type,
      'via', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END)
    FROM (SELECT 'fence.reaper_tick(uuid,integer,integer)' AS obj, p.proacl AS acl, p.proowner AS own FROM pg_proc p WHERE p.oid = to_regprocedure('fence.reaper_tick(uuid,integer,integer)')
          UNION ALL SELECT 'fence.reaper_health(integer)', p.proacl, p.proowner FROM pg_proc p WHERE p.oid = to_regprocedure('fence.reaper_health(integer)')
          UNION ALL SELECT 'fence.reaper_heartbeat', c.relacl, c.relowner FROM pg_class c WHERE c.oid = to_regclass('fence.reaper_heartbeat')) o,
         LATERAL aclexplode(o.acl) a
    WHERE a.grantee <> o.own
  ) s
$f$;

-- قائمةُ السماحِ الصريحة — كلُّ سطرٍ بمسوّغه:
--   role_attribute: LOGIN؛ NOINHERIT؛ لا SUPERUSER/CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS؛ CONNECTION LIMIT بينَ 0 و2؛ لا
--     كلمةَ مرورٍ صالحة. (‏NOLOGIN أو حدٌّ أدنى = قدرةٌ أقلّ: صحّةٌ في reaper_health لا مشكلةُ امتياز.)
--   database: CONNECT على هذه القاعدةِ مباشرةً، وعلى قاعدةٍ نظيرة (‏peer) مباشرةً (‏قاعدةٌ ALLOW_CONNECTIONS false تُستثنى).
--   schema: USAGE على fence مباشرة؛ وUSAGE لـPUBLIC على أيِّ مخطّط (‏لا يمنحُ وحدَه شيئاً — العلاقاتُ والدوالُّ تُفحَصُ أدناه).
--   function: fence.reaper_tick(uuid,integer,integer) مباشرة؛ fence.read_ok() لـPUBLIC (‏0024، قراءةُ حالة)؛ pg_terminate_backend وpg_cancel_backend
--     لـPUBLIC (‏افتراضُ PG؛ فحصٌ داخليّ: الدورُ نفسُه أو pg_signal_backend — مقيسٌ 42501 على جلسةِ الجذر).
--   shared_dependency 'a': منحُ CONNECT على هذه القاعدة، وUSAGE على fence، وEXECUTE على reaper_tick — لا غير؛ وفي قاعدةٍ
--     نظيرةٍ الشكلُ نفسُه وحدَه (‏peer: منحٌ على مخطّطٍ واحدٍ ودالّةٍ واحدة وCONNECT — 0030 مطبَّقةٌ هناك).
--   reaper_surface_grantee: reaper_tick لـxf_reaper؛ reaper_health لـxf_root/xf_sovereign/xf_auditor؛ الجدولُ بلا منح.
-- كلُّ ما سواه مشكلة: عضويّةٌ في أيِّ اتّجاه، ملكيّة، أيُّ امتيازِ علاقةٍ/عمودٍ/تسلسل، TEMP/CREATE، قاعدةٌ أخرى، أجنبيّ، معاملات،
-- ACL افتراضيّ، كائنٌ كبير، إعدادُ دورٍ أو قاعدة، غيابُ الدور.
CREATE FUNCTION fence.reaper_capability_problems() RETURNS jsonb
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

-- الصحّة. العتبةُ لكلِّ نسخة = ceiling_ms + 2 × query_timeout_ms المُصرَّحان + slack_ms: الحاصدُ لا ينامُ فوقَ سقفِه (‏ولا
-- تراجعُه)، والاتصالُ بعدَ انقطاعٍ لا يتجاوزُ المهلة (‏connectionTimeoutMillis)، والنداءُ لا يتجاوزُها (‏statement_timeout) وإلا
-- أُلغيَ بلا نبض؛ وslack_ms لتأخّرِ المؤقِّتِ وعودةِ النتيجة. العميلُ يربطُ المهلتَين بالقيمةِ المُصرَّحةِ نفسِها.
CREATE FUNCTION fence.reaper_health(slack_ms integer DEFAULT 1000) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE now_ timestamptz; inst jsonb; priv jsonb; priv_ok boolean; priv_err jsonb;
  unbound int; n_conn int; n_healthy int; n_anom int; n_stale int;
BEGIN
  IF slack_ms IS NULL OR slack_ms NOT BETWEEN 0 AND 600000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'fence: slack_ms ∈ [0، 600000]';
  END IF;
  BEGIN
    priv := fence.reaper_capability_problems();
    priv_ok := jsonb_typeof(priv) = 'array' AND jsonb_array_length(priv) = 0;
  EXCEPTION WHEN OTHERS THEN
    priv_ok := false; priv := NULL; priv_err := jsonb_build_object('sqlstate', SQLSTATE, 'message', SQLERRM);
  END;
  PERFORM pg_stat_clear_snapshot();
  now_ := clock_timestamp();
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.last_tick_at DESC, s.instance), '[]'::jsonb) INTO inst FROM (
    SELECT t.*, (t.connected AND t.tick_fresh AND t.ok_fresh AND NOT t.clock_anomaly) AS healthy FROM (
      SELECT h.instance, h.backend_pid, h.backend_start, h.ceiling_ms, h.query_timeout_ms, h.ticks, h.ok_ticks,
        h.failed_ticks, h.reaped_total, h.connects, h.last_tick_at, h.last_ok_at, h.last_result, h.last_error,
        h.ceiling_ms::bigint + 2 * h.query_timeout_ms::bigint + slack_ms AS stale_after_ms,
        EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.pid = h.backend_pid AND a.backend_start = h.backend_start
                AND a.usename = 'xf_reaper') AS connected,
        floor(extract(epoch FROM now_ - h.last_tick_at) * 1000)::bigint AS tick_age_ms,
        CASE WHEN h.last_ok_at IS NULL THEN NULL ELSE floor(extract(epoch FROM now_ - h.last_ok_at) * 1000)::bigint END AS ok_age_ms,
        (h.last_tick_at > now_ OR h.last_ok_at > now_ OR h.last_ok_at > h.last_tick_at OR h.first_tick_at > h.last_tick_at) AS clock_anomaly,
        (h.last_tick_at <= now_ AND now_ - h.last_tick_at <= make_interval(secs => (h.ceiling_ms::bigint + 2 * h.query_timeout_ms::bigint + slack_ms) / 1000.0)) AS tick_fresh,
        (h.last_ok_at IS NOT NULL AND h.last_ok_at = h.last_tick_at AND h.last_error IS NULL
          AND (h.last_result->>'ok')::boolean IS TRUE
          AND now_ - h.last_ok_at <= make_interval(secs => (h.ceiling_ms::bigint + 2 * h.query_timeout_ms::bigint + slack_ms) / 1000.0)) AS ok_fresh
      FROM fence.reaper_heartbeat h) t) s;
  SELECT count(*) INTO unbound FROM pg_stat_activity a
  WHERE a.usename = 'xf_reaper' AND a.backend_type = 'client backend'
    AND NOT EXISTS (SELECT 1 FROM fence.reaper_heartbeat h WHERE h.backend_pid = a.pid AND h.backend_start = a.backend_start);
  SELECT count(*) FILTER (WHERE (e->>'connected')::boolean),
         count(*) FILTER (WHERE (e->>'healthy')::boolean),
         count(*) FILTER (WHERE (e->>'clock_anomaly')::boolean),
         count(*) FILTER (WHERE (e->>'connected')::boolean AND NOT (e->>'tick_fresh')::boolean)
    INTO n_conn, n_healthy, n_anom, n_stale FROM jsonb_array_elements(inst) e;
  RETURN jsonb_build_object(
    'checked_at', now_, 'slack_ms', slack_ms,
    'process_alive', NULL, 'process_alive_observable', false,
    'db_connected', n_conn > 0,
    'tick_attempted', EXISTS (SELECT 1 FROM jsonb_array_elements(inst) e
                              WHERE (e->>'connected')::boolean AND (e->>'tick_fresh')::boolean AND NOT (e->>'clock_anomaly')::boolean),
    'tick_succeeded', n_healthy > 0,
    'privileges_intact', priv_ok,
    'privilege_problems', priv, 'privilege_error', priv_err,
    'anomalies', jsonb_build_object(
      'connected_instances', n_conn,
      'healthy_instances', n_healthy,
      'stale_connected_instances', n_stale,
      'clock_anomaly_instances', n_anom,
      'unbound_reaper_sessions', unbound),
    'healthy', n_healthy = 1 AND n_conn = 1 AND unbound = 0 AND n_stale = 0 AND n_anom = 0 AND priv_ok,
    'instances', inst);
END
$f$;

-- الربطُ بـcheck_fenced: الجسمُ القائمُ يُعادُ تسميتُه كما هو (‏البصمةُ لا تتغيّر — الاسمُ خارجَها؛ وACL كما هو).
ALTER FUNCTION fence.capability_problems() RENAME TO _worker_capability_problems;

CREATE FUNCTION fence.capability_problems() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE w jsonb; r jsonb;
BEGIN
  -- خطأُ جردِ العاملِ يصعدُ إلى check_fenced كما قبل 0030 (‏capability_inventory_failed).
  w := fence._worker_capability_problems();
  BEGIN
    r := fence.reaper_capability_problems();
    IF r IS NULL OR jsonb_typeof(r) IS DISTINCT FROM 'array' THEN
      r := jsonb_build_array(jsonb_build_object('kind', 'reaper_inventory_unreadable', 'got', coalesce(jsonb_typeof(r), 'null')));
    ELSIF EXISTS (SELECT 1 FROM jsonb_array_elements(r) e
                  WHERE jsonb_typeof(e) IS DISTINCT FROM 'object' OR jsonb_typeof(e->'kind') IS DISTINCT FROM 'string') THEN
      r := jsonb_build_array(jsonb_build_object('kind', 'reaper_inventory_unreadable', 'got', 'malformed_element'));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    r := jsonb_build_array(jsonb_build_object('kind', 'reaper_inventory_failed', 'sqlstate', SQLSTATE, 'message', SQLERRM));
  END;
  RETURN w || r;
END
$f$;

-- notify_surface: التغييرُ الوحيدُ إضافةُ 'xf_reaper' إلى allowed.
CREATE OR REPLACE FUNCTION fence.notify_surface() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
  WITH db AS (SELECT d.oid, d.datname, d.datdba, coalesce(d.datacl, acldefault('d', d.datdba)) AS acl
              FROM pg_database d WHERE d.datname = current_database()),
  allowed AS (SELECT unnest(ARRAY['xuux_worker', 'xf_root', 'xf_sovereign', 'xf_auditor', 'xuux_migrator', 'xf_reaper']::name[]) AS rolname),
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

REVOKE ALL ON FUNCTION fence.reaper_tick(uuid, integer, integer), fence.reaper_health(integer), fence.reaper_capabilities(),
  fence.reaper_capability_problems(), fence.capability_problems() FROM PUBLIC;

-- البيان.
DELETE FROM fence.manifest WHERE function_signature IN ('fence.capability_problems()', 'fence.notify_surface()');
INSERT INTO fence.manifest (function_signature, digest)
SELECT p.oid::regprocedure::text,
       encode(sha256(convert_to(concat_ws('|', p.prosrc, p.prosecdef::text, pg_get_userbyid(p.proowner),
         coalesce(array_to_string(p.proconfig, ','), ''), p.provolatile::text), 'UTF8')), 'hex')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'fence' AND p.oid::regprocedure::text IN (
  'fence._worker_capability_problems()', 'fence.capability_problems()', 'fence.notify_surface()',
  'fence.reaper_tick(uuid,integer,integer)', 'fence.reaper_health(integer)', 'fence.reaper_capabilities()',
  'fence.reaper_capability_problems()');

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

GRANT EXECUTE ON FUNCTION fence.capability_problems(), fence.reaper_capabilities(), fence.reaper_capability_problems()
  TO xf_root, xf_sovereign, xf_auditor, xuux_migrator;
GRANT EXECUTE ON FUNCTION fence.reaper_health(integer) TO xf_root, xf_sovereign, xf_auditor;
GRANT USAGE ON SCHEMA fence TO xf_reaper;
DO $c$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO xf_reaper', current_database()); END $c$;
GRANT EXECUTE ON FUNCTION fence.reaper_tick(uuid, integer, integer) TO xf_reaper;

ALTER EVENT TRIGGER xf_ddl_end ENABLE ALWAYS;
