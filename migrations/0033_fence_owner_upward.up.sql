-- الهجرة 0033 (تقديم) — عضويّةُ xf_owner الصاعدة: كشفٌ يمنعُ RESUME، وحارسا الكاتبِ لا يُعفيان عبرَ xf_owner (‏WL-563).
--
-- **العيبُ المقيس (‏PG 18.6، WL-563):** الحارسان (‏0031 `_control_guard` وXF105، و0032 `_table_writer_guard` وXF107) يُعفيان
-- session_user إذا كان `pg_has_role(.., 'xf_root'|'xf_sovereign', 'MEMBER')`. فإن صارَ xf_owner نفسُه عضواً في xf_root أو
-- xf_sovereign (‏`GRANT xf_root TO xf_owner` — مباشرةً، أو عبرَ دورٍ وسيط، أو INHERIT FALSE SET FALSE، فـMEMBER لا يعبأُ بالخيارات)
-- صارَ كلُّ عضوٍ في xf_owner «جذراً»: بعدَ `SET ROLE xf_owner` يمدُّ fence.run_lease سنةً ويكتبُ fence.credentials وصفَّ التحكّمِ
-- بحالةٍ مقيِّدة — أي يبطلُ 0032 ويُضعِفُ 0031. والحافّةُ الصاعدةُ وحدَها لا يراها check_fenced (‏ok = true وRESUME ينجح).
--
-- ما تغيّرُه: (١) دالّةٌ جديدةٌ `fence._owner_reach_problems()` (‏SECURITY INVOKER، مسحوبةٌ من PUBLIC) تجردُ كلَّ دورٍ يصلُ إليه
-- xf_owner صعوداً خارجَ أساسِه (‏0024: pg_read_all_stats وpg_signal_backend وxuux_worker بخياراتِها)، و`check_fenced()` = نصُّ 0032
-- مع كتلةٍ مغلقةِ الفشل تُناديها (‏`owner_upward_membership`). (٢) الحارسان يحسبان عضويّةَ الجذرِ أو السياديِّ لعضوِ xf_owner بمسارٍ
-- لا يمرُّ بـxf_owner. **بلا عضويّةٍ صاعدةٍ (‏الأساسُ المقيس) يساوي الشرطُ الجديدُ القديمَ حرفيّاً**: مسارٌ إلى الجذرِ عبرَ xf_owner
-- يستلزمُ أن يصلَ xf_owner إلى الجذر. **لا تغييرَ في صلاحيّاتِ أيِّ دور** (‏لا GRANT ولا REVOKE ولا ALTER ROLE)، ولا في 0024..0032.
-- **ما لا تغيّرُه:** الجذرُ أو السياديُّ عضواً مباشراً في xf_owner (‏بقيّةٌ مُعلَنةٌ منذُ 0032، قرارُ مالك)؛ superuser خارجَ السياج (‏T-OWN-04).
--
-- **شرطُ التطبيق:** superuser، وغيرُ RUNNING (‏D-13)، وxf_ddl_end على ENABLE ALWAYS.

DO $pre$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'fence: تقديمُ 0033 يتطلّبُ superuser (‏xf_ddl_end يُعطَّلُ داخلَ المعاملة)';
  END IF;
  IF (fence.effective_state()->>'state') = 'RUNNING' THEN
    RAISE EXCEPTION 'fence: لا تقديمُ 0033 تحتَ RUNNING — أوقِف أولاً (D-13)';
  END IF;
  IF (SELECT evtenabled FROM pg_catalog.pg_event_trigger WHERE evtname = 'xf_ddl_end') IS DISTINCT FROM 'A' THEN
    RAISE EXCEPTION 'fence: xf_ddl_end ليس ENABLE ALWAYS — حالةٌ غيرُ متوقَّعة، لا تُعادُ صامتاً';
  END IF;
END
$pre$;

