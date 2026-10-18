// Independent WL-413 probes. Compiled against the review-tree core; does not modify it.
// C# 5. Usage: mono ProbeRunner.exe <mode> <port> [arg]
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Xuux.TpmCeremony;

public sealed class CountingTransport : ICeremonyTransport
{
    private readonly ICeremonyTransport _inner;
    private readonly string _mode;
    public int Changes;
    public int Forwarded;
    public int UndefineForwards;
    public int CreateForwards;
    public int PolicySignedForwards;
    public int IncrementForwards;
    public uint Planted;
    public readonly List<string> Notes = new List<string>();

    public CountingTransport(ICeremonyTransport inner, string mode) { _inner = inner; _mode = mode; }
    public string Kind { get { return "probe:" + _mode; } }

    private static uint Cc(byte[] c)
    {
        return ((uint)c[6] << 24) | ((uint)c[7] << 16) | ((uint)c[8] << 8) | c[9];
    }

    private static byte[] AppendAuthHmacByte(byte[] raw)
    {
        // ST_SESSIONS success: keep params, replace the single auth area with nonce=empty, attr=0x01, hmac=1 byte 0xFF.
        Rd r = new Rd(raw);
        ushort tag = r.U16(); uint size = r.U32(); uint rc = r.U32();
        int headerAndHandles = 10; // no response handles in the commands we rewrite (Define/Increment)
        byte[] head = new byte[10];
        Buffer.BlockCopy(raw, 0, head, 0, 10);
        Rd r2 = new Rd(raw);
        r2.Raw(10);
        uint ps = r2.U32();
        byte[] prm = r2.Raw((int)ps);
        byte[] auth = new Wr().B2B(new byte[0]).U8(0x01).B2B(new byte[] { 0xFF }).Bytes();
        byte[] body = new Wr().U32((uint)prm.Length).Raw(prm).Raw(auth).Bytes();
        return new Wr().U16(tag).U32((uint)(10 + body.Length)).U32(rc).Raw(body).Bytes();
    }

    private static byte[] ShortenSessionNonce(byte[] raw)
    {
        // StartAuthSession success: 1 response handle, then nonce TPM2B. Replace nonce with 1 byte 0x11.
        Rd r = new Rd(raw);
        ushort tag = r.U16(); r.U32(); uint rc = r.U32();
        uint handle = r.U32();
        uint ps = r.U32();
        byte[] prm = r.Raw((int)ps);
        byte[] auth = r.Raw(r.Remaining);
        byte[] np = new Wr().B2B(new byte[] { 0x11 }).Bytes();
        byte[] body = new Wr().U32(handle).U32((uint)np.Length).Raw(np).Raw(auth).Bytes();
        return new Wr().U16(tag).U32((uint)(10 + body.Length)).U32(rc).Raw(body).Bytes();
    }

