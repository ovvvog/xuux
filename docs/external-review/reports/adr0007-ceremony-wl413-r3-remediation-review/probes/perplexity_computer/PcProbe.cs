// مسابرُ المراجعةِ المستقلةِ الثالثةِ — perplexity_computer (WL-414 / de099aa8)
// حقنُ أخطاءٍ مستقلٌّ عن أوضاعِ اختباراتِ المشروعِ: إعادةُ إنتاجِ عوائقِ الجولةِ الأولى
// (SOL413-01..08، G47-413-1..9) بمسابرَ خاصةٍ، ثمّ مسابرُ فجواتٍ جديدةٌ (B1..B8).
// كلُّ وضعٍ يُشغَّلُ على محاكٍ مستقلٍّ؛ الخروجُ 0 دائمًا (جامعُ الأدلةِ)، والنتيجةُ داخلَ JSON.

using System;
using System.Collections.Generic;
using System.IO;
using Xuux.TpmCeremony;

public sealed class PcFaultTransport : ICeremonyTransport
{
    private readonly ICeremonyTransport _inner;
    private readonly string _mode;
    public int Changes;
    public uint DefinedHandle;
    private uint _decoySession;
    private uint _primaryHandle;
    private bool _defineLost;

    public PcFaultTransport(ICeremonyTransport inner, string mode, bool decoy)
    {
        _inner = inner; _mode = mode;
        if (decoy)
        {
            byte[] z = new byte[32]; new System.Random(11).NextBytes(z);
            Resp p = Resp.Parse(inner.Transmit(Cmd.StartAuthSession(Tpm.SE_POLICY, z)), 1, Tpm.ST_NO_SESSIONS, 0);
            _decoySession = p.Handles[0];
        }
    }

    private static uint Cc(byte[] c) { return ((uint)c[6] << 24) | ((uint)c[7] << 16) | ((uint)c[8] << 8) | c[9]; }

    // إعادةُ بناءِ ردِّ ST_NO_SESSIONS بلا parameterSize (شكلُ ردودِ StartAuthSession/PolicySigned على swtpm)
    private static byte[] RebuildNoSessions(byte[] raw, int handles, byte[] newParams)
    {
        Rd r = new Rd(raw); r.U16(); r.U32(); r.U32();
        byte[] hs = r.Raw(4 * handles);
        byte[] body = new Wr().Raw(hs).Raw(newParams).Bytes();
        return new Wr().U16(Tpm.ST_NO_SESSIONS).U32((uint)(10 + body.Length)).U32(0).Raw(body).Bytes();
    }

    private static byte[] RebuildSessions(byte[] raw, int handles, byte[] newParams, byte[] newAuth)
    {
        Rd r = new Rd(raw); r.U16(); r.U32(); r.U32();
        byte[] hs = r.Raw(4 * handles);
        uint ps = r.U32(); byte[] prm = r.Raw((int)ps); byte[] auth = r.Raw(r.Remaining);
        if (newParams != null) prm = newParams;
        if (newAuth != null) auth = newAuth;
        byte[] body = new Wr().Raw(hs).U32((uint)prm.Length).Raw(prm).Raw(auth).Bytes();
        return new Wr().U16(Tpm.ST_SESSIONS).U32((uint)(10 + body.Length)).U32(0).Raw(body).Bytes();
    }

    public string Kind { get { return "pc-probe:" + _mode; } }

