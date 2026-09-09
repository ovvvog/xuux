#!/usr/bin/env python3
# sim/channel/vsock_probe_wsl.py
#
# فحص توافر AF_VSOCK (transient, non-production, no-TPM-write diagnostic PoC).
# يعمل داخل WSL (أو أي لينكس). لا يعدّل .wslconfig ولا يلمس TPM ولا يفتح
# مستمعاً دائماً — فحص فقط، ثم خروج. أقصى عمر ذاتي للعملية: 30 ثانية.
#
# الاستخدام:
#   python3 sim/channel/vsock_probe_wsl.py [--connect-port N] [--timeout-ms N]
#
# الخرج: PROBE_RESULT {json} — verdict واحد من:
#   available              العائلة مدعومة والربط والاستماع يعملان (يتبقى إثبات التبادل مع نظير)
#   family-missing          النواة لا تدعم AF_VSOCK (socket() فشل)
#   unavailable             /dev/vsock غائب أو فشل الربط
#   + نتيجة connect اختيارية إلى CID المضيف (2) مع errno الخام.

import argparse
import errno as _errno
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vsock_lib as vs

PROBE_BIND_PORT = 60600  # منفذ مؤقت لإثبات bind/listen ثم يُغلق فوراً


def main() -> int:
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--connect-port", type=int, default=0,
                    help="إن أُعطي: محاولة اتصال بـCID المضيف (2) على هذا المنفذ")
    ap.add_argument("--timeout-ms", type=int, default=3000)
    ap.add_argument("--send-frame", action="store_true",
                    help="بعد اتصال ناجح: إرسال إطار XU واحد وانتظار الصدى (إثبات تبادل فعلي)")
    args = ap.parse_args()

    # timeout إلزامي ذاتي: لا تعيش العملية أكثر من 30 ثانية مهما كان.
    hard_deadline = time.time() + 30

    report = {
        "tool": "vsock_probe_wsl",
        "dev_vsock": os.path.exists("/dev/vsock"),
        "family_supported": None,
        "bind_listen": None,
        "connect_host": None,
        "verdict": None,
        "notes": [],
    }

    try:
        fd = vs.vsock_socket()
        report["family_supported"] = True
    except OSError as e:
        report["family_supported"] = False
        report["verdict"] = "family-missing"
        report["notes"].append("socket(AF_VSOCK): " + _errno.errorcode.get(e.errno, str(e.errno)))
        print("PROBE_RESULT " + json.dumps(report, ensure_ascii=False))
        return 0

    try:
        vs.vsock_bind(fd, PROBE_BIND_PORT, vs.VMADDR_CID_ANY)
        vs.vsock_listen(fd, 1)
        report["bind_listen"] = True
        report["notes"].append(f"bind+listen(cid=ANY,port={PROBE_BIND_PORT}) ok ثم إغلاق فوري")
    except OSError as e:
        report["bind_listen"] = False
        report["verdict"] = "unavailable"
        report["notes"].append("bind/listen: " + _errno.errorcode.get(e.errno, str(e.errno)))
    finally:
        os.close(fd)

    if args.connect_port and report["verdict"] is None:
        try:
            cfd = vs.vsock_socket()
            r = vs.vsock_connect(cfd, vs.VMADDR_CID_HOST, args.connect_port,
                                 min(args.timeout_ms, 10000))
            report["connect_host"] = {
                "cid": vs.VMADDR_CID_HOST,
                "port": args.connect_port,
                "ok": r["ok"],
                "errno": r.get("errno"),
                "so_error": r.get("so_error"),
            }
            if r["ok"] and args.send_frame:
                import select as _sel
                t0 = time.monotonic()
                f = vs.frame(b"vsock-poc-ping", 1)
                report["exchange"] = {"sent": len(f), "echo": None}
                try:
                    os.write(cfd, f)  # إطار واحد فقط (السوكيت حجوبي بعد الاتصال)
                    if _sel.select([cfd], [], [], 4.0)[0]:
                        data = os.read(cfd, vs.MAX_FRAME)
                        rtt_ms = round((time.monotonic() - t0) * 1000, 2)
                        msgs = vs.FrameFeed().push(data)
                        if msgs and msgs[0]["ok"]:
                            report["exchange"] = {
                                "sent": len(f),
                                "echo": True,
                                "counter": msgs[0]["counter"],
                                "len": len(msgs[0]["payload"]),
                                "rtt_ms": rtt_ms,
                            }
                        else:
                            report["exchange"] = {"sent": len(f), "echo": False,
                                                  "error": "NO_VALID_ECHO"}
                    else:
                        report["exchange"] = {"sent": len(f), "echo": False,
                                              "error": "ECHO_TIMEOUT"}
                except OSError as e:
                    report["exchange"] = {"sent": len(f), "echo": False,
                                          "error": _errno.errorcode.get(e.errno, str(e))}
            os.close(cfd)
        except OSError as e:
            report["connect_host"] = {"ok": False,
                                      "errno": _errno.errorcode.get(e.errno, str(e.errno)),
                                      "so_error": None}

    if report["verdict"] is None:
        report["verdict"] = "available" if report["bind_listen"] else "unavailable"
        if report["verdict"] == "available":
            report["notes"].append(
                "متاح على مستوى النواة؛ إثبات التبادل الفعلي مع نظير (مستجيب Windows) "
                "يحتاج خطوة لاحقة — لا يُدّعى قبل حدوثه."
            )

    report["self_deadline_s"] = 30
    assert time.time() < hard_deadline  # المهلة الذاتية الإلزامية
    print("PROBE_RESULT " + json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
