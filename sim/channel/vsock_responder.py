#!/usr/bin/env python3
# sim/channel/vsock_responder.py
#
# PoC تشخيصي مؤقت غير إنتاجي (transient, non-production, no-TPM-write diagnostic PoC).
# مستجيب وهمي عبر AF_VSOCK ببروتوكول قناة XU (مطابق لـtcp_responder.mjs).
#
# الضمانات المفروضة (نفس قائمة TCP):
# - timeout إلزامي: خروج تلقائي بعد --lifetime-ms (افتراضي 30 ث، حد أقصى 5 دقائق).
# - kill switch: ملف --kill-file يُنهي العملية نظيفاً؛ وSIGTERM/SIGINT كذلك.
# - تنظيف تلقائي: إغلاق كل fd وطباعة تقرير خروج.
# - حد أقصى لحجم الرسائل ورفض malformed (BAD_MAGIC/BAD_CRC/PAYLOAD_TOO_LARGE).
# - rate limiting ورفض الإعادة (رتابة counter) لكل اتصال.
# - مهلة خمول 10 ث لكل اتصال.
# - لا TPM إطفالاً: يرفض الإقلاع إن ضُبط TPM2TOOLS_TCTI على غير محاكٍ.
# - لا خدمة دائمة ولا قاعدة Firewall — عملية أمامية تنتهي وحدها.
#
# ملاحظة: للاتصال من WSL إلى مستجيب Windows عبر hvsocket، المنفذ هنا يطابق
# ServiceId = <port-hex>-facb-11e6-bd58-64006a7986d3 على جانب Windows.

import argparse
import errno as _errno
import json
import os
import select
import signal
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vsock_lib as vs


def refuse_real_tcti():
    tcti = os.environ.get("TPM2TOOLS_TCTI", "")
    if tcti and not (tcti.startswith("swtpm:") or tcti.startswith("mssim:")):
        print(
            'REFUSED: TPM2TOOLS_TCTI="' + tcti + '" — هذه أداة قناة تشخيصية لا تلمس TPM. '
            "ارفع المتغير أو اضبطه على محاكٍ.",
            file=sys.stderr,
        )
        sys.exit(3)


class Conn:
    def __init__(self, fd):
        self.fd = fd
        self.feed = vs.FrameFeed()
        self.last_counter = 0
        self.rate_window_start = time.monotonic()
        self.rate_count = 0
        self.last_active = time.monotonic()


