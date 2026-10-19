using System;
using System.Collections.Generic;
using Xuux.TpmCeremony;
namespace G47Probe {
  public sealed class T : ICeremonyTransport {
    private readonly ICeremonyTransport _i;
    public readonly string Mode;
    public int Changes;
    public uint Decoy;
    public uint Primary;
    public uint Defined;
    public readonly List<string> Log = new List<string>();
    public T(ICeremonyTransport i, string mode) { _i = i; Mode = mode; }
    public string Kind { get { return "probe:" + Mode; } }
    private static uint Cc(byte[] c) { return ((uint)c[6] << 24) | ((uint)c[7] << 16) | ((uint)c[8] << 8) | c[9]; }
    private static byte[] RewriteNoSess(byte[] raw, int handles, Func<byte[], byte[]> f) {
      Rd r = new Rd(raw); r.U16(); r.U32(); r.U32();
      byte[] hs = r.Raw(4 * handles);
      byte[] np = f(r.Raw(r.Remaining));
      byte[] body = new Wr().Raw(hs).Raw(np).Bytes();
      return new Wr().U16(Tpm.ST_NO_SESSIONS).U32((uint)(10 + body.Length)).U32(0).Raw(body).Bytes();
    }
    private static byte[] RewriteAuth(byte[] raw, int handles, byte[] auth) {
      Rd r = new Rd(raw); r.U16(); r.U32(); r.U32();
      byte[] hs = r.Raw(4 * handles);
      uint ps = r.U32(); byte[] prm = r.Raw((int)ps);
      byte[] body = new Wr().Raw(hs).U32((uint)prm.Length).Raw(prm).Raw(auth).Bytes();
      return new Wr().U16(Tpm.ST_SESSIONS).U32((uint)(10 + body.Length)).U32(0).Raw(body).Bytes();
    }
    public byte[] Transmit(byte[] command) {
      uint cc = Cc(command);
      if (Mode == "plant-then-drop" && cc == Tpm.CC_NV_DefineSpace && Changes == 0) {
        Changes++;
        _i.Transmit(command); // index now exists; ceremony does not receive a reply
        throw new System.IO.IOException("PROBE_PLANT_THEN_DROP");
      }
      if (Mode == "define-drop-before" && cc == Tpm.CC_NV_DefineSpace && Changes == 0) {
        Changes++;
        throw new System.IO.IOException("PROBE_DEFINE_DROPPED_BEFORE");
      }
      if (Mode == "undefine-drop-before" && cc == Tpm.CC_NV_UndefineSpace && Changes == 0) {
        Changes++;
        throw new System.IO.IOException("PROBE_UNDEFINE_DROPPED_BEFORE");
      }
      byte[] raw = _i.Transmit(command);
      Rd h = new Rd(raw); ushort tag = h.U16(); uint sz = h.U32(); uint rc = h.U32();
      string hex = Hex.Of(raw);
      string head = hex.Length > 64 ? hex.Substring(0, 64) : hex;
      Log.Add(Hex.U32(cc) + " tag=0x" + tag.ToString("x4") + " sz=" + sz + " rc=0x" + rc.ToString("x8") + " head=" + head);
      if (rc == 0 && (cc == Tpm.CC_StartAuthSession || cc == Tpm.CC_PolicySigned || cc == Tpm.CC_CreatePrimary || cc == Tpm.CC_Create)) {
        string key = "FULL " + Hex.U32(cc) + " ";
        bool seen = false;
        foreach (string line in Log) if (line.StartsWith(key)) { seen = true; break; }
        if (!seen) Log.Add(key + hex);
      }
      if (cc == Tpm.CC_CreatePrimary && rc == 0 && Primary == 0) {
        Primary = ((uint)raw[10] << 24) | ((uint)raw[11] << 16) | ((uint)raw[12] << 8) | raw[13];
      }
      if (Mode == "log") return raw;
      if (Mode == "define-loss" && cc == Tpm.CC_NV_DefineSpace && rc == 0 && Changes == 0) {
        Changes++; throw new System.IO.IOException("PROBE_DEFINE_LOSS_AFTER");
      }
      if (Mode == "undefine-loss" && cc == Tpm.CC_NV_UndefineSpace && rc == 0 && Changes == 0) {
        Changes++; throw new System.IO.IOException("PROBE_UNDEFINE_LOSS_AFTER");
      }
      if (Mode == "load-loss" && cc == Tpm.CC_Load && rc == 0 && Changes == 0) {
        Changes++; throw new System.IO.IOException("PROBE_LOAD_LOSS_AFTER");
      }
      if (Mode == "session-loss" && cc == Tpm.CC_StartAuthSession && rc == 0 && Changes == 0) {
        Changes++; throw new System.IO.IOException("PROBE_SESSION_LOSS_AFTER");
      }
      if (Mode == "session-alias" && cc == Tpm.CC_StartAuthSession && rc == 0 && Changes == 0 && Decoy != 0) {
        Changes++;
        byte[] forged = (byte[])raw.Clone();
        forged[10] = (byte)(Decoy >> 24); forged[11] = (byte)(Decoy >> 16); forged[12] = (byte)(Decoy >> 8); forged[13] = (byte)Decoy;
        return forged;
      }
      if (Mode == "load-alias-primary" && cc == Tpm.CC_Load && rc == 0 && Changes == 0 && Primary != 0) {
        Changes++;
        byte[] forged = (byte[])raw.Clone();
        forged[10] = (byte)(Primary >> 24); forged[11] = (byte)(Primary >> 16); forged[12] = (byte)(Primary >> 8); forged[13] = (byte)Primary;
        return forged;
      }
      if (Mode == "auth-cross" && rc == 0 && tag == Tpm.ST_SESSIONS && cc == Tpm.CC_NV_DefineSpace && Changes == 0) {
        Changes++;
        // policy shape: nonce 32, attrs 0x00, hmac empty — not the password profile
        List<byte> a = new List<byte>();
        a.Add(0x00); a.Add(0x20);
        for (int i = 0; i < 32; i++) a.Add(0xAB);
        a.Add(0x00); a.Add(0x00); a.Add(0x00);
        return RewriteAuth(raw, 0, a.ToArray());
      }
      if (Mode == "policy-nonce16" && rc == 0 && tag == Tpm.ST_SESSIONS && cc == Tpm.CC_NV_Increment && Changes == 0) {
        // only the policy-session increment has a 32-byte nonce in the real response
        Rd q = new Rd(raw); q.U16(); q.U32(); q.U32(); uint ps = q.U32(); q.Raw((int)ps);
        byte[] nonce = q.B2B();
        if (nonce.Length == 32) {
          Changes++;
          List<byte> a = new List<byte>();
          a.Add(0x00); a.Add(0x10);
          for (int i = 0; i < 16; i++) a.Add(nonce[i]);
          a.Add(q.U8()); a.Add(0x00); a.Add(0x00);
          return RewriteAuth(raw, 0, a.ToArray());
        }
      }
      if (Mode == "policy-attrs08" && rc == 0 && tag == Tpm.ST_SESSIONS && cc == Tpm.CC_NV_Increment && Changes == 0) {
        Rd q = new Rd(raw); q.U16(); q.U32(); q.U32(); uint ps = q.U32(); q.Raw((int)ps);
        byte[] nonce = q.B2B(); byte attrs = q.U8(); byte[] hmac = q.B2B();
        if (nonce.Length >= 16) {
          Changes++;
          return RewriteAuth(raw, 0, new Wr().B2B(nonce).U8(0x08).B2B(hmac).Bytes());
        }
      }
      if (Mode == "ps-timeout8" && rc == 0 && cc == Tpm.CC_PolicySigned && Changes == 0) {
        Changes++;
        return RewriteNoSess(raw, 0, delegate(byte[] prm) {
          Rd q = new Rd(prm); q.B2B(); ushort tt = q.U16(); uint hh = q.U32(); byte[] td = q.B2B();
          return new Wr().B2B(new byte[8]).U16(tt).U32(hh).B2B(td).Bytes();
        });
      }
      if (Mode == "ps-hier02" && rc == 0 && cc == Tpm.CC_PolicySigned && Changes == 0) {
        Changes++;
        return RewriteNoSess(raw, 0, delegate(byte[] prm) {
          Rd q = new Rd(prm); byte[] to = q.B2B(); q.U16(); q.U32(); byte[] td = q.B2B();
          return new Wr().B2B(to).U16(0x8025).U32(0x40000002).B2B(td).Bytes();
        });
      }
      if (Mode == "cp-name-flip" && rc == 0 && cc == Tpm.CC_CreatePrimary && Changes == 0) {
        Changes++;
        // flip one unique byte; leave name unchanged so hash will not match
        byte[] forged = (byte[])raw.Clone();
        // params start after header(10)+handle(4)+parameterSize(4)
        if (forged.Length > 40) forged[40] = (byte)(forged[40] ^ 0xFF);
        return forged;
      }
      return raw;
    }
  }
}