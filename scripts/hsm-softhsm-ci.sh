#!/usr/bin/env bash
# WL-405/LIVE-23 — تشغيلُ اختباراتِ التوكنِ الحقيقيِّ (SoftHSM) على عدّاء CI.
#
# قبلَ هذه الخطوةِ كانت اختباراتُ `XUUX_HSM_TEST` كلُّها **تُتخطّى** في CI (لا
# `softhsm2` على العدّاء)، فالإقلاعُ الإنتاجيُّ على توكنٍ حقيقيٍّ (قناةُ `Pkcs11HsmProvider`
# و`createProductionRootOfTrust` بمصدرِ `hsm`) كانَ محلّيًّا يُقرأُ في سجلِّ الأعمالِ ولا
# يُعادُ قياسُه — وهو عينُ فجوةِ `LIVE-23`. وهذه الخطوةُ تُثبِّتُ `softhsm2` وتُشغِّلُ
# ملفَّي الاختبارِ المقيدينَ بالتوكنِ الحقيقيِّ بعقدِ `XUUX_HSM_TEST=1`، **وتسقطُ إن تُخطِّيَ
# اختبارٌ لغيابِ الأداةِ أو الموديولِ** (عقدُ `UF-14`: الإعلانُ عقدٌ — الغيابُ فشلٌ لا تخطٍّ).
#
# **حدٌّ مُعلَنٌ:** توكنُ برنامجٍ لا عتادُ HSM. يُثبِتُ المسارَ على واجهةِ PKCS#11 حقيقيةٍ
# (موديولٌ خارجيٌّ وحدةُ تخزينٍ حقيقيةٌ وعملياتُ تشفيرٍ فعليةٌ فيه)، ولا يُثبِتُ شيئًا عن
# HSM عتاديٍّ ولا عن TPM — فذاك يبقى خارجَ CI ببيانٍ صريحٍ لا بتخطٍّ صامت.

set -euo pipefail

readonly TAP_FILE="${RUNNER_TEMP:-/tmp}/xuux-softhsm.tap"

MODULE="${XUUX_HSM_TEST_MODULE:-/usr/lib/softhsm/libsofthsm2.so}"

if ! command -v softhsm2-util >/dev/null || [ ! -f "${MODULE}" ]; then
  sudo apt-get update -q
  sudo apt-get install -y -q softhsm2
fi
softhsm2-util --version
[ -f "${MODULE}" ]

export XUUX_HSM_TEST=1

set +e
node --test --test-concurrency=1 --test-reporter=tap \
  tests/root-of-trust/pkcs11-provider.test.mjs \
  tests/root-of-trust/production-runtime-softhsm.test.mjs \
  > "${TAP_FILE}" 2>&1
rc=$?
set -e
grep -E '^# (tests|pass|fail|skipped|todo)' "${TAP_FILE}" || true
if [ "${rc}" -ne 0 ]; then
  grep -E '^not ok' "${TAP_FILE}" >&2 || true
  echo "::error::اختباراتُ التوكنِ الحقيقيِّ (SoftHSM) سقطَت (rc=${rc})" >&2
  exit "${rc}"
fi
# لا تخطٍّ مسموحٌ هنا: الأداةُ والموديولُ مُهيّآنِ، فأيُّ تخطٍّ يعني أنّ الخطوةَ لم تقِسْ
# ما تدّعيه — والتخطّي الصامتُ ليس نجاحاً.
if grep -E '^# SKIP' "${TAP_FILE}" | grep -q .; then
  grep -E '# SKIP' "${TAP_FILE}" >&2
  echo "::error::اختبارُ توكنٍ حقيقيٍّ تُخطِّيَ والأداةُ قائمةٌ — قياسٌ لم يقع" >&2
  exit 1
fi
echo "اختباراتُ التوكنِ الحقيقيِّ (SoftHSM) نجحَت — دليلُ توكنٍ لا دليلُ عتاد."
