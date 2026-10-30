# shellcheck shell=bash
# scripts/lib/live-39-judge.sh — دوالُّ الحكمِ لقياسِ `LIVE-39` المرحليِّ (‏`WL-498`، فُصِلَت في `WL-499`).
#
# **لماذا ملفٌّ مستقلٌّ:** الحكمُ هو ما يجعلُ خطوةَ CI قياساً لا عرضاً. فصلُهُ عن الأجهزةِ
# (‏`dmsetup`/`losetup`/`sudo`) يتيحُ اختبارَهُ بلا نواةٍ في `tests/tooling/live-39-judge.test.mjs`:
# كلُّ نتيجةٍ مخالفةٍ للضمانِ يجبُ أن تُسقِطَ، والسليمةُ وحدَها تنجحُ.
#
# الواجهةُ: يُستدعى بعدَ ضبطِ `CHECKS=0` و`FAILURES=0`؛ كلُّ حكمٍ يطبعُ `PASS|…` أو `FAIL|…`
# ويزيدُ العدّادَين. لا يُنهي العمليّةَ — المُستدعي يحكمُ على `FAILURES` في آخرِهِ.

# `verdict <guarantee> <label> <ok:0|1> <detail>`
verdict() {
  CHECKS=$((CHECKS + 1))
  if [ "$3" = 1 ]; then
    echo "PASS|$1|$2|$4"
  else
    echo "FAIL|$1|$2|$4"
    FAILURES=$((FAILURES + 1))
  fi
}

# رفضُ إقلاعٍ برمزٍ مسمّى (‏لا `UNNAMED` ولا رمزٌ فارغٌ).
named_refusal() {
  [[ "$1" =~ ^BOOT_REFUSED:[A-Z][A-Z0-9_]+$ && "$1" != 'BOOT_REFUSED:UNNAMED' ]]
}

# `judge_witness <label> <snapshot-path>` — HARNESS: لقطةُ المرجعِ الخارجيِّ عندَ العلامةِ موجودةٌ.
# غيابُها **سقوطٌ** (‏كانَ في `WL-498` ملاحظةً `NOTE` لا تُسقِطُ): بلا لقطةٍ يُقلِعُ التحقّقُ بلا
# مرجعٍ فيُقاسُ غيرُ ما يُدَّعى قياسُه.
judge_witness() {
  local ok=0
  [ -f "$2" ] && ok=1
  verdict HARNESS "$1/witness-snapshot" "${ok}" "$2"
}

# `judge_cut <iteration> <stage> <witness-stage> <outcome>` — الشاهدُ الإيجابيُّ (‏`fsync:true`).
#   PL1 القطعُ عندَ S5/ACK ⇐ `committed`.
#   PL2 القطعُ عندَ S2/S3 والمرجعُ لم يتقدّمْ ⇐ `unknown`.
#   PL3 المرجعُ متقدّمٌ على القرصِ ⇐ `committed` أو رفضٌ مسمّى.
judge_cut() {
  local label="iter$1/cut@$2/witness@$3" outcome="$4" ok
  echo "OUTCOME|${label}|${outcome}"
  case "$2:$3" in
    S5:* | ACK:*)
      [[ "${outcome}" == 'BOOT_OK STATE:cmd-cut=committed' ]] && ok=1 || ok=0
      verdict PL1 "${label}" "${ok}" "${outcome}" ;;
    S2:S2 | S3:S3)
      [[ "${outcome}" == 'BOOT_OK STATE:cmd-cut=unknown' ]] && ok=1 || ok=0
      verdict PL2 "${label}" "${ok}" "${outcome}" ;;
    *)
      if [[ "${outcome}" == 'BOOT_OK STATE:cmd-cut=committed' ]] || named_refusal "${outcome}"; then
        ok=1
      else ok=0; fi
      verdict PL3 "${label}" "${ok}" "${outcome}" ;;
  esac
}

# `judge_negative <stage> <witness-stage> <outcome>` — الشاهدُ السلبيُّ (‏`fsync:false`).
#   PLN1 المرجعُ لم يتقدّمْ (‏لقطةُ S2/S3) ⇐ `unknown`.
#   PLN2 المرجعُ متقدّمٌ والقرصُ أقدمُ ⇐ رفضٌ مسمّى؛ `committed` هنا قياسٌ أعمى و`unknown` قبولٌ
#        صامتٌ لاسترجاعٍ (‏rollback).
judge_negative() {
  local label="nofsync/cut@$1/witness@$2" outcome="$3" ok
  echo "OUTCOME|${label}|${outcome}"
  case "$2" in
    S2 | S3)
      [[ "${outcome}" == 'BOOT_OK STATE:cmd-cut=unknown' ]] && ok=1 || ok=0
      verdict PLN1 "${label}" "${ok}" "${outcome}" ;;
    *)
      named_refusal "${outcome}" && ok=1 || ok=0
      verdict PLN2 "${label}" "${ok}" "${outcome}" ;;
  esac
}

# `judge_eio_ack <stage> <result>` — PL5: لا إقرارَ معَ خطأِ كتابةٍ، والرمزُ مسمّى.
judge_eio_ack() {
  local ok
  echo "OUTCOME|eio@$1/transaction|$2"
  if [[ "$2" =~ ^NO_ACK:[A-Za-z][A-Za-z0-9_]+$ && "$2" != 'NO_ACK:UNNAMED' ]]; then ok=1; else ok=0; fi
  verdict PL5 "eio@$1/no-ack" "${ok}" "$2"
}

# `judge_eio_reboot <stage> <outcome>` — PL5 بعدَ إعادةِ التحميلِ: `unknown`، أو `committed` إن بدأَ
# الخطأُ بعدَ S2 (‏المرجعُ قد يكونُ تقدّمَ والبياناتُ دائمةٌ)، أو رفضٌ مسمّى.
judge_eio_reboot() {
  local ok
  echo "OUTCOME|eio@$1/reboot|$2"
  if [[ "$2" == 'BOOT_OK STATE:cmd-cut=unknown' ]] ||
    [[ "$1" != S2 && "$2" == 'BOOT_OK STATE:cmd-cut=committed' ]] ||
    named_refusal "$2"; then
    ok=1
  else ok=0; fi
  verdict PL5 "eio@$1/reboot" "${ok}" "$2"
}
