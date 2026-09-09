#!/usr/bin/env bash
# sim/channel/wsl_cleanup_verify.sh
#
# PoC تشخيصي مؤقت غير إنتاجي — أمر تحقق مستقل بعد كل خطوة قناة داخل WSL.
# يثبت عدم بقاء: مستمع على منافذ PoC، عملية أدوات PoC، أو ملفات kill متبقية.
# للقراءة فقط — لا يغيّر شيئاً ولا يلمس TPM.
#
# الاستخدام:  bash sim/channel/wsl_cleanup_verify.sh [tcp_port [vsock_port]]

set -u
TCP_PORT="${1:-47849}"
VSOCK_PORT="${2:-60601}"
CLEAN=1

echo "CLEANUP_VERIFY (WSL side)"

# 1) مستمع TCP متبقٍّ؟
LISTENERS=$(ss -tlnp 2>/dev/null | grep -E ":${TCP_PORT} " || true)
if [ -n "$LISTENERS" ]; then
  echo "listeners: STILL LISTENING: $LISTENERS"; CLEAN=0
else
  echo "listeners: port ${TCP_PORT}: no listener"
fi

# 2) عمليات أدوات PoC متبقية؟
PROCS=$(pgrep -af 'tcp_responder|tcp_probe|vsock_responder|vsock_probe' || true)
if [ -n "$PROCS" ]; then
  echo "poc_processes: STILL RUNNING:"; echo "$PROCS"; CLEAN=0
else
  echo "poc_processes: none"
fi

# 3) ملفات kill متبقية؟
for f in "/tmp/xuux-poc-tcp-kill-${TCP_PORT}" "/tmp/xuux-poc-vsock-kill-${VSOCK_PORT}"; do
  if [ -e "$f" ]; then echo "kill_files: STILL PRESENT: $f"; CLEAN=0
  else echo "kill_files: $f absent"; fi
done

# 4) لا قاعدة iptables أُنشئت من قبلنا أصلاً (لا ننشئ أي قواعد — توثيق فقط)
echo "firewall: أدوات PoC لا تنشئ قواعد iptables أصلاً (توثيق)"

if [ "$CLEAN" -eq 1 ]; then
  echo "CLEAN: لا مستمع ولا عملية ولا ملف kill متبقٍّ في WSL."
  exit 0
else
  echo "NOT CLEAN: انظر الأعلى."
  exit 1
fi