-- البيانُ يُطابقُ الدوالَّ الحيّةَ قبلَ أيِّ تغيير (‏فشلٌ مغلق — كما في 0025..0032).
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

-- ‏كلُّ دورٍ يصلُ إليه xf_owner صعوداً (‏xf_owner عضوٌ فيه، مباشرةً أو عبرَ سلسلة) خارجَ أساسِه المقيس بعدَ 0024، أو حلقةٌ
-- مباشرةٌ من الأساسِ بخياراتٍ غيرِ خياراتِه. الأساسُ (‏0024): pg_read_all_stats وpg_signal_backend (‏INHERIT، SET، بلا ADMIN)
-- وxuux_worker (‏ADMIN وحدَه). **مجموعةٌ لا تعدادُ مسارات** كما في _owner_membership_problems (‏0028): reach بـUNION، والعمقُ
-- لا يتجاوزُ عددَ الأدوار، والأبُ على أقصرِ مسارٍ أصغرُ oid. لا يُستثنى superuser هنا: xf_owner عضواً في دورٍ فائقٍ يجعلُ كلَّ عضوٍ
-- فيه قادراً على SET ROLE إليه.
CREATE FUNCTION fence._owner_reach_problems() RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $f$
DECLARE owner_oid oid; out jsonb;
BEGIN
  SELECT r.oid INTO owner_oid FROM pg_roles r WHERE r.rolname = 'xf_owner';
  IF owner_oid IS NULL THEN
    RAISE EXCEPTION 'fence: الدورُ xf_owner غائب — لا جردَ للعضويّةِ الصاعدة';
  END IF;
  WITH RECURSIVE e AS (
    SELECT am.roleid, am.member, bool_or(am.admin_option) AS admin, bool_or(am.inherit_option) AS inherit,
           bool_or(am.set_option) AS set_
    FROM pg_auth_members am GROUP BY am.roleid, am.member
  ), base(rolname, admin, inherit, set_) AS (
    VALUES ('pg_read_all_stats'::name, false, true, true), ('pg_signal_backend'::name, false, true, true),
           ('xuux_worker'::name, true, false, false)
  ), reach(role, depth) AS (
    SELECT e.roleid, 1 FROM e WHERE e.member = owner_oid
    UNION
    SELECT e.roleid, r.depth + 1 FROM reach r JOIN e ON e.member = r.role
    WHERE r.depth < (SELECT count(*) FROM pg_roles)
  ), d AS (
    SELECT role, min(depth) AS depth FROM reach WHERE role <> owner_oid GROUP BY role
  ), par AS (
    SELECT d.role, d.depth,
           (SELECT e.member FROM e WHERE e.roleid = d.role
              AND CASE WHEN d.depth = 1 THEN e.member = owner_oid
                       ELSE e.member IN (SELECT d2.role FROM d d2 WHERE d2.depth = d.depth - 1) END
            ORDER BY e.member LIMIT 1) AS child
    FROM d
  ), walk(start, child, path, edges) AS (
    SELECT p.role, p.child,
           jsonb_build_array(pg_get_userbyid(p.child), pg_get_userbyid(p.role)),
           jsonb_build_array(jsonb_build_object('role', pg_get_userbyid(p.role), 'member', pg_get_userbyid(p.child),
             'admin', e.admin, 'inherit', e.inherit, 'set', e.set_))
    FROM par p JOIN e ON e.roleid = p.role AND e.member = p.child
    UNION ALL
    SELECT w.start, p.child, jsonb_build_array(pg_get_userbyid(p.child)) || w.path,
           jsonb_build_array(jsonb_build_object('role', pg_get_userbyid(p.role), 'member', pg_get_userbyid(p.child),
             'admin', e.admin, 'inherit', e.inherit, 'set', e.set_)) || w.edges
    FROM walk w JOIN par p ON p.role = w.child JOIN e ON e.roleid = p.role AND e.member = p.child
    WHERE w.child <> owner_oid
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', 'owner_upward_membership', 'role', r.rolname,
           'superuser', r.rolsuper, 'reserved', r.rolname IN ('xf_root', 'xf_sovereign'),
           'depth', jsonb_array_length(w.edges), 'path', w.path, 'edges', w.edges) ORDER BY r.rolname), '[]'::jsonb)
  INTO out
  FROM walk w JOIN pg_roles r ON r.oid = w.start
  WHERE w.child = owner_oid
    AND NOT EXISTS (SELECT 1 FROM base b JOIN e ON e.roleid = r.oid AND e.member = owner_oid
                    WHERE b.rolname = r.rolname AND jsonb_array_length(w.edges) = 1
                      AND e.admin = b.admin AND e.inherit = b.inherit AND e.set_ = b.set_);
  RETURN out;
