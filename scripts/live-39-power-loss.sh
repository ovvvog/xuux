#!/usr/bin/env bash
# LIVE-39 — قياسُ فقدِ الطاقةِ على المسارِ الإنتاجيِّ الحقيقيِّ (WL-360).
#
# **ما يقيسُهُ:** ضمانَ `D3` (لا إقرارَ قبلَ الدوامِ) أمامَ فقدِ طاقةٍ لا أمامَ `SIGKILL`
# وحدهُ (‏يُبقي ذاكرةَ الصفحاتِ). النواةُ تُسجِّلُ على `dm-log-writes` ما نجا من ذاكرةِ
# الجهازِ عندَ `FLUSH` — «أسوأُ حالةٍ ممكنةٍ تجاهَ فقدِ الطاقةِ» بحرفِ توثيقِها — فإعادةُ
# تشغيلِ السجلِّ حتّى علامةِ القطعِ تُنتِجُ صورةَ القرصِ عندَها.
#
# **القطعُ مربوطٌ بالإقرارِ لا بعدهُ:** العمليّةُ الفرعيّةُ (`tests/helpers/wl-360-crash-child.mjs`)
# تضعُ العلامةَ داخلَ حاجزِ الالتزامِ عندَ مرحلةِ `ACK` — بعدَ اكتمالِ دوامِ المعاملةِ
# (‏S2–S5) وقبلَ عودتِها للمُستدعي.
#
# **الشهودُ اثنانِ:**
#   - الإيجابيّ: معاملةٌ بـ`fsync:true` ⇐ بعدَ القطعِ عندَ علامتِها، الإقرارُ **باقٍ**
#     (`STATE:committed`) والإقلاعُ منَ الصورةِ نظيفٌ.
#   - السلبيّ: معاملةٌ بـ`fsync:false` (‏متغيّرُ اختبارٍ لا مسَّ بالإنتاجِ) ⇐ بعدَ القطعِ
#     عندَ علامتِها، الإقرارُ **ساقطٌ** (`STATE:unknown`) — فلو نجتِ المعاملةُ الغيرُ
#     مُزامَنةٍ لكانَ القياسُ أعمى ولسقطَ السلبيُّ بنفسِهِ.
#
# **نموذجُ الانهيارِ معلَنٌ:** `commit=600` يُقلّلُ ضجيجَ مجلةِ `ext4` الخلفيَّ فقطَ —
# حواجزُ الدوامِ كما هي، والقرصُ المُختبرُ `ext4` فوقَ جهازٍ حقيقيٍّ.
#
# **حدٌّ معلَنٌ:** مرجعُ الحداثةِ (`FileStateBoundSocket`) خارجَ القرصِ المُختبرِ عمداً
# (‏عونُ `WL-326`)، ولقطةُ منقولةٌ محصَّنةٌ (‏للقراءةِ فقطِ) عندَ حدِّ القطعِ تُستعمَلُ
# للتحقّقِ كمرجعٍ مُثبَّتٍ — عزلٌ لدوامِ ملفاتِ الجذرِ عن تغيُّراتِ المرجعِ الذاتيّةِ
# (ضربٌ منَ الإقلاعِ من فورةِ ذاكرةٍ محفوظةٍ عندَ حدِّ القطعِ، لا إعادةُ بناءٍ كاملةٍ
# لحالةِ الجهازِ عندَ فقدِ طاقةٍ) — فتقدُّمُهُ الذاتيُّ الدائمُ خارجَ الصورةِ ليسَ موضوعَ
# القياسِ هنا. وهذا قياسُ **دوامِ ملفاتِ الجذرِ** على جهازِ حلقةٍ في عدّاءٍ مستضافٍ —
# لا فقدُ طاقةٍ فعليٌّ ولا برهانُ TPM/HSM ولا جاهزيّةُ إنتاجٍ (وهذا نصٌّ في `WL-360`).
set -euo pipefail

readonly NAME='lw39'
readonly MNT='/mnt/lw39'
readonly SIZE_BYTES='268435456'
readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly CHILD="${REPO_ROOT}/tests/helpers/wl-360-crash-child.mjs"
readonly CONFIG="${RUNNER_TEMP:-/tmp}/lw39-config.json"
readonly SOCKET="${RUNNER_TEMP:-/tmp}/lw39-socket.json"
readonly SOCKET_SNAPSHOT="${RUNNER_TEMP:-/tmp}/lw39-socket-snapshot.json"

