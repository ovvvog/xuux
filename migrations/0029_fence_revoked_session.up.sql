-- الهجرة 0029 (تقديم) — جلسةٌ حيّةٌ لاعتمادٍ ملغى تُبقي الحاصدَ ok=false (‏WL-552).
--
-- **العيبُ المقيس (‏مختبرُ WL-548 (‏د)، PG 18.6، نافذةٌ حقيقيّةٌ 5 ث):** جلسةُ عاملٍ لم تمُت بإشارةِ الإنهاء (‏عمليّةٌ موقوفة)
-- — النداءُ الأوّلُ للحاصدِ يُلغي الاعتمادَ ويُبلِّغُها unresolved، والثاني يُعلِنُ ok=true وهي حيّة: الحلقةُ على ACTIVE وحدَها،
-- والاعتمادُ صار REVOKED. وكذلك اعتمادٌ ألغاه الجذرُ يدويّاً (‏revoke_credential) وجلستُه باقية.
--
-- ما تغيّرُه: fence._reap_lapsed() تفحصُ كلَّ اعتمادٍ غيرِ ACTIVE له جلسةٌ حيّة، فتُرسِلُ إشارةَ إنهاءٍ بلا انتظارٍ لكلِّ
-- (‏pid، backend_start) عبرَ دالّةٍ جديدة fence._signal_session (‏تحقّقٌ من الزوجِ والدورِ قبيلَ الإشارة — حمايةٌ من إعادةِ
-- استعمالِ رقمِ العمليّة)، وتُبلِّغُ الباقيَ في `lingering` مع unresolved وok=false وحدثِ REVOKED_SESSION_LINGERING. لا تغييرَ
-- في التوقيع ولا في reap_lapsed() ولا في أيِّ صلاحيّة؛ الدالّةُ الجديدةُ مسحوبةٌ من PUBLIC ولا تُمنَحُ لأحد.
--
-- **شرطُ التطبيق:** superuser، وغيرُ RUNNING (‏D-13)، وxf_ddl_end على ENABLE ALWAYS.

DO $pre$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'fence: تقديمُ 0029 يتطلّبُ superuser (‏xf_ddl_end يُعطَّلُ داخلَ المعاملة)';
  END IF;
  IF (fence.effective_state()->>'state') = 'RUNNING' THEN
    RAISE EXCEPTION 'fence: لا تقديمُ 0029 تحتَ RUNNING — أوقِف أولاً (D-13)';
  END IF;
  IF (SELECT evtenabled FROM pg_catalog.pg_event_trigger WHERE evtname = 'xf_ddl_end') IS DISTINCT FROM 'A' THEN
    RAISE EXCEPTION 'fence: xf_ddl_end ليس ENABLE ALWAYS — حالةٌ غيرُ متوقَّعة، لا تُعادُ صامتاً';
  END IF;
END
$pre$;

-- البيانُ (‏fence.manifest) يُطابقُ الدوالَّ الحيّةَ قبلَ أيِّ تغيير (‏فشلٌ مغلق — كما في 0025..0028).
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

-- دوالُّ السياجِ يملكُها xf_owner (‏NOSUPERUSER) — كما في 0024..0028.
SET LOCAL ROLE xf_owner;

-- ‏إشارةُ إنهاءٍ لجلسةٍ بعينِها: (‏pid، backend_start) ودورُها عاملٌ باسمِه — يُعادُ التحقّقُ بلقطةٍ جديدةٍ قبيلَ الإشارة، فرقمُ
-- عمليّةٍ ماتت جلستُه وأُعيدَ لجلسةٍ أخرى (‏backend_start مختلف، أو دورٌ آخر) لا يُمَسّ. بلا انتظار (‏المهلةُ 0): الجلسةُ
-- المعلّقةُ لا تُوقِفُ الحاصد، وبقاؤها يُبلَّغُ ولا يُستَر. **حدّ:** بينَ التحقّقِ والإشارةِ لحظةٌ لا تُغلَق (‏لا إنهاءَ ذرّيٌّ بالزوجِ
-- في PostgreSQL)، وإعادةُ استعمالِ الرقمِ فيها تتطلّبُ موتَ الجلسةِ وولادةَ أخرى بالرقمِ نفسِه في تلك اللحظة.
CREATE FUNCTION fence._signal_session(p integer, started timestamptz, role_name name) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
BEGIN
  IF p IS NULL OR started IS NULL OR role_name IS NULL OR p = pg_backend_pid() THEN RETURN false; END IF;
  PERFORM pg_stat_clear_snapshot();
  IF NOT EXISTS (SELECT 1 FROM pg_stat_activity a
                 WHERE a.pid = p AND a.backend_start = started AND a.usename = role_name
                   AND a.usesysid IS NOT NULL AND fence.is_worker_role(a.usesysid)) THEN
    RETURN false;
  END IF;
  RETURN pg_terminate_backend(p);
