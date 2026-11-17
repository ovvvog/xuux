-- الهجرة 0029 (رجوع) — يُعيدُ fence._reap_lapsed() إلى نصِّها في 0027 بايتاً ببايت ويُسقِطُ fence._signal_session.
--
-- **أثرُ الرجوع (‏يُعلَنُ ولا يُستَر):** تعودُ جلسةُ الاعتمادِ الملغى الحيّةُ غيرَ مرئيّةٍ للحاصدِ بعدَ نداءِ الإلغاء (‏ok=true
-- وهي حيّة — عيبُ WL-552 كما قيس). لا امتيازَ يُسحَبُ أو يُمنَحُ في أيِّ اتّجاه. 0028 لم تمسَّ _reap_lapsed.
-- **الشرط:** superuser، وغيرُ RUNNING (‏D-13)، وxf_ddl_end وxf_ddl_drop على ENABLE ALWAYS.

DO $pre$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'fence: رجوعُ 0029 يتطلّبُ superuser (‏xf_ddl_end وxf_ddl_drop يُعطَّلُ داخلَ المعاملة)';
  END IF;
  IF (fence.effective_state()->>'state') = 'RUNNING' THEN
    RAISE EXCEPTION 'fence: لا رجوعُ 0029 تحتَ RUNNING — أوقِف أولاً (D-13)';
  END IF;
  IF (SELECT evtenabled FROM pg_catalog.pg_event_trigger WHERE evtname = 'xf_ddl_end') IS DISTINCT FROM 'A'
     OR (SELECT evtenabled FROM pg_catalog.pg_event_trigger WHERE evtname = 'xf_ddl_drop') IS DISTINCT FROM 'A' THEN
    RAISE EXCEPTION 'fence: xf_ddl_end وxf_ddl_drop ليس ENABLE ALWAYS — حالةٌ غيرُ متوقَّعة، لا تُعادُ صامتاً';
  END IF;
END
$pre$;

-- البيانُ يُطابقُ الدوالَّ الحيّةَ قبلَ أيِّ تغيير (‏فشلٌ مغلق — كما في 0025).
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

ALTER EVENT TRIGGER xf_ddl_end DISABLE;
ALTER EVENT TRIGGER xf_ddl_drop DISABLE;

SET LOCAL ROLE xf_owner;

-- نصُّ 0027 حرفيّاً (‏0028 لم تمسَّ _reap_lapsed).
CREATE OR REPLACE FUNCTION fence._reap_lapsed() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE c fence.control; cr fence.credentials; why text; n integer; alive integer; due bigint;
  reaped jsonb := '[]'::jsonb; unresolved jsonb := '[]'::jsonb;
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
    'next_due_ms', due);
END
$f$;

DROP FUNCTION fence._signal_session(integer, timestamptz, name);

DELETE FROM fence.manifest WHERE function_signature = 'fence._signal_session(integer,timestamp with time zone,name)';
DELETE FROM fence.manifest WHERE function_signature IN (
  'fence._reap_lapsed()');
INSERT INTO fence.manifest (function_signature, digest)
SELECT p.oid::regprocedure::text,
       encode(sha256(convert_to(concat_ws('|', p.prosrc, p.prosecdef::text, pg_get_userbyid(p.proowner),
         coalesce(array_to_string(p.proconfig, ','), ''), p.provolatile::text), 'UTF8')), 'hex')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'fence' AND p.oid::regprocedure::text IN (
  'fence._reap_lapsed()');

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
ALTER EVENT TRIGGER xf_ddl_drop ENABLE ALWAYS;
