-- الهجرة 0024 — سياجُ قاعدةِ البيانات (`WL-532`، تنفيذُ تصميمِ `WL-541`).
--
-- الثابتُ الذي تفرضه: **لا يُحدِثُ عاملٌ أثراً دائماً في جداولِ الدولةِ إلا إذا
-- كانت حالةُ النظامِ RUNNING، وهويّتُه (session_user) اعتمادٌ صادرٌ لهذا الإقلاعِ،
-- واعتمادُه نشِطٌ، وعهدُه هو العهدُ الجاري، وإيجارُه لم ينقضِ، وقائمةُ العمالِ
-- المعتمدةُ هي التي صدر بها، والقاعدةُ هي التجسُّدُ نفسُه الذي رُبطت به الحالة.**
--
-- الطبقات:
--   1. `fence.guard_write()` — زنادُ جملةٍ BEFORE مُفعَّلٌ ALWAYS على كلِّ جدولٍ
--      (r/p/f) خارجَ مخطّطاتِ النظامِ وfence: INSERT/UPDATE/DELETE/TRUNCATE،
--      فيشملُ UPSERT وMERGE وCOPY والمشاهدَ القابلةَ للتحديثِ (تكتبُ في الأساس).
--      يُقرأُ صفُّ التحكُّمِ بـ`FOR SHARE` فيصيرُ قفلُ الإيقافِ (`UPDATE`) نقطةَ
--      خطّيّةٍ: كلُّ كتابةٍ إمّا قبلَه (التزمت قبلَ أن يأخذَه) أو بعدَه (تُرفَض، أو
--      تفشلُ تسلسلياً في REPEATABLE READ/SERIALIZABLE).
--   2. مُطلِقاتُ أحداثٍ (event triggers) تمنعُ كلَّ DDL في حالِ RUNNING، وتُغطّي
--      كلَّ جدولٍ/قسمٍ جديدٍ تلقائياً، وترفضُ إسقاطَ الزنادِ أو تعطيلَه أو قاعدةً
--      (RULE) كاتبةً أو امتيازاً محظوراً. **لا تحمي من superuser** (`T-OWN-04`):
--      مَن يملكُ superuser يُعطِّلُها — وذلك حدٌّ مُعلَن لا ادعاء.
--   3. `fence.check_fenced()` — الفحصُ الحيُّ الذي يُبنى عليه `DB_FENCED`.
--   4. أوامرُ سياديةٌ موقَّعةٌ بـEd25519 يُتحقَّقُ منها **داخلَ القاعدة**
--      (RESUME/RECOVER/ROSTER_SET/KEY_ROTATE/BREAKGLASS_SET/LEASE_SET)، واعتمادُ
--      إقلاعٍ يتطلّبُ توقيعَ مفتاحِ العاملِ المُدرَجِ (الجذرُ وحدَه لا يُصدِر).
--
-- **شرطُ التطبيق:** superuser (إنشاءُ الأدوارِ ومُطلِقاتِ الأحداث). والحالةُ
-- الابتدائيةُ RECOVERY_REQUIRED بلا مفتاحٍ سياديّ: لا كتابةَ لعاملٍ حتى يُقلَعَ
-- السياجُ بـ`fence.bootstrap(pubkey)` ثمّ RESUME موقَّع. الأدوارُ على مستوى
-- العنقودِ فتُنشأُ إن غابت ولا تُسقَطُ بالرجوع (قد تعتمدُ عليها قواعدُ أخرى).

DO $pre$
BEGIN
  IF current_setting('server_version_num')::int < 160000 THEN
    RAISE EXCEPTION 'fence: PostgreSQL >= 16 مطلوب (دلالاتُ CREATEROLE/ADMIN)';
  END IF;
  IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'fence: الهجرة 0024 تتطلّبُ superuser (أدوارٌ ومُطلِقاتُ أحداث)';
  END IF;
END
$pre$;

