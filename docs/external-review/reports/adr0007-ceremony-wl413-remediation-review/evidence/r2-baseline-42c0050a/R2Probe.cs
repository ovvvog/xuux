// WL-413 الدفعة الثانية — مسابر مستقلة للثغرات المتبقية بعد 42c0050a (محاكٍ فقط).
using System;
using System.IO;
using System.Collections.Generic;
using Xuux.TpmCeremony;

public sealed class R2Fault : ICeremonyTransport
{
    readonly ICeremonyTransport _in; readonly string _m; public int Changes; int _inc;
    public R2Fault(ICeremonyTransport i, string m) { _in = i; _m = m; }
    public string Kind { get { return "r2:" + _m; } }
    public byte[] Transmit(byte[] cmd)
    {
        Rd c = new Rd(cmd); c.U16(); c.U32(); uint cc = c.U32();
        if (_m == "written-before-reconcile" && cc == Tpm.CC_NV_DefineSpace && Changes == 0)
        {
            c.U32(); uint a = c.U32(); c.Raw((int)a); c.B2B(); byte[] pub = c.B2B(); uint h = new Rd(pub).U32();
            byte[] raw0 = _in.Transmit(cmd);
            // طرفٌ آخرُ (محاكى) يكتبُ الفهرسَ قبلَ المصالحة: زيادةٌ بتفويضٍ فارغ (S1 يسمحُ AUTHWRITE).
            byte[] inc = _in.Transmit(Cmd.NvIncrement(h, Cmd.PasswordAuth(new byte[0])));
            Changes++;
            Rd ih = new Rd(inc); ih.U16(); ih.U32(); Console.Error.WriteLine("third-party increment rc=" + Hex.U32(ih.U32()));
            throw new IOException("R2_RESPONSE_LOSS_AFTER_DEFINE_AND_THIRD_PARTY_WRITE");
        }
        if (_m == "neg-increment-loss" && cc == Tpm.CC_NV_Increment)
        {
            _inc++;
            if (_inc == 4) { byte[] r = _in.Transmit(cmd); Changes++; throw new IOException("R2_LOSS_AFTER_NEGATIVE_INCREMENT"); }
        }
        byte[] raw = _in.Transmit(cmd);
        if (_m == "trailing-params" && cc == Tpm.CC_NV_ReadPublic && new Rd(raw).U32Skip2() >= 0)
        {
            Rd h = new Rd(raw); h.U16(); h.U32(); uint rc = h.U32();
            if (rc == 0)
            {
                byte[] n = new byte[raw.Length + 3]; Buffer.BlockCopy(raw, 0, n, 0, raw.Length);
                n[raw.Length] = 0xde; n[raw.Length + 1] = 0xad; n[raw.Length + 2] = 0x01;
                byte[] sz = new Wr().U32((uint)n.Length).Bytes(); Buffer.BlockCopy(sz, 0, n, 2, 4);
                Changes++; return n;
            }
        }
        return raw;
    }
}

public static class R2
{
    static string Handles(ICeremonyTransport t, uint start)
    {
        Resp p = Resp.Parse(t.Transmit(Cmd.GetCapability(1, start, 64)), 0, Tpm.ST_NO_SESSIONS, 0);
        Rd r = new Rd(p.Params); r.U8(); r.U32(); uint n = r.U32(); List<string> hs = new List<string>();
        for (int i = 0; i < n; i++) { uint h = r.U32(); if ((h >> 24) == (start >> 24) || ((start >> 24) == 2 && (h >> 24) == 3)) hs.Add("\"" + Hex.U32(h) + "\""); }
        return "[" + string.Join(",", hs.ToArray()) + "]";
    }
    public static int Main(string[] a)
    {
        int port = int.Parse(a[1]);
        using (SwtpmLoopbackTransport t = new SwtpmLoopbackTransport("127.0.0.1", port))
        {
            R2Fault f = new R2Fault(t, a[0]);
            CeremonyReport rep = new CeremonyRehearsal(f).Run("ALL");
            Console.WriteLine("{\"probe\":\"" + a[0] + "\",\"changes\":" + f.Changes + ",\"nvAfter\":" + Handles(t, 0x01000000)
                + ",\"sessionsAfter\":" + Handles(t, 0x02000000) + ",\"transientsAfter\":" + Handles(t, 0x80000000) + ",\"report\":" + rep.ToJson() + "}");
        }
        return 0;
    }
}
