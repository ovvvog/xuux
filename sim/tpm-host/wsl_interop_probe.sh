#!/usr/bin/env bash
# sim/tpm-host/wsl_interop_probe.sh
#
# WL-510 — فحصُ قناةِ التشغيلِ البينيِّ في WSL (‏قرائيٌّ فقط). التصميم:
# docs/adr/0007-annex-f-windows11-tbs-qualification.md §5 (الفحص W-R4).
#
# يقرأ داخلَ توزيعةِ WSL فقط:
#   1. إصدارَ النواة (‏uname -r) وهل هي نواةُ WSL.
#   2. هل مُعالِجُ binfmt `WSLInterop` (أو `WSLInterop-late`) مسجَّلٌ ومُفعَّل.
#   3. قيمةَ `[interop] enabled` في /etc/wsl.conf إن وُجدت (‏الافتراضيُّ true).
#   4. هل متغيّرُ WSL_INTEROP موجود (‏دونَ طباعةِ قيمتِه).
#   5. هل powershell.exe قابلٌ للحلِّ على PATH (‏command -v دونَ تشغيلِه).
#
# لا يشغّلُ أيَّ برنامجِ Windows، ولا يكتبُ إلّا ملفَّ JSON واحدًا في المجلّدِ المعطى (‏الافتراضيُّ الحالي)،
# ولا يلمسُ /dev/tpm* ولا يرسلُ أيَّ أمرِ TPM. **هذا لا يُثبتُ أنّ القناةَ تنقلُ أوامرَ TPM** — ذلك الفحصُ
# W-R5 (‏تشغيلُ أداةِ الجردِ القرائيّةِ عبرَ القناةِ ومقارنةُ ناتجِها)، وهو خطوةٌ منفصلة.
#
#   bash sim/tpm-host/wsl_interop_probe.sh [OUT_DIR]
#
# خروج: 0 مكتمل · 1 جزئيّ · 2 ليس WSL · 4 عطلٌ في الأداة.

set -u

out_dir="${1:-$PWD}"
[ -d "$out_dir" ] || { echo "TOOL_FAILURE: out dir does not exist" >&2; exit 4; }

kernel="$(uname -r 2>/dev/null || true)"
case "$kernel" in
  *microsoft*|*Microsoft*|*WSL*) ;;
  *) echo "NOT_WSL: no read, no substitute" >&2; exit 2 ;;
esac

json_str() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

errors=()
binfmt_name=null
binfmt_enabled=null
for n in WSLInterop WSLInterop-late; do
  f="/proc/sys/fs/binfmt_misc/$n"
  if [ -r "$f" ]; then
    binfmt_name="\"$n\""
    if head -n 1 "$f" 2>/dev/null | grep -qx 'enabled'; then binfmt_enabled=true; else binfmt_enabled=false; fi
    break
  fi
done
[ "$binfmt_name" = null ] && errors+=("BINFMT_INTEROP_ABSENT")

conf_interop=null
if [ -r /etc/wsl.conf ]; then
  v="$(awk 'BEGIN{s=""} /^[[:space:]]*\[/{s=tolower($0); gsub(/[[:space:]]/,"",s)} s=="[interop]" && tolower($0) ~ /^[[:space:]]*enabled[[:space:]]*=/ {sub(/^[^=]*=[[:space:]]*/,""); sub(/[[:space:]#].*$/,""); print tolower($0); exit}' /etc/wsl.conf)"
  case "$v" in true) conf_interop=true ;; false) conf_interop=false ;; "") conf_interop=null ;; *) conf_interop="\"$(json_str "$v")\"" ;; esac
fi

interop_env=false
[ -n "${WSL_INTEROP:-}" ] && interop_env=true

ps_resolvable=false
command -v powershell.exe >/dev/null 2>&1 && ps_resolvable=true

status=COMPLETE
[ ${#errors[@]} -gt 0 ] && status=PARTIAL
err_json=""
for e in "${errors[@]+"${errors[@]}"}"; do err_json="${err_json:+$err_json,}\"$e\""; done

ts="$(date -u +%Y%m%dT%H%M%SZ)"
file="$out_dir/wsl-interop-$ts.json"
cat >"$file" <<EOF
{
  "schema": "xuux.wsl-interop/1",
  "readOnly": true,
  "windowsProcessesStarted": 0,
  "tpmCommandsSent": 0,
  "capturedUtc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "status": "$status",
  "errors": [${err_json}],
  "kernelRelease": "$(json_str "$kernel")",
  "binfmt": { "name": $binfmt_name, "enabled": $binfmt_enabled },
  "wslConfInteropEnabled": $conf_interop,
  "wslInteropEnvPresent": $interop_env,
  "powershellResolvable": $ps_resolvable,
  "note": "channel availability only; not evidence that TPM commands traverse the channel intact"
}
EOF
echo "$file"
echo "sha256=$(sha256sum "$file" | cut -d' ' -f1)"
[ "$status" = COMPLETE ] && exit 0 || exit 1
