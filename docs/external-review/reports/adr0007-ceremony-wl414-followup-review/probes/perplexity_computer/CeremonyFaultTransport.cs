// مسابرُ جولةِ المتابعةِ WL-414 على رأسِ الفرعِ — ناقلُ حقنٍ مستقلٌّ خارجَ شجرةِ المشروعِ
// (على غرارِ IndependentR3.cs للجولةِ الثالثةِ). لا يُعدِّلُ الملفاتِ المتتبَّعةَ في الشجرة.
using System;
using System.Collections.Generic;
using System.IO;
using Xuux.TpmCeremony;

namespace Xuux.TpmCeremony
{
    // ناقلُ مسابرِ جولةِ المتابعةِ: يزرعُ المواردَ الأجنبيّةَ والكائناتِ الحارسةَ قبلَ البروفةِ
    // عندَ الحاجةِ، ويعيدُ كتابةَ ردودٍ محدّدةً أو يُفقدُها فعلًا وفقَ الوضعِ المطلوبِ.
    public sealed class CeremonyFaultTransport : ICeremonyTransport
    {
        private readonly ICeremonyTransport _inner;
        private readonly string _mode;
        public int Changes;
        public uint ForeignNv = 0;
        public readonly List<uint> Sentinels = new List<uint>();
        public readonly List<string> Substitutions = new List<string>();
        public readonly List<uint> Flushed = new List<uint>();

        public CeremonyFaultTransport(ICeremonyTransport inner, string mode, bool ignored)
        {
            _inner = inner; _mode = mode;
            // وضعُ التنظيفِ: زرعُ فهرسِ NV أجنبيٍّ (0x01000010) قبلَ البروفةِ — ليس من خطِّ
            // أساسِ البروفةِ الافتراضيّ الفارغِ، فإذا حذفَهُ التنظيفُ فهو حذفُ موردٍ غيرِ مملوكٍ.
            if (_mode == "cleanup-foreign-nv" || _mode == "define-loss-foreign-nv")
            {
                byte[] pub = Cmd.NvPublic(0x01000010u, Tpm.S1_PROBE_ATTRIBUTES, new byte[0], 8);
                Resp d = Resp.Parse(_inner.Transmit(Cmd.NvDefineSpace(new byte[0], new byte[0], pub)),
                    0, Tpm.ST_SESSIONS, 1, new bool[] { true });
                if (d.Rc != 0) throw new CeremonyFailedException("PROBE_FOREIGN_NV_DEFINE_FAILED rc=" + Hex.U32(d.Rc), 0);
                ForeignNv = 0x01000010u;
            }
            // هجومُ R3SOL-01: زرعُ كائنَي تخزينٍ أوليَّينِ قبلَ البروفةِ (كمَا في مسبرِ gpt_6_1_sol الخامِّ).
            if (_mode == "r3sol01-replay")
            {
                for (int i = 0; i < 2; i++)
                {
                    byte[] raw = _inner.Transmit(Cmd.CreatePrimary(new byte[0], Templates.StoragePrimary()));
                    if (((raw[6] << 24) | (raw[7] << 16) | (raw[8] << 8) | raw[9]) != 0)
                        throw new CeremonyFailedException("PROBE_SENTINEL_CREATE_FAILED", 0);
                    Sentinels.Add(((uint)raw[10] << 24) | ((uint)raw[11] << 16) | ((uint)raw[12] << 8) | raw[13]);
                }
            }
        }

        public string Kind { get { return "test:wl414-followup-" + _mode; } }

        private static uint Cc(byte[] command)
        {
            return ((uint)command[6] << 24) | ((uint)command[7] << 16) | ((uint)command[8] << 8) | command[9];
        }

        // معاملاتُ أمرٍ بلا مقابضَ ولا تفويضٍ (GetCapability): capability ثمّ property ثمّ count.
        private static uint CapProp(byte[] command)
        {
            return ((uint)command[14] << 24) | ((uint)command[15] << 16) | ((uint)command[16] << 8) | command[17];
        }

        // صفحةُ جردِ مقابضَ GetCapability: more(1) + capability(4) + count(4) + مقابضُ 4 بايت.
        private static byte[] CapPage(byte more, params uint[] handles)
        {
            Wr p = new Wr().U8(more).U32(1).U32((uint)handles.Length);
            foreach (uint h in handles) p.U32(h);
            return p.Bytes();
        }