    public byte[] Transmit(byte[] command)
    {
        uint cc = Cc(command);
        if (cc == Tpm.CC_NV_UndefineSpace) UndefineForwards++;
        if (cc == Tpm.CC_Create) CreateForwards++;
        if (cc == Tpm.CC_PolicySigned) PolicySignedForwards++;
        if (cc == Tpm.CC_NV_Increment) IncrementForwards++;

        if (_mode == "drop-create" && cc == Tpm.CC_Create && Changes == 0)
        {
            Changes++;
            _inner.Transmit(command);
            throw new IOException("PROBE_DROP_CREATE_AFTER_SEND");
        }
        if (_mode == "drop-refused-policysigned" && cc == Tpm.CC_PolicySigned && PolicySignedForwards == 3)
        {
            // 3rd PolicySigned is the replay refusal (Refused(), not ledger-tracked).
            Changes++;
            _inner.Transmit(command);
            throw new IOException("PROBE_DROP_REFUSED_POLICYSIGNED");
        }
        if (_mode == "cleanup-undefine-no-retry" && cc == Tpm.CC_NV_Increment && IncrementForwards == 1)
        {
            Changes++;
            Notes.Add("increment-not-forwarded");
            throw new IOException("PROBE_DROP_FIRST_INCREMENT_BEFORE_SEND");
        }
        if (_mode == "cleanup-undefine-no-retry" && cc == Tpm.CC_NV_UndefineSpace)
        {
            Changes++;
            Notes.Add("cleanup-undefine-not-forwarded count=" + UndefineForwards);
            throw new IOException("PROBE_DROP_CLEANUP_UNDEFINE_BEFORE_SEND");
        }
        if (_mode == "drop-cleanup-undefine-before-send" && cc == Tpm.CC_NV_UndefineSpace)
        {
            // First undefine is in-stage; cleanup undefines are later. Drop the first cleanup one before send.
            // We cannot see the stage here. Drop the 3rd undefine (cleanup of primary? no, undefine is NV only).
            // S1 probe, S1 redefine, S2v anchor are in-stage. Cleanup may undefine none if those succeeded.
            // So drop the first undefine before send to observe the retry message, using a dedicated mode on S1 only.
            if (Changes == 0)
            {
                Changes++;
                Notes.Add("undefine-not-forwarded");
                throw new IOException("PROBE_DROP_UNDEFINE_BEFORE_SEND");
            }
        }
        if (_mode == "drop-undefine-after-exec" && cc == Tpm.CC_NV_UndefineSpace && Changes == 0)
        {
            Changes++;
            byte[] raw = _inner.Transmit(command);
            throw new IOException("PROBE_DROP_UNDEFINE_AFTER_EXEC");
        }
        if (_mode == "plant-same-public" && cc == Tpm.CC_NV_DefineSpace && Changes == 0)
        {
            Changes++;
            Rd c = new Rd(command); c.U16(); c.U32(); c.U32(); c.U32(); uint authSize = c.U32(); c.Raw((int)authSize); c.B2B();
            byte[] pub = c.B2B();
            Planted = new Rd(pub).U32();
            // Third party defines the identical public area; our command is not forwarded.
            byte[] planted = Cmd.NvDefineSpace(new byte[0], new byte[0], pub);
            byte[] pr = _inner.Transmit(planted);
            Rd hr = new Rd(pr); hr.U16(); hr.U32(); uint prc = hr.U32();
            Notes.Add("plant-rc=" + prc.ToString("x8") + " handle=" + Planted.ToString("x8"));
            throw new IOException("PROBE_PLANTED_MATCHING_INDEX_BEFORE_OUR_DEFINE");
        }
        if (_mode == "redefine-after-exec" && cc == Tpm.CC_NV_DefineSpace && Changes == 0)
        {
            Changes++;
            Rd c = new Rd(command); c.U16(); c.U32(); c.U32(); c.U32(); uint authSize = c.U32(); c.Raw((int)authSize); c.B2B();
            byte[] pub = c.B2B();
            Planted = new Rd(pub).U32();
            _inner.Transmit(command);
            byte[] und = Cmd.NvUndefineSpace(new byte[0], Planted);
            _inner.Transmit(und);
            byte[] again = Cmd.NvDefineSpace(new byte[0], new byte[] { 0x11 }, pub);
            byte[] pr = _inner.Transmit(again);
            Rd hr = new Rd(pr); hr.U16(); hr.U32(); uint prc = hr.U32();
            Notes.Add("redefine-rc=" + prc.ToString("x8"));
            throw new IOException("PROBE_REDEFINED_IDENTICAL_PUBLIC_AFTER_EXEC");
        }
        if (_mode == "short-nonce" && cc == Tpm.CC_StartAuthSession && Changes == 0)
        {
            byte[] raw = _inner.Transmit(command);
            Rd h = new Rd(raw); h.U16(); h.U32(); uint rc = h.U32();
            if (rc == 0) { Changes++; return ShortenSessionNonce(raw); }
            return raw;
        }
        if (_mode == "hmac-nonzero" && cc == Tpm.CC_NV_DefineSpace && Changes == 0)
        {
            byte[] raw = _inner.Transmit(command);
            Rd h = new Rd(raw); h.U16(); h.U32(); uint rc = h.U32();
            if (rc == 0) { Changes++; return AppendAuthHmacByte(raw); }
            return raw;
        }
        if (_mode == "paramsize-huge" && cc == Tpm.CC_GetCapability && Changes == 0)
        {
            Changes++;
            // tag 8001, size 10, rc 0, then we lie: actually return 14 bytes with parameterSize 0xFFFFFFFF embedded as params start.
            // Parse reads parameterSize from response. For no-sessions, params are the remainder, schema then reads them.
            // To hit the (int)ps cast, the response must be ST_SESSIONS so Parse reads parameterSize.
            // Identity GetCapability is ST_NO_SESSIONS. Force ST_SESSIONS with parameterSize 0xFFFFFFFF.
            return new byte[] {
                0x80, 0x02, 0x00, 0x00, 0x00, 14,
                0x00, 0x00, 0x00, 0x00,
                0xFF, 0xFF, 0xFF, 0xFF
            };
        }
        if (_mode == "truncated-header" && Changes == 0)
        {
            Changes++;
            return new byte[] { 0x80, 0x01, 0x00, 0x00, 0x00, 0x06 };
        }
        if (_mode == "size-mismatch" && Changes == 0)
        {
            Changes++;
            return new byte[] { 0x80, 0x01, 0x00, 0x00, 0x00, 0x0E, 0x00, 0x00, 0x00, 0x00 };
        }
        if (_mode == "error-with-body" && Changes == 0)
        {
            Changes++;
            return new byte[] { 0x80, 0x01, 0x00, 0x00, 0x00, 12, 0x00, 0x00, 0x01, 0x01, 0x00, 0x00 };
        }
        if (_mode == "error-bad-tag" && Changes == 0)
        {
            Changes++;
            return new byte[] { 0x80, 0x02, 0x00, 0x00, 0x00, 10, 0x00, 0x00, 0x01, 0x01 };
        }
        if (_mode == "invalid-tag-success")
        {
            byte[] raw = _inner.Transmit(command);
            if (raw.Length >= 2 && raw[0] == 0x80 && raw[1] == 0x01) { raw[0] = 0x12; raw[1] = 0x34; Changes++; }
            return raw;
        }
        if (_mode == "io-before-increment" && cc == Tpm.CC_NV_Increment && Changes == 0)
        {
            Changes++;
            throw new IOException("PROBE_IO_BEFORE_INCREMENT_WRITE");
        }

        Forwarded++;
        return _inner.Transmit(command);
    }
}