-- ── الأدوار (مستوى العنقود) ────────────────────────────────────────────────
DO $roles$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['xf_owner', 'xuux_owner', 'xuux_worker'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['xf_root', 'xf_sovereign', 'xf_auditor', 'xuux_migrator'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I LOGIN', r);
    END IF;
  END LOOP;
END
$roles$;

-- لا يحملُ أيٌّ منها قدرةَ تجاوز. xf_owner وحده CREATEROLE (يُنشئ أدوارَ الإقلاعِ
-- ويملكُ ADMIN عليها وحدها في PG16+)، ولا يدخل (NOLOGIN) — يُبلَغُ عبرَ دوالِّ
-- SECURITY DEFINER المملوكةِ له فقط.
ALTER ROLE xf_owner NOLOGIN NOSUPERUSER CREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS;
ALTER ROLE xuux_owner NOLOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS;
ALTER ROLE xuux_worker NOLOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS;
ALTER ROLE xf_root NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS;
ALTER ROLE xf_sovereign NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS;
ALTER ROLE xf_auditor NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS;
ALTER ROLE xuux_migrator NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS;

GRANT xuux_worker TO xf_owner WITH ADMIN OPTION, INHERIT FALSE, SET FALSE;
GRANT pg_signal_backend TO xf_owner;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO xf_owner;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_checkpoint() TO xf_owner;

-- ── المخطّط والجداول ────────────────────────────────────────────────────────
CREATE SCHEMA fence AUTHORIZATION xf_owner;
REVOKE ALL ON SCHEMA fence FROM PUBLIC;
GRANT USAGE ON SCHEMA fence TO xf_root, xf_sovereign, xf_auditor, xuux_worker, xuux_migrator, xuux_owner;

SET LOCAL ROLE xf_owner;

CREATE TABLE fence.control (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  state text NOT NULL CHECK (state IN ('RUNNING', 'HALT_REQUESTED', 'HALTED', 'RECOVERY_REQUIRED')),
  epoch bigint NOT NULL CHECK (epoch >= 0),
  roster_version bigint NOT NULL DEFAULT 0 CHECK (roster_version >= 0),
  roster_hash text NOT NULL DEFAULT '',
  sovereign_pubkey bytea CHECK (sovereign_pubkey IS NULL OR length(sovereign_pubkey) = 32),
  dbname text NOT NULL,
  sysid text,
  pm_start_epoch numeric,
  timeline integer,
  lease_window_s integer NOT NULL DEFAULT 30 CHECK (lease_window_s BETWEEN 5 AND 600),
  lease_renew_s integer NOT NULL DEFAULT 10 CHECK (lease_renew_s >= 1),
  command_max_validity_s integer NOT NULL DEFAULT 900 CHECK (command_max_validity_s BETWEEN 30 AND 86400),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  seal text NOT NULL,
  CHECK (lease_renew_s < lease_window_s)
);

CREATE TABLE fence.roster (
  worker_id text PRIMARY KEY CHECK (worker_id ~ '^[a-z][a-z0-9]{0,19}$'),
  pubkey bytea NOT NULL CHECK (length(pubkey) = 32),
  os_principal text NOT NULL CHECK (os_principal ~ '^[A-Za-z0-9._@=-]{1,128}$'),
  roster_version bigint NOT NULL
);

CREATE TABLE fence.roster_versions (
  version bigint PRIMARY KEY,
  hash text NOT NULL,
  payload jsonb NOT NULL,
  command_nonce text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE fence.credentials (
  role_name name PRIMARY KEY,
  worker_id text NOT NULL,
  boot_id text NOT NULL CHECK (boot_id ~ '^[0-9a-f]{16,64}$'),
  epoch bigint NOT NULL,
  roster_version bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  revoke_reason text,
  role_dropped boolean NOT NULL DEFAULT false,
  UNIQUE (worker_id, boot_id)
);
CREATE UNIQUE INDEX credentials_one_active_per_worker ON fence.credentials (worker_id) WHERE status = 'ACTIVE';

CREATE TABLE fence.run_lease (
  role_name name PRIMARY KEY REFERENCES fence.credentials (role_name),
  epoch bigint NOT NULL,
  expires_at timestamptz NOT NULL,
  renewed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE fence.challenges (
  nonce text PRIMARY KEY,
  worker_id text NOT NULL,
  boot_id text NOT NULL,
  role_name name NOT NULL,
  epoch bigint NOT NULL,
  roster_version bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE fence.halt_requests (
  id bigserial PRIMARY KEY,
  reason text NOT NULL,
  requested_by name NOT NULL DEFAULT session_user,
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  epoch_before bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('OPEN', 'LOCKED', 'COMPLETE', 'FAILED')),
  locked_at timestamptz,
  completed_at timestamptz,
  report jsonb
);

CREATE TABLE fence.sovereign_commands (
  nonce text PRIMARY KEY,
  type text NOT NULL,
  payload text NOT NULL,
  signature bytea NOT NULL,
  submitted_by name NOT NULL DEFAULT session_user,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  epoch_before bigint NOT NULL,
  epoch_after bigint NOT NULL
);

CREATE TABLE fence.breakglass (
  role_name name PRIMARY KEY,
  declared_by_nonce text,
  declared_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE fence.event_head (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  seq bigint NOT NULL,
  hash text NOT NULL
);

CREATE TABLE fence.events (
  seq bigint PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  kind text NOT NULL,
  actor name NOT NULL DEFAULT session_user,
  epoch bigint,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash text NOT NULL,
  hash text NOT NULL
);

CREATE TABLE fence.evidence (
  id bigserial PRIMARY KEY,
  epoch bigint NOT NULL,
  kind text NOT NULL CHECK (kind ~ '^[A-Z_]{3,40}$'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb NOT NULL,
  recorded_by name NOT NULL DEFAULT session_user,
  at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE fence.manifest (
  function_signature text PRIMARY KEY,
  digest text NOT NULL
);

CREATE TABLE fence.original_owners (
  relid oid PRIMARY KEY,
  owner name NOT NULL
);

REVOKE ALL ON ALL TABLES IN SCHEMA fence FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA fence FROM PUBLIC;

-- ── Ed25519 (RFC 8032) داخلَ القاعدة ──────────────────────────────────────────
-- تحقّقٌ فقط (لا مفاتيحَ خاصّةً في القاعدة). مُقارَنٌ مع `node:crypto` ومتّجهاتِ
-- RFC 8032 في `tests/fence/db-fence.test.mjs`. تحقّقٌ بلا عاملِ مرافق (cofactorless)
-- كـOpenSSL؛ يرفضُ ترميزاً غيرَ قانونيّ (y ≥ p) وS ≥ L.
CREATE FUNCTION fence._ed_modpow(b numeric, e numeric, m numeric) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $f$
DECLARE r numeric := 1; x numeric := mod(b, m); n numeric := e;
BEGIN
  WHILE n > 0 LOOP
    IF mod(n, 2) = 1 THEN r := mod(r * x, m); END IF;
    x := mod(x * x, m);
    n := div(n, 2);
  END LOOP;
  RETURN r;
END
$f$;

CREATE FUNCTION fence._ed_le2int(b bytea) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $f$
DECLARE r numeric := 0; i int;
BEGIN
  FOR i IN REVERSE length(b) - 1 .. 0 LOOP
    r := r * 256 + get_byte(b, i);
  END LOOP;
  RETURN r;
END
$f$;

CREATE FUNCTION fence._ed_add(p1 numeric[], p2 numeric[]) RETURNS numeric[]
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $f$
DECLARE
  q CONSTANT numeric := 57896044618658097711785492504343953926634992332820282019728792003956564819949;
  d2 CONSTANT numeric := 16295367250680780974490674513165176452449235426866156013048779062215315747161;
  a numeric; b numeric; c numeric; dd numeric; e numeric; f numeric; g numeric; h numeric;
BEGIN
  a := mod((p1[2] - p1[1] + q) * (p2[2] - p2[1] + q), q);
  b := mod((p1[2] + p1[1]) * (p2[2] + p2[1]), q);
  c := mod(mod(p1[4] * d2, q) * p2[4], q);
  dd := mod(2 * p1[3] * p2[3], q);
  e := b - a + q; f := dd - c + q; g := dd + c; h := b + a;
  RETURN ARRAY[mod(e * f, q), mod(g * h, q), mod(f * g, q), mod(e * h, q)];
END
$f$;

CREATE FUNCTION fence._ed_mul(s numeric, pt numeric[]) RETURNS numeric[]
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $f$
DECLARE r numeric[] := ARRAY[0, 1, 1, 0]::numeric[]; x numeric[] := pt; n numeric := s;
BEGIN
  WHILE n > 0 LOOP
    IF mod(n, 2) = 1 THEN r := fence._ed_add(r, x); END IF;
    x := fence._ed_add(x, x);
    n := div(n, 2);
  END LOOP;
  RETURN r;
END
$f$;

CREATE FUNCTION fence._ed_decode(b bytea) RETURNS numeric[]
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $f$
DECLARE
  q CONSTANT numeric := 57896044618658097711785492504343953926634992332820282019728792003956564819949;
  d CONSTANT numeric := 37095705934669439343138083508754565189542113879843219016388785533085940283555;
  sqrtm1 CONSTANT numeric := 19681161376707505956807079304988542015446066515923890162744021073123829784752;
  y numeric; sgn int; u numeric; v numeric; x numeric; vx2 numeric;
BEGIN
  IF length(b) <> 32 THEN RETURN NULL; END IF;
  sgn := (get_byte(b, 31) >> 7);
  y := fence._ed_le2int(set_byte(b, 31, get_byte(b, 31) & 127));
  IF y >= q THEN RETURN NULL; END IF;
  u := mod(y * y - 1 + q, q);
  v := mod(d * y * y + 1, q);
  x := mod(mod(u * fence._ed_modpow(v, 3, q), q)
       * fence._ed_modpow(mod(u * fence._ed_modpow(v, 7, q), q), (q - 5) / 8, q), q);
  vx2 := mod(v * x * x, q);
  IF vx2 = u THEN
    NULL;
  ELSIF vx2 = mod(q - u, q) THEN
    x := mod(x * sqrtm1, q);
  ELSE
    RETURN NULL;
  END IF;
  IF x = 0 AND sgn = 1 THEN RETURN NULL; END IF;
  IF mod(x, 2) <> sgn THEN x := q - x; END IF;
  RETURN ARRAY[x, y, 1, mod(x * y, q)];
END
$f$;

CREATE FUNCTION fence.ed25519_verify(pub bytea, msg bytea, sig bytea) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $f$
DECLARE
  q CONSTANT numeric := 57896044618658097711785492504343953926634992332820282019728792003956564819949;
  l CONSTANT numeric := 7237005577332262213973186563042994240857116359379907606001950938285454250989;
  base numeric[] := ARRAY[
    15112221349535400772501151409588531511454012693041857206046113283949847762202,
    46316835694926478169428394003475163141307993866256225615783033603165251855960,
    1, 0]::numeric[];
  a numeric[]; r numeric[]; s numeric; k numeric; lhs numeric[]; rhs numeric[];
BEGIN
  IF pub IS NULL OR sig IS NULL OR msg IS NULL OR length(pub) <> 32 OR length(sig) <> 64 THEN
    RETURN false;
  END IF;
  base[4] := mod(base[1] * base[2], q);
  a := fence._ed_decode(pub);
  r := fence._ed_decode(substring(sig FROM 1 FOR 32));
  IF a IS NULL OR r IS NULL THEN RETURN false; END IF;
  s := fence._ed_le2int(substring(sig FROM 33 FOR 32));
  IF s >= l THEN RETURN false; END IF;
  k := mod(fence._ed_le2int(sha512(substring(sig FROM 1 FOR 32) || pub || msg)), l);
  lhs := fence._ed_mul(s, base);
  rhs := fence._ed_add(r, fence._ed_mul(k, a));
  RETURN mod(lhs[1] * rhs[3], q) = mod(rhs[1] * lhs[3], q)
     AND mod(lhs[2] * rhs[3], q) = mod(rhs[2] * lhs[3], q);
END
$f$;

-- ── مساعداتُ الحالة ─────────────────────────────────────────────────────────
-- تجسُّدُ القاعدةِ الحيّ: معرّفُ العنقودِ ولحظةُ إقلاعِ الخادمِ. كلُّ إعادةِ تشغيلٍ
-- أو استرجاعٍ (PITR/فيزيائيّ/منطقيّ إلى عنقودٍ آخر) يُغيّرُ أحدَهما ⇒ لا يطابقُ
-- المختوم ⇒ RECOVERY_REQUIRED فعلياً حتى أمرِ RECOVER سياديٍّ موقَّع.
CREATE FUNCTION fence._live_incarnation() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
  SELECT jsonb_build_object(
    'dbname', current_database(),
    'sysid', (pg_control_system()).system_identifier::text,
    'pm_start_epoch', extract(epoch FROM pg_postmaster_start_time()),
    'timeline', (pg_control_checkpoint()).timeline_id)
$f$;

CREATE FUNCTION fence._control_digest(c fence.control) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $f$
  SELECT encode(sha256(convert_to(concat_ws('|',
    'xuux-fence/control/v1', c.state, c.epoch::text, c.roster_version::text, c.roster_hash,
    coalesce(encode(c.sovereign_pubkey, 'hex'), '-'), c.dbname, coalesce(c.sysid, '-'),
    coalesce(c.pm_start_epoch::text, '-'), coalesce(c.timeline::text, '-'),
    c.lease_window_s::text, c.lease_renew_s::text, c.command_max_validity_s::text), 'UTF8')), 'hex')
$f$;

-- الحالةُ الفعليةُ: المختومةُ إن سلِمَ الختمُ وطابقَ التجسُّد، وإلا RECOVERY_REQUIRED.
-- غيابُ الصفِّ ⇒ MISSING (فشلٌ مغلق). قراءةٌ بلا قفل — للعرضِ ومُطلِقاتِ DDL.
CREATE FUNCTION fence.effective_state() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE c fence.control; live jsonb := fence._live_incarnation();
BEGIN
  SELECT * INTO c FROM fence.control WHERE id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'MISSING', 'problem', 'control_missing');
  END IF;
  IF c.seal IS DISTINCT FROM fence._control_digest(c) THEN
    RETURN jsonb_build_object('state', 'RECOVERY_REQUIRED', 'problem', 'control_seal_mismatch', 'epoch', c.epoch);
  END IF;
  IF c.sysid IS DISTINCT FROM live->>'sysid' OR c.dbname IS DISTINCT FROM live->>'dbname'
     OR c.pm_start_epoch IS DISTINCT FROM (live->>'pm_start_epoch')::numeric THEN
    RETURN jsonb_build_object('state', 'RECOVERY_REQUIRED', 'problem', 'incarnation_mismatch',
      'epoch', c.epoch, 'stored_state', c.state);
  END IF;
  -- طلبُ إيقافٍ مُسجَّلٌ لم يكتمل (ومنه انقطاعُ الجذرِ بعدَ الخطوةِ 2) يُعلَنُ حالةً فعليةً لا
  -- RUNNING: الكتابةُ مرفوضةٌ أصلاً (XF005)، والحالةُ المُعلَنةُ يجبُ ألا تكذب.
  IF c.state = 'RUNNING' AND EXISTS (SELECT 1 FROM fence.halt_requests WHERE status IN ('OPEN', 'LOCKED')) THEN
    RETURN jsonb_build_object('state', 'HALT_REQUESTED', 'problem', 'halt_request_pending', 'epoch', c.epoch,
      'stored_state', c.state, 'roster_version', c.roster_version, 'roster_hash', c.roster_hash);
  END IF;
  RETURN jsonb_build_object('state', c.state, 'epoch', c.epoch, 'roster_version', c.roster_version,
    'roster_hash', c.roster_hash);
END
$f$;

-- حالةُ السياجِ للجذرِ والسياديِّ والمدقِّق: الحالةُ الفعليةُ + التجسُّدُ الحيُّ + المربوط.
-- السياديُّ يقرأُ منها ما يوقّعُه (sysid/pm_start_epoch/timeline/epoch/roster_hash) —
-- ويُفترَضُ أن يراجعَه قبلَ التوقيع؛ القراءةُ لا تمنحُ شيئاً.
CREATE FUNCTION fence.status() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE c fence.control; live jsonb := fence._live_incarnation();
BEGIN
  SELECT * INTO c FROM fence.control WHERE id;
  -- pm_start_epoch نصّاً: رقمٌ بستّةِ منازلَ عشريةٍ يفقدُ دقّتَه في double (JS)، والأوامرُ
  -- تُقارنُه نصّاً.
  live := jsonb_set(live, '{pm_start_epoch}', to_jsonb(live->>'pm_start_epoch'));
  RETURN jsonb_build_object('effective', fence.effective_state(), 'live', live,
    'bound', CASE WHEN c IS NULL THEN NULL ELSE jsonb_build_object('state', c.state, 'epoch', c.epoch,
      'roster_version', c.roster_version, 'roster_hash', c.roster_hash, 'sysid', c.sysid, 'dbname', c.dbname,
      'pm_start_epoch', c.pm_start_epoch::text, 'timeline', c.timeline, 'lease_window_s', c.lease_window_s,
      'lease_renew_s', c.lease_renew_s, 'command_max_validity_s', c.command_max_validity_s,
      'seal', c.seal, 'has_sovereign_key', c.sovereign_pubkey IS NOT NULL) END);
END
$f$;

-- عضويةُ xuux_worker **بلا superuser**: pg_has_role يعدُّ superuser عضواً في كلِّ دور.
CREATE FUNCTION fence.is_worker_role(r oid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
  SELECT EXISTS (SELECT 1 FROM pg_roles x WHERE x.oid = r AND NOT x.rolsuper AND x.rolname <> 'xuux_worker'
                 AND pg_has_role(x.oid, 'xuux_worker', 'MEMBER'))
$f$;

CREATE FUNCTION fence._event(kind text, epoch bigint, detail jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE h fence.event_head; nh text; ns bigint;
BEGIN
  SELECT * INTO h FROM fence.event_head WHERE id FOR UPDATE;
  ns := h.seq + 1;
  nh := encode(sha256(convert_to(concat_ws('|', h.hash, ns::text, kind, coalesce(epoch::text, '-'),
        session_user::text, coalesce(detail, '{}'::jsonb)::text), 'UTF8')), 'hex');
  INSERT INTO fence.events (seq, kind, epoch, detail, prev_hash, hash)
  VALUES (ns, kind, epoch, coalesce(detail, '{}'::jsonb), h.hash, nh);
  UPDATE fence.event_head SET seq = ns, hash = nh WHERE id;
  RETURN ns;
END
$f$;

-- ختمُ صفِّ التحكّم بعدَ كلِّ تغييرٍ مشروع. تغييرٌ مباشرٌ (superuser) بلا ختمٍ ⇒
-- عدمُ تطابقٍ ⇒ فشلٌ مغلق. (الختمُ تجزئةٌ بلا سرّ: يكشفُ الفسادَ والتعديلَ الساذجَ
-- لا superuser يُعيدُ الحسابَ — حدٌّ مُعلَن.)
CREATE FUNCTION fence._reseal() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE c fence.control;
BEGIN
  SELECT * INTO c FROM fence.control WHERE id;
  UPDATE fence.control SET seal = fence._control_digest(c) WHERE id;
END
$f$;

-- قيودُ صفِّ التحكّم: لا حذف ولا TRUNCATE، والعهدُ لا ينقصُ أبداً، والانتقالاتُ
-- محصورة، ولا رجوعَ افتراضيَّ إلى RUNNING إلا من HALTED وبرفعِ العهد.
CREATE FUNCTION fence._control_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $f$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION USING ERRCODE = 'XF101', MESSAGE = 'fence: صفُّ التحكّمِ لا يُحذَف';
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

CREATE TRIGGER xf_control_row BEFORE INSERT OR UPDATE OR DELETE ON fence.control
  FOR EACH ROW EXECUTE FUNCTION fence._control_guard();
CREATE TRIGGER xf_control_trunc BEFORE TRUNCATE ON fence.control
  FOR EACH STATEMENT EXECUTE FUNCTION fence._control_guard();
ALTER TABLE fence.control ENABLE ALWAYS TRIGGER xf_control_row;
ALTER TABLE fence.control ENABLE ALWAYS TRIGGER xf_control_trunc;

-- سجلّاتُ الإلحاقِ فقط: الأحداثُ والأدلّةُ والأوامرُ ونُسخُ القائمة.
CREATE FUNCTION fence._append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $f$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'XF104', MESSAGE = format('fence: %s.%s إلحاقٌ فقط (%s ممنوع)', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP);
END
$f$;

DO $ao$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['events', 'evidence', 'sovereign_commands', 'roster_versions'] LOOP
    EXECUTE format('CREATE TRIGGER xf_append_only BEFORE UPDATE OR DELETE ON fence.%I FOR EACH ROW EXECUTE FUNCTION fence._append_only()', t);
    EXECUTE format('CREATE TRIGGER xf_append_only_trunc BEFORE TRUNCATE ON fence.%I FOR EACH STATEMENT EXECUTE FUNCTION fence._append_only()', t);
    EXECUTE format('ALTER TABLE fence.%I ENABLE ALWAYS TRIGGER xf_append_only', t);
    EXECUTE format('ALTER TABLE fence.%I ENABLE ALWAYS TRIGGER xf_append_only_trunc', t);
  END LOOP;
END
$ao$;

-- ── الحارس: زنادُ الكتابة ────────────────────────────────────────────────────
-- يُقرَّرُ بـsession_user (لا current_user ولا متغيّرِ جلسة): SET ROLE وSECURITY
-- DEFINER وGUC مُزوَّر لا تُغيّرُه. superuser يمرّ — حدٌّ مُعلَن (`T-OWN-04`) لأنّه
-- يُعطّلُ الزنادَ أصلاً؛ ادّعاءُ غيرِ ذلك كذب.
CREATE FUNCTION fence.guard_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE
  s name := session_user;
  c fence.control;
  cr fence.credentials;
  live jsonb;
BEGIN
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = s) THEN
    RETURN NULL;
  END IF;
  -- القفلُ المشترك: نقطةُ الخطّيّة مع `halt_lock()` (UPDATE على الصفّ نفسه).
  SELECT * INTO c FROM fence.control WHERE id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'XF001', MESSAGE = 'fence: صفُّ التحكّمِ غائب — فشلٌ مغلق';
  END IF;
  IF c.seal IS DISTINCT FROM fence._control_digest(c) THEN
    RAISE EXCEPTION USING ERRCODE = 'XF002', MESSAGE = 'fence: ختمُ التحكّمِ لا يطابق — بياناتُ السياجِ فاسدة';
  END IF;
  live := fence._live_incarnation();
  IF c.sysid IS DISTINCT FROM live->>'sysid' OR c.dbname IS DISTINCT FROM live->>'dbname'
     OR c.pm_start_epoch IS DISTINCT FROM (live->>'pm_start_epoch')::numeric THEN
    RAISE EXCEPTION USING ERRCODE = 'XF003', MESSAGE = 'fence: تجسُّدُ القاعدةِ لا يطابقُ المختوم (استرجاعٌ/إعادةُ تشغيل) — RECOVERY_REQUIRED';
  END IF;
  IF s = 'xuux_migrator' THEN
    IF c.state = 'HALTED' THEN RETURN NULL; END IF;
    RAISE EXCEPTION USING ERRCODE = 'XF010', MESSAGE = format('fence: المُهاجرُ يكتبُ تحتَ HALTED فقط (الحالة %s)', c.state);
  END IF;
  IF c.state <> 'RUNNING' THEN
    RAISE EXCEPTION USING ERRCODE = 'XF004', MESSAGE = format('fence: الحالة %s — الكتابةُ مرفوضة', c.state);
  END IF;
  IF EXISTS (SELECT 1 FROM fence.halt_requests WHERE status IN ('OPEN', 'LOCKED')) THEN
    RAISE EXCEPTION USING ERRCODE = 'XF005', MESSAGE = 'fence: طلبُ إيقافٍ مُسجَّل — الكتابةُ مرفوضة';
  END IF;
  SELECT * INTO cr FROM fence.credentials WHERE role_name = s;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'XF006', MESSAGE = format('fence: هويّةٌ غيرُ معروفة (%s)', s);
  END IF;
  IF cr.status <> 'ACTIVE' THEN
    RAISE EXCEPTION USING ERRCODE = 'XF007', MESSAGE = format('fence: الاعتمادُ %s ملغى', s);
  END IF;
  IF cr.epoch <> c.epoch OR cr.roster_version <> c.roster_version THEN
    RAISE EXCEPTION USING ERRCODE = 'XF007', MESSAGE = format('fence: عهدُ الاعتماد %s/%s لا يطابقُ %s/%s', cr.epoch, cr.roster_version, c.epoch, c.roster_version);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM fence.roster r WHERE r.worker_id = cr.worker_id AND r.roster_version = c.roster_version) THEN
    RAISE EXCEPTION USING ERRCODE = 'XF008', MESSAGE = format('fence: العاملُ %s ليس في القائمةِ المعتمدة', cr.worker_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM fence.run_lease l WHERE l.role_name = s AND l.epoch = c.epoch AND l.expires_at > clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE = 'XF009', MESSAGE = 'fence: الإيجارُ منقضٍ أو غائب';
  END IF;
  RETURN NULL;
END
$f$;

-- قراءةُ العامل (RLS): تُسدُّ قراءاتُ أعضاءِ xuux_worker خارجَ RUNNING أو بلا اعتمادٍ
-- صالح. طبقةٌ مُكمِّلةٌ للقراءة لا بديلٌ عن الزناد (RLS لا يُعتمَدُ عليها وحدها).
CREATE FUNCTION fence.read_ok() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE s name := session_user; c fence.control; cr fence.credentials;
BEGIN
  IF NOT fence.is_worker_role(s::regrole::oid) THEN RETURN true; END IF;
  IF (fence.effective_state()->>'state') IS DISTINCT FROM 'RUNNING' THEN RETURN false; END IF;
  SELECT * INTO c FROM fence.control WHERE id;
  SELECT * INTO cr FROM fence.credentials WHERE role_name = s;
  IF NOT FOUND OR cr.status <> 'ACTIVE' OR cr.epoch <> c.epoch THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM fence.run_lease l WHERE l.role_name = s AND l.epoch = c.epoch AND l.expires_at > clock_timestamp())
     AND NOT EXISTS (SELECT 1 FROM fence.halt_requests WHERE status IN ('OPEN', 'LOCKED'));
END
$f$;

-- ── التغطية ──────────────────────────────────────────────────────────────────
CREATE FUNCTION fence.protected_relations() RETURNS TABLE (relid oid, schema_name name, rel_name name, relkind "char")
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
  SELECT c.oid, n.nspname, c.relname, c.relkind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p', 'f')
    AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'fence')
    AND n.nspname NOT LIKE 'pg\_toast%' AND n.nspname NOT LIKE 'pg\_temp\_%'
$f$;

-- مشكلاتُ التغطيةِ والامتياز — تُستعملُ في مُطلِقِ DDL وفي check_fenced.
CREATE FUNCTION fence.coverage_problems() RETURNS jsonb
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

CREATE FUNCTION fence.cover_relation(rel oid) RETURNS void
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

-- ── مُطلِقاتُ DDL ───────────────────────────────────────────────────────────
CREATE TABLE fence.ddl_audit (
  id bigserial PRIMARY KEY,
  xact xid8 NOT NULL DEFAULT pg_current_xact_id(),
  tag text NOT NULL,
  actor name NOT NULL DEFAULT session_user,
  at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON fence.ddl_audit FROM PUBLIC;

CREATE FUNCTION fence._ddl_note(tag text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
  INSERT INTO fence.ddl_audit (tag) VALUES (tag)
$f$;

CREATE FUNCTION fence._ddl_commit_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE problems jsonb;
BEGIN
  -- مرّةً لكلِّ معاملة: الصفُّ الأخيرُ للمعاملةِ وحده يفحص.
  IF EXISTS (SELECT 1 FROM fence.ddl_audit d WHERE d.xact = NEW.xact AND d.id > NEW.id) THEN
    RETURN NULL;
  END IF;
  problems := fence.coverage_problems();
  IF jsonb_array_length(problems) > 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'XF203', MESSAGE = 'fence: المعاملةُ تكسرُ تغطيةَ السياج: ' || problems::text;
  END IF;
  RETURN NULL;
END
$f$;

CREATE CONSTRAINT TRIGGER xf_ddl_commit AFTER INSERT ON fence.ddl_audit
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fence._ddl_commit_check();
ALTER TABLE fence.ddl_audit ENABLE ALWAYS TRIGGER xf_ddl_commit;
CREATE TRIGGER xf_append_only BEFORE UPDATE OR DELETE ON fence.ddl_audit FOR EACH ROW EXECUTE FUNCTION fence._append_only();
CREATE TRIGGER xf_append_only_trunc BEFORE TRUNCATE ON fence.ddl_audit FOR EACH STATEMENT EXECUTE FUNCTION fence._append_only();
ALTER TABLE fence.ddl_audit ENABLE ALWAYS TRIGGER xf_append_only;
ALTER TABLE fence.ddl_audit ENABLE ALWAYS TRIGGER xf_append_only_trunc;

CREATE FUNCTION fence._ddl_start() RETURNS event_trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE st text := fence.effective_state()->>'state';
BEGIN
  IF st = 'RUNNING' THEN
    RAISE EXCEPTION USING ERRCODE = 'XF201', MESSAGE = format('fence: DDL (%s) ممنوعٌ تحتَ RUNNING — الهجراتُ تحتَ HALTED', tg_tag);
  END IF;
END
$f$;

CREATE FUNCTION fence._ddl_end() RETURNS event_trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $f$
DECLARE cmd record; rel record;
BEGIN
  FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
    IF cmd.schema_name = 'fence' THEN
      RAISE EXCEPTION USING ERRCODE = 'XF202', MESSAGE = format('fence: تعديلُ مخطّطِ السياجِ ممنوع (%s %s)', cmd.command_tag, cmd.object_identity);
    END IF;
  END LOOP;
  -- تغطيةُ ما لا زنادَ عليه أصلاً (جدولٌ/قسمٌ جديدٌ أو مُلحَق). ما له زنادٌ مُعطَّل
  -- لا يُصلَحُ صامتاً: يُرفَضُ أدناه.
  FOR rel IN SELECT pr.relid FROM fence.protected_relations() pr
             WHERE NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = pr.relid AND t.tgname = 'xf_guard')
  LOOP
    PERFORM fence.cover_relation(rel.relid);
  END LOOP;
  -- الفحصُ لا يقعُ هنا: أوامرُ التغطيةِ نفسُها (CREATE TRIGGER ثمّ ENABLE ALWAYS ثمّ
  -- RLS) تُطلِقُ هذا المُطلِقَ متداخلاً قبلَ اكتمالِها. يُسجَّلُ الأمرُ، ويُفحَصُ الثابتُ
  -- **عندَ الالتزام** بزنادِ قيدٍ مؤجَّل — فأمرٌ يكسرُ التغطيةَ يُلغي معاملتَه كلَّها.
  PERFORM fence._ddl_note(tg_tag);
END
$f$;

CREATE FUNCTION fence._ddl_drop() RETURNS event_trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $f$
DECLARE o record;
BEGIN
  FOR o IN SELECT * FROM pg_event_trigger_dropped_objects() LOOP
    IF o.original AND o.object_type IN ('trigger', 'policy')
       AND (o.object_identity LIKE 'xf\_guard on %' OR o.object_identity LIKE 'xf\_read on %') THEN
      RAISE EXCEPTION USING ERRCODE = 'XF204', MESSAGE = format('fence: إسقاطُ %s ممنوع', o.object_identity);
    END IF;
    IF o.schema_name = 'fence' THEN
      RAISE EXCEPTION USING ERRCODE = 'XF202', MESSAGE = format('fence: إسقاطٌ في مخطّطِ السياجِ ممنوع (%s)', o.object_identity);
    END IF;
  END LOOP;
END
$f$;

-- ── الفحصُ الحيّ: DB_FENCED = check_fenced().ok ────────────────────────────────
-- لا يُبنى على موتِ عمليةٍ ولا انقضاءِ إيجارٍ ولا إقرار: يقرأُ القاعدةَ الآن.
CREATE FUNCTION fence.check_fenced() RETURNS jsonb
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
  SELECT coalesce(jsonb_agg(g.roleid::regrole::text ORDER BY 1), '[]'::jsonb) INTO x FROM pg_auth_members g
  WHERE g.member = 'xuux_worker'::regrole;
  IF jsonb_array_length(x) > 0 THEN problems := problems || jsonb_build_array(jsonb_build_object('kind', 'worker_inherits_roles', 'roles', x)); END IF;
  SELECT coalesce(jsonb_agg(p.oid::regprocedure::text ORDER BY 1), '[]'::jsonb) INTO x FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'fence' AND has_function_privilege('xuux_worker', p.oid, 'EXECUTE')
    AND p.oid NOT IN ('fence.whoami()'::regprocedure, 'fence.read_ok()'::regprocedure, 'fence.effective_state()'::regprocedure);
  IF jsonb_array_length(x) > 0 THEN problems := problems || jsonb_build_array(jsonb_build_object('kind', 'worker_fence_execute', 'functions', x)); END IF;
  SELECT coalesce(jsonb_agg(e.extname ORDER BY 1), '[]'::jsonb) INTO x FROM pg_extension e
  WHERE e.extname IN ('dblink', 'postgres_fdw', 'file_fdw', 'adminpack', 'pg_background', 'plpython3u', 'plperlu');
  IF jsonb_array_length(x) > 0 THEN problems := problems || jsonb_build_array(jsonb_build_object('kind', 'escape_extensions', 'extensions', x)); END IF;
  residuals := residuals || jsonb_build_array(
    jsonb_build_object('kind', 'notify_not_revocable', 'note', 'NOTIFY أمرٌ بلا امتياز: نافذتُه بين قفلِ الإيقافِ وإنهاءِ الجلسات؛ لا مُستقبِلَ في المشروع (E3)'),
    jsonb_build_object('kind', 'db_clock_trusted', 'note', 'الإيجارُ يُقاسُ بساعةِ القاعدة؛ العبثُ بها خارجَ السياج'));
  RETURN jsonb_build_object('ok', jsonb_array_length(problems) = 0, 'problems', problems, 'residuals', residuals,
    'state', eff->'state', 'epoch', c.epoch, 'roster_version', c.roster_version, 'roster_hash', c.roster_hash,
    'incarnation', live, 'checked_at', clock_timestamp());
END
$f$;

-- ── هويّةُ العامل ───────────────────────────────────────────────────────────
CREATE FUNCTION fence.whoami() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE cr fence.credentials; eff jsonb := fence.effective_state(); l fence.run_lease;
BEGIN
  SELECT * INTO cr FROM fence.credentials WHERE role_name = session_user;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('known', false, 'session_user', session_user, 'state', eff->'state');
  END IF;
  SELECT * INTO l FROM fence.run_lease WHERE role_name = session_user;
  RETURN jsonb_build_object('known', true, 'session_user', session_user, 'worker_id', cr.worker_id,
    'boot_id', cr.boot_id, 'credential_epoch', cr.epoch, 'credential_status', cr.status,
    'roster_version', cr.roster_version, 'state', eff->'state', 'epoch', eff->'epoch',
    'lease_expires_at', l.expires_at, 'now', clock_timestamp());
END
$f$;

-- ── إقلاعُ السياج (مرّةً واحدة، superuser) ────────────────────────────────────
CREATE FUNCTION fence.bootstrap(sovereign_pubkey bytea) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE c fence.control; live jsonb := fence._live_incarnation();
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = session_user) THEN
    RAISE EXCEPTION USING ERRCODE = 'XF301', MESSAGE = 'fence: الإقلاعُ لمُزوِّدِ العنقود (superuser) وحده';
  END IF;
  SELECT * INTO c FROM fence.control WHERE id FOR UPDATE;
  IF c.sovereign_pubkey IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'XF302', MESSAGE = 'fence: المفتاحُ السياديُّ مُثبَّتٌ سلفاً — التدويرُ بأمرٍ KEY_ROTATE موقَّع';
  END IF;
  IF sovereign_pubkey IS NULL OR length(sovereign_pubkey) <> 32 OR fence._ed_decode(sovereign_pubkey) IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'XF303', MESSAGE = 'fence: مفتاحٌ عامٌّ غيرُ صالح';
  END IF;
  UPDATE fence.control SET state = 'HALTED', epoch = c.epoch + 1, sovereign_pubkey = bootstrap.sovereign_pubkey,
    sysid = live->>'sysid', pm_start_epoch = (live->>'pm_start_epoch')::numeric, timeline = (live->>'timeline')::int,
    dbname = live->>'dbname' WHERE id;
  PERFORM fence._reseal();
  PERFORM fence._event('BOOTSTRAP', c.epoch + 1, jsonb_build_object('pubkey', encode(sovereign_pubkey, 'hex'), 'incarnation', live));
  RETURN fence.effective_state();
END
$f$;

-- ── الأوامرُ السيادية ───────────────────────────────────────────────────────
-- الرسالةُ الموقَّعة: 'xuux-fence/sovereign/v1\n' || payload (نصُّ JSON حرفياً).
-- payload: {type, nonce, db, sysid, expected_epoch, not_before, not_after, ...}
CREATE FUNCTION fence._verify_command(payload text, signature bytea, want_type text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE c fence.control; p jsonb; live jsonb := fence._live_incarnation(); nb timestamptz; na timestamptz;
BEGIN
  IF NOT pg_has_role(session_user, 'xf_sovereign', 'MEMBER') OR (SELECT rolsuper FROM pg_roles WHERE rolname = session_user) THEN
    RAISE EXCEPTION USING ERRCODE = 'XF401', MESSAGE = 'fence: الأوامرُ السياديةُ عبرَ xf_sovereign وحده';
  END IF;
  SELECT * INTO c FROM fence.control WHERE id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'XF001', MESSAGE = 'fence: صفُّ التحكّمِ غائب'; END IF;
  IF c.seal IS DISTINCT FROM fence._control_digest(c) THEN
    RAISE EXCEPTION USING ERRCODE = 'XF002', MESSAGE = 'fence: ختمُ التحكّمِ لا يطابق';
  END IF;
  IF c.sovereign_pubkey IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'XF402', MESSAGE = 'fence: لا مفتاحَ سياديّاً مُثبَّتاً';
  END IF;
  IF NOT fence.ed25519_verify(c.sovereign_pubkey, convert_to('xuux-fence/sovereign/v1' || chr(10) || payload, 'UTF8'), signature) THEN
    RAISE EXCEPTION USING ERRCODE = 'XF403', MESSAGE = 'fence: توقيعُ الأمرِ السياديِّ غيرُ صالح';
  END IF;
  BEGIN
    p := payload::jsonb;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION USING ERRCODE = 'XF404', MESSAGE = 'fence: حمولةُ الأمرِ ليست JSON';
  END;
  IF p->>'type' IS DISTINCT FROM want_type THEN
    RAISE EXCEPTION USING ERRCODE = 'XF404', MESSAGE = format('fence: نوعُ الأمر %s والمطلوب %s', p->>'type', want_type);
  END IF;
  IF coalesce(length(p->>'nonce'), 0) < 16 THEN
    RAISE EXCEPTION USING ERRCODE = 'XF404', MESSAGE = 'fence: nonce ناقص';
  END IF;
  IF EXISTS (SELECT 1 FROM fence.sovereign_commands WHERE nonce = p->>'nonce') THEN
    RAISE EXCEPTION USING ERRCODE = 'XF405', MESSAGE = 'fence: nonce مستعمَلٌ سلفاً — إعادةُ إرسال';
  END IF;
  IF p->>'db' IS DISTINCT FROM current_database() OR p->>'sysid' IS DISTINCT FROM live->>'sysid' THEN
    RAISE EXCEPTION USING ERRCODE = 'XF406', MESSAGE = 'fence: الأمرُ لقاعدةٍ/عنقودٍ آخر';
  END IF;
  IF (p->>'expected_epoch')::bigint IS DISTINCT FROM c.epoch THEN
    RAISE EXCEPTION USING ERRCODE = 'XF407', MESSAGE = format('fence: expected_epoch=%s والعهدُ %s', p->>'expected_epoch', c.epoch);
  END IF;
  nb := (p->>'not_before')::timestamptz; na := (p->>'not_after')::timestamptz;
  IF nb IS NULL OR na IS NULL OR clock_timestamp() < nb OR clock_timestamp() > na
     OR na - nb > make_interval(secs => c.command_max_validity_s) THEN
    RAISE EXCEPTION USING ERRCODE = 'XF408', MESSAGE = 'fence: الأمرُ خارجَ نافذةِ صلاحيته';
  END IF;
  RETURN p;
END
$f$;

CREATE FUNCTION fence._record_command(p jsonb, payload text, signature bytea, epoch_before bigint, epoch_after bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
BEGIN
  INSERT INTO fence.sovereign_commands (nonce, type, payload, signature, epoch_before, epoch_after)
  VALUES (p->>'nonce', p->>'type', payload, signature, epoch_before, epoch_after);
  PERFORM fence._event('SOVEREIGN_' || (p->>'type'), epoch_after, jsonb_build_object('nonce', p->>'nonce', 'epoch_before', epoch_before));
END
$f$;

CREATE FUNCTION fence._roster_hash(v bigint) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
  SELECT encode(sha256(convert_to('xuux-fence/roster/v1|' || v::text || '|' || coalesce(
    (SELECT string_agg(worker_id || ',' || encode(pubkey, 'hex') || ',' || os_principal, ';' ORDER BY worker_id)
     FROM fence.roster WHERE roster_version = v), ''), 'UTF8')), 'hex')
$f$;

CREATE FUNCTION fence.roster_set(payload text, signature bytea) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE p jsonb := fence._verify_command(payload, signature, 'ROSTER_SET'); c fence.control; w jsonb; v bigint; h text;
BEGIN
  SELECT * INTO c FROM fence.control WHERE id;
  IF fence.effective_state()->>'state' <> 'HALTED' THEN
    RAISE EXCEPTION USING ERRCODE = 'XF409', MESSAGE = 'fence: تغييرُ القائمةِ تحتَ HALTED فقط';
  END IF;
  IF jsonb_typeof(p->'workers') <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'XF404', MESSAGE = 'fence: workers ليست مصفوفة';
  END IF;
  v := c.roster_version + 1;
  DELETE FROM fence.roster;
  FOR w IN SELECT * FROM jsonb_array_elements(p->'workers') LOOP
    IF fence._ed_decode(decode(w->>'pubkey', 'hex')) IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'XF404', MESSAGE = format('fence: مفتاحُ العامل %s غيرُ صالح', w->>'worker_id');
    END IF;
    INSERT INTO fence.roster (worker_id, pubkey, os_principal, roster_version)
    VALUES (w->>'worker_id', decode(w->>'pubkey', 'hex'), w->>'os_principal', v);
  END LOOP;
  h := fence._roster_hash(v);
  INSERT INTO fence.roster_versions (version, hash, payload, command_nonce) VALUES (v, h, p->'workers', p->>'nonce');
  UPDATE fence.control SET roster_version = v, roster_hash = h WHERE id;
  PERFORM fence._reseal();
  PERFORM fence._record_command(p, payload, signature, c.epoch, c.epoch);
  RETURN jsonb_build_object('roster_version', v, 'roster_hash', h);
END
$f$;

CREATE FUNCTION fence.breakglass_set(payload text, signature bytea) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE p jsonb := fence._verify_command(payload, signature, 'BREAKGLASS_SET'); c fence.control; r text;
BEGIN
  SELECT * INTO c FROM fence.control WHERE id;
  IF fence.effective_state()->>'state' NOT IN ('HALTED', 'RECOVERY_REQUIRED') THEN
    RAISE EXCEPTION USING ERRCODE = 'XF409', MESSAGE = 'fence: إعلانُ break-glass تحتَ HALTED/RECOVERY_REQUIRED فقط';
  END IF;
  DELETE FROM fence.breakglass;
  FOR r IN SELECT jsonb_array_elements_text(p->'roles') LOOP
    INSERT INTO fence.breakglass (role_name, declared_by_nonce) VALUES (r, p->>'nonce');
  END LOOP;
  PERFORM fence._record_command(p, payload, signature, c.epoch, c.epoch);
  RETURN jsonb_build_object('breakglass', p->'roles');
END
$f$;

CREATE FUNCTION fence.lease_set(payload text, signature bytea) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE p jsonb := fence._verify_command(payload, signature, 'LEASE_SET'); c fence.control;
BEGIN
  SELECT * INTO c FROM fence.control WHERE id;
  IF fence.effective_state()->>'state' <> 'HALTED' THEN
    RAISE EXCEPTION USING ERRCODE = 'XF409', MESSAGE = 'fence: ضبطُ الإيجارِ تحتَ HALTED فقط';
  END IF;
  UPDATE fence.control SET lease_window_s = (p->>'lease_window_s')::int, lease_renew_s = (p->>'lease_renew_s')::int WHERE id;
  PERFORM fence._reseal();
  PERFORM fence._record_command(p, payload, signature, c.epoch, c.epoch);
  RETURN jsonb_build_object('lease_window_s', (p->>'lease_window_s')::int, 'lease_renew_s', (p->>'lease_renew_s')::int);
END
$f$;

CREATE FUNCTION fence.key_rotate(payload text, signature bytea) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE p jsonb := fence._verify_command(payload, signature, 'KEY_ROTATE'); c fence.control; k bytea;
BEGIN
  SELECT * INTO c FROM fence.control WHERE id;
  k := decode(p->>'new_pubkey', 'hex');
  IF k IS NULL OR length(k) <> 32 OR fence._ed_decode(k) IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'XF404', MESSAGE = 'fence: مفتاحٌ جديدٌ غيرُ صالح';
  END IF;
  IF fence.effective_state()->>'state' NOT IN ('HALTED', 'RECOVERY_REQUIRED') THEN
    RAISE EXCEPTION USING ERRCODE = 'XF409', MESSAGE = 'fence: تدويرُ المفتاحِ تحتَ HALTED/RECOVERY_REQUIRED فقط';
  END IF;
  UPDATE fence.control SET sovereign_pubkey = k WHERE id;
  PERFORM fence._reseal();
  PERFORM fence._record_command(p, payload, signature, c.epoch, c.epoch);
  RETURN jsonb_build_object('rotated', true);
END
$f$;

-- RECOVER: من RECOVERY_REQUIRED (فعلياً: تجسُّدٌ آخرُ أو ختمٌ فاسد) إلى HALTED، بعدَ
-- أن يراجعَ المالكُ التجسُّدَ الجديدَ ويوقّعَ قيمَه. يُلغي كلَّ اعتمادٍ (اعتماداتٌ
-- استُرجعت من نسخةٍ قديمةٍ لا تُورَّث) ويرفعُ العهد.
CREATE FUNCTION fence.recover(payload text, signature bytea) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE c fence.control; p jsonb; live jsonb := fence._live_incarnation(); eff jsonb; r record; n bigint;
BEGIN
  -- الختمُ الفاسدُ يمنعُ _verify_command؛ فالاستردادُ من ختمٍ فاسدٍ بالأمرِ نفسِه
  -- يقتضي إعادةَ الختمِ بعدَ التحقّقِ من التوقيعِ على حمولةٍ تُسمّي الختمَ الحاليّ.
  SELECT * INTO c FROM fence.control WHERE id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'XF001', MESSAGE = 'fence: صفُّ التحكّمِ غائب'; END IF;
  eff := fence.effective_state();
  IF eff->>'state' <> 'RECOVERY_REQUIRED' THEN
    RAISE EXCEPTION USING ERRCODE = 'XF409', MESSAGE = format('fence: RECOVER من RECOVERY_REQUIRED فقط (الحالة %s)', eff->>'state');
  END IF;
  IF c.seal IS DISTINCT FROM fence._control_digest(c) THEN
    -- الختمُ فاسد: لا يُعادُ الختمُ إلا بأمرٍ يحملُ الختمَ الحاليَّ نصّاً.
    IF NOT pg_has_role(session_user, 'xf_sovereign', 'MEMBER') OR c.sovereign_pubkey IS NULL
       OR NOT fence.ed25519_verify(c.sovereign_pubkey, convert_to('xuux-fence/sovereign/v1' || chr(10) || payload, 'UTF8'), signature)
       OR (payload::jsonb)->>'reseal_from' IS DISTINCT FROM c.seal THEN
      RAISE EXCEPTION USING ERRCODE = 'XF002', MESSAGE = 'fence: ختمٌ فاسد — RECOVER يتطلّبُ reseal_from موقَّعاً';
    END IF;
    UPDATE fence.control SET seal = fence._control_digest(c) WHERE id;
  END IF;
  p := fence._verify_command(payload, signature, 'RECOVER');
  IF p->>'pm_start_epoch' IS DISTINCT FROM live->>'pm_start_epoch' OR (p->>'timeline')::int IS DISTINCT FROM (live->>'timeline')::int THEN
    RAISE EXCEPTION USING ERRCODE = 'XF410', MESSAGE = 'fence: الأمرُ لا يُسمّي التجسُّدَ الحيَّ (pm_start/timeline)';
  END IF;
  SELECT count(*) INTO n FROM pg_stat_activity a WHERE a.usesysid IS NOT NULL AND fence.is_worker_role(a.usesysid);
  IF n > 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'XF411', MESSAGE = format('fence: %s جلسةَ عاملٍ حيّةً — لا استرداد', n);
  END IF;
  FOR r IN SELECT role_name FROM fence.credentials WHERE status = 'ACTIVE' LOOP
    UPDATE fence.credentials SET status = 'REVOKED', revoked_at = clock_timestamp(), revoke_reason = 'RECOVER' WHERE role_name = r.role_name;
  END LOOP;
  FOR r IN SELECT rolname FROM pg_roles WHERE rolcanlogin AND fence.is_worker_role(oid) LOOP
    BEGIN
      EXECUTE format('ALTER ROLE %I NOLOGIN', r.rolname);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE EXCEPTION USING ERRCODE = 'XF412', MESSAGE = format('fence: دورُ عاملٍ %s قادرٌ على الدخولِ ولا يُدارُ من السياج', r.rolname);
    END;
  END LOOP;
  DELETE FROM fence.run_lease;
  UPDATE fence.halt_requests SET status = 'FAILED', completed_at = clock_timestamp(), report = jsonb_build_object('closed_by', 'RECOVER') WHERE status IN ('OPEN', 'LOCKED');
  -- كلُّ حالةٍ مختومةٍ تمرُّ بـRECOVERY_REQUIRED ثمّ HALTED، وكلُّ خطوةٍ ترفعُ العهد.
  SELECT * INTO c FROM fence.control WHERE id;
  IF c.state <> 'RECOVERY_REQUIRED' THEN
    UPDATE fence.control SET state = 'RECOVERY_REQUIRED', epoch = c.epoch + 1 WHERE id;
    SELECT * INTO c FROM fence.control WHERE id;
  END IF;
  UPDATE fence.control SET state = 'HALTED', epoch = c.epoch + 1, sysid = live->>'sysid',
    pm_start_epoch = (live->>'pm_start_epoch')::numeric, timeline = (live->>'timeline')::int WHERE id;
  PERFORM fence._reseal();
  SELECT * INTO c FROM fence.control WHERE id;
  PERFORM fence._record_command(p, payload, signature, (p->>'expected_epoch')::bigint, c.epoch);
  RETURN fence.effective_state();
END
$f$;

-- RESUME: ذرّيٌّ في معاملةٍ واحدة. يرفضُ إن لم تكن الحالةُ HALTED، أو اختلفت القائمة،
-- أو لم يكن check_fenced() سليماً **الآن**، أو غاب دليلُ الآثارِ الخارجيةِ الموقَّعُ هاشُه.
CREATE FUNCTION fence.resume(payload text, signature bytea) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE p jsonb := fence._verify_command(payload, signature, 'RESUME'); c fence.control; chk jsonb; eff jsonb := fence.effective_state();
BEGIN
  SELECT * INTO c FROM fence.control WHERE id;
  IF eff->>'state' <> 'HALTED' THEN
    RAISE EXCEPTION USING ERRCODE = 'XF409', MESSAGE = format('fence: RESUME من HALTED فقط (الحالة %s)', eff->>'state');
  END IF;
  IF EXISTS (SELECT 1 FROM fence.halt_requests WHERE status IN ('OPEN', 'LOCKED')) THEN
    RAISE EXCEPTION USING ERRCODE = 'XF409', MESSAGE = 'fence: طلبُ إيقافٍ معلّقٌ لم يكتمل — لا استئنافَ قبلَ إكماله';
  END IF;
  IF p->>'roster_hash' IS DISTINCT FROM c.roster_hash OR c.roster_version = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'XF413', MESSAGE = 'fence: هاشُ القائمةِ لا يطابق (أو لا قائمة)';
  END IF;
  IF p->>'pm_start_epoch' IS DISTINCT FROM (fence._live_incarnation())->>'pm_start_epoch' THEN
    RAISE EXCEPTION USING ERRCODE = 'XF410', MESSAGE = 'fence: الأمرُ لا يُسمّي التجسُّدَ الحيّ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM fence.evidence e WHERE e.epoch = c.epoch AND e.kind = 'EFFECTS_HALTED' AND e.sha256 = p->>'effects_evidence_sha256') THEN
    RAISE EXCEPTION USING ERRCODE = 'XF414', MESSAGE = 'fence: دليلُ الآثارِ الخارجيةِ لهذا العهدِ غائبٌ أو لا يطابقُ الهاشَ الموقَّع';
  END IF;
  chk := fence.check_fenced();
  IF NOT (chk->>'ok')::boolean THEN
    RAISE EXCEPTION USING ERRCODE = 'XF415', MESSAGE = 'fence: check_fenced() غيرُ سليم — لا استئناف: ' || (chk->'problems')::text;
  END IF;
  UPDATE fence.control SET state = 'RUNNING', epoch = c.epoch + 1 WHERE id;
  PERFORM fence._reseal();
  PERFORM fence._record_command(p, payload, signature, c.epoch, c.epoch + 1);
  INSERT INTO fence.evidence (epoch, kind, sha256, detail)
  VALUES (c.epoch + 1, 'RESUME_CHECK', encode(sha256(convert_to(chk::text, 'UTF8')), 'hex'), chk);
  RETURN fence.effective_state();
END
$f$;

-- ── عملياتُ الجذر (xf_root) ──────────────────────────────────────────────────
CREATE FUNCTION fence._assert_root() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
BEGIN
  IF NOT pg_has_role(session_user, 'xf_root', 'MEMBER') THEN
    RAISE EXCEPTION USING ERRCODE = 'XF501', MESSAGE = 'fence: عمليةُ جذرٍ لغيرِ xf_root';
  END IF;
END
$f$;

CREATE FUNCTION fence._terminate_worker_sessions(role_filter name DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN SELECT a.pid FROM pg_stat_activity a
           WHERE a.usesysid IS NOT NULL AND fence.is_worker_role(a.usesysid)
             AND (role_filter IS NULL OR a.usename = role_filter) AND a.pid <> pg_backend_pid() LOOP
    IF pg_terminate_backend(r.pid, 5000) THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END
$f$;

CREATE FUNCTION fence.issue_challenge(worker_id text, boot_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE c fence.control; nonce text; rn name; eff jsonb := fence.effective_state(); live jsonb := fence._live_incarnation();
BEGIN
  PERFORM fence._assert_root();
  SELECT * INTO c FROM fence.control WHERE id;
  IF eff->>'state' <> 'RUNNING' THEN
    RAISE EXCEPTION USING ERRCODE = 'XF502', MESSAGE = format('fence: لا إصدارَ اعتمادٍ تحتَ %s', eff->>'state');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM fence.roster r WHERE r.worker_id = issue_challenge.worker_id AND r.roster_version = c.roster_version) THEN
    RAISE EXCEPTION USING ERRCODE = 'XF008', MESSAGE = format('fence: العاملُ %s ليس في القائمة', worker_id);
  END IF;
  IF boot_id !~ '^[0-9a-f]{16,64}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'XF503', MESSAGE = 'fence: boot_id غيرُ صالح';
  END IF;
  IF EXISTS (SELECT 1 FROM fence.credentials cr WHERE cr.worker_id = issue_challenge.worker_id AND cr.boot_id = issue_challenge.boot_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'XF504', MESSAGE = 'fence: boot_id مستعمَلٌ لهذا العامل';
  END IF;
  nonce := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  rn := ('xw_' || worker_id || '_' || substring(boot_id FROM 1 FOR 16))::name;
  INSERT INTO fence.challenges (nonce, worker_id, boot_id, role_name, epoch, roster_version, expires_at)
  VALUES (nonce, worker_id, boot_id, rn, c.epoch, c.roster_version, clock_timestamp() + interval '60 seconds');
  RETURN jsonb_build_object('nonce', nonce, 'role_name', rn, 'epoch', c.epoch, 'roster_version', c.roster_version,
    'db', current_database(), 'sysid', live->>'sysid', 'worker_id', worker_id, 'boot_id', boot_id,
    'message', 'xuux-fence/credential/v1' || chr(10) || current_database() || chr(10) || (live->>'sysid') || chr(10) ||
      worker_id || chr(10) || boot_id || chr(10) || c.epoch || chr(10) || c.roster_version || chr(10) || rn || chr(10) || nonce);
END
$f$;

-- إصدارُ اعتمادِ الإقلاع: يتطلّبُ توقيعَ مفتاحِ العاملِ المُدرَجِ على التحدّي (`T-CRED-07`:
-- الجذرُ وحده لا يُصدِر). يُلغي اعتمادَ الإقلاعِ السابقِ للعاملِ ويُنهي جلساتِه.
-- الدورُ بلا كلمةِ مرور: لا يُدخَلُ إلا بمصادقةٍ مربوطةٍ بالعامل (peer/cert) — `T-CRED-05`.
CREATE FUNCTION fence.issue_credential(nonce text, worker_signature bytea) RETURNS jsonb
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
  END LOOP;
  EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT CONNECTION LIMIT 16 PASSWORD NULL', ch.role_name);
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

CREATE FUNCTION fence.renew_lease(role_name name) RETURNS timestamptz
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
  e := clock_timestamp() + make_interval(secs => c.lease_window_s);
  UPDATE fence.run_lease SET expires_at = e, renewed_at = clock_timestamp() WHERE run_lease.role_name = renew_lease.role_name AND epoch = c.epoch;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'XF009', MESSAGE = 'fence: لا إيجار'; END IF;
  RETURN e;
END
$f$;

CREATE FUNCTION fence.revoke_credential(role_name name, reason text) RETURNS integer
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
  PERFORM fence._event('CREDENTIAL_REVOKED', NULL, jsonb_build_object('role', role_name, 'reason', reason, 'terminated', n));
  RETURN n;
END
$f$;

-- الإيقاف — الخطوات 1..11 مقسومةٌ على معاملاتٍ يقودها `src/fence/db-fence.mjs`.
-- (1) التسجيل، (2) رفضُ الكتاباتِ الجديدةِ فوراً (الحارسُ يقرأُ الطلبَ المفتوح).
CREATE FUNCTION fence.halt_request(reason text) RETURNS bigint
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

-- (3) القفلُ الخطّيّ على صفِّ التحكّم + (4) انتظارُ المعاملاتِ السابقة (UPDATE ينتظرُ
-- كلَّ FOR SHARE قائم). المُستدعي يضعُ lock_timeout ويُنهي الجلساتِ إن طال.
CREATE FUNCTION fence.halt_lock(halt_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE c fence.control; eff jsonb;
BEGIN
  PERFORM fence._assert_root();
  SELECT * INTO c FROM fence.control WHERE id FOR UPDATE;
  eff := fence.effective_state();
  IF c.state = 'RUNNING' THEN
    UPDATE fence.control SET state = 'HALT_REQUESTED', epoch = c.epoch + 1 WHERE id;
    PERFORM fence._reseal();
  ELSIF c.state = 'HALTED' THEN
    UPDATE fence.control SET state = 'HALT_REQUESTED', epoch = c.epoch + 1 WHERE id;
    PERFORM fence._reseal();
  END IF;
  UPDATE fence.halt_requests SET status = 'LOCKED', locked_at = clock_timestamp() WHERE halt_requests.id = halt_id AND status = 'OPEN';
  SELECT * INTO c FROM fence.control WHERE id;
  PERFORM fence._event('HALT_LOCKED', c.epoch, jsonb_build_object('halt_id', halt_id, 'effective', eff));
  RETURN jsonb_build_object('state', c.state, 'epoch', c.epoch);
END
$f$;

-- (5) إلغاءُ الاعتمادات، (6) منعُ الدخول، (7) إنهاءُ الجلسات.
CREATE FUNCTION fence.halt_revoke_and_terminate(halt_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE r record; revoked integer := 0; nologin integer := 0; terminated integer;
BEGIN
  PERFORM fence._assert_root();
  FOR r IN SELECT role_name FROM fence.credentials WHERE status = 'ACTIVE' LOOP
    UPDATE fence.credentials SET status = 'REVOKED', revoked_at = clock_timestamp(), revoke_reason = 'HALT ' || halt_id WHERE role_name = r.role_name;
    revoked := revoked + 1;
  END LOOP;
  DELETE FROM fence.run_lease;
  FOR r IN SELECT rolname FROM pg_roles WHERE rolcanlogin AND fence.is_worker_role(oid) LOOP
    BEGIN
      EXECUTE format('ALTER ROLE %I NOLOGIN', r.rolname);
      nologin := nologin + 1;
    EXCEPTION WHEN insufficient_privilege THEN
      NULL; -- يظهرُ في check_fenced (worker_login_roles) فيبقى الإيقافُ غيرَ مكتمل.
    END;
  END LOOP;
  terminated := fence._terminate_worker_sessions(NULL);
  PERFORM fence._event('HALT_REVOKED', NULL, jsonb_build_object('halt_id', halt_id, 'revoked', revoked, 'nologin', nologin, 'terminated', terminated));
  RETURN jsonb_build_object('revoked', revoked, 'nologin', nologin, 'terminated', terminated);
END
$f$;

-- (8..10) الفحصُ الحيّ، (11) الدليل. الفشلُ يُبقي HALT_REQUESTED (مغلقاً).
CREATE FUNCTION fence.halt_complete(halt_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE c fence.control; chk jsonb; sha text; r record;
BEGIN
  PERFORM fence._assert_root();
  SELECT * INTO c FROM fence.control WHERE id FOR UPDATE;
  chk := fence.check_fenced();
  sha := encode(sha256(convert_to(chk::text, 'UTF8')), 'hex');
  IF (chk->>'ok')::boolean AND c.state = 'HALT_REQUESTED' THEN
    UPDATE fence.control SET state = 'HALTED' WHERE id;
    PERFORM fence._reseal();
    UPDATE fence.halt_requests SET status = 'COMPLETE', completed_at = clock_timestamp(), report = chk WHERE halt_requests.id = halt_id;
    -- الطلباتُ الأقدمُ المعلّقة (انقطاعٌ سابق) يستوفيها هذا الإيقافُ المكتمل؛ لا تُترَكُ مفتوحةً
    -- فتسدَّ الكتابةَ بعدَ RESUME إلى الأبد ولا تُغلَقُ بصمت: تُسجَّلُ «superseded_by».
    UPDATE fence.halt_requests SET status = 'COMPLETE', completed_at = clock_timestamp(),
           report = jsonb_build_object('superseded_by', halt_id, 'check_sha256', sha)
     WHERE halt_requests.id < halt_id AND status IN ('OPEN', 'LOCKED');
    INSERT INTO fence.evidence (epoch, kind, sha256, detail) VALUES (c.epoch, 'DB_FENCED', sha, chk);
    -- أدوارُ الإقلاعِ الملغاةُ تُسقَطُ بعدَ خلوِّ الجلسات (لا تُعادُ إلى LOGIN).
    FOR r IN SELECT role_name FROM fence.credentials WHERE status = 'REVOKED' AND NOT role_dropped LOOP
      BEGIN
        EXECUTE format('DROP ROLE IF EXISTS %I', r.role_name);
        UPDATE fence.credentials SET role_dropped = true WHERE role_name = r.role_name;
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END LOOP;
  ELSE
    INSERT INTO fence.evidence (epoch, kind, sha256, detail) VALUES (c.epoch, 'DB_NOT_FENCED', sha, chk);
  END IF;
  SELECT * INTO c FROM fence.control WHERE id;
  PERFORM fence._event('HALT_CHECK', c.epoch, jsonb_build_object('halt_id', halt_id, 'ok', chk->'ok', 'sha256', sha));
  RETURN jsonb_build_object('db_fenced', (chk->>'ok')::boolean, 'state', c.state, 'epoch', c.epoch, 'sha256', sha, 'check', chk);
END
$f$;

-- دليلُ الآثارِ الخارجية (cgroup فارغ، المنافذُ مغلقة…) يُسجَّلُ بهاشِه؛ RESUME يشترطُ
-- أن يوقّعَ المالكُ الهاشَ نفسَه. يُقبَلُ تحتَ HALTED فقط.
CREATE FUNCTION fence.record_effects_evidence(digest text, detail jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE c fence.control; eid bigint;
BEGIN
  PERFORM fence._assert_root();
  SELECT * INTO c FROM fence.control WHERE id;
  IF fence.effective_state()->>'state' <> 'HALTED' THEN
    RAISE EXCEPTION USING ERRCODE = 'XF507', MESSAGE = 'fence: دليلُ الآثارِ تحتَ HALTED فقط';
  END IF;
  IF encode(sha256(convert_to(detail::text, 'UTF8')), 'hex') IS DISTINCT FROM digest THEN
    RAISE EXCEPTION USING ERRCODE = 'XF508', MESSAGE = 'fence: الهاشُ لا يطابقُ التفاصيل';
  END IF;
  INSERT INTO fence.evidence (epoch, kind, sha256, detail) VALUES (c.epoch, 'EFFECTS_HALTED', digest, detail) RETURNING evidence.id INTO eid;
  PERFORM fence._event('EFFECTS_EVIDENCE', c.epoch, jsonb_build_object('sha256', digest));
  RETURN eid;
END
$f$;

-- ── الصفُّ الابتدائي والختم ─────────────────────────────────────────────────
INSERT INTO fence.event_head (id, seq, hash) VALUES (true, 0, 'GENESIS_FENCE');
INSERT INTO fence.control (id, state, epoch, dbname, seal) VALUES (true, 'RECOVERY_REQUIRED', 0, current_database(), '');
SELECT fence._reseal();

-- ── الامتيازات ──────────────────────────────────────────────────────────────
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA fence FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fence.whoami(), fence.read_ok(), fence.effective_state() TO xuux_worker;
-- read_ok() تستدعيها سياسةُ RLS لكلِّ قارئ: غيرُ العاملِ يُعادُ له true (لا يكشفُ شيئاً). بلا
-- EXECUTE لـPUBLIC يفشلُ كلُّ قارئٍ مشروعٍ غيرِ عاملٍ بـ42501 بدلَ أن يُحكَمَ عليه بالزناد.
GRANT EXECUTE ON FUNCTION fence.read_ok() TO PUBLIC;
GRANT EXECUTE ON FUNCTION fence.effective_state(), fence.check_fenced(), fence.status() TO xf_root, xf_sovereign, xf_auditor, xuux_migrator;
GRANT EXECUTE ON FUNCTION fence.issue_challenge(text, text), fence.issue_credential(text, bytea), fence.renew_lease(name),
  fence.revoke_credential(name, text), fence.halt_request(text), fence.halt_lock(bigint),
  fence.halt_revoke_and_terminate(bigint), fence.halt_complete(bigint), fence.record_effects_evidence(text, jsonb) TO xf_root;
GRANT EXECUTE ON FUNCTION fence.halt_request(text), fence.resume(text, bytea), fence.recover(text, bytea),
  fence.roster_set(text, bytea), fence.key_rotate(text, bytea), fence.breakglass_set(text, bytea),
  fence.lease_set(text, bytea), fence.ed25519_verify(bytea, bytea, bytea) TO xf_sovereign;
-- إنشاءُ الزنادِ على جدولٍ جديدٍ يتطلّبُ EXECUTE على دالّتِه وقتَ CREATE TRIGGER.
GRANT EXECUTE ON FUNCTION fence.guard_write(), fence.read_ok(), fence.cover_relation(oid), fence._ddl_note(text),
  fence.protected_relations(), fence.coverage_problems() TO xuux_migrator, xuux_owner;
GRANT SELECT ON fence.events, fence.evidence, fence.halt_requests, fence.credentials, fence.roster, fence.roster_versions,
  fence.sovereign_commands, fence.breakglass TO xf_auditor, xf_root, xf_sovereign;

RESET ROLE;

-- ── ملكيّةُ الجداول وامتيازاتُ العامل ────────────────────────────────────────
-- العاملُ ليس مالكاً لأيِّ جدول (`T-OWN-04` جزئياً): الملكيّةُ لـxuux_owner (NOLOGIN).
INSERT INTO fence.original_owners (relid, owner)
SELECT c.oid, pg_get_userbyid(c.relowner) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'state' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
UNION ALL
SELECT n.oid, pg_get_userbyid(n.nspowner) FROM pg_namespace n WHERE n.nspname = 'state';

DO $own$
DECLARE r record;
BEGIN
  EXECUTE 'ALTER SCHEMA state OWNER TO xuux_owner';
  FOR r IN SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'state' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') LOOP
    EXECUTE format('ALTER TABLE %s OWNER TO xuux_owner', r.oid::regclass);
  END LOOP;
  -- القاعدةُ نفسُها: لا CONNECT ولا TEMP لـPUBLIC؛ CONNECT لأدوارِ السياجِ صراحةً.
  EXECUTE format('REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO xuux_worker, xf_root, xf_sovereign, xf_auditor, xuux_migrator', current_database());
END
$own$;

GRANT USAGE ON SCHEMA state TO xuux_worker, xuux_migrator;
GRANT CREATE ON SCHEMA state TO xuux_migrator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA state TO xuux_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA state TO xuux_worker;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA state TO xuux_migrator;
GRANT SELECT, INSERT, DELETE ON public.schema_migrations TO xuux_migrator;

-- الكائناتُ الكبيرةُ كتابةٌ خارجَ الجداول: تُسحَبُ من PUBLIC (E2).
REVOKE EXECUTE ON FUNCTION pg_catalog.lo_creat(integer), pg_catalog.lo_create(oid), pg_catalog.lo_from_bytea(oid, bytea),
  pg_catalog.lo_put(oid, bigint, bytea), pg_catalog.lowrite(integer, bytea), pg_catalog.lo_unlink(oid),
  pg_catalog.lo_truncate(integer, integer), pg_catalog.lo_truncate64(integer, bigint), pg_catalog.lo_open(oid, integer) FROM PUBLIC;

-- ── التغطيةُ الأولى لكلِّ جدولٍ قائم ───────────────────────────────────────────
DO $cover$
DECLARE r record;
BEGIN
  FOR r IN SELECT relid FROM fence.protected_relations() LOOP
    PERFORM fence.cover_relation(r.relid);
  END LOOP;
END
$cover$;

-- ── البيان (دوالُّ السياجِ كما ثُبِّتت) ──────────────────────────────────────────
INSERT INTO fence.manifest (function_signature, digest)
SELECT p.oid::regprocedure::text,
       encode(sha256(convert_to(concat_ws('|', p.prosrc, p.prosecdef::text, pg_get_userbyid(p.proowner),
         coalesce(array_to_string(p.proconfig, ','), ''), p.provolatile::text), 'UTF8')), 'hex')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'fence';

-- ── مُطلِقاتُ الأحداث (آخرُ ما يُنشأ) ──────────────────────────────────────────
CREATE EVENT TRIGGER xf_ddl_start ON ddl_command_start EXECUTE FUNCTION fence._ddl_start();
CREATE EVENT TRIGGER xf_ddl_end ON ddl_command_end EXECUTE FUNCTION fence._ddl_end();
CREATE EVENT TRIGGER xf_ddl_drop ON sql_drop EXECUTE FUNCTION fence._ddl_drop();
ALTER EVENT TRIGGER xf_ddl_start ENABLE ALWAYS;
ALTER EVENT TRIGGER xf_ddl_end ENABLE ALWAYS;
ALTER EVENT TRIGGER xf_ddl_drop ENABLE ALWAYS;
