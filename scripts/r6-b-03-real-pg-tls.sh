#!/usr/bin/env bash
# R6-B-03 — قياسُ المصافحةِ على قاعدةِ PostgreSQL حقيقيّةٍ عبرَ TLS (WL-359).
#
# قياسُ `WL-357` أغلقَ شطرَ السلكِ على **مُحاكيٍ** لبروتوكولِ PostgreSQL. وحدُّ الجولةِ
# السابعةِ المُعلَنُ كان «لا قياسَ لاتصالِ قاعدةٍ حقيقيّة». فهذه الخطوةُ تُشغِّلُ حاويةَ
# `postgres:18.6-alpine` حقيقيّةً بـTLS وشهادةٍ موقَّعةٍ من جهةِ إصدارٍ **مولَّدةٍ في
# التشغيلةِ** (مادّةُ اختبارٍ لا سرٌّ)، وتُجري الهجراتِ عليها، ثمّ تُشغِّلُ اختبارَ
# `tests/persistence/db-real-pg-tls.test.mjs` الذي يقيسُ المصافحةَ والرفضَ والحاجزَ
# على القاعدةِ الحقيقيّةِ نفسِها.
#
# يُشغَّلُ من خطوةٍ مخصّصةٍ في `ci.yml` فقط (يحتاجُ Docker وopenssl)؛ ولا يُتركُ أثراً:
# الحاويةُ تُمحى والمادّةُ في `RUNNER_TEMP` لا `/tmp` (سياسةُ `LIVE-9`).

set -euo pipefail

readonly NAME=pg-tls-r6-b-03
readonly PORT=5433
readonly URL="postgresql://state:state@127.0.0.1:${PORT}/state?sslmode=require"

cert_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/r6-b-03-pg-tls.XXXXXX")"

# `mktemp -d` ينشئُ المجلّدَ 700 لمالكِهِ وحدَه، فلا يستطيعُ `postgres` داخلَ الحاويةِ
# **عبورَه** لقراءةِ الشهادةِ والمفتاحِ (قِيسَ في التشغيلةِ `37939265355`: Permission
# denied على `pg-server.crt` نفسِه). 711 = عبورٌ بلا سردٍ: يدخلُ من يعرفُ الاسمَ ولا
# يَسردُ مَن لا يعرفُه.
chmod 711 "${cert_dir}"

cleanup() {
  docker rm -f "${NAME}" >/dev/null 2>&1 || true
  sudo rm -rf "${cert_dir}" || rm -rf "${cert_dir}" || true
}
trap cleanup EXIT

# ── مادّةُ الشهادةِ: جهةُ إصدارٍ + ورقةٌ موقَّعةٌ منها بـSAN (نفسُ مُولِّدِ الاختباراتِ) ──
# توليدُها هنا بـopenssl لا في المستودعِ: لا شهادةَ تُدخَلُ الشجرةَ ولا سرَّ يُدفَع.
node --input-type=module - "$cert_dir" <<'NODE'
import { execFileSync } from 'node:child_process';
import { issueMaterial } from './tests/helpers/tls-material.mjs';
issueMaterial(process.argv[2], 'pg');
NODE

# مِرساةٌ أجنبيّةٌ لاختبارِ الرفضِ (جهةُ إصدارٍ أخرى لا تعرفُ ورقةَ الخادمِ).
node --input-type=module - "$cert_dir" <<'NODE'
import { issueMaterial } from './tests/helpers/tls-material.mjs';
issueMaterial(process.argv[2], 'foreign');
NODE

# مِلكيّةُ المفتاحِ: `postgres` داخلَ الصورةِ (uid 70) هو مَن يقرأُه، بلا قراءةٍ للغيرِ.
# والترتيبُ حاسمٌ: `chmod` قبلَ `chown` — فبعدَ نقلِ المِلكيّةِ لا يملكُ المُشغِّلُ
# تغييرَ نمطِ الملفِّ (قِيسَ في التشغيلةِ `37937442805`: Operation not permitted).
chmod 600 "${cert_dir}/pg-server.key"
sudo chown 70:70 "${cert_dir}/pg-server.key"

# ── الخادمُ الحقيقيُّ: postgres مُشغَّلٌ بـTLS على منفذٍ منفصلٍ عن قاعدةِ الخدمةِ ──
docker run -d --name "${NAME}" \
  -p 127.0.0.1:${PORT}:5432 \
  -e POSTGRES_USER=state -e POSTGRES_PASSWORD=state -e POSTGRES_DB=state \
  -v "${cert_dir}":/certs:ro \
  postgres:18.6-alpine \
  -c ssl=on \
  -c ssl_cert_file=/certs/pg-server.crt \
  -c ssl_key_file=/certs/pg-server.key

ready=0
for _ in $(seq 1 60); do
  if docker exec "${NAME}" pg_isready -U state -d state -q; then ready=1; break; fi
  sleep 1
done
if [ "${ready}" != 1 ]; then
  echo "::error::خادمُ PostgreSQL بـTLS لم يُصبِح جاهزاً في 60 ثانيةً" >&2
  docker logs "${NAME}" >&2 || true
  exit 1
fi

# ── الهجراتُ عبرَ القناةِ المُعمّاةِ نفسِها (`migrate` يمرُّ بـ`createPool` فالشهادةُ تعملُ) ──
DATABASE_URL="${URL}" DATABASE_CA_FILE="${cert_dir}/pg-ca.crt" npm run migrate -- up

# ── القياسُ: الاختبارُ يقيسُ المصافحةَ والرفضَ والحاجزَ على القاعدةِ الحقيقيّةِ ──
XUUX_REAL_PG_TLS=1 \
DATABASE_URL="${URL}" \
DATABASE_CA_FILE="${cert_dir}/pg-ca.crt" \
DATABASE_FOREIGN_CA_FILE="${cert_dir}/foreign-ca.crt" \
  node --test tests/persistence/db-real-pg-tls.test.mjs