cleanup() {
  sudo umount "${MNT}" >/dev/null 2>&1 || true
  sudo dmsetup remove "${NAME}" >/dev/null 2>&1 || true
  # تحييدٌ محصورٌ: لا `losetup -D` الشاملةُ — أجهزةُ الحلقةِ التي أنشأها هذا
  # السكربتُ وحدَها تُفصَلُ (‏`sudo losetup -d` على كلِّ مقبضٍ؛ و`sudo losetup -D`
  # كانت تفصلُ أجهزةَ العدّاءِ كلَّها فتضرُّ بمساراتِ عملٍ أخرى).
  for loop in "${LOOP_DATA:-}" "${LOOP_LOG:-}" "${LOOP_POS:-}" "${LOOP_NEG:-}"; do
    if [ -n "${loop}" ]; then sudo losetup -d "${loop}" >/dev/null 2>&1 || true; fi
  done
  rm -f "${CONFIG}" "${SOCKET}" "${SOCKET_SNAPSHOT}" \
    "${RUNNER_TEMP:-/tmp}/lw39-data.dev" "${RUNNER_TEMP:-/tmp}/lw39-log.dev" \
    "${RUNNER_TEMP:-/tmp}/lw39-image-pos.dev" "${RUNNER_TEMP:-/tmp}/lw39-image-neg.dev"
}
trap cleanup EXIT

# ══ الجهازُ: ext4 حقيقيّةٌ فوقَ dm-log-writes ══
sudo truncate -s 256M "${RUNNER_TEMP:-/tmp}/lw39-data.dev"
sudo truncate -s 256M "${RUNNER_TEMP:-/tmp}/lw39-log.dev"
LOOP_DATA="$(sudo losetup -f --show "${RUNNER_TEMP:-/tmp}/lw39-data.dev")"
LOOP_LOG="$(sudo losetup -f --show "${RUNNER_TEMP:-/tmp}/lw39-log.dev")"
sudo dmsetup create "${NAME}" \
  --table "0 $(sudo blockdev --getsz "${LOOP_DATA}") log-writes ${LOOP_DATA} ${LOOP_LOG}"
sudo mkfs.ext4 -F -E nodiscard "/dev/mapper/${NAME}"
sudo mkdir -p "${MNT}"
sudo mount -o commit=600 "/dev/mapper/${NAME}" "${MNT}"
sudo chmod 0777 "${MNT}"

# ══ المفاتيحُ والإعدادُ (‏عونُ WL-326 نفسُهُ) ══
node -e '
const { writeFileSync } = require("node:fs");
import(process.argv[1]).then(({ makeKeys }) => {
  const keys = makeKeys();
  const temp = process.env.RUNNER_TEMP || "/tmp";
  const config = {
    keys,
    ops: {
      provision: { mode: "provision", root: process.argv[2], socketFile: `${temp}/lw39-socket.json`, fsync: true, dm: process.argv[3] },
      "transact-pos": { mode: "transact", root: process.argv[2], socketFile: `${temp}/lw39-socket.json`, fsync: true, id: "cmd-pos", mark: "ack-pos", dm: process.argv[3] },
      "transact-neg": { mode: "transact", root: process.argv[2], socketFile: `${temp}/lw39-socket.json`, fsync: false, id: "cmd-neg", mark: "ack-neg", dm: process.argv[3] },
      "verify-pos": { mode: "verify", root: process.argv[2], socketFile: `${temp}/lw39-socket-snapshot.json`, id: "cmd-pos", fsync: true, dm: process.argv[3] },
      "verify-neg": { mode: "verify", root: process.argv[2], socketFile: `${temp}/lw39-socket-snapshot.json`, ids: ["cmd-neg", "cmd-pos"], fsync: true, dm: process.argv[3] },
    },
  };
  writeFileSync(`${temp}/lw39-config.json`, JSON.stringify(config));
});' "${REPO_ROOT}/tests/helpers/wl-326-root.mjs" "${MNT}/root" "${NAME}"

# ══ المرحلةُ 1: إقلاعٌ متينٌ (‏خطُّ الأساسِ) ══
node "${CHILD}" "${CONFIG}" provision | tee /dev/stderr | grep -qx BOOTED
sudo sync
sudo dmsetup message "${NAME}" 0 mark baseline

# ══ المرحلةُ 2: معاملةٌ مُزامَنةٌ (الشاهدُ الإيجابيُّ) ══
node "${CHILD}" "${CONFIG}" transact-pos | tee /dev/stderr | grep -qx ACK