        private static byte[] NoSessions(byte[] body)
        {
            return new Wr().U16(Tpm.ST_NO_SESSIONS).U32((uint)(10 + body.Length)).U32(0).Raw(body).Bytes();
        }

        private static byte[] RewriteAuth(byte[] raw, int handles, byte[] newAuth)
        {
            Rd r = new Rd(raw); r.U16(); r.U32(); r.U32();
            byte[] hs = r.Raw(4 * handles);
            uint ps = r.U32(); byte[] prm = r.Raw((int)ps); byte[] auth = r.Raw(r.Remaining);
            byte[] body = new Wr().Raw(hs).U32((uint)prm.Length).Raw(prm).Raw(newAuth).Bytes();
            return new Wr().U16(Tpm.ST_SESSIONS).U32((uint)(10 + body.Length)).U32(0).Raw(body).Bytes();
        }

        public delegate byte[] ParamRewrite(byte[] oldParams);

        private static byte[] RewriteParams(byte[] raw, int handles, ParamRewrite f)
        {
            Rd r = new Rd(raw); r.U16(); r.U32(); r.U32();
            byte[] hs = r.Raw(4 * handles);
            uint ps = r.U32(); byte[] prm = r.Raw((int)ps); byte[] auth = r.Raw(r.Remaining);
            byte[] np = f(prm);
            byte[] body = new Wr().Raw(hs).U32((uint)np.Length).Raw(np).Raw(auth).Bytes();
            return new Wr().U16(Tpm.ST_SESSIONS).U32((uint)(10 + body.Length)).U32(0).Raw(body).Bytes();
        }

