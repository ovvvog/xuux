#!/usr/bin/env bash
# LIVE-39 ع١ — علاماتُ قياسٍ بعدَ كلِّ مزامنةِ مجلّدٍ ودوامُ الاسمِ في نظامِ الملفّاتِ نفسِه (WL-505).
#
# **السؤالُ المقيس:** حينَ يعودُ `fsync` على مجلّدٍ في مسارِ الكاتبِ، أَتكونُ الأسماءُ التي أُظهِرَت
# أو أُزيلَت فيه قبلَهُ دائمةً على القرص؟ — يُقاسُ **في نظامِ الملفّاتِ** (‏قراءةُ الصورةِ المُعادةِ)
# لا عبرَ نتيجةِ بروتوكولِ الاستعادة. وتحليلُ `WL-503` (‏`docs/decisions/LIVE-39-mutation-blindness-analysis.md`
# §3) بيّنَ لماذا لا تراهُ علاماتُ المراحلِ: كلٌّ منها يقعُ بعدَ `fsync` ملفٍّ لاحقٍ يُودِعُ يوميّاتِ
# `ext4` أو حيثُ تُعوِّضُ قاعدةُ B3. هنا العلامةُ تقعُ في النافذةِ بينَ المزامنةِ وأوّلِ `fsync` تالٍ.
#
# **ثلاثةُ أوضاعٍ على المعاملةِ نفسِها (‏`crown.command` عبرَ `tests/helpers/wl-498-stage-cut-child.mjs`):**
#   witness  الشاهدُ الموجب ⇐ PLD1: كلُّ اسمٍ دائمٌ عندَ كلِّ `dirsync-<n>`، و`e2fsck -fn` نظيف (‏PL4).
#   mutate   الطفرةُ السلبيّة (‏المزامنةُ مُسقَطة) ⇐ PLD2: الاسمُ الأوّليُّ **غيرُ** دائمٍ عندَ M2 وM4.
#   early    الطفرةُ المضادّة (‏العلامةُ قبلَ النداءِ والكاتبُ سليم) ⇐ PLD3: كـPLD2 — وإلّا فالأداةُ عمياءُ
#            عن الترتيبِ ونتيجةُ PLD1 لا تُثبِتُ شيئاً.
# ومعَ كلِّ علامةٍ سطرُ `PROTO` (‏إقلاعُ الجذرِ على الصورةِ نفسِها بلقطةِ المرجعِ عندَ العلامة) —
# **ملاحظةٌ لا حكمٌ**: يُظهِرُ الفصلَ بينَ دوامِ الاسمِ ونجاحِ الاستعادةِ ولا يُعيدُ تعريفَ `PLM` ولا `D3`.
#
# **حدودٌ مُعلَنة:** (١) سيناريو **اختياريٌّ** لا يُنادى من `ci.yml` ولا من `npm test` — يُشغَّلُ يدويّاً
# أو بمسارِ استقصاءٍ مؤقّت؛ (٢) `ext4` بـ`data=ordered` وحدَه (‏أنظمةٌ أخرى = ع٢، خارجَ التفويض)؛
# (٣) إعادةُ سجلِّ نواةٍ على جهازِ حلقةٍ — لا فقدُ طاقةٍ على عتاد؛ (٤) لا يُغلِقُ `LIVE-39`.
set -euo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly CHILD="${REPO_ROOT}/tests/helpers/wl-498-stage-cut-child.mjs"
readonly PROVISION_CHILD="${REPO_ROOT}/tests/helpers/wl-360-crash-child.mjs"
readonly REPLAY="${REPO_ROOT}/scripts/lib/log-writes-replay.mjs"
readonly CHECK="${REPO_ROOT}/scripts/lib/live-39-dirsync-check.mjs"
# shellcheck source=lib/live-39-judge.sh
source "${REPO_ROOT}/scripts/lib/live-39-judge.sh"
readonly WORK="${RUNNER_TEMP:-/tmp}/lw505"
readonly MNT='/mnt/lw505'
readonly DM_LOG='lw505log'
readonly SIZE_BYTES='268435456'
readonly MODES="${LIVE39_DIRSYNC_MODES:-witness mutate early}"
readonly EVIDENCE="${LIVE39_DIRSYNC_EVIDENCE:-${WORK}-evidence}"

SO_DIR="$(mktemp -d)"
readonly SO_DIR
readonly SHIM_SO="${SO_DIR}/live-39-dirsync-marks.so"
LOOPS=()
FAILURES=0
CHECKS=0