    public byte[] Transmit(byte[] command)
    {
        uint cc = Cc(command);

        // ── اعتراضاتُ ما قبلَ الإرسالِ ──
        // A5 (SOL413-05): إسقاطُ تعريفٍ قبلَ وصولِهِ للمحاكي (لم يُنفَّذْ)، ثمّ تشويهُ ردِّ الغيابِ 0x18B لاحقًا
        if (_mode == "A5-malformed-absence-18b" && cc == Tpm.CC_NV_DefineSpace && Changes == 0)
        {
            Changes++; _defineLost = true;
            throw new IOException("PC_DEFINE_DROPPED_BEFORE_EXECUTION");
        }

        byte[] raw = _inner.Transmit(command);
        Rd h = new Rd(raw); ushort tag = h.U16(); h.U32(); uint rc = h.U32();

        // A1 (SOL413-01): مقبضُ جلسةِ فخٍّ من خطِّ الأساسِ في ردِّ StartAuthSession
        if (_mode == "A1-session-alias-baseline" && cc == Tpm.CC_StartAuthSession && rc == 0 && _decoySession != 0)
        {
            Changes++;
            byte[] forged = (byte[])raw.Clone();
            forged[10] = (byte)(_decoySession >> 24); forged[11] = (byte)(_decoySession >> 16);
            forged[12] = (byte)(_decoySession >> 8); forged[13] = (byte)_decoySession;
            return forged;
        }

        // A2a (SOL413-02): more=1 مع count=0 في جردٍ
        if (_mode == "A2-inventory-no-progress" && cc == Tpm.CC_GetCapability && rc == 0 && Changes == 0)
        {
            Rd q = new Rd(raw); q.U16(); q.U32(); q.U32();
            byte more = q.U8(); uint cap = q.U32(); uint cnt = q.U32();
            if (cap == 1 && more == 0 && cnt == 0)
            {
                Changes++;
                byte[] forged = (byte[])raw.Clone(); forged[10] = 0x01;
                return forged;
            }
        }
        // A2b (SOL413-02): فئةٌ خاطئةٌ في جردٍ
        if (_mode == "A2-inventory-wrong-class" && cc == Tpm.CC_GetCapability && rc == 0 && Changes == 0)
        {
            Rd q = new Rd(raw); q.U16(); q.U32(); q.U32();
            byte more = q.U8(); uint cap = q.U32(); uint cnt = q.U32();
            if (cap == 1 && more == 0 && cnt == 0)
            {
                Changes++;
                byte[] body = new Wr().U8(0).U32(1).U32(1).U32(0x80000001).Bytes();
                return new Wr().U16(Tpm.ST_NO_SESSIONS).U32((uint)(10 + body.Length)).U32(0).Raw(body).Bytes();
            }
        }

        // A3 (SOL413-03/G47-413-2): hmac بايتٌ واحدٌ في ردِّ نجاحٍ بجلساتٍ
        if (_mode == "A3-auth-hmac-nonzero" && rc == 0 && tag == Tpm.ST_SESSIONS && Changes == 0)
        {
            Changes++;
            return RebuildSessions(raw, 0, null, new byte[] { 0x00, 0x00, 0x01, 0x00, 0x01, 0xFF });
        }

        // A4 (SOL413-04): publicArea فارغةٌ في ردِّ CreatePrimary
        if (_mode == "A4-public-empty" && rc == 0 && cc == Tpm.CC_CreatePrimary && Changes == 0)
        {
            Changes++;
            Rd q0 = new Rd(raw); q0.U16(); q0.U32(); q0.U32(); uint origHandle = q0.U32();
            uint ps = q0.U32(); byte[] prm = q0.Raw((int)ps); byte[] auth = q0.Raw(q0.Remaining);
            Rd q = new Rd(prm); q.B2B();
            byte[] np = new Wr().B2B(new byte[0]).Raw(q.Raw(q.Remaining)).Bytes();
            byte[] body = new Wr().U32(origHandle).U32((uint)np.Length).Raw(np).Raw(auth).Bytes();
            return new Wr().U16(Tpm.ST_SESSIONS).U32((uint)(10 + body.Length)).U32(0).Raw(body).Bytes();
        }

        // A7 (SOL413-07): parameterSize هائلٌ (0xFFFFFFF0)
        if (_mode == "A7-paramsize-huge" && rc == 0 && tag == Tpm.ST_SESSIONS && Changes == 0)
        {
            Changes++;
            byte[] forged = (byte[])raw.Clone();
            int off = 10 + 4 * (cc == Tpm.CC_CreatePrimary || cc == Tpm.CC_Load ? 1 : 0);
            forged[off] = 0x7F; forged[off + 1] = 0xFF; forged[off + 2] = 0xFF; forged[off + 3] = 0xF0;
            return forged;
        }

        // A5 (تكملة): تشويهُ ردِّ الغيابِ 0x18B في المصالحةِ (التعريفُ أُسقِطَ قبلَ التنفيذِ)
        if (_mode == "A5-malformed-absence-18b" && rc == 0x18B && cc == Tpm.CC_NV_ReadPublic && _defineLost)
        {
            Changes++;
            byte[] forged = (byte[])raw.Clone(); forged[0] = 0x12; forged[1] = 0x34;
            return forged;
        }

        // A8 (G47-413-1): فقدُ ردِّ التعريفِ بعدَ تنفيذِه
        if (_mode == "A8-define-response-loss" && cc == Tpm.CC_NV_DefineSpace && rc == 0 && Changes == 0)
        {
            Rd c = new Rd(command); c.U16(); c.U32(); c.U32(); c.U32(); uint a = c.U32(); c.Raw((int)a); c.B2B();
            byte[] pub = c.B2B(); DefinedHandle = new Rd(pub).U32();
            Changes++;
            throw new IOException("PC_RESPONSE_LOSS_AFTER_DEFINE_EXECUTION");
        }

        // A6 (SOL413-06): فقدُ ردِّ Create بعدَ تنفيذِه
        if (_mode == "A6-create-response-loss" && cc == Tpm.CC_Create && Changes == 0)
        {
            Changes++; // الأمرُ أُرسِلَ مرةً واحدةً في أعلى Transmit؛ يُرمى فقدُ الردِّ بعدَها
            throw new IOException("PC_CREATE_RESPONSE_LOSS");
        }
        // A6b (SOL413-06): فقدُ ردِّ PolicySigned السلبيِّ الثالثِ
        if (_mode == "A6-policysigned-neg-loss" && cc == Tpm.CC_PolicySigned)
        {
            Changes++;
            if (Changes == 3) throw new IOException("PC_NEGATIVE_POLICYSIGNED_LOSS"); // إرسالٌ واحدٌ في الأعلى
        }

        // A10 (G47-413-3): تجزئةُ SHA-1 في ردِّ Sign
        if (_mode == "A10-sign-sha1" && rc == 0 && cc == Tpm.CC_Sign && Changes == 0)
        {
            Changes++;
            Rd q0 = new Rd(raw); q0.U16(); q0.U32(); q0.U32(); uint ps = q0.U32();
            byte[] prm = q0.Raw((int)ps); byte[] auth = q0.Raw(q0.Remaining);
            Rd q = new Rd(prm); ushort a = q.U16(); q.U16(); byte[] r2 = q.B2B(); byte[] s2 = q.B2B();
            byte[] np = new Wr().U16(a).U16(0x0004).B2B(r2).B2B(s2).Bytes();
            byte[] body = new Wr().U32((uint)np.Length).Raw(np).Raw(auth).Bytes();
            return new Wr().U16(Tpm.ST_SESSIONS).U32((uint)(10 + body.Length)).U32(0).Raw(body).Bytes();
        }

        // B1: بايتٌ زائدٌ في ردِّ StartAuthSession بوسمِ ST_NO_SESSIONS (فحصُ شكلِ الردِّ بلا parameterSize)
        if (_mode == "B1-nosessions-trailing" && rc == 0 && cc == Tpm.CC_StartAuthSession && Changes == 0)
        {
            Changes++;
            Rd q = new Rd(raw); q.U16(); q.U32(); q.U32(); byte[] hs = q.Raw(4);
            byte[] body = new Wr().Raw(hs).Raw(q.Raw(q.Remaining)).Raw(new byte[] { 0xDE }).Bytes();
            return new Wr().U16(Tpm.ST_NO_SESSIONS).U32((uint)(10 + body.Length)).U32(0).Raw(body).Bytes();
        }
        // B2: nonceTPM بطولِ 1 في ردِّ StartAuthSession (بلا parameterSize)
        if (_mode == "B2-nosessions-nonce-1" && rc == 0 && cc == Tpm.CC_StartAuthSession && Changes == 0)
        {
            Changes++;
            return RebuildNoSessions(raw, 1, new Wr().B2B(new byte[] { 0xAB }).Bytes());
        }
        // B3: ردُّ Load يعيدُ مقبضَ الـprimary الذي أنشأتهُ الجولةُ نفسُها (استعارةٌ داخلية)
        uint _injectedLoadHandle = 0; // ميدانٌ حقيقيٌّ لاحقًا
        if (_mode == "B3-load-alias-run-handle" && rc == 0 && cc == Tpm.CC_CreatePrimary && Changes == 0)
        {
            Changes++;
            Rd q = new Rd(raw); q.U16(); q.U32(); q.U32(); _primaryHandle = q.U32(); // المقبضُ بعدَ الرأسِ
        }
        if (_mode == "B3-load-alias-run-handle" && rc == 0 && cc == Tpm.CC_Load && _primaryHandle != 0)
        {
            Changes++;
            Rd orig = new Rd(raw); orig.U16(); orig.U32(); orig.U32(); uint realLoad = orig.U32();
            byte[] forged = (byte[])raw.Clone();
            forged[10] = (byte)(_primaryHandle >> 24); forged[11] = (byte)(_primaryHandle >> 16);
            forged[12] = (byte)(_primaryHandle >> 8); forged[13] = (byte)_primaryHandle;
            _injectedLoadHandle = _primaryHandle;
            Console.Error.WriteLine("B3: primaryHandle=" + Hex.U32(_primaryHandle) + " realLoadHandle=" + Hex.U32(realLoad) + " injected=" + Hex.U32(_injectedLoadHandle) + " differs=" + (realLoad != _primaryHandle));
            return forged;
        }
        // B5: تكرارُ المقبضِ نفسِهِ مرتينِ في صفحةِ جردٍ
        if (_mode == "B5-inventory-duplicate" && cc == Tpm.CC_GetCapability && rc == 0 && Changes == 0)
        {
            Rd q = new Rd(raw); q.U16(); q.U32(); q.U32();
            byte more = q.U8(); uint cap = q.U32(); uint cnt = q.U32();
            if (cap == 1 && more == 0 && cnt == 0) // أولُ صفحةِ جردٍ فارغةٍ: يُصنَّعُ تكرارٌ فعليٌّ (المقبضُ نفسُهُ مرتينِ)
            {
                Changes++;
                uint phantom = 0x01000001;
                Console.Error.WriteLine("B5: firing on first empty handles page; fabricating count=2 with " + Hex.U32(phantom) + " twice");
                byte[] body = new Wr().U8(0).U32(1).U32(2).U32(phantom).U32(phantom).Bytes();
                return new Wr().U16(Tpm.ST_NO_SESSIONS).U32((uint)(10 + body.Length)).U32(0).Raw(body).Bytes();
            }
        }
        // B6: timeout هائلٌ (200 بايت) في ردِّ PolicySigned — الشكلُ الفعليُّ ST_NO_SESSIONS بلا parameterSize
        if (_mode == "B6-policysigned-huge-timeout" && rc == 0 && cc == Tpm.CC_PolicySigned && Changes == 0)
        {
            Changes++;
            Rd s = new Rd(raw); s.U16(); s.U32(); s.U32(); byte[] prm = s.Raw(s.Remaining);
            Rd q = new Rd(prm); q.B2B(); ushort tt = q.U16(); uint hh = q.U32(); byte[] td = q.B2B();
            byte[] big = new byte[200]; for (int i = 0; i < 200; i++) big[i] = (byte)(i & 0xFF);
            byte[] np = new Wr().B2B(big).U16(tt).U32(hh).B2B(td).Bytes();
            Console.Error.WriteLine("B6: injecting 200-byte timeout on PolicySigned success response (tag=0x" + tag.ToString("x4") + ")");
            return RebuildNoSessions(raw, 0, np);
        }
        // B7: ردٌّ بوسمِ NO_SESSIONS لأمرٍ أُرسلَ بجلساتٍ (إسقاطُ التفويضِ وإعادةُ الوسمِ)
        if (_mode == "B7-nosessions-for-sessions-cmd" && rc == 0 && tag == Tpm.ST_SESSIONS && Changes == 0)
        {
            Changes++;
            Rd q = new Rd(raw); q.U16(); q.U32(); q.U32();
            byte[] hs = q.Raw(4 * (cc == Tpm.CC_CreatePrimary || cc == Tpm.CC_Load ? 1 : 0));
            byte[] prm = q.Raw(q.Remaining);
            byte[] body = new Wr().Raw(hs).Raw(prm).Bytes();
            return new Wr().U16(Tpm.ST_NO_SESSIONS).U32((uint)(10 + body.Length)).U32(0).Raw(body).Bytes();
        }
        // B4: سماتٌ ببتٍّ محجوزٍ عالٍ (0x10) مع nonce سليم 32 بايتًا في ردِّ جلسةِ سياسةٍ
        if (_mode == "B4-auth-attrs-reserved-high" && rc == 0 && tag == Tpm.ST_SESSIONS && Changes == 0)
        {
            Changes++;
            byte[] nonce = new byte[32]; for (int i = 0; i < 32; i++) nonce[i] = (byte)i;
            byte[] auth = new byte[2 + 32 + 1 + 2];
            auth[0] = 0x00; auth[1] = 0x20;
            Buffer.BlockCopy(nonce, 0, auth, 2, 32);
            auth[34] = 0x10; // بتٌّ محجوزٌ عالٍ
            auth[35] = 0x00; auth[36] = 0x00; // hmac فارغٌ
            return RebuildSessions(raw, 0, null, auth);
        }
        // B8: ملفُّ تفويضٍ مختلطٌ (nonce فارغٌ مع hmac غيرِ فارغٌ)
        if (_mode == "B8-auth-mixed-profile" && rc == 0 && tag == Tpm.ST_SESSIONS && Changes == 0)
        {
            Changes++;
            return RebuildSessions(raw, 0, null, new byte[] { 0x00, 0x00, 0x01, 0x00, 0x01, 0x41 });
        }
        // B9: ملفُّ سياسةٍ كاملٌ (nonce=32, attrs=0x00, hmac=0) في ردِّ أمرٍ أُرسِلَ بتفويضِ كلمةِ سرٍّ
        // (فحصُ ربطِ الملفِّ بنوعِ الجلسةِ المطلوبةِ: هل يقبلُ المحللُ أيَّ الملفينِ بلا ربطٍ بالطلبِ؟)
        if (_mode == "B9-policy-profile-on-password-cmd" && rc == 0 && tag == Tpm.ST_SESSIONS && Changes == 0)
        {
            Changes++;
            byte[] nonce = new byte[32]; for (int i = 0; i < 32; i++) nonce[i] = (byte)i;
            byte[] auth = new byte[2 + 32 + 1 + 2];
            auth[0] = 0x00; auth[1] = 0x20;
            Buffer.BlockCopy(nonce, 0, auth, 2, 32);
            auth[34] = 0x00; // attrs=0x00
            auth[35] = 0x00; auth[36] = 0x00; // hmac فارغٌ
            Console.Error.WriteLine("B9: injecting policy-profile auth (nonce=32 attrs=0x00) on first ST_SESSIONS response");
            return RebuildSessions(raw, 0, null, auth);
        }
        return raw;
    }
}

