using System;
using Xuux.TpmCeremony;

namespace Wl413Shapes
{
    public static class Program
    {
        public static int Main(string[] args)
        {
            using (SwtpmLoopbackTransport t = new SwtpmLoopbackTransport(args[0], int.Parse(args[1])))
            {
                byte[] e = t.Transmit(Cmd.NvReadPublic(0x01DEAD00));
                Console.WriteLine("error-response: " + Hex.Of(e) + " len=" + e.Length);
                byte[] cp = t.Transmit(Cmd.CreatePrimary(new byte[0], Templates.StoragePrimary()));
                Console.WriteLine("createprimary len=" + cp.Length + " head=" + Hex.Of(cp).Substring(0, 40));
                // تحليلُ يدويٍّ: tag,size,rc ثمّ مقبضٌ ثمّ parameterSize ثمّ auth areas
                Rd r = new Rd(cp); ushort tag = r.U16(); uint size = r.U32(); uint rc = r.U32();
                Console.WriteLine("cp tag=0x" + tag.ToString("x4") + " size=" + size + " rc=0x" + rc.ToString("x8"));
                uint handle = r.U32();
                uint ps = r.U32();
                byte[] pars = r.Raw((int)ps);
                Console.WriteLine("cp handle=" + Hex.U32(handle) + " paramSize=" + ps + " remaining=" + r.Remaining);
                // بنيةُ منطقةِ تفويضِ الردِّ: TPMS_AUTH_RESPONSE = nonce(TPM2B) + attrs(1) + hmac(TPM2B)
                byte[] nonce = r.B2B(); byte attrs = r.U8(); byte[] hmac = r.B2B();
                Console.WriteLine("auth1 nonceLen=" + nonce.Length + " attrs=0x" + attrs.ToString("x2") + " hmacLen=" + hmac.Length + " remaining=" + r.Remaining);
                byte[] ld = t.Transmit(Cmd.Load(handle, new byte[0], new byte[16], new byte[16]));
                Rd l = new Rd(ld); ushort ltag = l.U16(); uint lsize = l.U32(); uint lrc = l.U32(); uint lh = l.U32(); uint lps = l.U32();
                byte[] lpars = l.Raw((int)lps);
                Console.WriteLine("load tag=0x" + ltag.ToString("x4") + " rc=0x" + lrc.ToString("x8") + " handle=" + Hex.U32(lh) + " ps=" + lps + " rest=" + l.Remaining);
                byte[] fl = t.Transmit(Cmd.FlushContext(handle));
                Console.WriteLine("flush: " + Hex.Of(fl));
            }
            return 0;
        }
    }
}
