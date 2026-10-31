#!/usr/bin/env bash
# LIVE-39 — قطعُ الطاقةِ عندَ كلِّ مرحلةٍ من حاجزِ الالتزامِ وحقنُ أخطاءِ الكتابةِ (WL-498).
#
# **ما يُضيفُهُ على `scripts/live-39-power-loss.sh` (‏WL-360):** ذاك يقطعُ عندَ `ACK` وحدَها.
# هذا يقطعُ عندَ **كلِّ** مرحلةٍ (‏S2 · S3 · S4 · S5 · ACK) لمعاملةٍ واحدةٍ، ويقيسُ ما بعدَ
# إعادةِ التشغيلِ، ويُكرِّرُ ذلكَ `LIVE39_ITERATIONS` مرّةً على أجهزةٍ جديدةٍ، ثمّ يحقنُ أخطاءَ
# الكتابةِ (‏`dm-flakey` بـ`error_writes`) داخلَ المعاملةِ.
#
# **الضماناتُ المقيسةُ (‏كلُّ سطرٍ `OUTCOME` يُحكَمُ عليه هنا لا في العمليّةِ الفرعيّةِ):**
#   PL1 لا فقدَ بعدَ الدوامِ: القطعُ عندَ S5 أو ACK ⇐ `BOOT_OK` و`committed`.
#   PL2 لا التزامَ شبحيّاً: القطعُ عندَ S2 أو S3 والمرجعُ لم يتقدّمْ ⇐ `BOOT_OK` و`unknown`.
#   PL3 المرجعُ متقدّمٌ على القرصِ (‏صورةُ S3 بلقطةِ S4، وصورةُ S4): إمّا `BOOT_OK`
#      و`committed` (‏إكمالٌ) وإمّا رفضٌ **مسمّى** (‏إغلاقٌ آمنٌ). `BOOT_OK` مع `unknown` هنا
#      قبولٌ صامتٌ لحالةٍ أقدمَ منَ المرجعِ ⇐ سقوطٌ. ورفضٌ بلا رمزٍ ⇐ سقوطٌ.
#   PL4 سلامةُ نظامِ الملفاتِ مستقلّةً عن التطبيقِ: `e2fsck -fn` نظيفٌ على كلِّ صورةٍ بعدَ
#      استرجاعِ المجلّةِ عندَ التحميلِ.
#   PL5 لا إقرارَ مع خطأِ كتابةٍ: الكتابةُ تُرفَضُ (‏EIO) ابتداءً من S2 أو S3 ⇐ `NO_ACK`
#      برمزٍ مسمّى؛ وبعدَ إعادةِ التحميلِ: لا `committed` بعدَ فشلِ S3-قبلَ-التقدّمِ (‏S2)،
#      وأيُّ إقلاعٍ إمّا `BOOT_OK` متّسقٌ وإمّا رفضٌ مسمّى.
#   HARNESS الحزامُ نفسُهُ: المعاملةُ المرحليّةُ أُقِرَّ بها، ولقطةُ المرجعِ موجودةٌ عندَ كلِّ علامةٍ
#      (‏غيابُها سقوطٌ منذ `WL-499` لا ملاحظةٌ). دوالُّ الحكمِ في `scripts/lib/live-39-judge.sh`.
#   PLM اختبارُ الطفرةِ (‏`WL-502`/`LIVE-39`): حذفُ `fsync` المجلّدِ وحدَهُ من مسارِ الكتابةِ
#      عبرَ حائلِ `LD_PRELOAD` يعترضُ `fsync(2)` على مقابضِ المجلداتِ (‏`scripts/lib/
#      live-39-mutate-dir-fsync.c`) — ترقيعُ `node:fs` لا يصيبُ كودَ الإنتاجِ لأنّ
#      الاستيرادَ المسمّى يُحلُّ وقتَ الربطِ. **فشلُ القياسِ هو المطلوبُ**: عندَ
#      القطوعِ التي يَعِدُها الشاهدُ الإيجابيُّ بدوامٍ (‏S3/S4، S4، S5، ACK) يجبُ ألّا تبقىَ
#      النتيجةُ `committed`؛ فإن بقيت فالقياسُ أعمى على ext4 (سقوطٌ لا نجاحٌ)، وإن انحرفت
#      (‏رفضٌ مسمّى أو `unknown`) فقد رأى القياسُ الغيابَ. والطفرةُ تُثبِتُ نفسَها بعدّادِ
#      تخطّياتٍ في `stderr` (‏`MUTATION_DIR_FSYNC_SKIPPED`) — عدٌّ صفرٌ سقوطُ تهيئةٍ.
#
# **حدٌّ معلَنٌ (‏بحرفِ WL-360):** إعادةُ تشغيلِ سجلِّ نواةٍ حقيقيٍّ على جهازِ حلقةٍ في عدّاءٍ
# مستضافٍ — لا فقدُ طاقةٍ فعليٌّ على عتادٍ مخصّصٍ، ولا برهانُ TPM/HSM، ولا جاهزيّةُ إنتاجٍ.
# والمرجعُ الخارجيُّ ملفٌّ خارجَ القرصِ المُختبرِ (‏`testFixture`) تُلتقَطُ حالُهُ عندَ كلِّ علامةٍ.
#
# `LIVE39_OBSERVE=1` يطبعُ النتائجَ بلا حكمٍ (‏للاستكشافِ فقطِ؛ CI لا يضبطُهُ).
set -euo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly CHILD="${REPO_ROOT}/tests/helpers/wl-498-stage-cut-child.mjs"
readonly PROVISION_CHILD="${REPO_ROOT}/tests/helpers/wl-360-crash-child.mjs"
readonly REPLAY="${REPO_ROOT}/scripts/lib/log-writes-replay.mjs"
# دوالُّ الحكمِ مفصولةٌ ومختبَرةٌ بلا نواةٍ (‏`WL-499`: `tests/tooling/live-39-judge.test.mjs`).
# shellcheck source=lib/live-39-judge.sh
source "${REPO_ROOT}/scripts/lib/live-39-judge.sh"
readonly WORK="${RUNNER_TEMP:-/tmp}/lw498"
readonly MNT='/mnt/lw498'
readonly DM_LOG='lw498log'
readonly DM_FLAKEY='lw498flakey'
readonly SIZE_BYTES='268435456'
readonly ITERATIONS="${LIVE39_ITERATIONS:-3}"
readonly OBSERVE="${LIVE39_OBSERVE:-0}"
readonly STAGES='S2 S3 S4 S5 ACK'

