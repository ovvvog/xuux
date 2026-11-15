-- الهجرة 0025 (رجوع) — يُعيدُ دوالَّ السياجِ إلى نصِّها في 0024 (‏WL-541، بايتاً ببايت) ويُسقِطُ الحاصد.
--
-- **أثرُ الرجوع (‏يُعلَنُ ولا يُستَر):** يعودُ renew_lease يُحيي الإيجارَ المنقضي، ويفقدُ السياديُّ الحصاد — أي تعودُ
-- عيوبُ WL-542 كما قيست. ضماناتُ WL-536..541 في 0024 لا تُمَسّ. الأحداثُ LEASE_LAPSED_REAPED المسجّلةُ تبقى (‏تاريخ).
-- **الشرط:** superuser، وغيرُ RUNNING (‏D-13)، وxf_ddl_end وxf_ddl_drop على ENABLE ALWAYS.

DO $pre$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'fence: رجوعُ 0025 يتطلّبُ superuser (‏مُطلِقا الأحداثِ xf_ddl_end وxf_ddl_drop يُعطَّلان داخلَ المعاملة)';
  END IF;
  IF (fence.effective_state()->>'state') = 'RUNNING' THEN
    RAISE EXCEPTION 'fence: لا رجوعُ 0025 تحتَ RUNNING — أوقِف أولاً (D-13)';
  END IF;
  IF (SELECT evtenabled FROM pg_catalog.pg_event_trigger WHERE evtname = 'xf_ddl_end') IS DISTINCT FROM 'A'
     OR (SELECT evtenabled FROM pg_catalog.pg_event_trigger WHERE evtname = 'xf_ddl_drop') IS DISTINCT FROM 'A' THEN
    RAISE EXCEPTION 'fence: xf_ddl_end/xf_ddl_drop ليسا ENABLE ALWAYS — حالةٌ غيرُ متوقَّعة، لا تُعادُ صامتاً';
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

-- مخطّطُ fence مُغلَقٌ أمامَ DDL والإسقاط (‏xf_ddl_end وxf_ddl_drop ⇒ XF202) ولو لـsuperuser. التعطيلُ داخلَ معاملةِ الهجرةِ وحدَها،
-- والإعادةُ إلى ENABLE ALWAYS في آخرِها؛ فشلُ أيِّ أمرٍ يُرجِعُ المعاملةَ كلَّها ومعها التعطيل.
ALTER EVENT TRIGGER xf_ddl_end DISABLE;
ALTER EVENT TRIGGER xf_ddl_drop DISABLE;

-- كما في 0024: دوالُّ السياجِ يملكُها xf_owner (‏NOSUPERUSER) — SECURITY DEFINER يعملُ بامتيازِه لا بامتيازِ
-- منفّذِ الهجرة. دالّةٌ يُنشئُها superuser هنا تعملُ superuser (‏تصعيد)، ويرفضُها النداءُ من دوالِّ xf_owner (‏42501).
SET LOCAL ROLE xf_owner;

