using System;
using System.Collections.Generic;
using Xuux.TpmCeremony;

public sealed class LateNvTransport : ICeremonyTransport
{
    private readonly ICeremonyTransport inner;
    private readonly string trigger;
    public bool Planted;
    public readonly List<string> MutationsAfterPlant = new List<string>();
    public readonly List<string> Events = new List<string>();
    public const uint Foreign = 0x01807777;
    public LateNvTransport(ICeremonyTransport t, string when) { inner = t; trigger = when; }
    public string Kind { get { return inner.Kind + "+independent-late-nv"; } }
    static uint U32(byte[] b, int o) { return ((uint)b[o] << 24) | ((uint)b[o+1] << 16) | ((uint)b[o+2] << 8) | b[o+3]; }
    static bool Mutates(uint cc)
    {
        return cc == Tpm.CC_NV_DefineSpace || cc == Tpm.CC_NV_Increment || cc == Tpm.CC_NV_UndefineSpace ||
            cc == Tpm.CC_CreatePrimary || cc == Tpm.CC_Create || cc == Tpm.CC_Load ||
            cc == Tpm.CC_StartAuthSession || cc == Tpm.CC_PolicySigned ||
            cc == Tpm.CC_PolicyCommandCode || cc == Tpm.CC_FlushContext;
    }
    public byte[] Transmit(byte[] command)
    {
        uint cc = U32(command, 6);
        if (Planted && Mutates(cc)) MutationsAfterPlant.Add(Hex.U32(cc));
        byte[] raw = inner.Transmit(command);
        bool atTrigger = trigger == "after-define" ? cc == Tpm.CC_NV_DefineSpace : cc == Tpm.CC_CreatePrimary;
        if (!Planted && atTrigger && U32(raw, 6) == 0)
        {
            byte[] pub = new Wr().U32(Foreign).U16(Tpm.ALG_SHA256)
                .U32(Tpm.NV_AUTHREAD | Tpm.NV_AUTHWRITE).B2B(new byte[0]).U16(0).Bytes();
            byte[] d = inner.Transmit(Cmd.NvDefineSpace(new byte[0], new byte[0], pub));
            if (U32(d, 6) != 0) throw new InvalidOperationException("plant rc=" + Hex.U32(U32(d, 6)));
            Planted = true;
            Events.Add("foreign NV planted after successful " + Hex.U32(cc) + ", before next command; index=" + Hex.U32(Foreign));
        }
        return raw;
    }
}
public static class LateNvProbe
{
    public static string Run(int port, string stages, string trigger)
    {
        using (var inner = new SwtpmLoopbackTransport("127.0.0.1", port))
        {
            var t = new LateNvTransport(inner, trigger);
            var report = new CeremonyRehearsal(t).Run(stages);
            byte[] raw = inner.Transmit(Cmd.NvReadPublic(LateNvTransport.Foreign));
            uint rc = ((uint)raw[6] << 24) | ((uint)raw[7] << 16) | ((uint)raw[8] << 8) | raw[9];
            return "stages=" + stages + " trigger=" + trigger + "\n" +
                string.Join("\n", t.Events.ToArray()) + "\n" +
                "mutationsAfterPlant=" + string.Join(",", t.MutationsAfterPlant.ToArray()) + "\n" +
                "foreignIndexStillPresent=" + (rc == 0) + "\n" + report.ToJson();
        }
    }
}