# لقطةُ المرجعِ عندَ حدِّ القطعِ (قبلَ السلبيِّ): العلامةُ والصورةُ تتحاكمان معاً.
cp "${SOCKET}" "${SOCKET_SNAPSHOT}"
# لقطةُ المرجعِ مُثبَّتةٌ لعزلِ دوامِ ملفاتِ الجذرِ عن تغيُّراتِهِ الذاتيّةِ الدائمةِ
# (ضربٌ منَ الإقلاعِ من فورةِ ذاكرةٍ محفوظةٍ عندَ حدِّ القطعِ، لا إعادةُ بناءٍ كاملةٍ
# لحالةِ الجهازِ عندَ فقدِ طاقةٍ). نسخةٌ للقراءةِ فقطِ فلا يعدّلها تحقّقٌ.
chmod 0444 "${SOCKET_SNAPSHOT}"

# ══ المرحلةُ 3: معاملةٌ غيرُ مُزامَنةٍ (الشاهدُ السلبيُّ) ══
node "${CHILD}" "${CONFIG}" transact-neg | tee /dev/stderr | grep -qx ACK

# ══ القطعُ: فقدُ الطاقةِ (كلُّ ما بعدَ العلامةِ وكلُّ ما لم يُفلَش يسقُطُ) ══
sudo umount "${MNT}"
sudo dmsetup remove "${NAME}"
sudo sync

# ══ إعادةُ التشغيلِ إلى علامةِ الإيجابيِّ والتحققُ ══
sudo truncate -s 256M "${RUNNER_TEMP:-/tmp}/lw39-image-pos.dev"
sudo node "${REPO_ROOT}/scripts/lib/log-writes-replay.mjs" \
  --log "${LOOP_LOG}" --image "${RUNNER_TEMP:-/tmp}/lw39-image-pos.dev" \
  --end-mark ack-pos --size "${SIZE_BYTES}"
LOOP_POS="$(sudo losetup -f --show "${RUNNER_TEMP:-/tmp}/lw39-image-pos.dev")"
# الصورةُ تُحمَّلُ في MNT نفسِها: بصمةُ الحالةِ تُحسَبُ من المساراتِ المطلقةِ، فالإقلاعُ
# من مسارٍ آخرَ يُكسِرُ المطابقةَ بلا علاقةٍ بالدوامِ (قِيسَ في 37967226716).
sudo mount "${LOOP_POS}" "${MNT}"
POSITIVE_OUT="$(node "${CHILD}" "${CONFIG}" verify-pos)"
echo "${POSITIVE_OUT}"
echo "${POSITIVE_OUT}" | grep -qx BOOT_OK
echo "${POSITIVE_OUT}" | grep -qx 'STATE:cmd-pos=committed'
sudo umount "${MNT}"
sudo losetup -d "${LOOP_POS}"
echo LIVE39_POSITIVE_OK

# ══ إعادةُ التشغيلِ إلى علامةِ السلبيِّ والتحققُ ══
sudo truncate -s 256M "${RUNNER_TEMP:-/tmp}/lw39-image-neg.dev"
sudo node "${REPO_ROOT}/scripts/lib/log-writes-replay.mjs" \
  --log "${LOOP_LOG}" --image "${RUNNER_TEMP:-/tmp}/lw39-image-neg.dev" \
  --end-mark ack-neg --size "${SIZE_BYTES}"
LOOP_NEG="$(sudo losetup -f --show "${RUNNER_TEMP:-/tmp}/lw39-image-neg.dev")"
sudo mount "${LOOP_NEG}" "${MNT}"
NEGATIVE_OUT="$(node "${CHILD}" "${CONFIG}" verify-neg)"
echo "${NEGATIVE_OUT}"
# الشاهدُ السلبيُّ حسّاسٌ: الإقرارُ الغيرُ مُزامَنِ ساقطٌ، والإقلاعُ منَ الصورةِ نظيفٌ.
echo "${NEGATIVE_OUT}" | grep -qx BOOT_OK
echo "${NEGATIVE_OUT}" | grep -qx 'STATE:cmd-neg=unknown'
echo "${NEGATIVE_OUT}" | grep -qx 'STATE:cmd-pos=committed'
sudo umount "${MNT}"
sudo losetup -d "${LOOP_NEG}"
echo LIVE39_NEGATIVE_OK
echo LIVE39_DONE
