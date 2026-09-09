// @ts-nocheck
// sim/channel/bind_policy.mjs
//
// سياسة الربط لأدوات PoC القناة (transient, non-production, no-TPM-write diagnostic PoC).
// الهدف: منع الاستماع على 0.0.0.0 أو :: أو عنوان LAN المادي.
// المسموح: loopback فقط افتراضياً؛ وشبكة WSL NAT الافتراضية (172.16.0.0/12)
// لا تُقبل إلا بصريح --allow-wsl-nat وبشرط أن يكون العنوان عنوانَ واجهةٍ محليةٍ فعلية.
// وحدة نقية بلا sockets — قابلة للاختبار في CI.

import { networkInterfaces } from 'node:os';

/** أرقام CIDR من عنوان IPv4 نصّي. يرمي على غير IPv4. */
export function parseIpv4(addr) {
  const parts = String(addr).split('.');
  if (parts.length !== 4) throw new Error('NOT_IPV4: ' + addr);
  const octets = parts.map((p) => {
    if (!/^\d{1,3}$/.test(p)) throw new Error('NOT_IPV4: ' + addr);
    const n = Number(p);
    if (n > 255) throw new Error('NOT_IPV4: ' + addr);
    return n;
  });
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}

/** هل العنوان داخل 172.16.0.0/12 (النطاق الافتراضي لشبكة WSL2 NAT)؟ */
export function isWslNatRange(addr) {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(String(addr))) return false;
  const n = parseIpv4(addr);
  return ((n >>> 24) & 0xff) === 172 && ((n >>> 20) & 0xf) === 1;
}

/** هل العنوان loopback (127.0.0.0/8)؟ */
export function isLoopback(addr) {
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(String(addr));
}

/**
 * عناوين IPv4 لجميع واجهات هذا المضيف.
 * @returns {string[]}
 */
export function localInterfaceAddresses() {
  const out = [];
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family === 'IPv4') out.push(i.address);
    }
  }
  return out;
}

/**
 * يتحقق من صلاحية عنوان الربط وفق السياسة.
 *
 * - يرفض البدائل (0.0.0.0، ::، سلسلة فارغة) إطلاقاً.
 * - يسمح بـ127.x.x.x (loopback) دائماً.
 * - يسمح بنطاق WSL NAT (172.16.0.0/12) فقط إذا allowWslNat=true
 *   وكان العنوان عنوان واجهة محلية فعلية (interfaces).
 * - يرفض كل ما عدا ذلك (192.168.x، 10.x، عناوين عامة، IPv6...).
 *
 * @param {string} addr
 * @param {{allowWslNat?: boolean, interfaces?: string[]}} [opts]
 * @returns {{ok: true, kind: 'loopback'|'wsl-nat'} | {ok: false, error: string}}
 */
export function validateBindAddress(addr, opts = {}) {
  const value = String(addr ?? '').trim();
  if (value.length === 0) return { ok: false, error: 'REFUSED_EMPTY_BIND' };
  if (value === '0.0.0.0' || value === '::' || value === '::0') {
    return { ok: false, error: 'REFUSED_WILDCARD_BIND: ' + value };
  }
  if (isLoopback(value)) return { ok: true, kind: 'loopback' };
  if (isWslNatRange(value)) {
    if (!opts.allowWslNat) {
      return { ok: false, error: 'REFUSED_WSL_NAT_WITHOUT_FLAG: pass --allow-wsl-nat explicitly' };
    }
    const interfaces = opts.interfaces ?? localInterfaceAddresses();
    if (!interfaces.includes(value)) {
      return { ok: false, error: 'REFUSED_NOT_LOCAL_INTERFACE: ' + value };
    }
    return { ok: true, kind: 'wsl-nat' };
  }
  return { ok: false, error: 'REFUSED_NON_LOOPBACK_NON_WSL_NAT: ' + value };
}