# حائلُ طفرةِ fsync المجلّدِ (‏WL-502): يُترجَمُ مرةً ويُحمَّلُ بـ`LD_PRELOAD` على العمليّةِ
# الفرعيّةِ لكاتبِ سيناريو `staged-mutdir` وحدَهُ — لا مسَّ لكودِ الإنتاجِ.
MUT_SO="$(mktemp -d)/live-39-mutate-dir-fsync.so"
readonly MUT_SO
cleanup() {
  sudo umount "${MNT}" >/dev/null 2>&1 || true
  sudo dmsetup remove "${DM_LOG}" >/dev/null 2>&1 || true
  sudo dmsetup remove "${DM_FLAKEY}" >/dev/null 2>&1 || true
  # تحييدٌ محصورٌ بالأجهزةِ التي أنشأها هذا السكربتُ وحدَهُ (‏لا `losetup -D`).
  for loop in "${LOOPS[@]}"; do sudo losetup -d "${loop}" >/dev/null 2>&1 || true; done
  sudo rm -rf "${WORK}"
  rm -f "${MUT_SO}" && rmdir "$(dirname "${MUT_SO}")" 2>/dev/null || true
}
trap cleanup EXIT
gcc -shared -fPIC -o "${MUT_SO}" "${REPO_ROOT}/scripts/lib/live-39-mutate-dir-fsync.c"

