#!/usr/bin/env bash
# WL-405/LIVE-23 — تشغيلُ اختباراتِ العزلِ الحقيقيِّ (مساحاتُ أسماءِ المستخدمِ) على
# عدّاء CI.
#
# فجوةُ `LIVE-23` الأصليةُ: منذَ WL-286 (الانتقالُ إلى `ubuntu-latest`) كانت اختباراتُ
# العزلِ الحقيقيِّ تُتخطّى في CI لأنَّ Ubuntu يقيّدُ `unprivileged user namespaces`
# بـAppArmor (`kernel.apparmor_restrict_unprivileged_userns=1`). والشرطُ في سجلِّ الديونِ
# يقولُ: «بعدّاءٍ يسمحُ بـuserns **أو بخطوةٍ تُهيِّئُ المضيفَ**». هذهِ الخطوةُ هيَ خيارُ
# «تهيئةِ المضيفِ»: تُهيِّئُ `unshare --user` على العدّاءِ نفسِهِ (عدّاءاتُ GitHub تمنحُ
# `sudo` بلا كلمةِ سرٍّ)، ثمّ تُشغِّلُ اختباراتِ العزلِ **وتسقطُ إن تُخطِّيَ اختبارٌ
# لغيابِ المساحاتِ** — فالتخطّي الصامتُ ليس نجاحاً.
#
# **حدٌّ مُعلَنٌ:** هذهَ مساحةُ أسماءِ مستخدمٍ حقيقيةٌ على عدّاءٍ حقيقيٍّ (عمليةٌ تنشئُ
# عزلًا فعليًّا وتُقاسُ به)، لا حاويةٌ مُحاكاةٌ. وهيَ لا تُثبِتُ شيئًا عن عتادِ TPM/HSM.

set -euo pipefail

readonly TAP_FILE="${RUNNER_TEMP:-/tmp}/xuux-isolation.tap"

userns_available() {
  unshare --user --map-root-user true 2>/dev/null
}

if ! userns_available; then
  # تهيئةُ المضيفِ — لا تفاديًا للحاجزِ بل بفتحِ ما يسمحُ بهِ النواةُ أصلًا. إن لم
  # تُتَحْ الخطوةُ فالفشلُ مغلَقٌ تحتَ: القياسُ لا يتحوَّلُ تخطيًا.
  if command -v sudo >/dev/null 2>&1; then
    sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
  fi
fi

if ! userns_available; then
  echo "::error::مساحاتُ أسماءِ المستخدمِ غيرُ متاحةٍ حتى بعدَ التهيئةِ — فشلٌ مغلقٌ لا تخطٍّ (LIVE-23)" >&2
  exit 1
fi

set +e
node --test --test-concurrency=1 --test-reporter=tap \
  tests/execution/isolation.test.mjs \
  tests/execution/worker-isolation.test.mjs \
  > "${TAP_FILE}" 2>&1
rc=$?
set -e
grep -E '^# (tests|pass|fail|skipped|todo)' "${TAP_FILE}" || true
if [ "${rc}" -ne 0 ]; then
  # كاملُ تفاصيلِ الاختباراتِ الساقطةِ (رسائلُ التأكيدِ وأسبابُها) لا سطورُ العناوينِ وحدَها —
  # التشخيصُ جزءٌ من القياسِ: سقوطٌ بلا سببٍ مكتوبٍ يعاد قياسُهُ بلا دليل.
  sed -n '/^not ok/,$p' "${TAP_FILE}" >&2 || true
  echo "::error::اختباراتُ العزلِ الحقيقيِّ سقطَت (rc=${rc})" >&2
  exit "${rc}"
fi
# المساحاتُ مُتاحةٌ ومُثبَتةٌ أعلاهُ — فأيُّ تخطٍّ يعني أنّ الخطوةَ لم تقِسْ ما تدّعيه.
if grep -E '^# SKIP' "${TAP_FILE}" | grep -q .; then
  grep -E '# SKIP' "${TAP_FILE}" >&2
  echo "::error::اختبارُ عزلٍ تُخطِّيَ والمساحاتُ قائمةٌ — قياسٌ لم يقع" >&2
  exit 1
fi
echo "اختباراتُ العزلِ الحقيقيِّ (userns) نجحَت على العدّاءِ — عزلٌ فعليٌّ لا محاكاة."