CREATE OR REPLACE FUNCTION fence.issue_credential(nonce text, worker_signature bytea) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE ch fence.challenges; c fence.control; r fence.roster; msg text; old record; live jsonb := fence._live_incarnation();
BEGIN
  PERFORM fence._assert_root();
  SELECT * INTO c FROM fence.control WHERE id FOR SHARE;
  IF fence.effective_state()->>'state' <> 'RUNNING' THEN
    RAISE EXCEPTION USING ERRCODE = 'XF502', MESSAGE = 'fence: لا إصدارَ اعتمادٍ خارجَ RUNNING';
  END IF;
  SELECT * INTO ch FROM fence.challenges WHERE challenges.nonce = issue_credential.nonce FOR UPDATE;
  IF NOT FOUND OR ch.used_at IS NOT NULL OR ch.expires_at < clock_timestamp() OR ch.epoch <> c.epoch OR ch.roster_version <> c.roster_version THEN
    RAISE EXCEPTION USING ERRCODE = 'XF505', MESSAGE = 'fence: تحدٍّ غائبٌ أو مستعمَلٌ أو منقضٍ أو من عهدٍ آخر';
  END IF;
  SELECT * INTO r FROM fence.roster WHERE worker_id = ch.worker_id AND roster_version = c.roster_version;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'XF008', MESSAGE = 'fence: العاملُ خرجَ من القائمة'; END IF;
  msg := 'xuux-fence/credential/v1' || chr(10) || current_database() || chr(10) || (live->>'sysid') || chr(10) ||
      ch.worker_id || chr(10) || ch.boot_id || chr(10) || ch.epoch || chr(10) || ch.roster_version || chr(10) || ch.role_name || chr(10) || ch.nonce;
  IF NOT fence.ed25519_verify(r.pubkey, convert_to(msg, 'UTF8'), worker_signature) THEN
    RAISE EXCEPTION USING ERRCODE = 'XF506', MESSAGE = 'fence: إثباتُ حيازةِ مفتاحِ العاملِ غيرُ صالح';
  END IF;
  UPDATE fence.challenges SET used_at = clock_timestamp() WHERE challenges.nonce = ch.nonce;
  FOR old IN SELECT role_name FROM fence.credentials WHERE worker_id = ch.worker_id AND status = 'ACTIVE' LOOP
    UPDATE fence.credentials SET status = 'REVOKED', revoked_at = clock_timestamp(), revoke_reason = 'SUPERSEDED_BY_NEW_BOOT' WHERE role_name = old.role_name;
    DELETE FROM fence.run_lease WHERE role_name = old.role_name;
    EXECUTE format('ALTER ROLE %I NOLOGIN', old.role_name);
    PERFORM fence._terminate_worker_sessions(old.role_name);
    PERFORM fence._neutralize_role(old.role_name);
  END LOOP;
  -- WL-538: VALID UNTIL '-infinity' — لا مصادقةَ بكلمةِ مرورٍ لهذا الدورِ أبداً، ولو وضعَها العاملُ لنفسِه.
  EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT CONNECTION LIMIT 16 PASSWORD NULL VALID UNTIL %L', ch.role_name, '-infinity');
  EXECUTE format('GRANT xuux_worker TO %I WITH INHERIT TRUE, SET FALSE', ch.role_name);
  INSERT INTO fence.credentials (role_name, worker_id, boot_id, epoch, roster_version, status)
  VALUES (ch.role_name, ch.worker_id, ch.boot_id, c.epoch, c.roster_version, 'ACTIVE');
  INSERT INTO fence.run_lease (role_name, epoch, expires_at)
  VALUES (ch.role_name, c.epoch, clock_timestamp() + make_interval(secs => c.lease_window_s));
  PERFORM fence._event('CREDENTIAL_ISSUED', c.epoch, jsonb_build_object('role', ch.role_name, 'worker', ch.worker_id, 'boot', ch.boot_id));
  RETURN jsonb_build_object('role_name', ch.role_name, 'epoch', c.epoch, 'os_principal', r.os_principal,
    'lease_window_s', c.lease_window_s, 'lease_renew_s', c.lease_renew_s);
END
$f$;

