using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using Xuux.TpmCeremony;

namespace Xuux.TpmCeremony.Probes
{
    public static class PolicyRefProbe
    {
        public static string Run(string host, int port)
        {
            SwtpmLoopbackTransport t = new SwtpmLoopbackTransport(host, port);
            try
            {
                byte[] empty = new byte[0];
                Resp id = Ok(t, Cmd.GetCapability(6, 0x105, 1), 0);
                Resp pp = Ok(t, Cmd.CreatePrimary(empty, Templates.StoragePrimary()), 1);
                uint primary = pp.Handles[0];
                Resp cr = Ok(t, Cmd.Create(primary, empty, Templates.ServiceSigningKey()), 0);
                Rd q = new Rd(cr.Params);
                byte[] priv = q.B2B();
                byte[] pub = q.B2B();
                Resp ld = Ok(t, Cmd.Load(primary, empty, priv, pub), 1);
                uint key = ld.Handles[0];
                byte[] name = new Rd(ld.Params).B2B();
                byte[] nonceCaller = new byte[32];
                RandomNumberGenerator.Create().GetBytes(nonceCaller);
                Resp ss = Ok(t, Cmd.StartAuthSession(Tpm.SE_TRIAL, nonceCaller), 1);
                uint sess = ss.Handles[0];
                byte[] nonceTpm = new Rd(ss.Params).B2B();
                byte[] pref = new byte[] { 0x01, 0x02, 0x03, 0x04 };
                byte[] aHash = Sha.H(Sha.Concat(nonceTpm, new Wr().U32(0).Bytes(), pref));
                Resp sig = Ok(t, Cmd.Sign(key, empty, aHash), 0);
                Rd sq = new Rd(sig.Params);
                if (sq.U16() != Tpm.ALG_ECDSA || sq.U16() != Tpm.ALG_SHA256) throw new Exception("scheme");
                byte[] sr = sq.B2B();
                byte[] ssig = sq.B2B();
                byte[] p = new Wr().B2B(nonceTpm).B2B(empty).B2B(pref).U32(0).U16(Tpm.ALG_ECDSA).U16(Tpm.ALG_SHA256).B2B(sr).B2B(ssig).Bytes();
                Resp pr = Ok(t, Cmd.Build(Tpm.CC_PolicySigned, new uint[] { key, sess }, null, p), 0);
                Ok(t, Cmd.PolicyCommandCode(sess, Tpm.CC_NV_Increment), 0);
                Resp dg = Ok(t, Cmd.PolicyGetDigest(sess), 0);
                byte[] digest = new Rd(dg.Params).B2B();
                Ok(t, Cmd.FlushContext(sess), 0);
                Ok(t, Cmd.FlushContext(key), 0);
                Ok(t, Cmd.FlushContext(primary), 0);
                return "{\"name\":\"" + Hex.Of(name) + "\",\"policyRef\":\"01020304\",\"tpmDigest\":\"" + Hex.Of(digest) + "\",\"policySignedRc\":" + pr.Rc + "}";
            }
            finally { t.Dispose(); }
        }

        private static Resp Ok(ICeremonyTransport t, byte[] cmd, int handles)
        {
            ushort tag = (ushort)((cmd[0] << 8) | cmd[1]);
            Resp p = Resp.Parse(t.Transmit(cmd), handles, tag, tag == Tpm.ST_SESSIONS ? 1 : 0);
            if (p.Rc != 0) throw new Exception("rc " + Hex.U32(p.Rc));
            return p;
        }

        public static string Layouts()
        {
            byte[] z = new byte[32];
            byte[] empty = new byte[0];
            byte[] pub = Cmd.NvPublic(0x01A00011, Tpm.ANCHOR_ATTRIBUTES, z, 8);
            List<string> rows = new List<string>();
            Add(rows, "NV_DefineSpace", Cmd.NvDefineSpace(empty, empty, pub));
            Add(rows, "NV_Increment", Cmd.NvIncrement(0x01A00011, Cmd.PasswordAuth(empty)));
            Add(rows, "NV_Read", Cmd.NvRead(0x01A00011, Cmd.PasswordAuth(empty), 8, 0));
            Add(rows, "NV_ReadPublic", Cmd.NvReadPublic(0x01A00011));
            Add(rows, "NV_UndefineSpace", Cmd.NvUndefineSpace(empty, 0x01A00011));
            Add(rows, "CreatePrimary", Cmd.CreatePrimary(empty, Templates.StoragePrimary()));
            Add(rows, "Create", Cmd.Create(0x80000000, empty, Templates.ServiceSigningKey()));
            Add(rows, "Load", Cmd.Load(0x80000000, empty, z, z));
            Add(rows, "Sign", Cmd.Sign(0x80000001, empty, z));
            Add(rows, "StartAuthSession", Cmd.StartAuthSession(Tpm.SE_TRIAL, z));
            Add(rows, "PolicySigned", Cmd.PolicySigned(0x80000001, 0x03000000, z, 0, z, z));
            Add(rows, "PolicyCommandCode", Cmd.PolicyCommandCode(0x03000000, Tpm.CC_NV_Increment));
            Add(rows, "PolicyGetDigest", Cmd.PolicyGetDigest(0x03000000));
            Add(rows, "FlushContext", Cmd.FlushContext(0x80000000));
            Add(rows, "GetCapability", Cmd.GetCapability(6, 0x105, 5));
            return "[" + string.Join(",", rows.ToArray()) + "]";
        }

        private static void Add(List<string> rows, string name, byte[] b)
        {
            uint size = ((uint)b[2] << 24) | ((uint)b[3] << 16) | ((uint)b[4] << 8) | b[5];
            uint cc = ((uint)b[6] << 24) | ((uint)b[7] << 16) | ((uint)b[8] << 8) | b[9];
            ushort tag = (ushort)((b[0] << 8) | b[1]);
            rows.Add("{\"name\":\"" + name + "\",\"len\":" + b.Length + ",\"declaredSize\":" + size
                + ",\"sizeMatch\":" + (size == (uint)b.Length ? "true" : "false")
                + ",\"tag\":\"0x" + tag.ToString("x4") + "\",\"cc\":\"0x" + cc.ToString("x8") + "\"}");
        }
    }
}