def main() -> int:
    refuse_real_tcti()
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--port", type=int, required=True, help="vsock port (required)")
    ap.add_argument("--lifetime-ms", type=int, default=30000,
                    help="timeout إلزامي: خروج تلقائي (افتراضي 30000، حد أقصى 600000)")
    ap.add_argument("--kill-file", default=None,
                    help="مسار ملف القتل (افتراضي /tmp/xuux-poc-vsock-kill-<port>)")
    ap.add_argument("--rate-limit", type=int, default=100,
                    help="أقصى رسائل لكل اتصال في الثانية")
    args = ap.parse_args()

    if not (0 < args.port <= 0x7FFFFFFF):
        print("--port يجب أن يكون بين 1 و2147483647", file=sys.stderr)
        return 2
    if not (0 < args.lifetime_ms <= 600000):
        print("--lifetime-ms يجب أن يكون بين 1 و600000 (timeout إلزامي)", file=sys.stderr)
        return 2
    if args.rate_limit <= 0:
        print("--rate-limit يجب أن يكون موجباً", file=sys.stderr)
        return 2

    kill_file = args.kill_file or f"/tmp/xuux-poc-vsock-kill-{args.port}"

    stats = {
        "tool": "vsock_responder",
        "port": args.port,
        "lifetime_ms": args.lifetime_ms,
        "rate_limit_per_s": args.rate_limit,
        "connections": 0,
        "messages_ok": 0,
        "rejected": {},
        "exit_reason": None,
    }
    started = time.monotonic()
    conns = {}
    listener = None
    running = {"stop": False, "reason": None}

    def reject(key):
        stats["rejected"][key] = stats["rejected"].get(key, 0) + 1

    def close_conn(fd):
        c = conns.pop(fd, None)
        try:
            os.close(fd)
        except OSError:
            pass

    def shutdown(reason):
        running["stop"] = True
        running["reason"] = reason

    def on_signal(_sig, _frm):
        shutdown("signal")

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)

    try:
        listener = vs.vsock_socket()
        vs.vsock_bind(listener, args.port, vs.VMADDR_CID_ANY)
        vs.vsock_listen(listener, 8)
        vs.set_nonblocking(listener)
    except OSError as e:
        stats["exit_reason"] = "bind-failed"
        stats["bind_errno"] = _errno.errorcode.get(e.errno, str(e.errno))
        print("POC_EXIT " + json.dumps(stats, ensure_ascii=False))
        return 5

    print(
        "POC_READY "
        + json.dumps(
            {
                "tool": "vsock_responder",
                "cid": "ANY",
                "port": args.port,
                "lifetime_ms": args.lifetime_ms,
                "kill_file": kill_file,
                "protocol": "XU-frame/vsock",
                "max_payload": vs.MAX_PAYLOAD,
                "tpm": "none (no-TPM-write diagnostic PoC)",
            },
            ensure_ascii=False,
        ),
        flush=True,
    )

    deadline = started + args.lifetime_ms / 1000.0

    while not running["stop"]:
        now = time.monotonic()
        if now >= deadline:
            shutdown("lifetime")
            break
        if os.path.exists(kill_file):
            shutdown("kill-file")
            break

        rlist = [listener] + list(conns.keys())
        try:
            readable, _, _ = select.select(rlist, [], [], 0.25)
        except InterruptedError:
            continue

        for fd in readable:
            if fd == listener:
                try:
                    cfd = os.accept(listener)[0]
                except (BlockingIOError, InterruptedError):
                    continue
                except OSError as e:
                    shutdown("accept-error:" + _errno.errorcode.get(e.errno, str(e.errno)))
                    break
                stats["connections"] += 1
                vs.set_nonblocking(cfd)
                conns[cfd] = Conn(cfd)
            else:
                c = conns.get(fd)
                if c is None:
                    continue
                try:
                    chunk = os.read(fd, 65536)
                except BlockingIOError:
                    continue
                except OSError:
                    close_conn(fd)
                    continue
                if not chunk:
                    close_conn(fd)
                    continue
                c.last_active = time.monotonic()
                try:
                    msgs = c.feed.push(chunk)
                except ValueError as e:
                    key = "OVERSIZE" if str(e) == "PAYLOAD_TOO_LARGE" else "MALFORMED"
                    reject(key)
                    close_conn(fd)
                    continue
                for m in msgs:
                    # rate limiting لكل اتصال
                    t = time.monotonic()
                    if t - c.rate_window_start >= 1.0:
                        c.rate_window_start = t
                        c.rate_count = 0
                    if c.rate_count >= args.rate_limit:
                        reject("RATE_LIMITED")
                        close_conn(fd)
                        break
                    # رفض الإعادة: رتابة counter
                    if m["counter"] <= c.last_counter:
                        reject("REPLAY")
                        close_conn(fd)
                        break
                    c.rate_count += 1
                    c.last_counter = m["counter"]
                    stats["messages_ok"] += 1
                    reply = (
                        f"diag:ok:counter={m['counter']}:len={len(m['payload'])}:no-tpm"
                    ).encode()
                    try:
                        os.write(fd, vs.frame(reply, m["counter"]))
                    except OSError:
                        close_conn(fd)
                        break

        # مهلة خمول 10 ث لكل اتصال
        for fd in [f for f, c in conns.items() if time.monotonic() - c.last_active > 10]:
            close_conn(fd)

    # تنظيف تلقائي كامل
    for fd in list(conns.keys()):
        close_conn(fd)
    if listener is not None:
        try:
            os.close(listener)
        except OSError:
            pass
    if running["reason"] == "kill-file" and os.path.exists(kill_file):
        try:
            os.unlink(kill_file)
        except OSError:
            pass
    stats["exit_reason"] = running["reason"]
    stats["duration_ms"] = int((time.monotonic() - started) * 1000)
    print("POC_EXIT " + json.dumps(stats, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