CREATE OR REPLACE FUNCTION fence.renew_lease(role_name name) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE c fence.control; cr fence.credentials; e timestamptz;
BEGIN
  PERFORM fence._assert_root();
  SELECT * INTO c FROM fence.control WHERE id FOR SHARE;
  IF fence.effective_state()->>'state' <> 'RUNNING' OR EXISTS (SELECT 1 FROM fence.halt_requests WHERE status IN ('OPEN', 'LOCKED')) THEN
    RAISE EXCEPTION USING ERRCODE = 'XF502', MESSAGE = 'fence: لا تجديدَ خارجَ RUNNING';
  END IF;
  SELECT * INTO cr FROM fence.credentials WHERE credentials.role_name = renew_lease.role_name;
  IF NOT FOUND OR cr.status <> 'ACTIVE' OR cr.epoch <> c.epoch THEN
    RAISE EXCEPTION USING ERRCODE = 'XF007', MESSAGE = 'fence: اعتمادٌ غيرُ نشِط';
  END IF;
  -- WL-536: لا تجديدَ على ساعةٍ تراجعت قبلَ آخرِ تجديد — وإلّا أعادَ التجديدُ شرعنةَ الساعةِ المُرجَعة.
  IF EXISTS (SELECT 1 FROM fence.run_lease l WHERE l.role_name = renew_lease.role_name AND l.epoch = c.epoch AND l.renewed_at > clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE = 'XF012', MESSAGE = 'fence: ساعةُ القاعدةِ تراجعت قبلَ آخرِ تجديد — لا تجديد';
  END IF;
  e := clock_timestamp() + make_interval(secs => c.lease_window_s);
  UPDATE fence.run_lease SET expires_at = e, renewed_at = clock_timestamp() WHERE run_lease.role_name = renew_lease.role_name AND epoch = c.epoch;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'XF009', MESSAGE = 'fence: لا إيجار'; END IF;
  RETURN e;
END
$f$;

CREATE OR REPLACE FUNCTION fence.halt_request(reason text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE hid bigint; c fence.control;
BEGIN
  IF NOT (pg_has_role(session_user, 'xf_root', 'MEMBER') OR pg_has_role(session_user, 'xf_sovereign', 'MEMBER')) THEN
    RAISE EXCEPTION USING ERRCODE = 'XF501', MESSAGE = 'fence: طلبُ الإيقافِ للجذرِ أو السياديّ';
  END IF;
  SELECT * INTO c FROM fence.control WHERE id;
  INSERT INTO fence.halt_requests (reason, epoch_before, status) VALUES (reason, coalesce(c.epoch, -1), 'OPEN') RETURNING halt_requests.id INTO hid;
  PERFORM fence._event('HALT_REQUESTED', c.epoch, jsonb_build_object('halt_id', hid, 'reason', reason));
  RETURN hid;
END
$f$;

CREATE OR REPLACE FUNCTION fence.revoke_credential(role_name name, reason text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE n integer;
BEGIN
  PERFORM fence._assert_root();
  UPDATE fence.credentials SET status = 'REVOKED', revoked_at = clock_timestamp(), revoke_reason = reason
  WHERE credentials.role_name = revoke_credential.role_name AND status = 'ACTIVE';
  DELETE FROM fence.run_lease WHERE run_lease.role_name = revoke_credential.role_name;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
    EXECUTE format('ALTER ROLE %I NOLOGIN', role_name);
  END IF;
  n := fence._terminate_worker_sessions(role_name);
  PERFORM fence._neutralize_role(role_name);
  PERFORM fence._event('CREDENTIAL_REVOKED', NULL, jsonb_build_object('role', role_name, 'reason', reason, 'terminated', n));
  RETURN n;
END
$f$;

-- check_fenced بنصِّ 0024 (‏ملاحظةُ NOTIFY بلا ذكرِ الحاصد).
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
    -- WL-541: السطحُ مقيسٌ لا مُفترَض — مَن يستطيعُ الدخولَ (‏= LISTEN) ومن أين؛ مَن يستمعُ فعلاً لا يُرى.
    jsonb_build_object('kind', 'notify_not_revocable', 'surface', fence.notify_surface(), 'note', 'أمرُ NOTIFY بلا امتيازٍ يُسحَب (‏pg_notify مسحوبةٌ من PUBLIC — WL-541): العاملُ يُرسِلُ ما دامت جلستُه حيّة — بعدَ الختمِ وبعدَ انقضاءِ الإيجارِ حتى الإلغاءِ أو الإيقاف؛ والإشعارُ الملتزَمُ قبلَ إنهاءِ الجلسةِ يصلُ مستمعاً كان متّصلاً ولو بعدَه، ولا يُخزَّنُ لمستمعٍ لاحق. المستمعُ: كلُّ مَن يدخلُ هذه القاعدة (‏surface.listeners) — لا مستهلكَ في المستودع، وما خارجَه لا يُثبَتُ غيابُه؛ والمنعُ من أصلِه يحتاجُ خطّافاً بلغةِ C (‏قرارُ معمار، E3)'),
    jsonb_build_object('kind', 'db_clock_trusted', 'note', 'الإيجارُ يُقاسُ بساعةِ القاعدة: التقدّمُ يُغلِق، والتراجعُ قبلَ آخرِ تجديدٍ يُرفَضُ (XF012)، وما دونَه يمدُّ الإيجارَ بما لا يزيدُ على نافذةٍ واحدة؛ العبثُ بها خارجَ السياج'),
    jsonb_build_object('kind', 'worker_self_alter_role', 'note', 'ALTER ROLE <نفسه> PASSWORD/SET بلا امتيازٍ يُسحَب ولا مُطلِقِ أحداث (WL-538): الإعداداتُ تُرفَضُ كتابتُها (XF013) وتُمحى عندَ الختمِ والإلغاءِ والإيقاف، وكلمةُ المرورِ لا تُدخِلُ أحداً (VALID UNTIL -infinity) وتُمحى كذلك؛ لكنّ الكتابةَ نفسَها تبقى ممكنةً بإيجارٍ منقضٍ حتى الانتقالِ التالي: إعداداتٌ يقرؤُها كلُّ دور، وبصمةٌ بمحتوًى يختارُه العاملُ لا يراها إلا superuser؛ ومنعُ الأمرِ من أصلِه يحتاجُ خطّافاً بلغةِ C (قرارُ معمار)'));
  RETURN jsonb_build_object('ok', jsonb_array_length(problems) = 0, 'problems', problems, 'residuals', residuals,
    'state', eff->'state', 'epoch', c.epoch, 'roster_version', c.roster_version, 'roster_hash', c.roster_hash,
    'incarnation', live, 'checked_at', clock_timestamp());
END
$f$;

DROP FUNCTION fence.reap_lapsed();
DROP FUNCTION fence._reap_lapsed();
DROP FUNCTION fence._lease_lapse_reason(fence.credentials, fence.control);
DROP FUNCTION fence._revoke_role(name, text);

-- البيان: تُعادُ بصماتُ ما غيّرته هذه الهجرةُ وحدَه (‏بالتعبيرِ نفسِه في 0024 وcheck_fenced).
DELETE FROM fence.manifest WHERE function_signature IN (
  'fence.check_fenced()',
  'fence.revoke_credential(name,text)',
  'fence.issue_credential(text,bytea)',
  'fence.renew_lease(name)',
  'fence.halt_request(text)',
  'fence._revoke_role(name,text)',
  'fence._lease_lapse_reason(fence.credentials,fence.control)',
  'fence._reap_lapsed()',
  'fence.reap_lapsed()');
INSERT INTO fence.manifest (function_signature, digest)
SELECT p.oid::regprocedure::text,
       encode(sha256(convert_to(concat_ws('|', p.prosrc, p.prosecdef::text, pg_get_userbyid(p.proowner),
         coalesce(array_to_string(p.proconfig, ','), ''), p.provolatile::text), 'UTF8')), 'hex')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'fence' AND p.oid::regprocedure::text IN (
  'fence.check_fenced()',
  'fence.revoke_credential(name,text)',
  'fence.issue_credential(text,bytea)',
  'fence.renew_lease(name)',
  'fence.halt_request(text)');

-- وبعدَه: البيانُ يُطابقُ كلَّ دالّةٍ حيّة، ولا دالّةَ خارجَه.
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