cleanup() {
  sudo umount "${MNT}" >/dev/null 2>&1 || true
  sudo dmsetup remove "${DM_LOG}" >/dev/null 2>&1 || true
  for loop in "${LOOPS[@]}"; do sudo losetup -d "${loop}" >/dev/null 2>&1 || true; done
  sudo rm -rf "${WORK}"
  rm -rf "${SO_DIR}"
}
trap cleanup EXIT
gcc -shared -fPIC -O1 -Wall -Werror -Wno-bidi-chars -Wno-format-truncation -o "${SHIM_SO}" "${REPO_ROOT}/scripts/lib/live-39-dirsync-marks.c" -ldl -lpthread
mkdir -p "${EVIDENCE}"

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
  node -e '
const { writeFileSync } = require("node:fs");
const [helper, root, dm, work, log] = process.argv.slice(1);
import(helper).then(({ makeKeys }) => {
  const base = { root, socketFile: `${work}/socket.json`, dm };
  const config = {
    keys: makeKeys(),
    ops: {
      provision: { ...base, mode: "provision", fsync: true },
      dirsync: { ...base, mode: "transact-staged", fsync: true, id: "cmd-cut", dirsyncLog: log },
      verify: { ...base, mode: "verify", socketFile: `${work}/verify-socket.json`, ids: ["cmd-cut"] },
    },
  };
  writeFileSync(`${work}/config.json`, JSON.stringify(config));
});' "${REPO_ROOT}/tests/helpers/wl-326-root.mjs" "${MNT}/root" "${DM_LOG}" "${WORK}" "$1"
}

verify_with_witness() {
  sudo rm -f "${WORK}/verify-socket.json"
  if [ -f "$1" ]; then
    cp "$1" "${WORK}/verify-socket.json"
    chmod 0666 "${WORK}/verify-socket.json"
  fi
  node "${CHILD}" "${WORK}/config.json" verify | paste -sd' '
}

fsck_clean() {
  if sudo e2fsck -fn "$1" >"${WORK}/fsck.out" 2>&1; then echo 1; else
    sed 's/^/  fsck: /' "${WORK}/fsck.out" | head -20 >&2
    echo 0
  fi
}