LOOPS=()
FAILURES=0
CHECKS=0

new_loop() {
  sudo truncate -s 256M "$1"
  local loop
  loop="$(sudo losetup -f --show "$1")"
  LOOPS+=("${loop}")
  echo "${loop}"
}

drop_loop() {
  sudo losetup -d "$1"
  local kept=()
  for loop in "${LOOPS[@]}"; do [ "${loop}" = "$1" ] || kept+=("${loop}"); done
  LOOPS=("${kept[@]}")
}

write_config() {
  # $1 = جذرُ الحالة، $2 = اسمُ جهازِ العلامات، $3 = مجلدُ اللقطات، $4 = جهازُ flakey الخلفيّ
  node -e '
const { writeFileSync } = require("node:fs");
const [helper, root, dm, snaps, work, flakeyDev, flakeyName] = process.argv.slice(1);
import(helper).then(({ makeKeys }) => {
  const socketFile = `${work}/socket.json`;
  const base = { root, socketFile, dm };
  const flakey = { name: flakeyName, dev: flakeyDev, sectors: String(268435456 / 512) };
  const config = {
    keys: makeKeys(),
    ops: {
      provision: { ...base, mode: "provision", fsync: true },
      staged: { ...base, mode: "transact-staged", fsync: true, id: "cmd-cut", prefix: "cut", snapshots: snaps },
      "staged-nofsync": { ...base, mode: "transact-staged", fsync: false, id: "cmd-cut", prefix: "cut", snapshots: snaps },
      "staged-mutdir": { ...base, mode: "transact-staged", fsync: true, id: "cmd-cut", prefix: "cut", snapshots: snaps },
      "eio-S2": { ...base, mode: "transact-staged", fsync: true, id: "cmd-cut", failWritesAt: "S2", flakey },
      "eio-S3": { ...base, mode: "transact-staged", fsync: true, id: "cmd-cut", failWritesAt: "S3", flakey },
      verify: { ...base, mode: "verify", socketFile: `${work}/verify-socket.json`, ids: ["cmd-cut"] },
    },
  };
  writeFileSync(`${work}/config.json`, JSON.stringify(config));
});' "${REPO_ROOT}/tests/helpers/wl-326-root.mjs" "${MNT}/root" "$2" "$3" "${WORK}" "${4:-none}" "${DM_FLAKEY}"
}

# يُقلِعُ من الصورةِ المحمَّلةِ على MNT بلقطةِ مرجعٍ ويطبعُ الناتجَ في سطرٍ واحدٍ.
verify_with_witness() {
  sudo rm -f "${WORK}/verify-socket.json"
  if [ -n "$1" ] && [ -f "$1" ]; then
    cp "$1" "${WORK}/verify-socket.json"
    chmod 0666 "${WORK}/verify-socket.json"
  fi
  node "${CHILD}" "${WORK}/config.json" verify | paste -sd' '
}

fsck_clean() {
  # بعدَ `umount`: المجلّةُ استُرجِعَت عندَ التحميلِ؛ `-n` لا يكتبُ شيئاً.
  if sudo e2fsck -fn "$1" >"${WORK}/fsck.out" 2>&1; then echo 1; else
    sed 's/^/  fsck: /' "${WORK}/fsck.out" | head -20 >&2
    echo 0
  fi
}