public static class ProbeMain
{
    static string J(string s)
    {
        if (s == null) return "null";
        return "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }

    static void Emit(string mode, CeremonyReport r, CountingTransport t, int exitCode)
    {
        StringBuilder sb = new StringBuilder();
        sb.Append("{\"mode\":").Append(J(mode));
        sb.Append(",\"status\":").Append(J(r.Status));
        sb.Append(",\"failure\":").Append(J(r.Failure));
        sb.Append(",\"steps\":").Append(r.Steps.Count);
        sb.Append(",\"changes\":").Append(t.Changes);
        sb.Append(",\"forwarded\":").Append(t.Forwarded);
        sb.Append(",\"undefineForwards\":").Append(t.UndefineForwards);
        sb.Append(",\"createForwards\":").Append(t.CreateForwards);
        sb.Append(",\"policySignedForwards\":").Append(t.PolicySignedForwards);
        sb.Append(",\"planted\":").Append(J("0x" + t.Planted.ToString("x8")));
        sb.Append(",\"leftovers\":[");
        for (int i = 0; i < r.CleanupLeftovers.Count; i++) { if (i > 0) sb.Append(','); sb.Append(J(r.CleanupLeftovers[i])); }
        sb.Append("],\"reconciliation\":[");
        for (int i = 0; i < r.Reconciliation.Count; i++) { if (i > 0) sb.Append(','); sb.Append(J(r.Reconciliation[i])); }
        sb.Append("],\"notes\":[");
        for (int i = 0; i < t.Notes.Count; i++) { if (i > 0) sb.Append(','); sb.Append(J(t.Notes[i])); }
        sb.Append("],\"postVerified\":").Append(r.PostRunVerified ? "true" : "false");
        sb.Append(",\"postError\":").Append(J(r.PostRunError));
        sb.Append(",\"residualNv\":[");
        for (int i = 0; i < r.ResidualNv.Count; i++) { if (i > 0) sb.Append(','); sb.Append(J(r.ResidualNv[i])); }
        sb.Append("],\"residualSessions\":[");
        for (int i = 0; i < r.ResidualSessions.Count; i++) { if (i > 0) sb.Append(','); sb.Append(J(r.ResidualSessions[i])); }
        sb.Append("],\"residualTransients\":[");
        for (int i = 0; i < r.ResidualTransients.Count; i++) { if (i > 0) sb.Append(','); sb.Append(J(r.ResidualTransients[i])); }
        sb.Append("],\"changingAfterFail\":").Append(J(ChangingAfter(r)));
        sb.Append("}");
        Console.WriteLine(sb.ToString());
    }

    static string ChangingAfter(CeremonyReport r)
    {
        int idx = -1;
        for (int i = 0; i < r.Steps.Count; i++)
        {
            if (r.Steps[i].Outcome == "unknown" || r.Steps[i].Outcome == "unexpected-failure" || r.Steps[i].Outcome == "wrong-rejection-code" || r.Steps[i].Outcome == "blocked")
            { idx = i; break; }
        }
        if (idx < 0) return "no-failed-step";
        StringBuilder sb = new StringBuilder();
        for (int i = idx + 1; i < r.Steps.Count; i++)
        {
            Step s = r.Steps[i];
            uint cc = s.CommandCode;
            bool changing = cc == Tpm.CC_NV_DefineSpace || cc == Tpm.CC_NV_Increment || cc == Tpm.CC_NV_UndefineSpace
                || cc == Tpm.CC_CreatePrimary || cc == Tpm.CC_Create || cc == Tpm.CC_Load || cc == Tpm.CC_StartAuthSession
                || cc == Tpm.CC_PolicySigned || cc == Tpm.CC_PolicyCommandCode || cc == Tpm.CC_FlushContext;
            if (changing && s.Stage != "cleanup") sb.Append(s.Stage).Append(':').Append(s.Name).Append(';');
        }
        return sb.Length == 0 ? "none" : sb.ToString();
    }

    static string TryCheck(uint cc, byte[] cmd, byte[] prm)
    {
        try { ResponseSchema.Check(cc, cmd, prm); return "accepted"; }
        catch (Exception e) { return e.GetType().Name + ":" + e.Message; }
    }

    static string TryParse(byte[] raw, int handles, ushort tag, int auths)
    {
        try
        {
            Resp p = Resp.Parse(raw, handles, tag, auths);
            return "parsed rc=" + p.Rc.ToString("x8") + " tag=" + p.Tag.ToString("x4") + " params=" + p.Params.Length + " handles=" + p.Handles.Length;
        }
        catch (Exception e) { return e.GetType().Name + ":" + e.Message; }
    }

    static void SchemaLab(int port)
    {
        SwtpmLoopbackTransport t = new SwtpmLoopbackTransport("127.0.0.1", port);
        try
        {
            byte[] capCmd = Cmd.GetCapability(6, 0x105, 1);
            byte[] cap = t.Transmit(capCmd);
            Resp capR = Resp.Parse(cap, 0, Tpm.ST_NO_SESSIONS, 0);
            Console.WriteLine("SCHEMA getcap-original " + TryCheck(Tpm.CC_GetCapability, capCmd, capR.Params));
            byte[] capTrail = (byte[])capR.Params.Clone();
            byte[] grown = new byte[capTrail.Length + 1];
            Buffer.BlockCopy(capTrail, 0, grown, 0, capTrail.Length);
            grown[grown.Length - 1] = 0xEE;
            Console.WriteLine("SCHEMA getcap-trailing " + TryCheck(Tpm.CC_GetCapability, capCmd, grown));

            // CreatePrimary and walk both layouts.
            byte[] cpCmd = Cmd.CreatePrimary(new byte[0], Templates.StoragePrimary());
            byte[] cpRaw = t.Transmit(cpCmd);
            Resp cp = Resp.Parse(cpRaw, 1, Tpm.ST_SESSIONS, 1);
            Console.WriteLine("SCHEMA createprimary-parse handles=" + cp.Handles[0].ToString("x8") + " paramsLen=" + cp.Params.Length);
            Console.WriteLine("SCHEMA createprimary-check " + TryCheck(Tpm.CC_CreatePrimary, cpCmd, cp.Params));
            WalkCreatePrimary(cp.Params);
            // Mutate: append 2 bytes after a consistent total by increasing the last TPM2B (name) length — should fail name check or trailing.
            byte[] mut = (byte[])cp.Params.Clone();
            mut[mut.Length - 1] ^= 0x01;
            Console.WriteLine("SCHEMA createprimary-flip-last " + TryCheck(Tpm.CC_CreatePrimary, cpCmd, mut));
            byte[] extra = new byte[cp.Params.Length + 2];
            Buffer.BlockCopy(cp.Params, 0, extra, 0, cp.Params.Length);
            extra[extra.Length - 2] = 0xAB; extra[extra.Length - 1] = 0xCD;
            Console.WriteLine("SCHEMA createprimary-trailing " + TryCheck(Tpm.CC_CreatePrimary, cpCmd, extra));

            // Inside-TPM2B growth: increment first TPM2B length by 1 and insert a byte, so total grows but outer End may still pass if we don't add past the buffer... 
            // Instead, steal 1 byte from a later field into the first TPM2B by increasing its length and decreasing nothing — that shortens what the next field sees.
            byte[] steal = (byte[])cp.Params.Clone();
            int firstLen = (steal[0] << 8) | steal[1];
            steal[1] = (byte)(steal[1] + 1); // length + 1, next field starts one byte later
            Console.WriteLine("SCHEMA createprimary-first-b2b-len-plus1 " + TryCheck(Tpm.CC_CreatePrimary, cpCmd, steal) + " firstLenWas=" + firstLen);

            uint h = cp.Handles[0];
            byte[] crCmd = Cmd.Create(h, new byte[0], Templates.ServiceSigningKey());
            byte[] crRaw = t.Transmit(crCmd);
            Resp cr = Resp.Parse(crRaw, 0, Tpm.ST_SESSIONS, 1);
            Console.WriteLine("SCHEMA create-check " + TryCheck(Tpm.CC_Create, crCmd, cr.Params) + " paramsLen=" + cr.Params.Length);
            byte[] crExtra = new byte[cr.Params.Length + 1];
            Buffer.BlockCopy(cr.Params, 0, crExtra, 0, cr.Params.Length); crExtra[crExtra.Length - 1] = 0x01;
            Console.WriteLine("SCHEMA create-trailing " + TryCheck(Tpm.CC_Create, crCmd, crExtra));
            // ticket tag not checked: flip the ticket tag bytes if we can locate them by a spec walk
            Console.WriteLine("SCHEMA create-walk " + WalkGeneric(cr.Params, 4));

            byte[] ldCmd = null; byte[] ldRaw = null; Resp ld = null;
            {
                Rd q = new Rd(cr.Params);
                byte[] priv = q.B2B(); byte[] pub = q.B2B();
                ldCmd = Cmd.Load(h, new byte[0], priv, pub);
                ldRaw = t.Transmit(ldCmd);
                ld = Resp.Parse(ldRaw, 1, Tpm.ST_SESSIONS, 1);
                Console.WriteLine("SCHEMA load-check " + TryCheck(Tpm.CC_Load, ldCmd, ld.Params));
                byte[] shortName = new byte[] { 0x00, 0x02, 0x00, 0x0B };
                Console.WriteLine("SCHEMA load-short-name " + TryCheck(Tpm.CC_Load, ldCmd, shortName));
            }
            uint key = ld.Handles[0];
            byte[] signCmd = Cmd.Sign(key, new byte[0], new byte[32]);
            byte[] signRaw = t.Transmit(signCmd);
            Resp sg = Resp.Parse(signRaw, 0, Tpm.ST_SESSIONS, 1);
            Console.WriteLine("SCHEMA sign-check " + TryCheck(Tpm.CC_Sign, signCmd, sg.Params));
            byte[] badAlg = (byte[])sg.Params.Clone();
            badAlg[2] = 0x00; badAlg[3] = 0x04; // hash alg SHA1 if layout is alg(2) hash(2)
            Console.WriteLine("SCHEMA sign-hashalg-sha1 " + TryCheck(Tpm.CC_Sign, signCmd, badAlg));

            byte[] nonceCaller = new byte[32];
            byte[] ssCmd = Cmd.StartAuthSession(Tpm.SE_POLICY, nonceCaller);
            byte[] ssRaw = t.Transmit(ssCmd);
            Resp ss = Resp.Parse(ssRaw, 1, Tpm.ST_NO_SESSIONS, 0);
            Console.WriteLine("SCHEMA startsession-check " + TryCheck(Tpm.CC_StartAuthSession, ssCmd, ss.Params) + " nonceLen=" + new Rd(ss.Params).B2B().Length);
            byte[] shortNonce = new Wr().B2B(new byte[] { 0x11 }).Bytes();
            Console.WriteLine("SCHEMA startsession-nonce1 " + TryCheck(Tpm.CC_StartAuthSession, ssCmd, shortNonce));
            uint sess = ss.Handles[0];
            byte[] pgCmd = Cmd.PolicyGetDigest(sess);
            byte[] pgRaw = t.Transmit(pgCmd);
            Resp pg = Resp.Parse(pgRaw, 0, Tpm.ST_NO_SESSIONS, 0);
            Console.WriteLine("SCHEMA policygetdigest-check " + TryCheck(Tpm.CC_PolicyGetDigest, pgCmd, pg.Params) + " digLen=" + new Rd(pg.Params).B2B().Length);
            Console.WriteLine("SCHEMA policygetdigest-short " + TryCheck(Tpm.CC_PolicyGetDigest, pgCmd, new Wr().B2B(new byte[8]).Bytes()));

            byte[] pcCmd = Cmd.PolicyCommandCode(sess, Tpm.CC_NV_Increment);
            byte[] pcRaw = t.Transmit(pcCmd);
            Resp pc = Resp.Parse(pcRaw, 0, Tpm.ST_NO_SESSIONS, 0);
            Console.WriteLine("SCHEMA policycc-check " + TryCheck(Tpm.CC_PolicyCommandCode, pcCmd, pc.Params));
            Console.WriteLine("SCHEMA policycc-trailing " + TryCheck(Tpm.CC_PolicyCommandCode, pcCmd, new byte[] { 0x00 }));

            byte[] flCmd = Cmd.FlushContext(sess);
            byte[] flRaw = t.Transmit(flCmd);
            Resp fl = Resp.Parse(flRaw, 0, Tpm.ST_NO_SESSIONS, 0);
            Console.WriteLine("SCHEMA flush-check " + TryCheck(Tpm.CC_FlushContext, flCmd, fl.Params) + " rc=" + fl.Rc.ToString("x8"));

            // NV path
            uint idx = 0x01A10001;
            byte[] nvPub = Cmd.NvPublic(idx, Tpm.S1_PROBE_ATTRIBUTES, new byte[0], 8);
            byte[] defCmd = Cmd.NvDefineSpace(new byte[0], new byte[0], nvPub);
            byte[] defRaw = t.Transmit(defCmd);
            Resp def = Resp.Parse(defRaw, 0, Tpm.ST_SESSIONS, 1);
            Console.WriteLine("SCHEMA define-check " + TryCheck(Tpm.CC_NV_DefineSpace, defCmd, def.Params) + " " + TryParse(defRaw, 0, Tpm.ST_SESSIONS, 1));
            // nonzero hmac already built: reconstruct params empty, parse a rewritten response
            Console.WriteLine("SCHEMA define-empty-params-plus-byte " + TryCheck(Tpm.CC_NV_DefineSpace, defCmd, new byte[] { 0x00 }));

            byte[] incCmd = Cmd.NvIncrement(idx, Cmd.PasswordAuth(new byte[0]));
            byte[] incRaw = t.Transmit(incCmd);
            Resp inc = Resp.Parse(incRaw, 0, Tpm.ST_SESSIONS, 1);
            Console.WriteLine("SCHEMA increment-check " + TryCheck(Tpm.CC_NV_Increment, incCmd, inc.Params));

            byte[] rdCmd = Cmd.NvRead(idx, Cmd.PasswordAuth(new byte[0]), 8, 0);
            byte[] rdRaw = t.Transmit(rdCmd);
            Resp rd = Resp.Parse(rdRaw, 0, Tpm.ST_SESSIONS, 1);
            int dlen = new Rd(rd.Params).B2B().Length;
            Console.WriteLine("SCHEMA nvread-check " + TryCheck(Tpm.CC_NV_Read, rdCmd, rd.Params) + " dataLen=" + dlen);
            Console.WriteLine("SCHEMA nvread-7bytes " + TryCheck(Tpm.CC_NV_Read, rdCmd, new Wr().B2B(new byte[7]).Bytes()));

            byte[] rpCmd = Cmd.NvReadPublic(idx);
            byte[] rpRaw = t.Transmit(rpCmd);
            Resp rp = Resp.Parse(rpRaw, 0, Tpm.ST_NO_SESSIONS, 0);
            Console.WriteLine("SCHEMA readpublic-check " + TryCheck(Tpm.CC_NV_ReadPublic, rpCmd, rp.Params));
            // public area with internal trailing: length says 16 but only 14 meaningful — increase TPM2B length by 2 and append 2 bytes before name
            Console.WriteLine("SCHEMA readpublic-walk " + WalkNvPublic(rp.Params));

            byte[] unCmd = Cmd.NvUndefineSpace(new byte[0], idx);
            byte[] unRaw = t.Transmit(unCmd);
            Resp un = Resp.Parse(unRaw, 0, Tpm.ST_SESSIONS, 1);
            Console.WriteLine("SCHEMA undefine-check " + TryCheck(Tpm.CC_NV_UndefineSpace, unCmd, un.Params));

            // PolicySigned needs a loaded signing key and a policy session. Use key still loaded.
            byte[] snonce;
            byte[] ss2 = Cmd.StartAuthSession(Tpm.SE_POLICY, new byte[32]);
            Resp ss2r = Resp.Parse(t.Transmit(ss2), 1, Tpm.ST_NO_SESSIONS, 0);
            snonce = new Rd(ss2r.Params).B2B();
            uint ps = ss2r.Handles[0];
            byte[] ahash = Policy.AHash(snonce, 0);
            byte[] sign2 = t.Transmit(Cmd.Sign(key, new byte[0], ahash));
            Resp sig = Resp.Parse(sign2, 0, Tpm.ST_SESSIONS, 1);
            Rd sq = new Rd(sig.Params);
            if (sq.U16() != Tpm.ALG_ECDSA) Console.WriteLine("SCHEMA sign-unexpected-alg");
            sq.U16();
            byte[] sr = sq.B2B(); byte[] ss_ = sq.B2B();
            byte[] psCmd = Cmd.PolicySigned(key, ps, snonce, 0, sr, ss_);
            byte[] psRaw = t.Transmit(psCmd);
            Resp psr = Resp.Parse(psRaw, 0, Tpm.ST_NO_SESSIONS, 0);
            Console.WriteLine("SCHEMA policysigned-check " + TryCheck(Tpm.CC_PolicySigned, psCmd, psr.Params) + " rc=" + psr.Rc.ToString("x8"));
            Console.WriteLine("SCHEMA policysigned-walk " + WalkPolicySigned(psr.Params));
            // bad ticket tag: if walk shows tag at a known offset, flip it
            byte[] badTicket = (byte[])psr.Params.Clone();
            if (badTicket.Length > 4) { badTicket[2] ^= 0xFF; badTicket[3] ^= 0xFF; }
            Console.WriteLine("SCHEMA policysigned-flip-after-timeout-len " + TryCheck(Tpm.CC_PolicySigned, psCmd, badTicket));

            t.Transmit(Cmd.FlushContext(ps));
            t.Transmit(Cmd.FlushContext(key));
            t.Transmit(Cmd.FlushContext(h));

            // Parse-only distortions
            Console.WriteLine("PARSE truncated " + TryParse(new byte[] { 0x80, 0x01, 0, 0, 0, 6 }, 0, Tpm.ST_NO_SESSIONS, 0));
            Console.WriteLine("PARSE size-mismatch " + TryParse(new byte[] { 0x80, 0x01, 0, 0, 0, 14, 0, 0, 0, 0 }, 0, Tpm.ST_NO_SESSIONS, 0));
            Console.WriteLine("PARSE error-body " + TryParse(new byte[] { 0x80, 0x01, 0, 0, 0, 12, 0, 0, 1, 1, 0, 0 }, 0, Tpm.ST_NO_SESSIONS, 0));
            Console.WriteLine("PARSE error-tag " + TryParse(new byte[] { 0x80, 0x02, 0, 0, 0, 10, 0, 0, 1, 1 }, 0, Tpm.ST_NO_SESSIONS, 0));
            Console.WriteLine("PARSE bad-success-tag " + TryParse(new byte[] { 0x12, 0x34, 0, 0, 0, 10, 0, 0, 0, 0 }, 0, Tpm.ST_NO_SESSIONS, 0));
            // parameterSize 0xFFFFFFFF on a 14-byte ST_SESSIONS buffer
            Console.WriteLine("PARSE paramsize-ffffffff " + TryParse(new byte[] { 0x80, 0x02, 0, 0, 0, 14, 0, 0, 0, 0, 0xFF, 0xFF, 0xFF, 0xFF }, 0, Tpm.ST_SESSIONS, 1));
            // missing auth area but size consistent
            byte[] noAuth = new Wr().U16(Tpm.ST_SESSIONS).U32(14).U32(0).U32(0).Bytes();
            Console.WriteLine("PARSE missing-auth " + TryParse(noAuth, 0, Tpm.ST_SESSIONS, 1));
            // extra handle bytes interpreted as params for a 0-handle command: NV_ReadPublic with 4 extra bytes prepended inside params
            Console.WriteLine("SCHEMA readpublic-extra-handle-bytes " + TryCheck(Tpm.CC_NV_ReadPublic, rpCmd, Sha.Concat(new byte[] { 0, 0, 0, 1 }, rp.Params)));
        }
        finally { t.Dispose(); }
    }

    static void WalkCreatePrimary(byte[] p)
    {
        // Spec layout: outPrivate, outPublic, creationData, creationHash, ticket(tag, hierarchy, digest), name
        try
        {
            Rd r = new Rd(p);
            byte[] a = r.B2B(); byte[] b = r.B2B(); byte[] c = r.B2B(); byte[] d = r.B2B();
            ushort tag = r.U16(); uint hier = r.U32(); byte[] dig = r.B2B(); byte[] name = r.B2B();
            Console.WriteLine("WALK-SPEC createprimary priv=" + a.Length + " pub=" + b.Length + " cdata=" + c.Length + " chash=" + d.Length
                + " ticketTag=" + tag.ToString("x4") + " hier=" + hier.ToString("x8") + " tdig=" + dig.Length + " name=" + name.Length
                + " nameHead=" + (name.Length >= 2 ? name[0].ToString("x2") + name[1].ToString("x2") : "?")
                + " remain=" + r.Remaining);
        }
        catch (Exception e) { Console.WriteLine("WALK-SPEC createprimary FAIL " + e.Message); }
        try
        {
            Rd r = new Rd(p);
            byte[] a = r.B2B(); byte[] b = r.B2B(); byte[] c = r.B2B();
            ushort tag = r.U16(); uint hier = r.U32(); byte[] dig = r.B2B(); byte[] name = r.B2B();
            Console.WriteLine("WALK-CODE createprimary b1=" + a.Length + " b2=" + b.Length + " b3=" + c.Length
                + " u16=" + tag.ToString("x4") + " u32=" + hier.ToString("x8") + " b2b=" + dig.Length + " name=" + name.Length
                + " nameHead=" + (name.Length >= 2 ? name[0].ToString("x2") + name[1].ToString("x2") : "?")
                + " remain=" + r.Remaining);
        }
        catch (Exception e) { Console.WriteLine("WALK-CODE createprimary FAIL " + e.GetType().Name + ":" + e.Message); }
    }

    static string WalkGeneric(byte[] p, int b2bsBeforeTicket)
    {
        try
        {
            Rd r = new Rd(p);
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < b2bsBeforeTicket; i++) sb.Append("b").Append(i).Append('=').Append(r.B2B().Length).Append(' ');
            sb.Append("tag=").Append(r.U16().ToString("x4")).Append(" hier=").Append(r.U32().ToString("x8"));
            sb.Append(" dig=").Append(r.B2B().Length).Append(" remain=").Append(r.Remaining);
            return sb.ToString();
        }
        catch (Exception e) { return "FAIL " + e.Message; }
    }