END
$f$;

REVOKE ALL ON FUNCTION fence._signal_session(integer,timestamp with time zone,name) FROM PUBLIC;

CREATE OR REPLACE FUNCTION fence._reap_lapsed() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE c fence.control; cr fence.credentials; why text; n integer; alive integer; due bigint; sess jsonb; s jsonb;
  reaped jsonb := '[]'::jsonb; unresolved jsonb := '[]'::jsonb; lingering jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO c FROM fence.control WHERE id;
  FOR cr IN SELECT * FROM fence.credentials WHERE status = 'ACTIVE' ORDER BY role_name FOR UPDATE LOOP
    -- الفحصُ بعدَ القفل: FOR UPDATE في READ COMMITTED يُعيدُ أحدثَ نسخةٍ للصفِّ بعدَ انتظارِ المُمسِك، والإيجارُ
    -- يُقرأُ بلقطةٍ جديدة — فتجديدٌ التزمَ قبلَ القفلِ يُرى هنا ولا يُحصَدُ ما جُدِّد (‏مختبَرٌ بوصلتين).
    why := fence._lease_lapse_reason(cr, c);
    CONTINUE WHEN why IS NULL OR cr.status <> 'ACTIVE';
    n := fence._revoke_role(cr.role_name, 'LEASE_LAPSED:' || why);
    PERFORM pg_stat_clear_snapshot();
    SELECT count(*) INTO alive FROM pg_stat_activity a WHERE a.usename = cr.role_name AND a.pid <> pg_backend_pid();
    reaped := reaped || jsonb_build_array(jsonb_build_object('role', cr.role_name, 'reason', why, 'terminated', n, 'alive_after', alive));
    IF alive > 0 THEN unresolved := unresolved || to_jsonb(cr.role_name::text); END IF;
  END LOOP;
  -- WL-552: جلسةٌ حيّةٌ لاعتمادٍ غيرِ ACTIVE (‏أُلغيَ في نداءٍ سابق، أو بالجذرِ يدويّاً) كانت تخرجُ من النظر — الحلقةُ أعلاه
  -- على ACTIVE وحدَها — فيُعلَنُ ok=true وهي حيّة. كلُّ جلسةٍ كهذه تُربَطُ بـ(‏pid، backend_start) وتُرسَلُ لها إشارةُ إنهاءٍ
  -- جديدةٌ بلا انتظار (‏fence._signal_session يتحقّقُ من الزوجِ والدورِ قبيلَ الإشارة — فرقمُ عمليّةٍ أُعيدَ استعمالُه لجلسةٍ
  -- أخرى لا يُنهى)؛ وما بقيَ حيّاً يُبلَّغُ lingering ويُبقي ok=false حتى يموت.
  PERFORM pg_stat_clear_snapshot();
  FOR cr IN SELECT * FROM fence.credentials x WHERE x.status <> 'ACTIVE'
              AND NOT unresolved @> to_jsonb(ARRAY[x.role_name::text])
              AND EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.usename = x.role_name AND a.pid <> pg_backend_pid())
            ORDER BY x.role_name LOOP
    SELECT coalesce(jsonb_agg(jsonb_build_object('pid', a.pid, 'backend_start', a.backend_start) ORDER BY a.pid, a.backend_start), '[]'::jsonb)
      INTO sess FROM pg_stat_activity a WHERE a.usename = cr.role_name AND a.pid <> pg_backend_pid();
    n := 0;
    FOR s IN SELECT * FROM jsonb_array_elements(sess) LOOP
      IF fence._signal_session((s->>'pid')::integer, (s->>'backend_start')::timestamptz, cr.role_name) THEN n := n + 1; END IF;
    END LOOP;
    PERFORM pg_stat_clear_snapshot();
    SELECT coalesce(jsonb_agg(jsonb_build_object('pid', a.pid, 'backend_start', a.backend_start) ORDER BY a.pid, a.backend_start), '[]'::jsonb)
      INTO sess FROM pg_stat_activity a WHERE a.usename = cr.role_name AND a.pid <> pg_backend_pid();
    IF jsonb_array_length(sess) > 0 THEN
      lingering := lingering || jsonb_build_array(jsonb_build_object('role', cr.role_name, 'status', cr.status,
        'signalled', n, 'sessions', sess));
      unresolved := unresolved || to_jsonb(cr.role_name::text);
    END IF;
  END LOOP;
  IF jsonb_array_length(lingering) > 0 THEN
    PERFORM fence._event('REVOKED_SESSION_LINGERING', c.epoch, jsonb_build_object('lingering', lingering));
  END IF;
  IF jsonb_array_length(reaped) > 0 THEN
    PERFORM fence._event('LEASE_LAPSED_REAPED', c.epoch, jsonb_build_object('reaped', reaped, 'unresolved', unresolved));
  END IF;
  -- WL-545: موعدُ الانقضاءِ التالي بساعةِ القاعدةِ نفسِها (‏لا ساعةِ المُنادي): أقربُ expires_at لاعتمادٍ نشِط، و0
  -- لما سببُ انقضائِه قائمٌ الآن (‏stale_epoch/no_lease/clock_regressed — مستحقّةٌ فوراً)، **ولا يتجاوزُ lease_window_s**:
  -- اعتمادٌ يصدرُ بعدَ هذا النداءِ موعدُه ≥ الآنَ + النافذة، فالنومُ حتى هذا الحدِّ لا يفوّتُه (‏وبلا اعتمادٍ نشِطٍ = النافذة).
  -- لا يمنحُ سلطةً: قراءةٌ لمن يملكُ الحصادَ أصلاً، ليُنادى الحاصدُ عندَ الموعدِ لا بعدَه بفترة.
  SELECT least(c.lease_window_s::bigint * 1000, min(CASE WHEN fence._lease_lapse_reason(x, c) IS NOT NULL THEN 0
                  ELSE greatest(0, ceil(extract(epoch FROM (l.expires_at - clock_timestamp())) * 1000))::bigint END))
    INTO due
  FROM fence.credentials x
  LEFT JOIN fence.run_lease l ON l.role_name = x.role_name AND l.epoch = c.epoch
  WHERE x.status = 'ACTIVE';
  RETURN jsonb_build_object('ok', jsonb_array_length(unresolved) = 0, 'reaped', reaped, 'unresolved', unresolved,
    'lingering', lingering, 'next_due_ms', due);
END
$f$;

-- البيان: تُعادُ بصمتا ما غيّرته هذه الهجرةُ وحدَه (‏بالتعبيرِ نفسِه في 0024..0028).
DELETE FROM fence.manifest WHERE function_signature IN (
  'fence._reap_lapsed()',
  'fence._signal_session(integer,timestamp with time zone,name)');
INSERT INTO fence.manifest (function_signature, digest)
SELECT p.oid::regprocedure::text,
       encode(sha256(convert_to(concat_ws('|', p.prosrc, p.prosecdef::text, pg_get_userbyid(p.proowner),
         coalesce(array_to_string(p.proconfig, ','), ''), p.provolatile::text), 'UTF8')), 'hex')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'fence' AND p.oid::regprocedure::text IN (
  'fence._reap_lapsed()',
  'fence._signal_session(integer,timestamp with time zone,name)');

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
