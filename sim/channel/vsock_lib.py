#!/usr/bin/env python3
# sim/channel/vsock_lib.py
#
# مكتبة مشتركة لأدوات AF_VSOCK (transient, non-production, no-TPM-write diagnostic PoC).
# - تأطير XU مطابق بايتاً-بايتاً لـsim/tpm/channel_protocol.mjs (magic/counter/len/crc16).
# - إدارة AF_VSOCK عبر ctypes مباشرة (تعمل حتى لو لم تُبنَ وحدة socket بثابت AF_VSOCK).
# لا sockets TCP ولا TPM هنا — عائلة vsock فقط.

import ctypes
import ctypes.util
import errno as _errno
import os

# ---------------------------------------------------------------- التأطير (مطابق للنسخة node)

MAGIC = 0x5855            # 'XU'
HEADER_LEN = 14           # 2 + 8 + 4
CRC_LEN = 2
MAX_PAYLOAD = 65536
MAX_FRAME = HEADER_LEN + MAX_PAYLOAD + CRC_LEN


def crc16(data: bytes) -> int:
    """crc16-ccitt (0x1021, init 0xFFFF) — مطابق للنسخة node."""
    crc = 0xFFFF
    for b in data:
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc & 0xFFFF


def frame(payload: bytes, counter: int) -> bytes:
    """يؤطّر حمولة بـcounter. يرفض الحمولات الكبيرة (PAYLOAD_TOO_LARGE)."""
    if not isinstance(payload, (bytes, bytearray)):
        payload = payload.encode()
    payload = bytes(payload)
    if len(payload) > MAX_PAYLOAD:
        raise ValueError("PAYLOAD_TOO_LARGE")
    hdr = (
        MAGIC.to_bytes(2, "big")
        + counter.to_bytes(8, "big")
        + len(payload).to_bytes(4, "big")
    )
    return hdr + payload + crc16(hdr + payload).to_bytes(2, "big")


def parse_message(buf: bytes) -> dict:
    """يحلل رسالة كاملة. يتحقق من magic وcrc والحد الأقصى (نفس أخطاء النسخة node)."""
    if not isinstance(buf, (bytes, bytearray)):
        return {"ok": False, "error": "TOO_SHORT"}
    buf = bytes(buf)
    if len(buf) < HEADER_LEN + CRC_LEN:
        return {"ok": False, "error": "TOO_SHORT"}
    if int.from_bytes(buf[0:2], "big") != MAGIC:
        return {"ok": False, "error": "BAD_MAGIC"}
    ln = int.from_bytes(buf[10:14], "big")
    if ln > MAX_PAYLOAD:
        return {"ok": False, "error": "PAYLOAD_TOO_LARGE"}
    if len(buf) < HEADER_LEN + ln + CRC_LEN:
        return {"ok": False, "error": "INCOMPLETE"}
    payload = buf[HEADER_LEN : HEADER_LEN + ln]
    crc = int.from_bytes(buf[HEADER_LEN + ln : HEADER_LEN + ln + CRC_LEN], "big")
    if crc != crc16(buf[: HEADER_LEN + ln]):
        return {"ok": False, "error": "BAD_CRC"}
    return {
        "ok": True,
        "counter": int.from_bytes(buf[2:10], "big"),
        "payload": payload,
        "total_len": HEADER_LEN + ln + CRC_LEN,
    }


class FrameFeed:
    """محلّل تدفّق: يراكم البايتات ويُخرج رسائل كاملة (مطابق لـnode FrameFeed)."""

    def __init__(self):
        self.buf = bytearray()

    def push(self, chunk: bytes):
        self.buf += chunk
        msgs = []
        while True:
            if len(self.buf) < HEADER_LEN:
                break
            ln = int.from_bytes(self.buf[10:14], "big")
            if ln > MAX_PAYLOAD:
                self.buf = bytearray()
                raise ValueError("PAYLOAD_TOO_LARGE")
            total = HEADER_LEN + ln + CRC_LEN
            if len(self.buf) < total:
                break
            m = parse_message(bytes(self.buf[:total]))
            if not m["ok"]:
                self.buf = bytearray()
                raise ValueError("PARSE_ERROR:" + m["error"])
            msgs.append(m)
            self.buf = self.buf[total:]
        return msgs


# ---------------------------------------------------------------- AF_VSOCK عبر ctypes

AF_VSOCK = 40
SOCK_STREAM = 1
VMADDR_CID_ANY = 0xFFFFFFFF   # -1U: الربط بأي CID محلي
VMADDR_CID_HOST = 2           # CID المضيف (Windows في حالة WSL2)

_libc = None


def _get_libc():
    global _libc
    if _libc is None:
        _libc = ctypes.CDLL(ctypes.util.find_library("c"), use_errno=True)
    return _libc


class _SockaddrVm(ctypes.Structure):
    _fields_ = [
        ("svm_family", ctypes.c_ushort),
        ("svm_reserved1", ctypes.c_ushort),
        ("svm_port", ctypes.c_uint),
        ("svm_cid", ctypes.c_uint),
        ("svm_zero", ctypes.c_ubyte * 4),
    ]