    static string WalkNvPublic(byte[] p)
    {
        try
        {
            Rd r = new Rd(p);
            byte[] pub = r.B2B(); byte[] nm = r.B2B();
            Rd q = new Rd(pub);
            uint idx = q.U32(); ushort alg = q.U16(); uint attr = q.U32(); byte[] pol = q.B2B(); ushort sz = q.U16();
            return "pub=" + pub.Length + " name=" + nm.Length + " idx=" + idx.ToString("x8") + " alg=" + alg.ToString("x4")
                + " attr=" + attr.ToString("x8") + " pol=" + pol.Length + " data=" + sz + " pubRemain=" + q.Remaining + " outerRemain=" + r.Remaining;
        }
        catch (Exception e) { return "FAIL " + e.Message; }
    }

    static string WalkPolicySigned(byte[] p)
    {
        try
        {
            Rd r = new Rd(p);
            byte[] to = r.B2B(); ushort tag = r.U16(); uint hier = r.U32(); byte[] dig = r.B2B();
            return "timeout=" + to.Length + " tag=" + tag.ToString("x4") + " hier=" + hier.ToString("x8") + " dig=" + dig.Length + " remain=" + r.Remaining;
        }
        catch (Exception e) { return "FAIL " + e.Message; }
    }

    static void RunFault(string mode, int port, string stages)
    {
        SwtpmLoopbackTransport inner = new SwtpmLoopbackTransport("127.0.0.1", port);
        CountingTransport t = new CountingTransport(inner, mode);
        try
        {
            CeremonyReport r = new CeremonyRehearsal(t).Run(stages);
            Emit(mode, r, t, 0);
        }
        finally { inner.Dispose(); }
    }

    public static int Main(string[] args)
    {
        if (args.Length < 2) { Console.Error.WriteLine("usage: ProbeRunner <schema|fault> <port> [mode] [stages]"); return 2; }
        string kind = args[0];
        int port = int.Parse(args[1]);
        if (kind == "schema") { SchemaLab(port); return 0; }
        string mode = args.Length > 2 ? args[2] : "invalid-tag-success";
        string stages = args.Length > 3 ? args[3] : "ALL";
        RunFault(mode, port, stages);
        return 0;
    }
}