# ══ السيناريو أ: قطعٌ عندَ كلِّ مرحلةٍ على dm-log-writes ══
stage_cuts() {
  local iter="$1" op="${2:-staged}"
  sudo rm -rf "${WORK}" && mkdir -p "${WORK}/snaps"
  local data log
  data="$(new_loop "${WORK}/data.dev")"
  log="$(new_loop "${WORK}/log.dev")"
  sudo dmsetup create "${DM_LOG}" \
    --table "0 $(sudo blockdev --getsz "${data}") log-writes ${data} ${log}"
  sudo mkfs.ext4 -q -F -E nodiscard "/dev/mapper/${DM_LOG}"
  sudo mkdir -p "${MNT}"
  sudo mount -o commit=600 "/dev/mapper/${DM_LOG}" "${MNT}"
  sudo chmod 0777 "${MNT}"
  write_config "${MNT}/root" "${DM_LOG}" "${WORK}/snaps"

  node "${PROVISION_CHILD}" "${WORK}/config.json" provision | grep -qx BOOTED
  sudo sync
  sudo dmsetup message "${DM_LOG}" 0 mark baseline
  local ack
  # سيناريو الطفرةِ يُحمَّلُ على حائلِ `LD_PRELOAD` (إسقاطُ fsync المجلداتِ في النواةِ).
  if [ "${op}" = staged-mutdir ]; then
    ack="$(LD_PRELOAD="${MUT_SO}" node "${CHILD}" "${WORK}/config.json" "${op}" 2> >(tee "${WORK}/child.err" >&2))"
  else
    ack="$(node "${CHILD}" "${WORK}/config.json" "${op}" 2> >(tee "${WORK}/child.err" >&2))"
  fi
  verdict HARNESS "iter${iter}/staged-transaction" "$([ "${ack}" = ACK ] && echo 1 || echo 0)" "${ack}"
  # الطفرةُ (staged-mutdir): يجبُ أن يُثبِتَ الحائلُ أنّ نداءاتِ الإنتاجِ مرّتْ عبرَهُ —
  # عدٌّ صفرٌ يعني أنّ الطفرةَ لم تُصِبْ المسارَ فلا يُقاسُ شيءٌ (سقوطُ تهيئةٍ لا عمىً).
  if [ "${op}" = staged-mutdir ]; then
    local mutcount
    mutcount="$(sed -n 's/^MUTATION_DIR_FSYNC_SKIPPED count=\([0-9][0-9]*\)$/\1/p' "${WORK}/child.err" | head -1)"
    verdict HARNESS "iter${iter}/mutation-active" "$([ -n "${mutcount}" ] && [ "${mutcount}" -ge 1 ] && echo 1 || echo 0)" "dir-fsync-skipped=${mutcount:-none}"
  fi
  for stage in ${STAGES}; do
    judge_witness "iter${iter}/${stage}" "${WORK}/snaps/${stage}.json"
  done
  # القطعُ: ما بعدَ العلامةِ وما لم يُفلَش يسقُطُ.
  sudo umount "${MNT}"
  sudo dmsetup remove "${DM_LOG}"
  sudo sync

  for stage in ${STAGES}; do
    local witnesses="${stage}"
    [ "${stage}" = S3 ] && witnesses='S3 S4'
    for witness in ${witnesses}; do
      local image="${WORK}/image.dev" loop outcome
      sudo rm -f "${image}"
      sudo truncate -s 256M "${image}"
      sudo node "${REPLAY}" --log "${log}" --image "${image}" \
        --end-mark "cut-${stage}" --size "${SIZE_BYTES}" >/dev/null
      loop="$(sudo losetup -f --show "${image}")"
      LOOPS+=("${loop}")
      sudo mount "${loop}" "${MNT}"
      outcome="$(verify_with_witness "${WORK}/snaps/${witness}.json")"
      sudo umount "${MNT}"
      if [ "${op}" = staged ]; then
        judge_cut "${iter}" "${stage}" "${witness}" "${outcome}"
      elif [ "${op}" = staged-mutdir ]; then
        judge_mutation "${stage}" "${witness}" "${outcome}"
      else
        judge_negative "${stage}" "${witness}" "${outcome}"
      fi
      verdict PL4 "iter${iter}/cut@${stage}/witness@${witness}" "$(fsck_clean "${loop}")" e2fsck
      drop_loop "${loop}"
    done
  done
  drop_loop "${data}"
  drop_loop "${log}"
}