END
$f$;

REVOKE ALL ON FUNCTION fence._owner_reach_problems() FROM PUBLIC;

CREATE OR REPLACE FUNCTION fence._control_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $f$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION USING ERRCODE = 'XF101', MESSAGE = 'fence: صفُّ التحكّمِ لا يُحذَف';
  END IF;
  -- WL-560: الكاتبُ يُقرَّرُ بـsession_user (‏SET ROLE وSECURITY DEFINER لا يغيّرانه، وSET SESSION AUTHORIZATION لـsuperuser
  -- وحدَه): superuser، أو عضوٌ في xf_root (‏halt_lock/halt_complete) أو xf_sovereign (‏الأوامرُ الموقَّعة) — وما سواهم ⇒ XF105
  -- ولو كان current_user = xf_owner مالكَ الجدول. وعضوٌ في xf_owner غيرُ superuser — ولو كان جذراً أو سياديّاً — لا يكتبُ
  -- RUNNING ولا يُغيّرُ إلّا الحالةَ والعهدَ والختم (‏إيقافٌ يبقى ممكناً) ⇒ XF106.
  IF NOT coalesce((SELECT r.rolsuper FROM pg_roles r WHERE r.rolname = session_user), false) THEN
    -- WL-563: عضويّةُ الجذرِ أو السياديِّ تُحسَبُ لعضوِ xf_owner بمسارٍ لا يمرُّ بـxf_owner وحدَه. فـ`GRANT xf_root TO xf_owner`
    -- (‏مباشرةً أو عبرَ وسيطٍ، وبأيِّ خيارات) كانت تجعلُ كلَّ عضوٍ في xf_owner «جذراً» فيتخطّى XF105. ولغيرِ أعضاءِ xf_owner الشرطُ
    -- هو نفسُه حرفيّاً (‏مسارٌ عبرَ xf_owner يجعلُ صاحبَه عضواً فيه)، فلا يتغيّرُ الجذرُ ولا السياديُّ ولا الإيقاف.
    IF NOT ((pg_has_role(session_user, 'xf_root', 'MEMBER') OR pg_has_role(session_user, 'xf_sovereign', 'MEMBER'))
            AND (NOT pg_has_role(session_user, 'xf_owner', 'MEMBER') OR EXISTS (
             WITH RECURSIVE up(oid) AS (
               SELECT r.oid FROM pg_roles r WHERE r.rolname = session_user
               UNION
               SELECT am.roleid FROM up JOIN pg_auth_members am ON am.member = up.oid
               WHERE am.roleid IS DISTINCT FROM (SELECT o.oid FROM pg_roles o WHERE o.rolname = 'xf_owner'))
             SELECT 1 FROM up JOIN pg_roles t ON t.oid = up.oid WHERE t.rolname IN ('xf_root', 'xf_sovereign')))) THEN
      RAISE EXCEPTION USING ERRCODE = 'XF105',
        MESSAGE = format('fence: صفُّ التحكّمِ لا يكتبُه %s — الجذرُ أو السياديُّ أو superuser وحدَهم (‏session_user)', session_user);
    END IF;
    IF pg_has_role(session_user, 'xf_owner', 'MEMBER') AND (TG_OP = 'INSERT' OR NEW.state = 'RUNNING'
       OR (to_jsonb(NEW) - ARRAY['state', 'epoch', 'seal', 'updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state', 'epoch', 'seal', 'updated_at'])) THEN
      RAISE EXCEPTION USING ERRCODE = 'XF106',
        MESSAGE = format('fence: %s عضوٌ في xf_owner — لا يكتبُ RUNNING ولا غيرَ الحالةِ المقيِّدة', session_user);
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF (SELECT count(*) FROM fence.control) > 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'XF101', MESSAGE = 'fence: صفُّ تحكّمٍ واحدٌ فقط';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.epoch < OLD.epoch THEN
    RAISE EXCEPTION USING ERRCODE = 'XF102', MESSAGE = format('fence: العهدُ لا ينقص (%s → %s)', OLD.epoch, NEW.epoch);
  END IF;
  IF NEW.state <> OLD.state THEN
    IF NEW.epoch <= OLD.epoch AND NOT (OLD.state = 'HALT_REQUESTED' AND NEW.state = 'HALTED') THEN
      RAISE EXCEPTION USING ERRCODE = 'XF102', MESSAGE = 'fence: تغييرُ الحالةِ يرفعُ العهد';
    END IF;
    IF NOT (
         (OLD.state = 'RUNNING' AND NEW.state IN ('HALT_REQUESTED', 'RECOVERY_REQUIRED'))
      OR (OLD.state = 'HALT_REQUESTED' AND NEW.state IN ('HALTED', 'RECOVERY_REQUIRED'))
      OR (OLD.state = 'HALTED' AND NEW.state IN ('RUNNING', 'RECOVERY_REQUIRED', 'HALT_REQUESTED'))
      OR (OLD.state = 'RECOVERY_REQUIRED' AND NEW.state IN ('HALTED'))
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'XF103', MESSAGE = format('fence: انتقالٌ ممنوع %s → %s', OLD.state, NEW.state);
    END IF;
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END
$f$;

CREATE OR REPLACE FUNCTION fence._table_writer_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $f$
BEGIN
  -- WL-561: عضوٌ في xf_owner غيرُ superuser وليس جذراً ولا سياديّاً لا يكتبُ أيَّ جدولٍ في fence (‏بعدَ SET ROLE xf_owner هو
  -- المالك، فالامتيازُ وحدَه لا يمنعُه). الكاتبُ يُقرَّرُ بـsession_user (‏SET ROLE وSECURITY DEFINER لا يغيّرانه). المساراتُ
  -- المشروعةُ (‏العامل، الحاصد، الجذر، السياديّ، المدقّق، الهجراتُ بـsuperuser) ليست أعضاءً في xf_owner فلا تتغيّر.
  IF NOT coalesce((SELECT r.rolsuper FROM pg_roles r WHERE r.rolname = session_user), false)
     AND pg_has_role(session_user, 'xf_owner', 'MEMBER')
     -- WL-563: الاستثناءُ بمسارٍ إلى الجذرِ أو السياديِّ لا يمرُّ بـxf_owner (‏`GRANT xf_root TO xf_owner` لا يُعفي كلَّ عضو).
     -- بلا عضويّةٍ صاعدةٍ لـxf_owner (‏الأساس) يساوي الشرطُ شرطَ 0032 حرفيّاً.
     AND NOT EXISTS (
            WITH RECURSIVE up(oid) AS (
              SELECT r.oid FROM pg_roles r WHERE r.rolname = session_user
              UNION
              SELECT am.roleid FROM up JOIN pg_auth_members am ON am.member = up.oid
              WHERE am.roleid IS DISTINCT FROM (SELECT o.oid FROM pg_roles o WHERE o.rolname = 'xf_owner'))
            SELECT 1 FROM up JOIN pg_roles t ON t.oid = up.oid WHERE t.rolname IN ('xf_root', 'xf_sovereign')) THEN
    RAISE EXCEPTION USING ERRCODE = 'XF107',
      MESSAGE = format('fence: %s عضوٌ في xf_owner — لا يكتبُ fence.%s (‏%s)', session_user, TG_TABLE_NAME, TG_OP);
  END IF;
  IF TG_LEVEL = 'ROW' THEN RETURN NEW; END IF;
  RETURN NULL;
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
  -- WL-563: عضويّةُ xf_owner الصاعدة — دورٌ يصلُ إليه xf_owner خارجَ أساسِه (‏xf_root أو xf_sovereign أو superuser أو أيُّ دور)
  -- مشكلةٌ تمنعُ RESUME: `GRANT xf_root TO xf_owner` كانت تُعفي كلَّ عضوٍ في xf_owner من XF105/XF107 ولا يراها check_fenced.
  -- خطأٌ في الجردِ مشكلةٌ كذلك (‏فشلٌ مغلق) ولا يُسقِطُ check_fenced.
  BEGIN
    problems := problems || fence._owner_reach_problems();
  EXCEPTION WHEN OTHERS THEN
    problems := problems || jsonb_build_array(jsonb_build_object('kind', 'owner_reach_inventory_failed', 'sqlstate', SQLSTATE, 'message', SQLERRM));
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
    jsonb_build_object('kind', 'db_clock_trusted', 'note', 'الإيجارُ يُقاسُ بساعةِ القاعدة: التقدّمُ يُغلِق، والتراجعُ قبلَ آخرِ تجديدٍ يُرفَضُ (XF012)، وما دونَه يمدُّ الإيجارَ بما لا يزيدُ على نافذةٍ واحدة؛ العبثُ بها خارجَ السياج'),
    jsonb_build_object('kind', 'worker_self_alter_role', 'note', 'ALTER ROLE <نفسه> PASSWORD/SET بلا امتيازٍ يُسحَب ولا مُطلِقِ أحداث (WL-538): الإعداداتُ تُرفَضُ كتابتُها (XF013) وتُمحى عندَ الختمِ والإلغاءِ والإيقاف، وكلمةُ المرورِ لا تُدخِلُ أحداً (VALID UNTIL -infinity) وتُمحى كذلك؛ لكنّ الكتابةَ نفسَها تبقى ممكنةً بإيجارٍ منقضٍ حتى الانتقالِ التالي: إعداداتٌ يقرؤُها كلُّ دور، وبصمةٌ بمحتوًى يختارُه العاملُ لا يراها إلا superuser؛ ومنعُ الأمرِ من أصلِه يحتاجُ خطّافاً بلغةِ C (قرارُ معمار)'));
  RETURN jsonb_build_object('ok', jsonb_array_length(problems) = 0, 'problems', problems, 'residuals', residuals,
    'state', eff->'state', 'epoch', c.epoch, 'roster_version', c.roster_version, 'roster_hash', c.roster_hash,
    'incarnation', live, 'checked_at', clock_timestamp());
END
$f$;

-- البيان: الدوالُّ الأربعُ وحدَها (‏الجديدةُ والحارسانِ وcheck_fenced).
DELETE FROM fence.manifest WHERE function_signature IN (
  'fence._control_guard()',
  'fence._table_writer_guard()',
  'fence.check_fenced()',
  'fence._owner_reach_problems()');
INSERT INTO fence.manifest (function_signature, digest)
SELECT p.oid::regprocedure::text,
       encode(sha256(convert_to(concat_ws('|', p.prosrc, p.prosecdef::text, pg_get_userbyid(p.proowner),
         coalesce(array_to_string(p.proconfig, ','), ''), p.provolatile::text), 'UTF8')), 'hex')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'fence' AND p.oid::regprocedure::text IN (
  'fence._control_guard()',
  'fence._table_writer_guard()',
  'fence.check_fenced()',
  'fence._owner_reach_problems()');

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