dirsync_case() {
  local mode="$1"
  sudo rm -rf "${WORK}" && mkdir -p "${WORK}/snaps"
  local log_file="${WORK}/dirsync.log"
  local data log
  data="$(new_loop "${WORK}/data.dev")"
  log="$(new_loop "${WORK}/log.dev")"
  sudo dmsetup create "${DM_LOG}" \
    --table "0 $(sudo blockdev --getsz "${data}") log-writes ${data} ${log}"
  sudo mkfs.ext4 -q -F -E nodiscard "/dev/mapper/${DM_LOG}"
  sudo mkdir -p "${MNT}"
  # `commit=600`: لا إيداعَ دوريٌّ لليوميّاتِ يُخفي غيابَ المزامنةِ في نافذةِ القياس (‏كما في WL-498).
  sudo mount -o commit=600 "/dev/mapper/${DM_LOG}" "${MNT}"
  sudo chmod 0777 "${MNT}"
  write_config "${log_file}"
  node "${PROVISION_CHILD}" "${WORK}/config.json" provision | grep -qx BOOTED
  sudo sync
  sudo dmsetup message "${DM_LOG}" 0 mark baseline

  # المُعلِّمُ: علامةٌ في السجلِّ ثمّ إقرارٌ في سجلِّ الحائلِ — والحائلُ ينتظرُ خروجَه.
  cat >"${WORK}/marker.sh" <<MARKER
#!/usr/bin/env bash
set -euo pipefail
sudo -n dmsetup message '${DM_LOG}' 0 mark "\$1"
echo "MARK_ACK|\$1" >>'${log_file}'
MARKER
  chmod 0755 "${WORK}/marker.sh"

  local ack
  ack="$(LIVE39_DIRSYNC_MODE="${mode}" LIVE39_DIRSYNC_LOG="${log_file}" \
    LIVE39_DIRSYNC_SNAPS="${WORK}/snaps" LIVE39_DIRSYNC_MARKER="${WORK}/marker.sh" \
    LIVE39_DIRSYNC_SCOPE="${MNT}/root" LIVE39_DIRSYNC_SOCKET="${WORK}/socket.json" \
    LD_PRELOAD="${SHIM_SO}" node "${CHILD}" "${WORK}/config.json" dirsync \
    2> >(tee "${WORK}/child.err" >&2))"
  verdict HARNESS "dirsync-${mode}/transaction" "$([ "${ack}" = ACK ] && echo 1 || echo 0)" "${ack}"
  sudo umount "${MNT}"
  sudo dmsetup remove "${DM_LOG}"
  sudo sync
  cp "${log_file}" "${EVIDENCE}/dirsync-${mode}.log"
  cp "${WORK}/child.err" "${EVIDENCE}/dirsync-${mode}.child.err"

  node "${CHECK}" list --log "${log_file}" >"${WORK}/marks.txt"
  sed "s/^/MARKS|${mode}|/" "${WORK}/marks.txt"
  local total required_seen=0 broken
  total="$(grep -c '^MARKREC|' "${WORK}/marks.txt" || true)"
  broken="$(grep -c '|broken$' "${WORK}/marks.txt" || true)"
  # الحزامُ: علاماتٌ وُضِعَت، وكلٌّ منها في موضعِه من النداءِ بحسبِ الوضع (‏تسلسلُ السجلِّ الحيّ).
  verdict HARNESS "dirsync-${mode}/marks-placed" "$([ "${total}" -ge 1 ] && echo 1 || echo 0)" "marks=${total}"
  verdict HARNESS "dirsync-${mode}/mark-order" "$([ "${broken}" -eq 0 ] && echo 1 || echo 0)" "broken=${broken}"

  # الواصفُ 3 لا `stdin`: `sudo` و`node` داخلَ الحلقةِ لا يأكلانِ قائمةَ العلامات.
  while IFS='|' read -r -u 3 _ n _ site window primary order; do
    local image="${WORK}/image.dev" loop result line primary_result all_result proto
    sudo rm -f "${image}"
    sudo truncate -s 256M "${image}"
    sudo node "${REPLAY}" --log "${log}" --image "${image}" \
      --end-mark "dirsync-${n}" --size "${SIZE_BYTES}" >/dev/null
    loop="$(sudo losetup -f --show "${image}")"
    LOOPS+=("${loop}")
    # دوامُ الاسمِ: تحميلٌ للقراءةِ (‏تُسترجَعُ اليوميّاتُ كإقلاعٍ حقيقيٍّ) وقراءةُ الأسماءِ وحدَها.
    sudo mount -o ro "${loop}" "${MNT}"
    result="$(node "${CHECK}" check --log "${log_file}" --n "${n}")"
    sudo umount "${MNT}"
    echo "${result}" | sed "s/^/${mode}|/" >>"${EVIDENCE}/dirsync-${mode}.results"
    echo "${result}" | grep '^NAME_RESULT|' | sed "s/^/  ${mode}|/"
    line="$(echo "${result}" | grep '^DIRSYNC_RESULT|')"
    primary_result="$(sed -n 's/.*|primary=\(.*\)$/\1/p' <<<"${line}")"
    all_result="$(sed -n 's/.*|all=\([^|]*\)|primary=.*/\1/p' <<<"${line}")"
    if [ "${site}" = M2 ] || [ "${site}" = M4 ]; then required_seen=$((required_seen + 1)); fi
    judge_dirsync "${mode}" "${site}" "n${n}/${window}/$(basename "${primary}")" "${primary_result}" "${all_result}"
    verdict PL4 "dirsync-${mode}/n${n}" "$(fsck_clean "${loop}")" e2fsck
    # البروتوكولُ عندَ العلامةِ نفسِها — منفصلاً وبلا حكم (‏قد يُكمِلُ B3 ما لم يَدُمِ اسمُه).
    sudo mount "${loop}" "${MNT}"
    proto="$(verify_with_witness "${WORK}/snaps/${n}.socket.json")"
    sudo umount "${MNT}"
    echo "PROTO|dirsync-${mode}/n${n}|site=${site}|name=${primary_result}|protocol=${proto}|order=${order}" |
      tee -a "${EVIDENCE}/dirsync-${mode}.results"
    drop_loop "${loop}"
  done 3< <(grep '^MARKREC|' "${WORK}/marks.txt")
  # المواضعُ المطلوبةُ حاضرةٌ في كلِّ وضع — وإلّا فحكمُ PLD2/PLD3 فارغٌ لا كشف.
  verdict HARNESS "dirsync-${mode}/required-sites" "$([ "${required_seen}" -eq 2 ] && echo 1 || echo 0)" "M2+M4=${required_seen}"
  drop_loop "${data}"
  drop_loop "${log}"
}

uname -r
for mode in ${MODES}; do dirsync_case "${mode}"; done
echo "LIVE39_DIRSYNC checks=${CHECKS} failures=${FAILURES} modes=${MODES// /,}"
if [ "${FAILURES}" -ne 0 ]; then
  echo "LIVE39_DIRSYNC_FAILED"
  exit 1
fi
echo LIVE39_DIRSYNC_DONE