# ══ السيناريو ب: أخطاءُ كتابةٍ داخلَ المعاملةِ على dm-flakey ══
eio_case() {
  local at="$1"
  sudo rm -rf "${WORK}" && mkdir -p "${WORK}/snaps"
  local data
  data="$(new_loop "${WORK}/flakey.dev")"
  local sectors
  sectors="$(sudo blockdev --getsz "${data}")"
  sudo dmsetup create "${DM_FLAKEY}" --table "0 ${sectors} flakey ${data} 0 180 0"
  sudo mkfs.ext4 -q -F -E nodiscard "/dev/mapper/${DM_FLAKEY}"
  sudo mkdir -p "${MNT}"
  sudo mount "/dev/mapper/${DM_FLAKEY}" "${MNT}"
  sudo chmod 0777 "${MNT}"
  write_config "${MNT}/root" none "${WORK}/snaps" "${data}"
  node "${PROVISION_CHILD}" "${WORK}/config.json" provision | grep -qx BOOTED
  sudo sync

  local result
  result="$(node "${CHILD}" "${WORK}/config.json" "eio-${at}")"
  judge_eio_ack "${at}" "${result}"
  judge_witness "eio@${at}" "${WORK}/socket.json"

  # «إعادةُ التشغيلِ»: فكُّ التحميلِ، وإعادةُ الجهازِ سليماً، وتحميلٌ جديدٌ يقرأُ القرصَ لا الذاكرة.
  sudo umount "${MNT}" || sudo umount -l "${MNT}"
  sudo dmsetup remove "${DM_FLAKEY}"
  sudo dmsetup create "${DM_FLAKEY}" --table "0 ${sectors} flakey ${data} 0 180 0"
  sudo mount "/dev/mapper/${DM_FLAKEY}" "${MNT}"
  local outcome
  outcome="$(verify_with_witness "${WORK}/socket.json")"
  sudo umount "${MNT}"
  judge_eio_reboot "${at}" "${outcome}"
  verdict PL4 "eio@${at}" "$(fsck_clean "/dev/mapper/${DM_FLAKEY}")" e2fsck
  sudo dmsetup remove "${DM_FLAKEY}"
  drop_loop "${data}"
}

uname -r
for iter in $(seq 1 "${ITERATIONS}"); do stage_cuts "${iter}"; done
stage_cuts neg staged-nofsync
# اختبارُ الطفرةِ (‏`WL-502`): حذفُ fsync المجلّدِ وحدَهُ — **سيناريو اختياريٌّ لا يدخلُ المسارَ الدائمَ**:
# قياسُهُ على عدّاءِ CI أثبتَ عمىً على `ext4` (التشغيلةُ `41181438329`: `count=6` وكلُّ قطوعِ الدوامِ
# `committed`) فتشغيلُهُ الدائمُ يُحمِّرُ الخطوةَ الدائمةَ بلا علاجٍ (مُقيسٌ بالتشغيلةِ `41182355757`) —
# يُشغَّلُ بـ`LIVE39_RUN_MUTDIR=1` عندَ الحاجةِ (استقصاءٌ أو بعدَ قرارِ الجهةِ المخوَّلةِ بعلاجِ العمى).
if [ "${LIVE39_RUN_MUTDIR:-0}" = "1" ]; then
  stage_cuts mut staged-mutdir
else
  echo "LIVE39_MUTDIR_OPTIN_SKIPPED"
fi
eio_case S2
eio_case S3

echo "LIVE39_STAGE_CUTS checks=${CHECKS} failures=${FAILURES} iterations=${ITERATIONS}"
if [ "${FAILURES}" -ne 0 ] && [ "${OBSERVE}" != 1 ]; then
  echo "LIVE39_STAGE_CUTS_FAILED"
  exit 1
fi
echo LIVE39_STAGE_CUTS_DONE