        public byte[] Transmit(byte[] command)
        {
            uint cc = Cc(command);
            byte[] raw = _inner.Transmit(command);
            ushort tag = (ushort)((raw[0] << 8) | raw[1]);
            uint rc = ((uint)raw[6] << 24) | ((uint)raw[7] << 16) | ((uint)raw[8] << 8) | raw[9];

            // ===== المسبر 1أ: خطُّ أساسٍ جزئيٌّ (أولويةُ 3 — سلوكُ R3SOL-04) =====
            // أولُ جردٍ للمتحوّلاتِ العابرةِ (property=0x80000000) يُعادُ بفهرسٍ من فئةِ NV
            // (0x01) ⇒ HandleSet يرمي CLASS_MALFORMED داخلَ SnapshotBaseline ⇒ خطُّ أساسٍ
            // جزئيٌّ: _baselineNv/_baselineSessions مضبوطانِ و_baselineTransients غائبٌ.
            // التوقّعُ: FAILED_CLOSED مسمّى + postRunInventory.verified=false برسالةِ
            // "partial baseline" — لا "COMPLETE" ولا جردٌ موثوقٌ ولا مقارنةُ بقايا.
            if (_mode == "baseline-partial" && cc == Tpm.CC_GetCapability && rc == 0
                && CapProp(command) == 0x80000000u && Changes == 0)
            {
                Changes++;
                return NoSessions(CapPage(0, 0x01000001u));
            }

            // ===== المسبر 1ب: تكرارٌ عبرَ صفحتَي جردٍ (أولويةُ 1) =====
            // صفحتانِ صالحتانِ بنيويًّا (تصاعديّةٌ، ضمنَ الفئةِ، فوقَ نقطةِ البدءِ) يتكرّرُ فيها
            // المقبضُ 0x01000002 عبرَ الصفحتَينِ: فحصُ الصفحةِ الواحدةِ لا يكفي — تكتشفُهُ
            // مجموعةُ NvHandles (DUPLICATE_HANDLE) لأنّ الجردَ يجمّعُ الصفحاتِ، وفحصُ
            // خاصيةِ البدءِ يرفضُ الصفحةَ الثانيةَ (مقبضٌ دونَ الخاصيةِ المطلوبةِ) رفضًا مسمّى.
            if (_mode == "nv-cross-page-duplicate" && cc == Tpm.CC_GetCapability && rc == 0
                && (CapProp(command) & 0xFF000000u) == 0x01000000u)
            {
                byte[] page = (Changes == 0)
                    ? CapPage(1, 0x01000001u, 0x01000002u)
                    : CapPage(0, 0x01000002u, 0x01000003u);
                Changes++;
                return NoSessions(page);
            }

            // ===== المسبر 1ج: تكرارٌ متعدّدٌ داخلَ صفحةٍ واحدةٍ (أولويةُ 1) =====
            if (_mode == "nv-multi-duplicate" && cc == Tpm.CC_GetCapability && rc == 0
                && (CapProp(command) & 0xFF000000u) == 0x01000000u && Changes == 0)
            {
                Changes++;
                return NoSessions(CapPage(0, 0x01000001u, 0x01000001u, 0x01000002u, 0x01000002u));
            }

            // ===== المسبر 1د: ترتيبٌ تنازليٌّ صارمٌ (أولويةُ 1) =====
            if (_mode == "nv-descending" && cc == Tpm.CC_GetCapability && rc == 0
                && (CapProp(command) & 0xFF000000u) == 0x01000000u && Changes == 0)
            {
                Changes++;
                return NoSessions(CapPage(0, 0x01000003u, 0x01000002u, 0x01000001u));
            }

            // ===== المسبر 1هـ: مقبضٌ دونَ نقطةِ البدءِ المطلوبةِ (أولويةُ 1) =====
            if (_mode == "nv-below-start" && cc == Tpm.CC_GetCapability && rc == 0
                && (CapProp(command) & 0xFF000000u) == 0x01000000u && Changes == 0)
            {
                Changes++;
                return NoSessions(CapPage(0, 0x00FFFFFFu));
            }

            // ===== المسبر 1و: إعادةُ هجومِ R3SOL-01 كاملًا (أولويةُ 1) =====
            // البنيةُ الأصليةُ لمسبرِ gpt_6_1_sol: كائنَا تخزينٍ حارسانِ (S0 وS1) مزروعانِ قبلَ
            // البروفةِ؛ صفحةُ جردِ المتحوّلاتِ تُستبدَلُ بـ[S0,S0] (مكرَّرٌ يخفي S1)؛ ومرحلةُ
            // الاستبدالِ مسلَّحةٌ: مقبضُ ردِّ CreatePrimary الأول يُستبدَلُ بالضحيةِ S1 كما في
            // المسبرِ الأصليِّ (primary-alias). التوقّعُ على الرأسِ المصحَّحِ: الرفضُ المسمّى
            // عندَ خطِّ الأساسِ (ORDER/DUPLICATE) قبلَ أيِّ أمرٍ مُغيّرٍ فتنكسرُ السلسلةُ عندَ
            // حلقتِها الأولى، والضحيةُ S1 تبقى موجودةً غيرَ مسوسةٍ (لا استبدالَ ولا تحريرَ).
            if (_mode == "r3sol01-replay" && cc == Tpm.CC_GetCapability && rc == 0
                && CapProp(command) == 0x80000000u && Changes == 0)
            {
                Changes++;
                return NoSessions(CapPage(0, Sentinels[0], Sentinels[0]));
            }
            if (_mode == "r3sol01-replay" && cc == Tpm.CC_CreatePrimary && rc == 0 && Changes >= 1)
            {
                uint actual = ((uint)raw[10] << 24) | ((uint)raw[11] << 16) | ((uint)raw[12] << 8) | raw[13];
                if (actual != Sentinels[1])
                {
                    Changes++;
                    byte[] forged = (byte[])raw.Clone();
                    forged[10] = (byte)(Sentinels[1] >> 24); forged[11] = (byte)(Sentinels[1] >> 16);
                    forged[12] = (byte)(Sentinels[1] >> 8); forged[13] = (byte)Sentinels[1];
                    Substitutions.Add("primary-handle:" + Hex.U32(actual) + "=>" + Hex.U32(Sentinels[1]));
                    return forged;
                }
            }
            if (_mode == "r3sol01-replay" && cc == Tpm.CC_FlushContext)
            {
                Flushed.Add(((uint)command[10] << 24) | ((uint)command[11] << 16) | ((uint)command[12] << 8) | command[13]);
            }

            // ===== المسبر 2أ: ملفُّ كلمةِ السرِّ في ردِّ أمرٍ بجلسةِ سياسةٍ (أولويةُ 2) =====
            // العكسُ المباشرُ للوضعِ المرفقِ auth-cross-policy-on-password: أولُ ردِّ ST_SESSIONS
            // لأمرِ NV_Increment بجلسةِ سياسةٍ يُعادُ بملفِّ كلمةِ السرِّ (nonce فارغٌ + attrs=0x01
            // + hmac فارغٌ): التوقّعُ RESPONSE_AUTH_CONTENT_MALFORMED برسالةِ expected=policy.
            if (_mode == "auth-password-on-policy" && rc == 0 && tag == Tpm.ST_SESSIONS
                && cc == Tpm.CC_NV_Increment && Changes == 0)
            {
                Rd a = new Rd(raw); a.U16(); a.U32(); a.U32(); uint ps = a.U32(); a.Raw((int)ps);
                if (a.B2B().Length == 32)
                {
                    Changes++;
                    byte[] newAuth = new Wr().B2B(new byte[0]).U8(0x01).B2B(new byte[0]).Bytes();
                    return RewriteAuth(raw, 0, newAuth);
                }
            }

            // ===== المسبر 2ب: هرميةُ منصةٍ صالحةٌ في تذكرةِ الإنشاءِ (أولويةُ 2) =====
            // RH_PLATFORM (0x4000000C) قيمةٌ صالحةٌ في TPMS_ID_OBJECT: يثبتُ هذا المسبرُ أنّ
            // المحلّلَ يقبلُ القيمةَ الصالحةَ (لا رفضًا مفرِطًا). قبولُ المحلّلِ لا يثبتْ صحةً
            // تشفيريّةً كاملةً للتذكرةِ — تلكَ لا تُقاسُ هنا وتُوثَّقُ كحدٍّ.
            if (_mode == "ticket-hierarchy-platform-valid" && rc == 0 && cc == Tpm.CC_CreatePrimary
                && tag == Tpm.ST_SESSIONS && Changes == 0)
            {
                Changes++;
                return RewriteParams(raw, 1, delegate(byte[] prm)
                {
                    Rd q = new Rd(prm); byte[] pub = q.B2B(); byte[] cd = q.B2B(); byte[] ch = q.B2B();
                    ushort ttag = q.U16(); uint hh = q.U32(); byte[] td = q.B2B(); byte[] nm = q.Raw(q.Remaining);
                    return new Wr().B2B(pub).B2B(cd).B2B(ch).U16(ttag).U32(0x4000000Cu).B2B(td).Raw(nm).Bytes();
                });
            }

            // ===== المسبر 2ج: هرميةُ اعتمادٍ صالحةٌ في تذكرةِ الإنشاءِ (أولويةُ 2) =====
            if (_mode == "ticket-hierarchy-endorsement-valid" && rc == 0 && cc == Tpm.CC_CreatePrimary
                && tag == Tpm.ST_SESSIONS && Changes == 0)
            {
                Changes++;
                return RewriteParams(raw, 1, delegate(byte[] prm)
                {
                    Rd q = new Rd(prm); byte[] pub = q.B2B(); byte[] cd = q.B2B(); byte[] ch = q.B2B();
                    ushort ttag = q.U16(); uint hh = q.U32(); byte[] td = q.B2B(); byte[] nm = q.Raw(q.Remaining);
                    return new Wr().B2B(pub).B2B(cd).B2B(ch).U16(ttag).U32(0x4000000Bu).B2B(td).Raw(nm).Bytes();
                });
            }

            // ===== المسبر 4: فقدُ ردِّ تعريفِ البروفةِ فعلًا مع فهرسٍ أجنبيٍّ مزروعٍ (أولويةُ 4) =====
            // فقدٌ فعليٌّ (IOException بعدَ تنفيذِ الأمرِ — نفسُ منطقِ الوضعِ المرفقِ define-response-loss)
            // مع فهرسٍ أجنبيٍّ 0x01000010 مزروعٍ سلفًا: التوقّعُ — فهرسُ البروفةِ يُعلَنُ مجهولَ
            // الملكيّةِ متبقّيًا لا محذوفًا، والفهرسُ الأجنبيُّ يبقى دونَ حذفٍ (ليسَ من _definedByRun).
            if (_mode == "define-loss-foreign-nv" && cc == Tpm.CC_NV_DefineSpace && Changes == 0)
            {
                Changes++;
                throw new IOException("WL414_FOLLOWUP_RESPONSE_LOSS_AFTER_DEFINE_EXECUTION");
            }

            return raw;
        }
    }
}
