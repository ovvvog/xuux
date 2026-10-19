using System;
using System.Collections.Generic;
using Xuux.TpmCeremony;

namespace Xuux.TpmCeremony.Audit
{
    public sealed class AuditProbeTransport : ICeremonyTransport
    {
        private readonly ICeremonyTransport _inner;
        private readonly string _probe;
        public int Changes;
        public string Outcome;
        public string ErrorMessage;

        public AuditProbeTransport(ICeremonyTransport inner, string probe)
        {
            _inner = inner;
            _probe = probe;
        }

        public string Kind { get { return "audit:" + _probe; } }

        private static byte[] RewriteParams(byte[] raw, int handles, Func<byte[], byte[]> f)
        {
            Rd r = new Rd(raw); r.U16(); r.U32(); r.U32();
            byte[] hs = r.Raw(4 * handles);
            uint ps = r.U32(); byte[] prm = r.Raw((int)ps); byte[] auth = r.Raw(r.Remaining);
            byte[] np = f(prm);
            byte[] body = new Wr().Raw(hs).U32((uint)np.Length).Raw(np).Raw(auth).Bytes();
            return new Wr().U16(Tpm.ST_SESSIONS).U32((uint)(10 + body.Length)).U32(0).Raw(body).Bytes();
        }

        private static byte[] RewriteNoSessionsParams(byte[] raw, int handles, Func<byte[], byte[]> f)
        {
            Rd r = new Rd(raw); r.U16(); r.U32(); r.U32();
            byte[] hs = r.Raw(4 * handles);
            byte[] np = f(r.Raw(r.Remaining));
            byte[] body = new Wr().Raw(hs).Raw(np).Bytes();
            return new Wr().U16(Tpm.ST_NO_SESSIONS).U32((uint)(10 + body.Length)).U32(0).Raw(body).Bytes();
        }

        public byte[] Transmit(byte[] command)
        {
            uint cc = ((uint)command[6] << 24) | ((uint)command[7] << 16) | ((uint)command[8] << 8) | command[9];
            byte[] raw = _inner.Transmit(command);
            Rd header = new Rd(raw);
            ushort tag = header.U16(); header.U32(); uint rc = header.U32();

            // 1. In NV_ReadPublic: corrupt the nvName to a different 34-byte hash (valid SHA256 header 0x000B, but wrong hash)
            if (rc == 0 && _probe == "readpublic-name-mismatch" && cc == Tpm.CC_NV_ReadPublic && Changes == 0)
            {
                Changes++;
                return RewriteNoSessionsParams(raw, 0, delegate(byte[] prm)
                {
                    Rd q = new Rd(prm);
                    byte[] pub = q.B2B();
                    byte[] oldNm = q.B2B();
                    byte[] fakeNm = (byte[])oldNm.Clone();
                    fakeNm[2] ^= 0xFF; // flip byte in hash, keeping 0x000B prefix
                    return new Wr().B2B(pub).B2B(fakeNm).Bytes();
                });
            }

            // 2. In PolicySigned: replace hierarchy with 0x40000002 (TPM_RH_REVOKE, an invalid hierarchy)
            if (rc == 0 && _probe == "policysigned-hierarchy-0x40000002" && cc == Tpm.CC_PolicySigned && Changes == 0)
            {
                Changes++;
                return RewriteNoSessionsParams(raw, 0, delegate(byte[] prm)
                {
                    Rd q = new Rd(prm);
                    byte[] to = q.B2B();
                    ushort ttag = q.U16();
                    uint h = q.U32();
                    byte[] td = q.B2B();
                    return new Wr().B2B(to).U16(ttag).U32(0x40000002u).B2B(td).Bytes();
                });
            }

            // 3. In Create: set ticket digest to empty (0 bytes) or 1 byte
            if (rc == 0 && _probe == "create-ticket-digest-short" && cc == Tpm.CC_Create && Changes == 0)
            {
                Changes++;
                return RewriteParams(raw, 0, delegate(byte[] prm)
                {
                    Rd q = new Rd(prm);
                    byte[] priv = q.B2B();
                    byte[] pub = q.B2B();
                    byte[] cd = q.B2B();
                    byte[] ch = q.B2B();
                    ushort ttag = q.U16();
                    uint h = q.U32();
                    byte[] td = q.B2B();
                    return new Wr().B2B(priv).B2B(pub).B2B(cd).B2B(ch).U16(ttag).U32(h).B2B(new byte[1]).Bytes();
                });
            }

            // 4. In Load: change key name to a different valid 34-byte name
            if (rc == 0 && _probe == "load-name-mismatch" && cc == Tpm.CC_Load && Changes == 0)
            {
                Changes++;
                return RewriteParams(raw, 1, delegate(byte[] prm)
                {
                    Rd q = new Rd(prm);
                    byte[] oldNm = q.B2B();
                    byte[] fakeNm = (byte[])oldNm.Clone();
                    fakeNm[2] ^= 0xFF;
                    return new Wr().B2B(fakeNm).Bytes();
                });
            }

            // 5. In PolicySigned: expiration=0 but timeout is non-empty (e.g. 8 bytes)
            if (rc == 0 && _probe == "policysigned-timeout-nonzero" && cc == Tpm.CC_PolicySigned && Changes == 0)
            {
                Changes++;
                return RewriteNoSessionsParams(raw, 0, delegate(byte[] prm)
                {
                    Rd q = new Rd(prm);
                    byte[] to = q.B2B();
                    ushort ttag = q.U16();
                    uint h = q.U32();
                    byte[] td = q.B2B();
                    return new Wr().B2B(new byte[] { 1, 2, 3, 4, 5, 6, 7, 8 }).U16(ttag).U32(h).B2B(td).Bytes();
                });
            }

            return raw;
        }
    }
}