public static class PcProbe
{
    private static void RunOne(string mode, bool decoy, string dir, int port)
    {
        string state = Path.Combine(dir, "st-" + mode);
        if (Directory.Exists(state)) Directory.Delete(state, true);
        Directory.CreateDirectory(state);
        string pidFile = Path.Combine(dir, "pid-" + mode);
        System.Diagnostics.Process sw = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(
            "swtpm", "socket --tpm2 --tpmstate dir=" + state +
            " --server type=tcp,port=" + port + ",bindaddr=127.0.0.1" +
            " --ctrl type=tcp,port=" + (port + 1) + ",bindaddr=127.0.0.1" +
            " --flags not-need-init,startup-clear --pid file=" + pidFile + " --daemon"));
        sw.WaitForExit();
        System.Threading.Thread.Sleep(500);
        string outcome = "no-exception";
        string reportJson = null;
        try
        {
            using (var inner = new SwtpmLoopbackTransport("127.0.0.1", port))
            {
                var t = new PcFaultTransport(inner, mode, decoy);
                var rehearsal = new CeremonyRehearsal(t);
                CeremonyReport rep = rehearsal.Run("ALL");
                reportJson = rep.ToJson();
            }
        }
        catch (Exception e)
        {
            outcome = e.GetType().Name + ": " + e.Message;
        }
        string summary = "{\"mode\":\"" + mode + "\",\"outcome\":\"" + outcome.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\""
            + (reportJson != null ? ",\"report\":" + reportJson : "") + "}";
        File.WriteAllText(Path.Combine(dir, mode + ".json"), summary);
        Console.WriteLine("== " + mode + " => " + outcome);
        try
        {
            if (File.Exists(pidFile))
            {
                string pid = File.ReadAllText(pidFile).Trim();
                System.Diagnostics.Process.Start("kill", pid);
            }
        }
        catch { }
        System.Threading.Thread.Sleep(400);
    }

    public static int Main(string[] args)
    {
        string dir = args.Length > 0 ? args[0] : ".";
        int port = args.Length > 1 ? int.Parse(args[1]) : 4300;
        string[] modes = {
            "A1-session-alias-baseline", "A2-inventory-no-progress", "A2-inventory-wrong-class",
            "A3-auth-hmac-nonzero", "A4-public-empty", "A5-malformed-absence-18b",
            "A6-create-response-loss", "A6-policysigned-neg-loss", "A7-paramsize-huge",
            "A8-define-response-loss", "A10-sign-sha1",
            "B1-nosessions-trailing", "B2-nosessions-nonce-1", "B3-load-alias-run-handle",
            "B4-auth-attrs-reserved-high", "B5-inventory-duplicate", "B6-policysigned-huge-timeout",
            "B7-nosessions-for-sessions-cmd", "B8-auth-mixed-profile",
            "B9-policy-profile-on-password-cmd"
        };
        if (args.Length > 2) modes = new string[] { args[2] };
        foreach (string m in modes)
        {
            RunOne(m, m == "A1-session-alias-baseline", dir, port);
            port += 4;
        }
        return 0;
    }
}
