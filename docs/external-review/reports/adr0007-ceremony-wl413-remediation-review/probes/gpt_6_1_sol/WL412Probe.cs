using System;
using System.IO;
using System.Collections.Generic;
using Xuux.TpmCeremony;

namespace IndependentReview
{
    public sealed class Fault : ICeremonyTransport
    {
        public readonly ICeremonyTransport Inner;
        public readonly string Mode;
        public int Changes;
        public uint DefinedHandle;
        public byte[] DefinedPublic;
        public uint LostSession;
        public Fault(ICeremonyTransport inner, string mode) { Inner = inner; Mode = mode; }
        public string Kind { get { return "independent:" + Mode; } }
        public byte[] Transmit(byte[] command)
        {
            Rd c = new Rd(command); c.U16(); c.U32(); uint cc = c.U32();
            if (Mode == "flush-refusal" && cc == Tpm.CC_FlushContext && Changes == 0)
            {
                LostSession = c.U32(); Changes++;
                return new Wr().U16(Tpm.ST_NO_SESSIONS).U32(10).U32(0x80280400).Bytes();
            }
            if (Mode == "unexpected-negative" && cc == Tpm.CC_PolicySigned)
            {
                // First PolicySigned is trial; second is positive policy; third is replay.
                Changes++;
                if (Changes == 3)
                    return new Wr().U16(Tpm.ST_NO_SESSIONS).U32(10).U32(0x101).Bytes();
            }
            byte[] raw = Inner.Transmit(command);
            Rd header = new Rd(raw);
            ushort tag = header.U16(); header.U32(); uint rc = header.U32();
            if (Mode == "define-response-loss" && cc == Tpm.CC_NV_DefineSpace && rc == 0 && Changes == 0)
            {
                c.U32(); uint authSize = c.U32(); c.Raw((int)authSize); c.B2B();
                DefinedPublic = c.B2B(); DefinedHandle = new Rd(DefinedPublic).U32(); Changes++;
                throw new IOException("INDEPENDENT_RESPONSE_LOSS_AFTER_DEFINE_EXECUTION");
            }
            if (Mode == "invalid-tag" && tag == Tpm.ST_NO_SESSIONS)
            {
                raw[0] = 0x12; raw[1] = 0x34; Changes++;
            }
            if (Mode == "missing-response-auth" && rc == 0 && tag == Tpm.ST_SESSIONS)
            {
                int handles = cc == Tpm.CC_CreatePrimary || cc == Tpm.CC_Load ? 1 : 0;
                Rd r = new Rd(raw); r.Raw(10 + 4 * handles); uint ps = r.U32();
                int keep = 10 + 4 * handles + 4 + (int)ps;
                byte[] shortened = new byte[keep]; Buffer.BlockCopy(raw, 0, shortened, 0, keep);
                byte[] size = new Wr().U32((uint)keep).Bytes(); Buffer.BlockCopy(size, 0, shortened, 2, 4);
                Changes++; return shortened;
            }
            return raw;
        }
    }

    public static class Program
    {
        private static string Handles(ICeremonyTransport t, uint start)
        {
            Resp p = Resp.Parse(t.Transmit(Cmd.GetCapability(1, start, 64)), 0, Tpm.ST_NO_SESSIONS, 0);
            Rd r = new Rd(p.Params); r.U8(); r.U32(); uint count = r.U32();
            List<string> hs = new List<string>();
            for (int i = 0; i < count; i++) hs.Add("\"" + Hex.U32(r.U32()) + "\"");
            return "[" + String.Join(",", hs.ToArray()) + "]";
        }
        public static int Main(string[] args)
        {
            string mode = args[0];
            using (SwtpmLoopbackTransport inner = new SwtpmLoopbackTransport("127.0.0.1", 2101))
            {
                string beforeNv = Handles(inner, 0x01000000);
                string beforeSessions = Handles(inner, 0x02000000);
                Fault fault = new Fault(inner, mode);
                CeremonyReport report = new CeremonyRehearsal(fault).Run("ALL");
                string afterNv = Handles(inner, 0x01000000);
                string afterSessions = Handles(inner, 0x02000000);
                Console.WriteLine("{\"probe\":\"" + mode + "\",\"changes\":" + fault.Changes
                    + ",\"nvBefore\":" + beforeNv + ",\"nvAfter\":" + afterNv
                    + ",\"sessionsBefore\":" + beforeSessions + ",\"sessionsAfter\":" + afterSessions
                    + ",\"refusedFlushHandle\":\"" + Hex.U32(fault.LostSession) + "\""
                    + ",\"report\":" + report.ToJson() + "}");
                // Restore only the object created by this probe, after collecting observations.
                if (fault.DefinedHandle != 0)
                {
                    Resp p = Resp.Parse(inner.Transmit(Cmd.NvReadPublic(fault.DefinedHandle)), 0, Tpm.ST_NO_SESSIONS, 0);
                    byte[] actual = new Rd(p.Params).B2B();
                    if (Hex.Of(actual) != Hex.Of(fault.DefinedPublic)) throw new Exception("OWN_PUBLIC_MISMATCH");
                    Resp u = Resp.Parse(inner.Transmit(Cmd.NvUndefineSpace(new byte[0], fault.DefinedHandle)), 0, Tpm.ST_SESSIONS, 1);
                    if (u.Rc != 0) throw new Exception("OWN_NV_RESTORE_ERROR");
                }
                if (fault.LostSession != 0)
                {
                    Resp f = Resp.Parse(inner.Transmit(Cmd.FlushContext(fault.LostSession)), 0, Tpm.ST_NO_SESSIONS, 0);
                    if (f.Rc != 0) throw new Exception("OWN_SESSION_RESTORE_ERROR");
                }
                Console.WriteLine("{\"probe\":\"" + mode + "\",\"afterIndependentRestoreNv\":"
                    + Handles(inner, 0x01000000) + ",\"afterIndependentRestoreSessions\":"
                    + Handles(inner, 0x02000000) + "}");
            }
            return 0;
        }
    }
}
