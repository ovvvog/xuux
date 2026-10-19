// WL-416 — مسبارُ رجوعِ ResponseContext المتوافقُ مع خطِّ الأساسِ e23bd431.
// يستعملُ واجهاتٍ موجودةً في النسختَين وحدَها: Cmd، Templates، SwtpmLoopbackTransport،
// ResponseContext.Record، وResponseSchema.Check(cc, cmd, prm, ctx). والشاهدُ هو حكمُ الفاحصِ (قبولٌ/رفضٌ
// باسمِه) على ردودِ swtpm حقيقيّةٍ — سلوكٌ خارجيٌّ لا حالةٌ داخليّة (لا TryObject ولا Knows).
// على النسخةِ المصحّحةِ وحدَها يُستدعى ResponseContext.EndOfLife بالانعكاسِ بعدَ إثباتِ الغيابِ بجردٍ قرائيّ —
// وهي الخطوةُ نفسُها التي ينفّذُها ReconcileOne في مسارِ البروفة؛ وعلى e23bd431 لا وجودَ لها فلا تُستدعى.
// السيناريو: مقبضُ Primary يُحرَّرُ وردُّ التحريرِ يضيعُ (الأمرُ نُفِّذَ ولم يُسجَّل)، فيُثبَتُ الغيابُ،
// ثمّ يُعادُ استعمالُ رقمِ المقبضِ بهويّةٍ جديدةٍ، ويُفحَصُ ردُّ Create صحيحٌ على المقبضِ المعاد.
using System;
using System.Collections.Generic;
using Xuux.TpmCeremony;

public static class CtxRegressionProbe
{
    static uint U32(byte[] b, int o) { return ((uint)b[o] << 24) | ((uint)b[o + 1] << 16) | ((uint)b[o + 2] << 8) | b[o + 3]; }

    static byte[] Params(byte[] r, int handles)
    {
        int o = 10 + 4 * handles;
        if (r[1] == 2) { int n = (int)U32(r, o); byte[] p = new byte[n]; Array.Copy(r, o + 4, p, 0, n); return p; }
        byte[] q = new byte[r.Length - o]; Array.Copy(r, o, q, 0, q.Length); return q;
    }

    static byte[] Ok(ICeremonyTransport t, byte[] cmd, string what)
    {
        byte[] r = t.Transmit(cmd);
        if (U32(r, 6) != 0) throw new InvalidOperationException(what + " rc=0x" + U32(r, 6).ToString("x8"));
        return r;
    }

    // جردٌ قرائيٌّ للمقابضِ العابرةِ — إثباتُ حضورٍ/غيابٍ بلا مساسٍ بالحالة.
    static bool Present(ICeremonyTransport t, uint handle)
    {
        uint start = 0x80000000;
        for (int page = 0; page < 16; page++)
        {
            byte[] r = Ok(t, Cmd.GetCapability(1, start, 64), "getcap");
            byte[] p = Params(r, 0);
            byte more = p[0]; uint n = U32(p, 5); uint last = 0;
            for (uint i = 0; i < n; i++) { uint h = U32(p, 9 + 4 * (int)i); if (h == handle) return true; last = h; }
            if (more == 0 || n == 0) return false;
            start = last + 1;
        }
        throw new InvalidOperationException("inventory incomplete");
    }

    // هويّةٌ جديدةٌ: القالبُ نفسُه بحقلِ unique مختلفٍ (بذرةٌ أخرى لاشتقاقِ المفتاح) ⇒ اسمٌ آخرُ على المقبضِ نفسِه.
    static byte[] TemplateB()
    {
        byte[] a = Templates.StoragePrimary();
        byte[] u = new byte[32]; for (int i = 0; i < 32; i++) u[i] = 0x42;
        List<byte> b = new List<byte>(a);
        b.RemoveRange(a.Length - 4, 4);
        b.Add(0); b.Add(32); b.AddRange(u); b.Add(0); b.Add(32); b.AddRange(u);
        return b.ToArray();
    }

    static string Verdict(uint cc, byte[] cmd, byte[] prm, ResponseContext ctx)
    {
        try { ResponseSchema.Check(cc, cmd, prm, ctx); return "ACCEPT"; }
        catch (Exception e) { return "REJECT " + e.Message; }
    }

