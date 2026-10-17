using System;
using Xuux.TpmCeremony;
namespace Wl413TagCheck {
  public static class Program {
    public static int Main(string[] a) {
      using (SwtpmLoopbackTransport t = new SwtpmLoopbackTransport(a[0], int.Parse(a[1]))) {
        byte[] cp = t.Transmit(Cmd.CreatePrimary(new byte[0], Templates.StoragePrimary()));
        Rd r = new Rd(cp); r.U16(); r.U32(); r.U32(); uint key = r.U32(); r.U32(); r.Raw(291); r.B2B(); r.U8(); r.B2B();
        byte[] ss = t.Transmit(Cmd.StartAuthSession(Tpm.SE_TRIAL, new byte[32]));
        Rd rs = new Rd(ss); rs.U16(); rs.U32(); rs.U32(); uint sess = rs.U32(); byte[] nonce = new Rd(rs.Raw(rs.Remaining)).B2B();
        Console.WriteLine("StartAuthSession resp tag=0x" + new Rd(ss).U16().ToString("x4") + " handle=" + Hex.U32(sess) + " nonceLen=" + nonce.Length);
        byte[] sg = t.Transmit(Cmd.Sign(key, new byte[0], Policy.AHash(nonce, 0)));
        Console.WriteLine("Sign resp tag=0x" + new Rd(sg).U16().ToString("x4") + " len=" + sg.Length);
        byte[] ps = t.Transmit(Cmd.PolicySigned(key, sess, nonce, 0, new byte[32], new byte[32]));
        Console.WriteLine("PolicySigned resp tag=0x" + new Rd(ps).U16().ToString("x4") + " len=" + ps.Length + " body=" + Hex.Of(ps));
        byte[] pcc = t.Transmit(Cmd.PolicyCommandCode(sess, Tpm.CC_NV_Increment));
        Console.WriteLine("PolicyCommandCode resp tag=0x" + new Rd(pcc).U16().ToString("x4") + " len=" + pcc.Length);
        byte[] f = t.Transmit(Cmd.FlushContext(sess));
        Console.WriteLine("FlushContext resp tag=0x" + new Rd(f).U16().ToString("x4") + " len=" + f.Length);
        byte[] f2 = t.Transmit(Cmd.FlushContext(key));
        Console.WriteLine("FlushContext(key) resp tag=0x" + new Rd(f2).U16().ToString("x4") + " len=" + f2.Length);
      }
      return 0;
    }
  }
}
