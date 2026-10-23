#!/usr/bin/env bash
# WL-374 — تشغيلُ اختباراتِ محاكي TPM (‏`tests/sim/`) على `swtpm` حقيقيٍّ في CI.
#
# قبلَ هذه الخطوةِ كانت `tests/sim/**` كلُّها **تُتخطّى** في CI (‏لا `XUUX_TPM_SIM` ولا
# `swtpm`)، فكلُّ دليلِ محاكاةٍ لـADR 0006/0007 (‏حالاتُ التمزّقِ، الإعادةُ، الشهادةُ،
# الإيقافُ السياديُّ المختومُ) كانَ محلّيّاً يُقرأُ في سجلِّ الأعمالِ ولا يُعادُ قياسُه.
# فهذه الخطوةُ تُشغِّلُ `swtpm` مؤقّتاً على loopback وتُشغِّلُ الاختباراتِ عليه، **وتسقطُ
# إن تُخطِّيَ اختبارٌ لغيابِ المحاكي** — فتخطٍّ صامتٌ ليس نجاحاً.
#
# **حدٌّ مُعلَنٌ:** محاكٍ لا عتاد. لا يُثبِتُ شيئاً عن TPM حقيقيٍّ (‏ADR 0007 §9)، ولا
# يلمسُ `/dev/tpm*` (‏`sim/tpm/tcti_guard.mjs` يرفضُ كلَّ TCTI غيرِ `swtpm:`/`mssim:`).
# ولا يتركُ أثراً في `/tmp` (‏سياسةُ `LIVE-9`): الحالةُ في `RUNNER_TEMP`، وملفُّ TAP
# الدائمُ (‏WL-461) في `RUNNER_TEMP/xuux-sim-tap` تحذفُهُ آليّةُ العدّاءِ بعدَ الوظيفةِ.

set -euo pipefail

readonly PORT=2321
readonly CTRL=2322

state_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/xuux-swtpm.XXXXXX")"
pid_file="${state_dir}/swtpm.pid"
# WL-461: ملفُّ TAP كانَ داخلَ مجلدِ الحالةِ الذي يحذفُهُ الفخُّ عندَ الخروجِ، فكانَ رفعُهُ
# أثرًا (‏WL-434) يقعُ على ملفٍّ محذوفٍ دائمًا ولا يُنجَزُ إلا عندَ الفشلِ أصلًا. الآنَ:
# في CI (‏`RUNNER_TEMP` معلومٌ) يُكتبُ في مجلدٍ مستقلٍّ يبقى بعدَ الفخِّ حتى خطوةِ الرفعِ؛
# ومحليًّا (‏لا `RUNNER_TEMP`) يبقى في مجلدِ الحالةِ فيُحذفُ معَهُ (لا حاجةَ لأثرٍ محليًّا
# وسياسةُ LIVE-9 محفوظةٌ: كلُّ شيءٍ تحتَ `RUNNER_TEMP` لا `/tmp`).
if [ -n "${RUNNER_TEMP:-}" ]; then
  tap_dir="${RUNNER_TEMP}/xuux-sim-tap"
  mkdir -p "${tap_dir}"
else
  tap_dir="${state_dir}"
fi
tap_file="${tap_dir}/sim.tap"

cleanup() {
  if [ -f "${pid_file}" ]; then kill "$(cat "${pid_file}")" 2>/dev/null || true; fi
  rm -rf "${state_dir}" sim/tpm/_tear sim/tpm/_replay sim/tpm/_snap sim/tpm/_sovereign || true
}
trap cleanup EXIT

if ! command -v swtpm >/dev/null || ! command -v tpm2_nvincrement >/dev/null; then
  sudo apt-get update -q
  sudo apt-get install -y -q swtpm swtpm-tools tpm2-tools
fi
swtpm --version

swtpm socket --tpm2 \
  --tpmstate dir="${state_dir}" \
  --server type=tcp,port=${PORT},bindaddr=127.0.0.1 \
  --ctrl type=tcp,port=${CTRL},bindaddr=127.0.0.1 \
  --flags not-need-init,startup-clear \
  --pid file="${pid_file}" \
  --daemon

export TPM2TOOLS_TCTI="swtpm:host=127.0.0.1,port=${PORT}"
export XUUX_TPM_SIM=1

ready=0
for _ in $(seq 1 30); do
  if tpm2_getcap properties-fixed >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
if [ "${ready}" != 1 ]; then
  echo "::error::swtpm لم يُجِبْ على TPM2_GetCapability في 30 ثانيةً" >&2
  exit 1
fi

# WL-461: الطباعةُ عبرَ `tee` فلا يُختزنُ الأثرُ في الملفِ وحدهُ — أسماءُ الاختباراتِ
# المنفذةِ والمتخطاةِ وأسبابُها تظهرُ في سجلِّ الخطوةِ عندَ النجاحِ كما عندَ الفشلِ،
# لا رؤوسَ الإخفاقِ وحدها (فجوةُ WL-434 في الإظهارِ لا في الحفظِ وحده).
set +e
node --test --test-concurrency=1 --test-reporter=tap tests/sim/ 2>&1 | tee "${tap_file}"
rc=$?
set -e
grep -E '^# (tests|pass|fail|skipped|todo)' "${tap_file}" || true
if [ "${rc}" -ne 0 ]; then
  grep -E '^not ok' "${tap_file}" >&2 || true
  echo "::error::اختباراتُ محاكي TPM سقطَت (rc=${rc})" >&2
  exit "${rc}"
fi
# التخطّي المسموحُ الوحيدُ: مسارُ القناةِ الحيُّ (‏`XUUX_CHANNEL_POC`) — محلّيٌّ بقرارِ المالكِ.
# وأيُّ تخطٍّ لغيابِ المحاكي يعني أنّ الخطوةَ لم تَقِسْ ما تدّعيه.
if grep -E '# SKIP' "${tap_file}" | grep -v 'XUUX_CHANNEL_POC' | grep -q .; then
  grep -E '# SKIP' "${tap_file}" | grep -v 'XUUX_CHANNEL_POC' >&2
  echo "::error::اختبارُ محاكاةٍ تُخطِّيَ والمحاكي قائمٌ — قياسٌ لم يقع" >&2
  exit 1
fi
echo "اختباراتُ محاكي TPM نجحَت على swtpm — دليلُ محاكاةٍ لا دليلُ عتاد."