    static string ParentName(byte[] createPrm)
    {
        Rd r = new Rd(createPrm); r.B2B(); r.B2B(); byte[] cd = r.B2B();
        // آخرُ ثلاثةِ حقولٍ في بياناتِ الإنشاءِ: parentName، parentQualifiedName، outsideInfo — يكفي البصمةُ المختصرة.
        return BitConverter.ToString(Sha.H(cd)).Replace("-", "").Substring(0, 16);
    }

    // يقلبُ بايتًا داخلَ parentName في بياناتِ الإنشاءِ (ردٌّ غيرُ صالحٍ مبنيٌّ من الردِّ الصحيح).
    static byte[] TamperParentName(byte[] prm)
    {
        byte[] x = (byte[])prm.Clone();
        Rd r = new Rd(x); r.B2B(); r.B2B();
        int cdStart = x.Length - r.Remaining + 2; // بدايةُ محتوى creationData
        Rd c = new Rd(r.B2B());
        uint count = c.U32();
        int off = 4;
        for (uint i = 0; i < count; i++) { c.U16(); byte sz = c.U8(); c.Raw(sz); off += 3 + sz; }
        ushort dlen = c.U16(); off += 2 + dlen; // pcrDigest
        off += 1 + 2; // locality + parentNameAlg
        off += 2;     // طولُ parentName
        x[cdStart + off + 5] ^= 0x01;
        return x;
    }

    public static List<string> Run(string host, int port)
    {
        List<string> o = new List<string>();
        var eol = typeof(ResponseContext).GetMethod("EndOfLife");
        o.Add("core: EndOfLife " + (eol == null ? "absent (baseline)" : "present (fixed)"));
        byte[] tA = Templates.StoragePrimary();
        byte[] tB = TemplateB();
        string[] cases = { "recorded-reuse-new-identity", "unrecorded-reuse-new-identity", "unrecorded-reuse-same-identity", "invalid-response-recorded-reuse" };
        foreach (string cs in cases)
        {
            using (var t = new SwtpmLoopbackTransport(host, port))
            {
                var ctx = new ResponseContext();
                // 1) Primary بالهويّة A يُنشأُ ويُسجَّلُ كما تفعلُ البروفة.
                byte[] ca = Cmd.CreatePrimary(new byte[0], tA);
                byte[] ra = Ok(t, ca, "primaryA");
                uint h = U32(ra, 10);
                ctx.Record(Tpm.CC_CreatePrimary, ca, new uint[] { h }, Params(ra, 1));
                // 2) التحريرُ يُنفَّذُ وردُّه يضيعُ: لا Record (نتيجةٌ مجهولةٌ للبروفة).
                t.Transmit(Cmd.FlushContext(h));
                bool absent = !Present(t, h);
                // 3) إثباتُ الغيابِ بجردٍ قرائيّ ⇒ في النسخةِ المصحّحةِ: خطوةُ ReconcileOne (EndOfLife).
                if (absent && eol != null) eol.Invoke(ctx, new object[] { h });
                // 4) إعادةُ استعمالِ رقمِ المقبض.
                byte[] tpl = cs == "unrecorded-reuse-same-identity" ? tA : tB;
                byte[] cb = Cmd.CreatePrimary(new byte[0], tpl);
                byte[] rb = Ok(t, cb, "reuse");
                uint h2 = U32(rb, 10);
                bool recorded = cs.StartsWith("recorded") || cs.StartsWith("invalid");
                if (recorded) ctx.Record(Tpm.CC_CreatePrimary, cb, new uint[] { h2 }, Params(rb, 1));
                // 5) ردُّ Create حقيقيٌّ على المقبضِ المعاد.
                byte[] cc = Cmd.Create(h2, new byte[0], Templates.ServiceSigningKey());
                byte[] rc = Ok(t, cc, "create");
                byte[] prm = Params(rc, 0);
                string verdict = cs.StartsWith("invalid") ? Verdict(Tpm.CC_Create, cc, TamperParentName(prm), ctx) : Verdict(Tpm.CC_Create, cc, prm, ctx);
                o.Add(cs + ": handle=0x" + h.ToString("x8") + " flushExecutedResponseDropped=True absentByInventory=" + absent +
                      " reusedHandle=0x" + h2.ToString("x8") + " sameNumber=" + (h2 == h) + " reuseRecorded=" + recorded +
                      " identity=" + (tpl == tA ? "A" : "B") + " creationDataSha=" + ParentName(prm) + " verdict=" + verdict);
                Ok(t, Cmd.FlushContext(h2), "cleanup");
                if (Present(t, h2)) throw new InvalidOperationException("cleanup left handle");
            }
        }
        o.Add("probe: done");
        return o;
    }
}