def _sa(port: int, cid: int) -> _SockaddrVm:
    return _SockaddrVm(AF_VSOCK, 0, port, cid, (ctypes.c_ubyte * 4)())


def vsock_socket() -> int:
    """ينشئ سوكيت AF_VSOCK. يرمي OSError عند غياب دعم العائلة في النواة."""
    libc = _get_libc()
    ctypes.set_errno(0)
    fd = libc.socket(AF_VSOCK, SOCK_STREAM, 0)
    e = ctypes.get_errno()
    if fd < 0:
        raise OSError(e, _errno.errorcode.get(e, "socket(AF_VSOCK) failed"))
    return fd


def vsock_bind(fd: int, port: int, cid: int = VMADDR_CID_ANY) -> None:
    libc = _get_libc()
    a = _sa(port, cid)
    ctypes.set_errno(0)
    rc = libc.bind(fd, ctypes.byref(a), ctypes.sizeof(_SockaddrVm))
    e = ctypes.get_errno()
    if rc != 0:
        raise OSError(e, _errno.errorcode.get(e, "bind failed"))


def vsock_listen(fd: int, backlog: int = 8) -> None:
    libc = _get_libc()
    ctypes.set_errno(0)
    rc = libc.listen(fd, backlog)
    e = ctypes.get_errno()
    if rc != 0:
        raise OSError(e, _errno.errorcode.get(e, "listen failed"))


def vsock_connect(fd: int, cid: int, port: int, timeout_ms: int = 3000) -> dict:
    """اتصال غير محجوب مع مهلة، بالطريقة القياسية (اتصالٌ ثانٍ ينتظر EISCONN).
    يرجع {'ok': bool, 'errno': str?} — لا يعتبر الاتصال ناجحاً إلا بتأكيدٍ صريح
    من النواة (rc==0 أو EISCONN)، وإلا يرجع errno الخام كتشخيص."""
    import fcntl
    import select as _select

    libc = _get_libc()
    flags = fcntl.fcntl(fd, fcntl.F_GETFL)
    fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
    a = _sa(port, cid)

    def _restore():
        fcntl.fcntl(fd, fcntl.F_SETFL, flags)

    ctypes.set_errno(0)
    rc = libc.connect(fd, ctypes.byref(a), ctypes.sizeof(_SockaddrVm))
    e = ctypes.get_errno()
    if rc == 0:
        _restore()
        return {"ok": True}
    if e != _errno.EINPROGRESS:
        _restore()
        return {"ok": False, "errno": _errno.errorcode.get(e, str(e))}

    ready = _select.select([], [fd], [], timeout_ms / 1000.0)
    if not ready[1]:
        _restore()
        return {"ok": False, "errno": "ETIMEDOUT"}

    # اتصالٌ ثانٍ: EISCONN = اكتمل فعلاً؛ أيّ خطأ آخر = الحالة الخام للتشخيص.
    ctypes.set_errno(0)
    rc2 = libc.connect(fd, ctypes.byref(a), ctypes.sizeof(_SockaddrVm))
    e2 = ctypes.get_errno()
    _restore()
    if rc2 == 0 or e2 == _errno.EISCONN:
        return {"ok": True}
    return {"ok": False, "errno": _errno.errorcode.get(e2, str(e2))}


def set_nonblocking(fd: int) -> None:
    import fcntl
    flags = fcntl.fcntl(fd, fcntl.F_GETFL)
    fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)


# ---------------------------------------------------------------- self-test

def _selftest() -> int:
    payload = b"parity-check-payload-0123456789"
    for counter in (1, 2, 42, 2**53):
        f = frame(payload, counter)
        m = parse_message(f)
        assert m["ok"], ("roundtrip failed", counter, m)
        assert m["counter"] == counter
        assert m["payload"] == payload
        assert m["total_len"] == len(f)
    # حالات الرفض
    assert parse_message(f[:-1])["error"] == "INCOMPLETE"
    assert parse_message(b"XX" + f[2:])["error"] == "BAD_MAGIC"
    bad = bytearray(f)
    bad[-1] ^= 0xFF
    assert parse_message(bytes(bad))["error"] == "BAD_CRC"
    try:
        frame(b"x" * (MAX_PAYLOAD + 1), 1)
        raise AssertionError("oversize not rejected")
    except ValueError as e:
        assert str(e) == "PAYLOAD_TOO_LARGE"
    # FrameFeed: تجزئة منتصف الرسالة
    feed = FrameFeed()
    got = []
    got += feed.push(f[:7])
    got += feed.push(f[7:])
    assert len(got) == 1 and got[0]["ok"]
    print("SELFTEST_OK " + f.hex())
    return 0


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "selftest":
        raise SystemExit(_selftest())
    print("usage: vsock_lib.py selftest")
    raise SystemExit(2)
