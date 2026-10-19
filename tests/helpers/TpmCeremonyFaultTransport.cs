// tests/helpers/TpmCeremonyFaultTransport.cs
//
// أدواتُ اختبارٍ (WL-412؛ WL-413) لنواةِ البروفة sim/tpm-ceremony/TpmCeremonyCore.cs — لا تُشحَنُ مع الأداة.
//   BlockingTransport : يلفُّ نقلَ المحاكي؛ عندَ ظهورِ كودِ الأمرِ المستهدفِ (المرّةَ n، أو كلَّ ظهورٍ
//                       بـBlockAll) لا يُمرِّرُه ويعيدُ ردَّ Windows TBS: TPM_E_COMMAND_BLOCKED (0x80280400) —
//                       حقنُ خطأٍ داخلَ الاختبار، لا ادّعاءٌ بسلوكِ TBS الحقيقيّ.
//   ForeignIdentityTransport : يجيبُ استعلامَ الهويّةِ بمصنّعٍ غيرِ المحاكي ("IFX") ويسجّلُ كلَّ ما عداه.
//   CeremonyFaultTransport : أوضاعُ مسابرِ WL-413 — تشويهُ الردودِ (وسمٌ غيرُ صالحٍ، حذفُ منطقةِ تفويضِ الردِّ)،
//                       فقدُ ردِّ تعريفٍ بعدَ تنفيذِهِ، فقدُهُ قبلَ تنفيذِهِ، رفضُ تحريرٍ، رمزٌ عامٌّ مكانَ
//                       رفضِ الاختبارِ السلبيّ، حجبُ حذفٍ دائم، وهوياتُ محاكٍ محرَّفة (سلاسلُ بائعٍ زائدة،
//                       طيُّ مسافات، خاصيّةٌ ناقصة).
//   CommandEmitter    : يبني أوامرَ المراسمِ بالمنشئِ نفسِه لتُعرَضَ على حارسِ أداةِ المضيف.

using System;
using System.Collections.Generic;
using Xuux.TpmCeremony;

namespace Xuux.TpmCeremony.Tests
{
    public sealed class BlockingTransport : ICeremonyTransport
    {
        private readonly ICeremonyTransport _inner;
        private readonly uint _cc;
        private readonly int _nth;
        private readonly bool _all;
        private int _seen;
        public readonly List<string> Forwarded = new List<string>();
        public int BlockedCount;

        public BlockingTransport(ICeremonyTransport inner, uint commandCode, int nth) : this(inner, commandCode, nth, false) { }

        public BlockingTransport(ICeremonyTransport inner, uint commandCode, int nth, bool all)
        {
            _inner = inner; _cc = commandCode; _nth = nth; _all = all;
        }

        public string Kind { get { return _inner.Kind + "+fault-injection"; } }

        public byte[] Transmit(byte[] command)
        {
            uint cc = ((uint)command[6] << 24) | ((uint)command[7] << 16) | ((uint)command[8] << 8) | command[9];
            if (cc == _cc)
            {
                _seen++;
                if (_all || _seen == _nth)
                {
                    BlockedCount++;
                    return new byte[] { 0x80, 0x01, 0, 0, 0, 10, 0x80, 0x28, 0x04, 0x00 };
                }
            }
            Forwarded.Add(Hex.U32(cc));
            return _inner.Transmit(command);
        }
    }

    public sealed class ForeignIdentityTransport : ICeremonyTransport
    {
        public readonly List<string> Received = new List<string>();
        public string Kind { get { return "test:foreign-identity"; } }

        public byte[] Transmit(byte[] command)
        {
            uint cc = ((uint)command[6] << 24) | ((uint)command[7] << 16) | ((uint)command[8] << 8) | command[9];
            Received.Add(Hex.U32(cc));
            if (cc != Tpm.CC_GetCapability) return new byte[] { 0x80, 0x01, 0, 0, 0, 10, 0, 0, 0x01, 0x01 };
            Wr p = new Wr().U8(0).U32(6).U32(5)
                .U32(0x105).U32(0x49465800)   // "IFX"
                .U32(0x106).U32(0x534C4239)   // "SLB9"
                .U32(0x107).U32(0x36373000)   // "670"
                .U32(0x108).U32(0).U32(0x109).U32(0);
            byte[] body = p.Bytes();
            return new Wr().U16(Tpm.ST_NO_SESSIONS).U32((uint)(10 + body.Length)).U32(0).Raw(body).Bytes();
        }
    }

    // أوضاعُ مسابرِ WL-413: إعادةُ إنتاجِ عوائقِ المراجعةِ المستقلّةِ داخلَ الاختبارِ الآليّ.
    public sealed class CeremonyFaultTransport : ICeremonyTransport
    {
        private readonly ICeremonyTransport _inner;
        private readonly string _mode;
        public int Changes;
        public uint DefinedHandle;
        public byte[] DefinedPublic;
        public uint LostSession;
        public readonly List<string> Forwarded = new List<string>();

        public uint ThirdPartyRc = 0xFFFFFFFF;
        private int _increments;
        private bool _dead;
        private uint _livePrimary; // مقبضُـ CreatePrimary الحيّ (وضعُ load-alias-live)
        private uint _decoySession;
        private bool _defineLost;
        private uint _plantedNv;       // فهرسُ NV المزروعُ فعليًّا على المحاكي (WL-416) — منشئُ النقلِ لا البروفة.
        private int _nvInvCount;      // عددُ طلباتِ جردِ NV المُعالجة (وضعُ nv-appear-midrun).

        // فهرسٌ حقيقيٌّ مزروعٌ على المحاكي بأمرِ NV_DefineSpace عبرَ النقلِ الداخليّ (قبلَ بدءِ البروفةِ):
        // النقلُ هو مَن يعرّفُه ويملكُه في هذهِ الجولةِ — البروفةُ نفسُها لم تُنشئهُ ولا تعرفُهُ. يستعملُ
        // تفويضَ مالكٍ فارغًا (سلوكُ المحاكي المُعلَن) فلا يُطلَبُ سرٌّ، والفهرسُ بسيطٌ (AUTHREAD|AUTHWRITE).
        private static byte[] PlantedNvPublic(uint index)
        {
            return new Wr().U32(index).U16(Tpm.ALG_SHA256).U32(Tpm.NV_AUTHREAD | Tpm.NV_AUTHWRITE).B2B(new byte[0]).U16(0).Bytes();
        }

        public CeremonyFaultTransport(ICeremonyTransport inner, string mode) : this(inner, mode, false) { }

        // جلسةُ فخٍّ تنشأُ قبلَ بدءِ البروفةِ (وضعُ session-alias): مقبضٌ موجودٌ في خطِّ الأساسِ يُعادُ في ردِّ
        // StartAuthSession فيُرفَضُ تبنّيه (RESPONSE_HANDLE_PREEXISTING) — إعادةُ إنتاجِ SOL413-01.
        public CeremonyFaultTransport(ICeremonyTransport inner, string mode, bool decoySession)
        {
            _inner = inner; _mode = mode;
            if (decoySession)
            {
                byte[] z = new byte[32]; new System.Random(4).NextBytes(z);
                Resp p = Resp.Parse(inner.Transmit(Cmd.StartAuthSession(Tpm.SE_POLICY, z)), 1, Tpm.ST_NO_SESSIONS, 0, new bool[0]);
                _decoySession = p.Handles[0];
            }
            // WL-416: زرعُ فهرسٍ حقيقيّ قبلَ البروفةِ (inventory-more0-hide خارجَ مجالِ المالكِ؛
            // nv-preseed-unattributable داخلَهُ) — التعريفُ من النقلِ لا من خطواتِ البروفةِ.
            if (mode == "inventory-more0-hide") _plantedNv = 0x01000001;
            if (mode == "nv-preseed-unattributable") _plantedNv = 0x01807777;
            if (_plantedNv != 0)
            {
                Resp d = Resp.Parse(inner.Transmit(Cmd.NvDefineSpace(new byte[0], new byte[0], PlantedNvPublic(_plantedNv))), 0, Tpm.ST_SESSIONS, 1, new bool[] { true });
                if (d.Rc != 0) throw new InvalidOperationException("planted NV define failed rc=" + Hex.U32(d.Rc));
            }
        }

        public delegate byte[] ParamRewrite(byte[] oldParams);

        // يُلحِقُ بايتاتٍ بنهايةِ ردٍّ بلا جلساتٍ ويصحّحُ الحجمَ المعلن (الترويسةُ متّسقة؛ البنيةُ الداخليّةُ لا).
        private static byte[] Append(byte[] raw, byte[] extra)
        {
            byte[] n = new byte[raw.Length + extra.Length];
            Buffer.BlockCopy(raw, 0, n, 0, raw.Length); Buffer.BlockCopy(extra, 0, n, raw.Length, extra.Length);
            byte[] sz = new Wr().U32((uint)n.Length).Bytes(); Buffer.BlockCopy(sz, 0, n, 2, 4);
            return n;
        }

        // يعيدُ كتابةَ معاملاتِ ردِّ ST_SESSIONS مع تصحيحِ parameterSize والحجمِ الكلّيِّ (منطقةُ التفويضِ كما هي).
        // يعيدُ كتابةَ منطقةِ تفويضِ ردِّ ST_SESSIONS (مسابرُ الدفعةِ الثالثةِ): البنيةُ الكلّيّةُ متّسقةٌ والمحتوى
        // مخالفٌ لملفِّ التفويضِ المتوقّعِ — فشلٌ مسمّى لا افتراضات.
        // يعيدُ كتابةَ معاملاتِ ردِّ ST_NO_SESSIONS (بلا حقلِ parameterSize): المعاملاتُ تلي المقابضَ مباشرةً.
        // ردودُ StartAuthSession وPolicySigned على swtpm بهذا الشكلِ — والمسابرُ تحتاجُ تعديلَها (SOL413-04).
        private static byte[] RewriteNoSessionsParams(byte[] raw, int handles, ParamRewrite f)
        {
            Rd r = new Rd(raw); r.U16(); r.U32(); r.U32();
            byte[] hs = r.Raw(4 * handles);
            byte[] np = f(r.Raw(r.Remaining));
            byte[] body = new Wr().Raw(hs).Raw(np).Bytes();
            return new Wr().U16(Tpm.ST_NO_SESSIONS).U32((uint)(10 + body.Length)).U32(0).Raw(body).Bytes();
        }

        private static byte[] RewriteAuth(byte[] raw, int handles, ParamRewrite f)
        {
            Rd r = new Rd(raw); r.U16(); r.U32(); r.U32();
            byte[] hs = r.Raw(4 * handles);
            uint ps = r.U32(); byte[] prm = r.Raw((int)ps); byte[] auth = r.Raw(r.Remaining);
            byte[] na = f(auth);
            byte[] body = new Wr().Raw(hs).U32((uint)prm.Length).Raw(prm).Raw(na).Bytes();
            return new Wr().U16(Tpm.ST_SESSIONS).U32((uint)(10 + body.Length)).U32(0).Raw(body).Bytes();
        }

        private static byte[] RewriteParams(byte[] raw, int handles, ParamRewrite f)
        {
            Rd r = new Rd(raw); r.U16(); r.U32(); r.U32();
            byte[] hs = r.Raw(4 * handles);
            uint ps = r.U32(); byte[] prm = r.Raw((int)ps); byte[] auth = r.Raw(r.Remaining);
            byte[] np = f(prm);
            byte[] body = new Wr().Raw(hs).U32((uint)np.Length).Raw(np).Raw(auth).Bytes();
            return new Wr().U16(Tpm.ST_SESSIONS).U32((uint)(10 + body.Length)).U32(0).Raw(body).Bytes();
        }

        public string Kind { get { return "test:wl413-" + _mode; } }

        private static uint Cc(byte[] command)
        {
            return ((uint)command[6] << 24) | ((uint)command[7] << 16) | ((uint)command[8] << 8) | command[9];
        }

        private static byte[] RcOnly(uint rc)
        {
            return new Wr().U16(Tpm.ST_NO_SESSIONS).U32(10).U32(rc).Bytes();
        }

        public byte[] Transmit(byte[] command)
        {
            uint cc = Cc(command);
            Forwarded.Add(Hex.U32(cc));
            if (_mode == "flush-refusal" && cc == Tpm.CC_FlushContext)
            {
                // رفضٌ مستمرٌّ لكلِّ تحريرٍ (لا الأولى فقط): الجلسةُ يجبُ أن تبقىَ معلَنةً في البقايا.
                if (Changes == 0) { Rd c = new Rd(command); c.U16(); c.U32(); c.U32(); LostSession = c.U32(); }
                Changes++;
                return RcOnly(0x80280400);
            }
            if (_mode == "unexpected-negative" && cc == Tpm.CC_PolicySigned)
            {
                // الثالثةُ هي رفضُ إعادةِ التوقيعِ: يُعادُ رمزٌ عامٌّ (0x101) مكانَ رفضِ التوقيعِ المقصودِ.
                Changes++;
                if (Changes == 3) return RcOnly(0x101);
            }
            if (_mode == "blocked-forever-undefine" && cc == Tpm.CC_NV_UndefineSpace)
            {
                Changes++;
                return RcOnly(Tpm.TPM_E_COMMAND_BLOCKED);
            }
            if (_mode == "define-not-executed" && cc == Tpm.CC_NV_DefineSpace && Changes == 0)
            {
                Changes++;
                throw new System.IO.IOException("WL413_DEFINE_DROPPED_BEFORE_EXECUTION");
            }
            if (_mode == "identity-string34" && cc == Tpm.CC_GetCapability && Changes == 0)
            {
                Changes++;
                Wr p = new Wr().U8(0).U32(6).U32(5)
                    .U32(0x105).U32(0x49424D00)   // "IBM"
                    .U32(0x106).U32(0x53572020)   // "SW  "
                    .U32(0x107).U32(0x2054504D)   // " TPM"
                    .U32(0x108).U32(0x4556494C)   // "EVIL"
                    .U32(0x109).U32(0x58585858);  // "XXXX"
                byte[] body = p.Bytes();
                return new Wr().U16(Tpm.ST_NO_SESSIONS).U32((uint)(10 + body.Length)).U32(0).Raw(body).Bytes();
            }
            if (_mode == "identity-spacefold" && cc == Tpm.CC_GetCapability && Changes == 0)
            {
                Changes++;
                Wr p = new Wr().U8(0).U32(6).U32(5)
                    .U32(0x105).U32(0x49424D00)
                    .U32(0x106).U32(0x53205720)   // "S W "
                    .U32(0x107).U32(0x5420504D)   // "T PM"
                    .U32(0x108).U32(0).U32(0x109).U32(0);
                byte[] body = p.Bytes();
                return new Wr().U16(Tpm.ST_NO_SESSIONS).U32((uint)(10 + body.Length)).U32(0).Raw(body).Bytes();
            }
            if (_mode == "identity-missing-prop" && cc == Tpm.CC_GetCapability && Changes == 0)
            {
                Changes++;
                // أربعُ خصائصٍ فقط: سلسلةُ البائعِ الرابعةُ غائبةٌ — الهويّةُ ناقصةٌ فتُرفض.
                Wr p = new Wr().U8(0).U32(6).U32(4)
                    .U32(0x105).U32(0x49424D00)
                    .U32(0x106).U32(0x53572020)
                    .U32(0x107).U32(0x2054504D)
                    .U32(0x108).U32(0);
                byte[] body = p.Bytes();
                return new Wr().U16(Tpm.ST_NO_SESSIONS).U32((uint)(10 + body.Length)).U32(0).Raw(body).Bytes();
            }
            if (_dead) throw new System.IO.IOException("WL413R2_TRANSPORT_DEAD");
            // ── مسابرُ الدفعةِ الثالثةِ (WL-413 R3) ──
            if (_mode == "written-before-reconcile" && cc == Tpm.CC_NV_DefineSpace && Changes == 0)
            {
                // يُنفَّذُ التعريفُ، ثمّ «طرفٌ آخرُ» يكتبُ الفهرسَ (زيادةٌ بتفويضٍ فارغٍ يسمحُ بها شكلُ S1)،
                // ثمّ يضيعُ ردُّ التعريف. الفهرسُ يطابقُ تعريفَنا عدا WRITTEN — ليس مُثبَتَ الملكيّة.
                Rd c = new Rd(command); c.U16(); c.U32(); c.U32(); c.U32(); uint authSize = c.U32(); c.Raw((int)authSize); c.B2B();
                DefinedPublic = c.B2B(); DefinedHandle = new Rd(DefinedPublic).U32();
                _inner.Transmit(command);
                byte[] inc = _inner.Transmit(Cmd.NvIncrement(DefinedHandle, Cmd.PasswordAuth(new byte[0])));
                Rd ih = new Rd(inc); ih.U16(); ih.U32(); ThirdPartyRc = ih.U32();
                Changes++;
                throw new System.IO.IOException("WL413R2_RESPONSE_LOSS_AFTER_DEFINE_AND_THIRD_PARTY_WRITE");
            }
            if (_mode == "neg-increment-loss" && cc == Tpm.CC_NV_Increment)
            {
                // الزيادةُ الرابعةُ هي s2v:NV_Increment(password-auth) — مرفوضةٌ على المحاكي، وردُّها يضيع.
                _increments++;
                if (_increments == 4) { _inner.Transmit(command); Changes++; throw new System.IO.IOException("WL413R2_LOSS_AFTER_NEGATIVE_INCREMENT"); }
            }
            if (_mode == "transport-dead-after-define" && cc == Tpm.CC_NV_DefineSpace && Changes == 0)
            {
                Rd c = new Rd(command); c.U16(); c.U32(); c.U32(); c.U32(); uint authSize = c.U32(); c.Raw((int)authSize); c.B2B();
                DefinedPublic = c.B2B(); DefinedHandle = new Rd(DefinedPublic).U32();
                _inner.Transmit(command); Changes++; _dead = true;
                throw new System.IO.IOException("WL413R2_TRANSPORT_DIED_AFTER_DEFINE");
            }
            if (_mode == "create-response-loss" && cc == Tpm.CC_Create && Changes == 0)
            {
                Changes++; _inner.Transmit(command);
                throw new System.IO.IOException("WL413R3_CREATE_RESPONSE_LOSS");
            }
            if (_mode == "flush-response-loss-noexec" && cc == Tpm.CC_FlushContext)
            {
                // الردُّ يضيعُ والأمرُ لم يُنفَّذ أصلًا: نتيجةٌ مجهولةٌ والمقبضُ باقٍ بحقٍّ — المصالحةُ القرائيّةُ
                // تُبقي السياقَ ولا تدّعي زوالًا (الزوجُ الصادقُ لـ flush-response-loss — حسمُ المراجعةِ 3).
                Changes++;
                throw new System.IO.IOException("WL416_FLUSH_RESPONSE_LOSS_NOEXEC");
            }
            if (_mode == "flush-response-loss" && cc == Tpm.CC_FlushContext)
            {
                // الأمرُ يُنفَّذُ على الناقلِ الداخليّ لكنّ ردّهُ يضيعُ: نتيجةٌ مجهولةٌ تُفعّلُ المصالحةَ القرائيّةَ —
                // الجردُ يُثبِتُ غيابَ المقبضِ فيُزالُ السياقُ من المسارِ الحقيقيّ (WL-416، حسمُ المراجعةِ 3).
                Changes++; _inner.Transmit(command);
                throw new System.IO.IOException("WL416_FLUSH_RESPONSE_LOSS");
            }
            if (_mode == "policysigned-neg-loss" && cc == Tpm.CC_PolicySigned)
            {
                // الرفضُ الثاني هو s2v.replay (old-signature) — مُغيّرٌ ومرفوضٌ ويضيعُ ردُّه (SOL413-06).
                Changes++;
                if (Changes == 3) { _inner.Transmit(command); throw new System.IO.IOException("WL413R3_NEGATIVE_POLICYSIGNED_LOSS"); }
            }
            if (_mode == "readcounter-malformed-14a" && cc == Tpm.CC_NV_Increment)
            {
                // الزيادةُ الرابعةُ هي s2v:NV_Increment(password-auth) — مرفوضةٌ على المحاكي ويضيعُ ردُّها،
                // ثمّ يُشوّهُ ردُّ القراءةِ 0x14A في المصالحةِ — كان يُبتلَعُ دليلًا للعدمِ (SOL413-05).
                _increments++;
                if (_increments == 4) { _inner.Transmit(command); Changes++; throw new System.IO.IOException("WL413R3_NEG_INCREMENT_LOSS_THEN_MALFORMED_14A"); }
            }
            if (_mode == "readpublic-malformed-18b" && cc == Tpm.CC_NV_DefineSpace && Changes == 0)
            {
                // يُسقَطُ التعريفُ قبلَ التنفيذِ، ثمّ يُشوّهُ ردُّ الغيابِ 0x18B في المصالحةِ — كان يُبتلَعُ
                // دليلًا للغيابِ فيُعلَنُ «not-executed (verified absent)» من ردٍّ مشوّهٍ (SOL413-05).
                Changes++; _defineLost = true;
                throw new System.IO.IOException("WL413R3_DEFINE_DROPPED_THEN_MALFORMED_ABSENCE");
            }
            // WL-414 FUP-SOL-04 (مسبرُ gpt_6_1_sol نفسُه): فشلُ TPM مُحقَنٌ على أولِ NV_Increment يُدخِلُ التنظيفَ
            // قبلَ أيِّ حذفٍ، ثمّ يُسقَطُ حذفُ التنظيفِ نفسُه قبلَ الإرسالِ — لا محاولةَ تنظيفٍ تاليةً بعدها.
            if (_mode == "fup-cleanup-undefine-before" && cc == Tpm.CC_NV_Increment && Changes == 0)
            {
                Changes++;
                return RcOnly(0x101);
            }
            if (_mode == "fup-cleanup-undefine-before" && cc == Tpm.CC_NV_UndefineSpace && Changes == 1)
            {
                Changes++;
                Rd c = new Rd(command); c.U16(); c.U32(); c.U32(); c.U32(); DefinedHandle = c.U32();
                throw new System.IO.IOException("WL414_FUP_CLEANUP_UNDEFINE_DROPPED_BEFORE_SEND");
            }
            // ضابطُ FUP-SOL-04: إسقاطُ حذفِ المرحلةِ (قبلَ التنظيفِ) — نصُّ «متروكٌ لمحاولةِ التنظيفِ» صحيحٌ هنا.
            if (_mode == "fup-undefine-drop-before" && cc == Tpm.CC_NV_UndefineSpace && Changes == 0)
            {
                Changes++;
                Rd c = new Rd(command); c.U16(); c.U32(); c.U32(); c.U32(); DefinedHandle = c.U32();
                throw new System.IO.IOException("WL414_FUP_UNDEFINE_DROPPED_BEFORE_SEND");
            }
            byte[] raw = _inner.Transmit(command);
            Rd header = new Rd(raw);
            ushort tag = header.U16(); header.U32(); uint rc = header.U32();
            if (_mode == "session-alias" && cc == Tpm.CC_StartAuthSession && rc == 0)
            {
                Changes++;
                byte[] forged = (byte[])raw.Clone();
                forged[10] = (byte)(_decoySession >> 24); forged[11] = (byte)(_decoySession >> 16);
                forged[12] = (byte)(_decoySession >> 8); forged[13] = (byte)_decoySession;
                return forged;
            }
            if (rc == 0 && _mode == "auth-nonce-byte" && tag == Tpm.ST_SESSIONS && Changes == 0)
            {
                Changes++; return RewriteAuth(raw, 0, delegate(byte[] a)
                {
                    return new byte[] { 0x00, 0x01, 0xAB, 0x01, 0x00, 0x00 }; // nonce بايتٌ واحدٌ
                });
            }
            if (rc == 0 && _mode == "auth-hmac-byte" && tag == Tpm.ST_SESSIONS && Changes == 0)
            {
                Changes++; return RewriteAuth(raw, 0, delegate(byte[] a)
                {
                    return new byte[] { 0x00, 0x00, 0x01, 0x00, 0x01, 0xFF }; // hmac بايتٌ واحدٌ
                });
            }
            if (rc == 0 && _mode == "auth-attrs-ff" && tag == Tpm.ST_SESSIONS && Changes == 0)
            {
                Changes++; return RewriteAuth(raw, 0, delegate(byte[] a)
                {
                    return new byte[] { 0x00, 0x00, 0xFF, 0x00, 0x00 }; // سماتٌ محفوظةٌ كلّها
                });
            }
            if (rc == 0 && _mode == "auth-attrs-clear" && tag == Tpm.ST_SESSIONS && Changes == 0)
            {
                Changes++; return RewriteAuth(raw, 0, delegate(byte[] a)
                {
                    return new byte[] { 0x00, 0x00, 0x00, 0x00, 0x00 }; // continueSession مُصفّرةٌ
                });
            }
            // ── مسابرُ المخطّطِ الداخليِّ (SOL413-04/G47-413-3) ──
            // CreatePrimary: B2B pub + B2B creationData + B2B creationHash + تذكرةٌ (وسمٌ/هرمٌ/B2B) + B2B اسم.
            if (rc == 0 && _mode == "schema-public-empty" && cc == Tpm.CC_CreatePrimary && Changes == 0)
            {
                Changes++; return RewriteParams(raw, 1, delegate(byte[] prm)
                {
                    Rd q = new Rd(prm); q.B2B();
                    return new Wr().B2B(new byte[0]).Raw(q.Raw(q.Remaining)).Bytes();
                });
            }
            if (rc == 0 && _mode == "schema-creationdata-short" && cc == Tpm.CC_CreatePrimary && Changes == 0)
            {
                Changes++; return RewriteParams(raw, 1, delegate(byte[] prm)
                {
                    Rd q = new Rd(prm); byte[] pub = q.B2B(); q.B2B();
                    return new Wr().B2B(pub).B2B(new byte[1]).Raw(q.Raw(q.Remaining)).Bytes();
                });
            }
            if (rc == 0 && _mode == "schema-creationhash-short" && cc == Tpm.CC_CreatePrimary && Changes == 0)
            {
                Changes++; return RewriteParams(raw, 1, delegate(byte[] prm)
                {
                    Rd q = new Rd(prm); byte[] pub = q.B2B(); byte[] cd = q.B2B(); q.B2B();
                    return new Wr().B2B(pub).B2B(cd).B2B(new byte[0]).Raw(q.Raw(q.Remaining)).Bytes();
                });
            }
            if (rc == 0 && _mode == "schema-ticket-tag-flip" && cc == Tpm.CC_CreatePrimary && Changes == 0)
            {
                // تذكرةُ الإنشاءِ: الوسمُ 0x8021 وفقَ القياسِ — قلبُهُ فشلٌ مسمّى لا نجاحٌ بصحةٍ زائفةٍ.
                Changes++; return RewriteParams(raw, 1, delegate(byte[] prm)
                {
                    Rd q = new Rd(prm);
                    byte[] pub = q.B2B(); byte[] cd = q.B2B(); byte[] ch = q.B2B();
                    ushort ttag = q.U16(); uint h = q.U32(); byte[] td = q.B2B(); byte[] nm = q.Raw(q.Remaining);
                    return new Wr().B2B(pub).B2B(cd).B2B(ch).U16((ushort)(ttag ^ 0x0001)).U32(h).B2B(td).Raw(nm).Bytes();
                });
            }
            if (rc == 0 && _mode == "schema-nonce-empty" && cc == Tpm.CC_StartAuthSession && Changes == 0)
            {
                Changes++; return RewriteNoSessionsParams(raw, 1, delegate(byte[] prm)
                {
                    return new Wr().B2B(new byte[0]).Bytes();
                });
            }
            if (rc == 0 && _mode == "schema-nvread-short" && cc == Tpm.CC_NV_Read && Changes == 0)
            {
                Changes++; return RewriteParams(raw, 0, delegate(byte[] prm)
                {
                    return new Wr().B2B(new byte[1]).Bytes();
                });
            }
            if (rc == 0 && _mode == "schema-sign-short" && cc == Tpm.CC_Sign && Changes == 0)
            {
                // Sign: U16 alg + U16 hash + B2B r + B2B s — r بايتٌ واحدٌ.
                Changes++; return RewriteParams(raw, 0, delegate(byte[] prm)
                {
                    Rd q = new Rd(prm); ushort a = q.U16(); ushort hh = q.U16(); q.B2B(); byte[] ss2 = q.Raw(q.Remaining);
                    return new Wr().U16(a).U16(hh).B2B(new byte[1]).Raw(ss2).Bytes();
                });
            }
            // ── مسابرُ جولةِ المراجعةِ الثالثةِ R3 (تقاريرُ المراجعينَ الثلاثةِ على de099aa8) ──
            // R3SOL-02/PC-R3-4: ملفُّ سياسةٍ كاملٌ (nonce بطولِ 32 وattrs=0x00) في ردِّ أمرٍ بكلمةِ سرٍّ —
            // الفاحصُ كانَ يقبلُ أحدَ الملفينِ بلا ربطٍ بنوعِ الجلسةِ في الطلبِ.
            if (rc == 0 && _mode == "auth-cross-policy-on-password" && tag == Tpm.ST_SESSIONS && Changes == 0)
            {
                Changes++;
                return RewriteAuth(raw, 0, delegate(byte[] a)
                {
                    byte[] nonce = new byte[32]; for (int i = 0; i < 32; i++) nonce[i] = (byte)i;
                    return new Wr().B2B(nonce).U8(0x00).B2B(new byte[0]).Bytes();
                });
            }
            // R3SOL-02: أولُ ردٍّ بتفويضِ جلسةِ سياسةٍ (nonce بطولِ 32 في الأصلِ) يُصغّرُ إلى 16 —
            // أولُ ردٍّ من هذا النوعِ في البروفةِ هوَ s2.trial:PolicyGetDigest (قرائيٌّ فقط).
            if (rc == 0 && _mode == "auth-policy-nonce16" && cc == Tpm.CC_NV_Increment && tag == Tpm.ST_SESSIONS && Changes == 0)
            {
                // أولُ ردِّ تفويضِ جلسةِ سياسةٍ: NV_Increment بالجلسةِ (صفرُ مقابضٍَ في الردّ؛ nonceTPM=32)
                Rd a = new Rd(raw); a.U16(); a.U32(); a.U32(); uint ps = a.U32(); a.Raw((int)ps);
                if (a.B2B().Length == 32)
                {
                    Changes++;
                    return RewriteAuth(raw, 0, delegate(byte[] x)
                    {
                        return new Wr().B2B(new byte[16]).U8(0x00).B2B(new byte[0]).Bytes();
                    });
                }
            }
            // R3SOL-02: البتُّ المحجوزُ 3 (attrs=0x08) في ردِّ تفويضِ جلسةِ سياسةٍ.
            if (rc == 0 && _mode == "auth-policy-attrs08" && cc == Tpm.CC_NV_Increment && tag == Tpm.ST_SESSIONS && Changes == 0)
            {
                Rd a = new Rd(raw); a.U16(); a.U32(); a.U32(); uint ps = a.U32(); a.Raw((int)ps);
                if (a.B2B().Length == 32)
                {
                    Changes++;
                    return RewriteAuth(raw, 0, delegate(byte[] x)
                    {
                        return new Wr().B2B(new byte[32]).U8(0x08).B2B(new byte[0]).Bytes();
                    });
                }
            }
            // R3SOL-03/PC-R3-1: timeout بطولِ 8 في ردِّ PolicySigned ناجحٍ عندَ expiration=0.
            if (rc == 0 && _mode == "policysigned-timeout-nonempty" && cc == Tpm.CC_PolicySigned && Changes == 0)
            {
                Changes++;
                return RewriteNoSessionsParams(raw, 0, delegate(byte[] prm)
                {
                    Rd q = new Rd(prm); q.B2B(); // الـtimeout الأصليُّ الفارغُ يُستبدلُ
                    return new Wr().B2B(new byte[8]).Raw(q.Raw(q.Remaining)).Bytes();
                });
            }
            // R3SOL-03: هرميةُ تذكرةِ الإنشاءِ 0x40000002 (ليست هرميةً) في ردِّ CreatePrimary.
            if (rc == 0 && _mode == "ticket-hierarchy-revoke" && cc == Tpm.CC_CreatePrimary && Changes == 0)
            {
                Changes++;
                return RewriteParams(raw, 1, delegate(byte[] prm)
                {
                    Rd q = new Rd(prm); byte[] pub = q.B2B(); byte[] cd = q.B2B(); byte[] ch = q.B2B();
                    ushort ttag = q.U16(); uint hh = q.U32(); byte[] td = q.B2B(); byte[] nm = q.Raw(q.Remaining);
                    return new Wr().B2B(pub).B2B(cd).B2B(ch).U16(ttag).U32(0x40000002u).B2B(td).Raw(nm).Bytes();
                });
            }
            // R3SOL-03: بصمةُ تذكرةِ الإنشاءِ بطولِ بايتٍ واحدٍ في ردِّ CreatePrimary.
            if (rc == 0 && _mode == "ticket-digest-short" && cc == Tpm.CC_CreatePrimary && Changes == 0)
            {
                Changes++;
                return RewriteParams(raw, 1, delegate(byte[] prm)
                {
                    Rd q = new Rd(prm); byte[] pub = q.B2B(); byte[] cd = q.B2B(); byte[] ch = q.B2B();
                    ushort ttag = q.U16(); uint hh = q.U32(); byte[] td = q.B2B(); byte[] nm = q.Raw(q.Remaining);
                    return new Wr().B2B(pub).B2B(cd).B2B(ch).U16(ttag).U32(hh).B2B(new byte[1]).Raw(nm).Bytes();
                });
            }
            // R3SOL-01/PC-R3-2: صفحةُ جردٍ بمقبضٍ واحدٍ مكرّرٍ (تصنيعٌ على أولِ صفحةٍ فارغةٍ) —
            // الترتيبُ الصاعدُ الصارمُ (والتكرارُ) يُرفضُ باسمٍ مسمّى.
            if (rc == 0 && _mode == "inventory-duplicate" && cc == Tpm.CC_GetCapability && Changes == 0)
            {
                Rd r0 = new Rd(raw); r0.U16(); r0.U32(); r0.U32(); byte more = r0.U8(); uint cap = r0.U32(); uint cnt = r0.U32();
                if (cap == 1 && more == 0 && cnt == 0)
                {
                    Changes++;
                    return RewriteNoSessionsParams(raw, 0, delegate(byte[] prm)
                    {
                        return new Wr().U8(0).U32(1).U32(2).U32(0x01000001u).U32(0x01000001u).Bytes();
                    });
                }
            }
            // PC-R3-3/قياسُ grok: ردُّ Load يعيدُ مقبضَ CreatePrimary الحيّ (لم يُحرّر) — التبنيَ
            // يرفضُهُ الآنَ باسمٍ مسمّى (كانَ يقارنُ خطَّ الأساسِ فقطْ فيفشلُ مغلقًا لاحقًا برمزٍ عامٍّ).
            if (rc == 0 && _mode == "load-alias-live" && cc == Tpm.CC_CreatePrimary && Changes == 0)
            {
                Changes++;
                Rd q = new Rd(raw); q.U16(); q.U32(); q.U32(); _livePrimary = q.U32();
                return raw;
            }
            if (rc == 0 && _mode == "load-alias-live" && cc == Tpm.CC_Load && Changes == 1 && _livePrimary != 0)
            {
                Changes++;
                byte[] forged = (byte[])raw.Clone();
                forged[10] = (byte)(_livePrimary >> 24); forged[11] = (byte)(_livePrimary >> 16);
                forged[12] = (byte)(_livePrimary >> 8); forged[13] = (byte)_livePrimary;
                return forged;
            }
            // خطُّ الأساسِ الجزئيُّ (قيدُ الجولةِ الثالثةِ R3SOL-04): أولُ جردِ للمتحوّلاتِ العابرةِ
            // يُعادُ بمقبضٍِ من فئةِ NV ⇒ فشلٌ مسمّى داخلَ SnapshotBaseline ⇒ خطُّ أساسٍِ جزئيًّ: لا
            // يُدَّى جردٌ موثوقٌ بعده (الجردُ من قابليةِ المقارنةِ برسالةِ partial baseline) ولا تُقارَنُ البقايا.
            if (rc == 0 && _mode == "baseline-partial" && cc == Tpm.CC_GetCapability && Changes == 0)
            {
                Rd c = new Rd(command); c.U16(); c.U32(); c.U32(); uint cap = c.U32(); uint prop = c.U32();
                if (cap == 1 && prop == 0x80000000u)
                {
                    Changes++;
                    byte[] body = new Wr().U8(0).U32(1).U32(1).U32(0x01000001).Bytes();
                    return new Wr().U16(Tpm.ST_NO_SESSIONS).U32((uint)(10 + body.Length)).U32(0).Raw(body).Bytes();
                }
            }
            // قياسُ المراجعينَ: مقبضُ ردِّ StartAuthSession بفئةِ كائنٍ عابرٍ (0x80) — يُرفضُ باسمٍ.
            if (rc == 0 && _mode == "startsession-wrongclass" && cc == Tpm.CC_StartAuthSession && Changes == 0)
            {
                Changes++;
                byte[] forged = (byte[])raw.Clone();
                forged[10] = 0x80; forged[11] = 0x00; forged[12] = 0x00; forged[13] = 0x05; // مقبضٌ غيرُ حيّّ بفئةِ كائنٍ عابرٍ
                return forged;
            }
            // R3SOL-05 (قبولٌ مشروعٌ): بياناتُ إنشاءٍ بعددِ PCR صفرٍ وبصمةِ PCR فارغةٍ (جملةُ الجدولِ 222
            // في Part 2) معَ إعادةِ حسابِ creationHash — كانَ الرفضُ السابقُ لهذا الترميزِ السائغِ انحسارًا.
            if (rc == 0 && _mode == "creationdata-empty-pcrdigest" && cc == Tpm.CC_CreatePrimary && Changes == 0)
            {
                Changes++;
                return RewriteParams(raw, 1, delegate(byte[] prm)
                {
                    Rd q = new Rd(prm); byte[] pub = q.B2B(); byte[] cd = q.B2B(); q.B2B();
                    ushort ttag = q.U16(); uint hh = q.U32(); byte[] td = q.B2B(); byte[] nm = q.Raw(q.Remaining);
                    Rd c = new Rd(cd); c.U32(); ushort dlen = c.U16(); c.Raw(dlen); byte locality = c.U8(); ushort pna = c.U16();
                    byte[] f1 = c.B2B(); byte[] f2 = c.B2B(); byte[] f3 = c.B2B();
                    byte[] ncd = new Wr().U32(0).U16(0).U8(locality).U16(pna).B2B(f1).B2B(f2).B2B(f3).Bytes();
                    byte[] nch = Sha.H(ncd);
                    return new Wr().B2B(pub).B2B(ncd).B2B(nch).U16(ttag).U32(hh).B2B(td).Raw(nm).Bytes();
                });
            }
            // WL-414 FUP-SOL-01 + ربطُ طولِ البصمةِ: تشويهُ تذكرةِ PolicySigned عندَ expiration=0 (طلبُ تذكرةِ NULL):
            //   fup-ps-digest-<N>     بصمةٌ بطولِ N (1/32/64 كانت تُقبلُ؛ 65 وحدَها كانت تُرفضُ)
            //   fup-ps-hierarchy-<h>  هرميّةٌ غيرُ RH_NULL (المالكُ/التأييدُ/المنصّةُ كانت تُقبلُ)
            //   fup-ps-tag-<t>        وسمٌ غيرُ AUTH_SIGNED (0x8023 AUTH_SECRET كان يُقبلُ)
            if (rc == 0 && cc == Tpm.CC_PolicySigned && Changes == 0 && _mode.StartsWith("fup-ps-"))
            {
                Changes++;
                string arg = _mode.Substring(_mode.LastIndexOf('-') + 1);
                return RewriteNoSessionsParams(raw, 0, delegate(byte[] prm)
                {
                    Rd q = new Rd(prm); byte[] to = q.B2B(); ushort tt = q.U16(); uint hh = q.U32(); byte[] td = q.B2B();
                    if (_mode.StartsWith("fup-ps-digest-")) td = new byte[int.Parse(arg)];
                    else if (_mode.StartsWith("fup-ps-hierarchy-")) hh = Convert.ToUInt32(arg, 16);
                    else if (_mode.StartsWith("fup-ps-tag-")) tt = Convert.ToUInt16(arg, 16);
                    return new Wr().B2B(to).U16(tt).U32(hh).B2B(td).Bytes();
                });
            }
            // WL-414 FUP-SOL-02: تشويهُ الحقولِ الذيليّةِ لبياناتِ الإنشاءِ (parentName، parentQualifiedName،
            // outsideInfo) أو parentNameAlg مع إعادةِ حسابِ creationHash — فلا يكشفُها إلا الربطُ بالطلبِ/بالأصل.
            //   fup-cd-*   على Create (أوّلُ Create: s2:Create(service-key))؛ fup-cdp-* على CreatePrimary.
            if (rc == 0 && Changes == 0 && ((_mode.StartsWith("fup-cd-") && cc == Tpm.CC_Create) || (_mode.StartsWith("fup-cdp-") && cc == Tpm.CC_CreatePrimary)))
            {
                Changes++;
                bool primary = cc == Tpm.CC_CreatePrimary;
                string what = _mode.Substring(primary ? 8 : 7);
                return RewriteParams(raw, primary ? 1 : 0, delegate(byte[] prm)
                {
                    Rd q = new Rd(prm);
                    byte[] priv = primary ? null : q.B2B();
                    byte[] pub = q.B2B(); byte[] cd = q.B2B(); q.B2B();
                    ushort ttag = q.U16(); uint hh = q.U32(); byte[] td = q.B2B(); byte[] rest = q.Raw(q.Remaining);
                    Rd c = new Rd(cd); uint n = c.U32(); Wr head = new Wr().U32(n);
                    for (uint i = 0; i < n; i++) { head.U16(c.U16()); byte sz = c.U8(); head.U8(sz).Raw(c.Raw(sz)); }
                    byte[] pd = c.B2B(); byte loc = c.U8(); ushort pna = c.U16();
                    byte[] pn = c.B2B(); byte[] pq = c.B2B(); byte[] oi = c.B2B();
                    if (what == "parentname") { pn = (byte[])pn.Clone(); pn[pn.Length - 1] ^= 0x01; }
                    else if (what == "parentqn") { pq = (byte[])pq.Clone(); pq[pq.Length - 1] ^= 0x01; }
                    else if (what == "outsideinfo") { oi = new byte[] { 0x42 }; }
                    else if (what == "pna-null") { pna = Tpm.ALG_NULL; }
                    else if (what == "pna-sha256") { pna = Tpm.ALG_SHA256; }
                    else if (what == "identity") { }
                    else throw new InvalidOperationException("unknown creation-data fault " + _mode);
                    byte[] ncd = head.B2B(pd).U8(loc).U16(pna).B2B(pn).B2B(pq).B2B(oi).Bytes();
                    Wr w = new Wr();
                    if (!primary) w.B2B(priv);
                    return w.B2B(pub).B2B(ncd).B2B(Sha.H(ncd)).U16(ttag).U32(hh).B2B(td).Raw(rest).Bytes();
                });
            }
            if (rc == 0 && _mode == "schema-policysigned-digest" && cc == Tpm.CC_PolicySigned && Changes == 0)
            {
                // PolicySigned: B2B timeout + وسمٌ + هرمٌ + B2B بصمةُ التذكرةِ — 65 بايتًا يتجاوزُ الحدَّ.
                Changes++; return RewriteNoSessionsParams(raw, 0, delegate(byte[] prm)
                {
                    Rd q = new Rd(prm); q.B2B(); ushort tt = q.U16(); uint hh = q.U32();
                    return new Wr().B2B(new byte[0]).U16(tt).U32(hh).B2B(new byte[65]).Bytes();
                });
            }
            if (rc == 0 && _mode == "paramsize-huge" && tag == Tpm.ST_SESSIONS && Changes == 0)
            {
                Changes++;
                byte[] forged = (byte[])raw.Clone();
                int handles = cc == Tpm.CC_CreatePrimary || cc == Tpm.CC_Load ? 1 : 0;
                int off = 10 + 4 * handles;
                forged[off] = 0x7F; forged[off + 1] = 0xFF; forged[off + 2] = 0xFF; forged[off + 3] = 0xF0; // ps > المتبقّي
                return forged;
            }
            if (rc == 0 && _mode == "inventory-no-progress" && cc == Tpm.CC_GetCapability && Changes == 0)
            {
                // جردُ مقابضَ يعيد more=1 مع count=0: تقدّمٌ مزعومٌ بلا أثرٍ — كان يُقبلُ كنهايةٍ صامتةٍ (SOL413-02).
                Rd q = new Rd(raw); q.U16(); q.U32(); q.U32();
                byte more = q.U8(); uint cap = q.U32(); uint cnt = q.U32();
                if (cap == 1 && more == 0 && cnt == 0)
                {
                    Changes++;
                    byte[] forged = (byte[])raw.Clone();
                    forged[10] = 0x01; // more=1 مع count=0
                    return forged;
                }
            }
            if (rc == 0 && _mode == "inventory-wrong-class" && cc == Tpm.CC_GetCapability && Changes == 0)
            {
                // جردُ الجلساتِ يعيدُ مقبضاً عابراً (0x80...): كان يوقفُ الجردَ صامتاً فيبدو فارغاً (SOL413-02).
                Rd q = new Rd(raw); q.U16(); q.U32(); q.U32();
                byte more = q.U8(); uint cap = q.U32(); uint cnt = q.U32();
                if (cap == 1 && more == 0 && cnt == 0)
                {
                    Changes++;
                    byte[] body = new Wr().U8(0).U32(1).U32(1).U32(0x80000001).Bytes();
                    return new Wr().U16(Tpm.ST_NO_SESSIONS).U32((uint)(10 + body.Length)).U32(0).Raw(body).Bytes();
                }
            }
            if (rc == 0x14A && _mode == "readcounter-malformed-14a" && cc == Tpm.CC_NV_Read && _increments >= 4)
            {
                Changes++;
                byte[] forged = (byte[])raw.Clone(); forged[0] = 0x12; forged[1] = 0x34;
                return forged;
            }
            // ── WL-416: أوضاعُ قراراتِ المالكِ (more=0) وحاجزِ ملكيّةِ مجالِ المالكِ ──
            // inventory-more0-hide: يُحجبُ الفهرسُ المزروعُ وحدهُ من صفحاتِ جردِ NV — بقيةُ الصفحةِ كما ردّها
            // المحاكي (المقابضُ الأخرى و more كما هي)؛ فالردُّ الصحيحُ البنيةِ الذي يُعلنُ more=0 ليس برهانَ
            // خلوٍّ: الاختبارُ يُثبتُ وجودَ الفهرسِ بجردٍ مباشرٍ بعدَ البروفةِ.
            if (rc == 0 && _mode == "inventory-more0-hide" && cc == Tpm.CC_GetCapability)
            {
                Rd c = new Rd(command); c.U16(); c.U32(); c.U32(); uint cap = c.U32(); uint prop = c.U32();
                if (cap == 1 && prop >= 0x01000000u && prop < 0x02000000u)
                {
                    Changes++;
                    // إعادةُ كتابةِ الردّ: تحليلُ المعاملاتِ وإسقاطُ الفهرسِ المزروعِ فقطْ وحفظُ more كما ردّ.
                    return RewriteNoSessionsParams(raw, 0, delegate(byte[] prm)
                    {
                        Rd r = new Rd(prm); byte more = r.U8(); uint rcap = r.U32(); uint cnt = r.U32();
                        List<uint> keep = new List<uint>();
                        for (uint i = 0; i < cnt; i++)
                        {
                            uint h = r.U32();
                            if (h != _plantedNv) keep.Add(h);
                        }
                        Wr w = new Wr().U8(more).U32(rcap).U32((uint)keep.Count);
                        foreach (uint h in keep) w.U32(h);
                        return w.Bytes();
                    });
                }
            }
            // nv-appear-midrun: عندَ طلبِ جردِ NV الثاني يُعرّفُ النقلُ فهرسًا حقيقيًّا داخلَ مجالِ المالك
            // (طرفٌ ثالثٍ يظهرُ بعدَ خطِّ الأساسِ) قبلَ تمريرِ الطلبِ — الردُّ يشملُهُ فيوقفُهُ الحاجزُ.
            if ((_mode == "nv-appear-midrun" || _mode == "nv-appear-late") && cc == Tpm.CC_GetCapability)
            {
                Rd c = new Rd(command); c.U16(); c.U32(); c.U32(); uint cap = c.U32(); uint prop = c.U32();
                if (cap == 1 && prop >= 0x01000000u && prop < 0x02000000u)
                {
                    _nvInvCount++;
                    // nv-appear-midrun: الجردُ الثاني (حاجزُ ما بعدِ خطِّ الأساسِ)؛ nv-appear-late: الجردُ الثالث
                    // (حاجزُ PickVacantHandle المتكرّرُ قبلَ كلِّ تعريفٍ) — كلاهُما ظهورٌ من طرفٍ ثالثٍ يوقفُهُ الحاجزُ.
                    if ((_mode == "nv-appear-midrun" && _nvInvCount == 2) || (_mode == "nv-appear-late" && _nvInvCount == 3))
                    {
                        Changes++;
                        Resp d = Resp.Parse(_inner.Transmit(Cmd.NvDefineSpace(new byte[0], new byte[0], PlantedNvPublic(0x01807777))), 0, Tpm.ST_SESSIONS, 1, new bool[] { true });
                        if (d.Rc != 0) throw new InvalidOperationException("midrun NV define failed rc=" + Hex.U32(d.Rc));
                    }
                }
            }
            // WL-418 (WL418-gpt_6_1_sol-01): ظهورٌ متأخّرٌ بعدَ أمرٍ مُغيِّرٍ ناجحٍ — يُعرَّفُ فهرسٌ حقيقيٌّ داخلَ مجالِ
            // المالكِ بعدَ نجاحِ أوّلِ NV_DefineSpace (nv-appear-after-define) أو أوّلِ CreatePrimary
            // (nv-appear-after-primary)، بلا إخفاءٍ عن أيِّ جرد. حاجزُ بوابةِ الإرسالِ يوقفُ الأمرَ المُغيِّرَ التالي.
            if (((_mode == "nv-appear-after-define" && cc == Tpm.CC_NV_DefineSpace) ||
                 (_mode == "nv-appear-after-primary" && cc == Tpm.CC_CreatePrimary)) && rc == 0 && Changes == 0)
            {
                Changes++;
                Resp d = Resp.Parse(_inner.Transmit(Cmd.NvDefineSpace(new byte[0], new byte[0], PlantedNvPublic(0x01807777))), 0, Tpm.ST_SESSIONS, 1, new bool[] { true });
                if (d.Rc != 0) throw new InvalidOperationException("late NV define failed rc=" + Hex.U32(d.Rc));
            }
            if (rc == 0x18B && _mode == "readpublic-malformed-18b" && cc == Tpm.CC_NV_ReadPublic && _defineLost)
            {
                Changes++;
                byte[] forged = (byte[])raw.Clone(); forged[0] = 0x12; forged[1] = 0x34;
                return forged;
            }

            if (_mode == "define-response-loss" && cc == Tpm.CC_NV_DefineSpace && rc == 0 && Changes == 0)
            {
                Rd c = new Rd(command); c.U16(); c.U32(); c.U32(); c.U32(); uint authSize = c.U32(); c.Raw((int)authSize); c.B2B();
                DefinedPublic = c.B2B(); DefinedHandle = new Rd(DefinedPublic).U32(); Changes++;
                throw new System.IO.IOException("WL413_RESPONSE_LOSS_AFTER_DEFINE_EXECUTION");
            }
            if (rc == 0 && _mode == "trailing-readpublic" && cc == Tpm.CC_NV_ReadPublic)
            {
                Changes++; return Append(raw, new byte[] { 0xde, 0xad, 0x01 });
            }
            if (rc == 0 && _mode == "define-params-extra" && cc == Tpm.CC_NV_DefineSpace && Changes == 0)
            {
                // ردُّ نجاحٍ لأمرٍ مُغيِّرٍ معاملاتُه يجبُ أن تكونَ فارغةً، وقد حُشيَت ببايتين (الأحجامُ متّسقة).
                if (DefinedHandle == 0)
                {
                    Rd c = new Rd(command); c.U16(); c.U32(); c.U32(); c.U32(); uint authSize = c.U32(); c.Raw((int)authSize); c.B2B();
                    DefinedPublic = c.B2B(); DefinedHandle = new Rd(DefinedPublic).U32();
                }
                Changes++; return RewriteParams(raw, 0, delegate(byte[] p) { return new byte[] { 0x00, 0x00 }; });
            }
            if (rc == 0 && _mode == "getcap-wrong-cap" && cc == Tpm.CC_GetCapability && Changes == 0)
            {
                // ردُّ الهويّةِ يعلنُ قدرةً غيرَ المسؤولِ عنها (HANDLES بدلَ TPM_PROPERTIES) — بنيةٌ صالحةٌ ومعنى خاطئ.
                Changes++; raw[11] = 0x00; raw[12] = 0x00; raw[13] = 0x00; raw[14] = 0x01; // الحقلُ capability عندَ الإزاحةِ 11
                return raw;
            }
            if (rc == 0 && _mode == "load-name-short" && cc == Tpm.CC_Load && Changes == 0)
            {
                Changes++; return RewriteParams(raw, 1, delegate(byte[] p) { return new byte[] { 0x00, 0x02, 0x00, 0x0b }; });
            }
            if (_mode == "invalid-tag" && tag == Tpm.ST_NO_SESSIONS)
            {
                raw[0] = 0x12; raw[1] = 0x34; Changes++;
            }
            if (_mode == "missing-response-auth" && rc == 0 && tag == Tpm.ST_SESSIONS)
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

    public static class CommandEmitter
    {
        // كلُّ شكلِ أمرٍ تُرسِلُه البروفة، بقيمٍ عشوائيةٍ غيرِ صالحةٍ للعتاد — يُعرَضُ على حارسِ المضيفِ فقط.
        // استثناءانِ مقصودانِ (WL-413/SOL-06): استعلامُ القدراتِ وقراءةُ المنطقةِ العامّةِ لفهرسٍ — هما
        // المسموحانِ في حارسِ أداةِ الجردِ لأنّهما قرائيّانِ، وكلُّ ما عداهما يُرفَض.
        public static List<KeyValuePair<string, string>> All()
        {
            byte[] z = new byte[32];
            byte[] empty = new byte[0];
            byte[] pub = Cmd.NvPublic(0x01A00000, Tpm.ANCHOR_ATTRIBUTES, z, 8);
            List<KeyValuePair<string, string>> l = new List<KeyValuePair<string, string>>();
            Add(l, "NV_DefineSpace", Cmd.NvDefineSpace(empty, empty, pub));
            Add(l, "NV_Increment(password)", Cmd.NvIncrement(0x01A00000, Cmd.PasswordAuth(empty)));
            Add(l, "NV_Increment(policy)", Cmd.NvIncrement(0x01A00000, Cmd.PolicyAuth(0x03000000, z)));
            Add(l, "NV_UndefineSpace", Cmd.NvUndefineSpace(empty, 0x01A00000));
            Add(l, "NV_Read", Cmd.NvRead(0x01A00000, Cmd.PasswordAuth(empty), 8, 0));
            Add(l, "CreatePrimary", Cmd.CreatePrimary(empty, Templates.StoragePrimary()));
            Add(l, "Create", Cmd.Create(0x80000000, empty, Templates.ServiceSigningKey()));
            Add(l, "Load", Cmd.Load(0x80000000, empty, z, z));
            Add(l, "Sign", Cmd.Sign(0x80000001, empty, z));
            Add(l, "StartAuthSession(trial)", Cmd.StartAuthSession(Tpm.SE_TRIAL, z));
            Add(l, "StartAuthSession(policy)", Cmd.StartAuthSession(Tpm.SE_POLICY, z));
            Add(l, "PolicySigned", Cmd.PolicySigned(0x80000001, 0x03000000, z, 0, z, z));
            Add(l, "PolicyCommandCode", Cmd.PolicyCommandCode(0x03000000, Tpm.CC_NV_Increment));
            Add(l, "PolicyGetDigest", Cmd.PolicyGetDigest(0x03000000));
            Add(l, "FlushContext", Cmd.FlushContext(0x80000000));
            Add(l, "GetCapability", Cmd.GetCapability(6, 0x105, 5));
            Add(l, "NV_ReadPublic", Cmd.NvReadPublic(0x01A00000));
            return l;
        }

        private static void Add(List<KeyValuePair<string, string>> l, string n, byte[] b)
        {
            l.Add(new KeyValuePair<string, string>(n, Hex.Of(b)));
        }
    }
}

namespace Xuux.TpmCeremony.Tests
{
    // WL-414 FUP-SOL-01/05 + ربطُ طولِ البصمةِ — حالاتٌ إيجابيّةٌ على ردودِ swtpm الحقيقيّةِ (بلا تشويهٍ):
    // لكلِّ (جلسةِ سياسةٍ/تجربةٍ × expiration ∈ {0, 3600, -3600}) يُرسَلُ PolicySigned حقيقيٌّ ويُعرَضُ ردُّه على
    // ResponseSchema.Check. البروفةُ نفسُها ترسلُ expiration=0 فقط، فلا يغطّي تشغيلُها 3600 ولا السالبَ.
    // السياقُ (ResponseContext) يُستعمَلُ بالانعكاسِ إن وُجد — لتعملَ الأداةُ نفسُها على خطِّ أساسٍ قديمٍ بلا سياقٍ
    // فيظهرُ سلوكُه (الرفضُ) بدلَ فشلِ ترجمةٍ؛ هذه أداةُ قياسٍ للاختبارِ، لا مسارَ البروفة.
    public static class PolicySignedShapes
    {
        private static uint U32(byte[] b, int o) { return ((uint)b[o] << 24) | ((uint)b[o + 1] << 16) | ((uint)b[o + 2] << 8) | b[o + 3]; }

        private static byte[] Params(byte[] r, int handles)
        {
            int o = 10 + 4 * handles;
            if (r[1] == 2) { int n = (int)U32(r, o); byte[] p = new byte[n]; Array.Copy(r, o + 4, p, 0, n); return p; }
            byte[] q = new byte[r.Length - o]; Array.Copy(r, o, q, 0, q.Length); return q;
        }

        public static List<string> Run(ICeremonyTransport t)
        {
            List<string> lines = new List<string>();
            Type ctxType = typeof(ResponseSchema).Assembly.GetType("Xuux.TpmCeremony.ResponseContext");
            object ctx = ctxType == null ? null : Activator.CreateInstance(ctxType);
            System.Reflection.MethodInfo record = ctxType == null ? null : ctxType.GetMethod("Record");
            System.Reflection.MethodInfo check = ctxType == null
                ? typeof(ResponseSchema).GetMethod("Check", new Type[] { typeof(uint), typeof(byte[]), typeof(byte[]) })
                : typeof(ResponseSchema).GetMethod("Check", new Type[] { typeof(uint), typeof(byte[]), typeof(byte[]), ctxType });
            Func<byte[], int, byte[]> send = delegate(byte[] c, int handles)
            {
                byte[] r = t.Transmit(c);
                if (U32(r, 6) != 0) throw new InvalidOperationException("TPM rc=" + Hex.U32(U32(r, 6)));
                uint[] hs = new uint[handles];
                for (int i = 0; i < handles; i++) hs[i] = U32(r, 10 + 4 * i);
                if (record != null) record.Invoke(ctx, new object[] { U32(c, 6), c, hs, Params(r, handles) });
                return r;
            };
            uint primary = U32(send(Cmd.CreatePrimary(new byte[0], Templates.StoragePrimary()), 1), 10);
            Rd cr = new Rd(Params(send(Cmd.Create(primary, new byte[0], Templates.ServiceSigningKey()), 0), 0));
            byte[] priv = cr.B2B(), pub = cr.B2B();
            uint key = U32(send(Cmd.Load(primary, new byte[0], priv, pub), 1), 10);
            try
            {
                foreach (byte st in new byte[] { Tpm.SE_POLICY, Tpm.SE_TRIAL })
                    foreach (int exp in new int[] { 0, 3600, -3600 })
                    {
                        byte[] sr = send(Cmd.StartAuthSession(st, new byte[32]), 1);
                        uint session = U32(sr, 10);
                        byte[] nonce = new Rd(Params(sr, 1)).B2B();
                        try
                        {
                            Rd sig = new Rd(Params(send(Cmd.Sign(key, new byte[0], Policy.AHash(nonce, exp)), 0), 0));
                            sig.U16(); sig.U16(); byte[] r = sig.B2B(), s = sig.B2B();
                            byte[] cmd = Cmd.PolicySigned(key, session, nonce, exp, r, s);
                            byte[] reply = t.Transmit(cmd);
                            string line = "session=" + (st == Tpm.SE_POLICY ? "policy" : "trial") + " expiration=" + exp + " rc=" + Hex.U32(U32(reply, 6));
                            if (U32(reply, 6) == 0)
                            {
                                byte[] p = Params(reply, 0);
                                Rd q = new Rd(p); byte[] to = q.B2B(); ushort tag = q.U16(); uint h = q.U32(); byte[] td = q.B2B();
                                line += " timeoutLen=" + to.Length + " tag=0x" + tag.ToString("x4") + " hierarchy=" + Hex.U32(h) + " digestLen=" + td.Length;
                                try
                                {
                                    check.Invoke(null, ctxType == null ? new object[] { Tpm.CC_PolicySigned, cmd, p } : new object[] { Tpm.CC_PolicySigned, cmd, p, ctx });
                                    line += " SCHEMA_ACCEPT";
                                }
                                catch (System.Reflection.TargetInvocationException e) { line += " SCHEMA_REJECT " + e.InnerException.Message; }
                            }
                            lines.Add(line);
                        }
                        finally { send(Cmd.FlushContext(session), 0); }
                    }
            }
            finally
            {
                send(Cmd.FlushContext(key), 0);
                send(Cmd.FlushContext(primary), 0);
            }
            return lines;
        }
    }
}

namespace Xuux.TpmCeremony.Tests
{
    // WL-416: مسبارُ دورةِ حياةِ سياقِ الردّ (ResponseContext) على swtpm حقيقيّ — قياسٌ مباشرٌ بالانعكاسِ.
    // الحالاتُ المقيسةُ:
    //   1. فقدُ ردِّ التحريرِ + إثباتُ الغيابِ بجردٍ قرائيّ + إعادةُ استخدامِ المقبضِ بلا تسجيلٍ (طرفٌ ثالثٍ)
    //      ⇒ لا وراثةَ للسياقِ، ورفضٌ مسمّى (RESPONSE_CREATION_PARENT_UNKNOWN) لا ادّعاءُ تلفٍ.
    //   2. إعادةُ الاستخدامِ معَ تسجيلٍ ⇒ مقبولٌ، والاسمُ الجديدُ لا يرثُ الاسمَ القديم.
    //   3. فقدُ الردِّ والمقبضُ ما زالَ حاضرًا (جردٌ قرائيّ) ⇒ السياقُ محفوظٌ (لا EndOfLife).
    //   4. استهلاكُ جلسةِ السياسةِ يُقاسُ مباشرةً: الجلسةُ تختفي فورَ الأمرِ المُفوِّزِ الناجحِ (قبلَ التنظيفِ
    //      وقبلَ تحريرِ غيرِها) ثمّ EndOfLife يزيلُ نوعَها المسجّل.
    // السياقُ يُستعمَلُ بالانعكاسِ — هذه أداةُ قياسٍ للاختبارِ لا مسارَ البروفةِ.
    public static class ContextLifetimeProbe
    {
        private static uint U32(byte[] b, int o) { return ((uint)b[o] << 24) | ((uint)b[o + 1] << 16) | ((uint)b[o + 2] << 8) | b[o + 3]; }

        private static byte[] Params(byte[] r, int handles)
        {
            int o = 10 + 4 * handles;
            if (r[1] == 2) { int n = (int)U32(r, o); byte[] p = new byte[n]; Array.Copy(r, o + 4, p, 0, n); return p; }
            byte[] q = new byte[r.Length - o]; Array.Copy(r, o, q, 0, q.Length); return q;
        }

        // جردٌ قرائيّ للمقابضِ (صفحاتُ 64) — إثباتُ حضورٍ/غيابٍ لا مساسَ بالحالةِ.
        private static bool HandlePresent(ICeremonyTransport t, uint start, uint handle)
        {
            for (int page = 0; page < 16; page++)
            {
                byte[] r = t.Transmit(Cmd.GetCapability(1, start, 64));
                if (U32(r, 6) != 0) throw new InvalidOperationException("inventory rc=" + Hex.U32(U32(r, 6)));
                Rd q = new Rd(Params(r, 0)); byte more = q.U8(); q.U32(); uint n = q.U32(); uint last = 0;
                for (uint i = 0; i < n; i++) { uint h = q.U32(); if (h == handle) return true; last = h; }
                if (more == 0 || n == 0) return false;
                start = last + 1;
            }
            throw new InvalidOperationException("inventory incomplete");
        }

        private static byte[] RequireOk(ICeremonyTransport t, byte[] cmd, string what)
        {
            byte[] r = t.Transmit(cmd);
            if (U32(r, 6) != 0) throw new InvalidOperationException(what + " rc=" + Hex.U32(U32(r, 6)));
            return r;
        }

        public static List<string> Run(ICeremonyTransport t)
        {
            List<string> lines = new List<string>();
            Type ctxType = typeof(ResponseSchema).Assembly.GetType("Xuux.TpmCeremony.ResponseContext");
            object ctx = ctxType == null ? null : Activator.CreateInstance(ctxType);
            System.Reflection.MethodInfo record = ctxType == null ? null : ctxType.GetMethod("Record");
            System.Reflection.MethodInfo endOfLife = ctxType == null ? null : ctxType.GetMethod("EndOfLife");
            System.Reflection.MethodInfo tryObject = ctxType == null ? null : ctxType.GetMethod("TryObject");
            System.Reflection.MethodInfo trySessionType = ctxType == null ? null : ctxType.GetMethod("TrySessionType");
            System.Reflection.MethodInfo check = ctxType == null
                ? typeof(ResponseSchema).GetMethod("Check", new Type[] { typeof(uint), typeof(byte[]), typeof(byte[]) })
                : typeof(ResponseSchema).GetMethod("Check", new Type[] { typeof(uint), typeof(byte[]), typeof(byte[]), ctxType });
            if (ctxType == null)
            {
                lines.Add("constraint: ResponseContext type absent on this baseline; lifetime cases not measurable here");
                return lines;
            }
            // الحالةُ 1+2: فقدُ ردِّ التحريرِ، إثباتُ الغيابِ، إعادةُ الاستخدامِ (بلا تسجيلٍ ثمّ بهِ).
            byte[] primaryCmd = Cmd.CreatePrimary(new byte[0], Templates.StoragePrimary());
            byte[] primaryReply = RequireOk(t, primaryCmd, "primary");
            uint primary = U32(primaryReply, 10);
            record.Invoke(ctx, new object[] { Tpm.CC_CreatePrimary, primaryCmd, new uint[] { primary }, Params(primaryReply, 1) });
            object[] oa = new object[] { primary, null, null, null };
            bool known = (bool)tryObject.Invoke(ctx, oa);
            byte[] oldName = (byte[])oa[1]; byte[] oldQn = (byte[])oa[2]; uint oldHier = (uint)oa[3];
            lines.Add("record: known=" + known + " hier=" + Hex.U32(oldHier) + " nameLen=" + oldName.Length);
            // فقدُ ردِّ التحريرِ: يُرسَلُ الأمرُ ويُهمَلُ الردُّ (لا تسجيلَ ولا فحصَ) — نتيجةٌ مجهولةٌ للبروفةِ.
            RequireOk(t, Cmd.FlushContext(primary), "flush-loss");
            bool presentAfterLoss = HandlePresent(t, 0x80000000, primary);
            lines.Add("flush-loss: presentAfterLoss=" + presentAfterLoss);
            // إثباتُ الغيابِ بجردٍ قرائيّ ⇒ مسارُ الإنتاجِ (ReconcileOne) يستدعي EndOfLife:
            endOfLife.Invoke(ctx, new object[] { primary });
            object[] ra = new object[] { primary, null, null, null };
            bool stillKnown = (bool)tryObject.Invoke(ctx, ra);
            lines.Add("endoflife: contextRemoved=" + (!stillKnown));
            // إعادةُ استخدامٍ من طرفٍ ثالثٍ بلا تسجيلٍ: المقبضُ يعودُ كائنًا جديدًا (swtpm يعيدُ مقبضَ Primary المحرّر).
            byte[] pr2Cmd = Cmd.CreatePrimary(new byte[0], Templates.StoragePrimary());
            byte[] pr2 = RequireOk(t, pr2Cmd, "reuse");
            uint reused = U32(pr2, 10);
            object[] ua = new object[] { reused, null, null, null };
            bool inherited = (bool)tryObject.Invoke(ctx, ua);
            lines.Add("reuse-unrecorded: handle=" + Hex.U32(reused) + " inheritedContext=" + inherited);
            // ردُّ Create على الأصلِ المعادِ بلا سياقٍ ⇒ رفضٌ مسمّى (CONTEXT_UNKNOWN) لا ادّعاءُ تلفٍ:
            byte[] cc = Cmd.Create(reused, new byte[0], Templates.ServiceSigningKey());
            byte[] cr = RequireOk(t, cc, "create-on-reused");
            string unrecordedVerdict;
            try
            {
                check.Invoke(null, new object[] { Tpm.CC_Create, cc, Params(cr, 0), ctx });
                unrecordedVerdict = "ACCEPT";
            }
            catch (System.Reflection.TargetInvocationException e) { unrecordedVerdict = "REJECT " + e.InnerException.Message; }
            lines.Add("reuse-unrecorded: createCheck=" + unrecordedVerdict);
            // الحالةُ 2: التسجيلُ بعدَ إعادةِ الاستخدامِ ⇒ مقبولٌ بلا وراثةِ الأسماءِ القديمةِ.
            record.Invoke(ctx, new object[] { Tpm.CC_CreatePrimary, pr2Cmd, new uint[] { reused }, Params(pr2, 1) });
            object[] na = new object[] { reused, null, null, null };
            bool reKnown = (bool)tryObject.Invoke(ctx, na);
            byte[] newName = (byte[])na[1]; byte[] newQn = (byte[])na[2];
            lines.Add("reuse-recorded: known=" + reKnown + " newNameLen=" + newName.Length +
                " nameChanged=" + (Hex.Of(newName) != Hex.Of(oldName)) + " qnChanged=" + (Hex.Of(newQn) != Hex.Of(oldQn)));
            byte[] cc2 = Cmd.Create(reused, new byte[0], Templates.ServiceSigningKey());
            byte[] cr2 = RequireOk(t, cc2, "create-on-recorded");
            string recordedVerdict;
            try
            {
                check.Invoke(null, new object[] { Tpm.CC_Create, cc2, Params(cr2, 0), ctx });
                recordedVerdict = "ACCEPT";
            }
            catch (System.Reflection.TargetInvocationException e) { recordedVerdict = "REJECT " + e.InnerException.Message; }
            lines.Add("reuse-recorded: createCheck=" + recordedVerdict);
            // تنظيفُ الكائنِ المعادِ استخدامِهِ قبلَ الحالةِ التاليةِ (تحريرٌ ناجحٌ يُسجَّلُ كالإنتاجِ).
            byte[] reusedFlushCmd = Cmd.FlushContext(reused);
            RequireOk(t, reusedFlushCmd, "cleanup-reused");
            record.Invoke(ctx, new object[] { Tpm.CC_FlushContext, reusedFlushCmd, new uint[0], new byte[0] });

            // الحالةُ 3: فقدُ ردِّ التحريرِ والمقبضُ ما زالَ حاضرًا ⇒ السياقُ محفوظٌ.
            byte[] p2Cmd = Cmd.CreatePrimary(new byte[0], Templates.StoragePrimary());
            byte[] p2r = RequireOk(t, p2Cmd, "p2");
            uint p2 = U32(p2r, 10);
            record.Invoke(ctx, new object[] { Tpm.CC_CreatePrimary, p2Cmd, new uint[] { p2 }, Params(p2r, 1) });
            // تحريرٌ لمقبضٍ غيرِ موجودٍ ⇒ خطأٌ؛ المقبضُ الحيّ باقٍ والسياقُ لا يُمسّ.
            byte[] fr = t.Transmit(Cmd.FlushContext(0x81234567));
            bool flushFailed = U32(fr, 6) != 0;
            bool p2Present = HandlePresent(t, 0x80000000, p2);
            object[] pa = new object[] { p2, null, null, null };
            bool p2Known = (bool)tryObject.Invoke(ctx, pa);
            lines.Add("still-present: flushFailed=" + flushFailed + " present=" + p2Present + " contextKept=" + p2Known);
            RequireOk(t, Cmd.FlushContext(p2), "cleanup-p2");

            // الحالةُ 4: استهلاكُ جلسةِ السياسةِ يُقاسُ مباشرةً (سياسةُ المرساةِ بمفتاحِ الخدمةِ).
            byte[] primCmd = Cmd.CreatePrimary(new byte[0], Templates.StoragePrimary());
            uint prim = U32(RequireOk(t, primCmd, "prim"), 10);
            byte[] pcrCmd = Cmd.Create(prim, new byte[0], Templates.ServiceSigningKey());
            byte[] pcr = RequireOk(t, pcrCmd, "svc-create");
            Rd k = new Rd(Params(pcr, 0));
            byte[] priv = k.B2B(); byte[] pub = k.B2B();
            byte[] ldCmd = Cmd.Load(prim, new byte[0], priv, pub);
            byte[] ldr = RequireOk(t, ldCmd, "svc-load");
            uint key = U32(ldr, 10);
            record.Invoke(ctx, new object[] { Tpm.CC_Create, pcrCmd, new uint[0], Params(pcr, 0) });
            record.Invoke(ctx, new object[] { Tpm.CC_Load, ldCmd, new uint[] { key }, Params(ldr, 1) });
            try
            {
                byte[] keyName = Policy.Name(pub);
                byte[] policy = Policy.AnchorIncrementPolicy(keyName);
                byte[] nvPub = new Wr().U32(0x01807700).U16(Tpm.ALG_SHA256).U32(Tpm.ANCHOR_ATTRIBUTES).B2B(policy).U16(8).Bytes();
                RequireOk(t, Cmd.NvDefineSpace(new byte[0], new byte[0], nvPub), "anchor-define");
                try
                {
                    byte[] scmd = Cmd.StartAuthSession(Tpm.SE_POLICY, new byte[32]);
                    byte[] sr = RequireOk(t, scmd, "policy-session");
                    uint ps = U32(sr, 10);
                    byte[] nonce = new Rd(Params(sr, 1)).B2B();
                    record.Invoke(ctx, new object[] { Tpm.CC_StartAuthSession, scmd, new uint[] { ps }, Params(sr, 1) });
                    object[] sa = new object[] { ps, null };
                    bool sessionKnown = (bool)trySessionType.Invoke(ctx, sa);
                    lines.Add("policy-session: known=" + sessionKnown + " type=" + (byte)sa[1]);
                    byte[] sg = RequireOk(t, Cmd.Sign(key, new byte[0], Policy.AHash(nonce, 0)), "sign-ahash");
                    Rd sig = new Rd(Params(sg, 0)); sig.U16(); sig.U16(); byte[] r = sig.B2B(); byte[] s = sig.B2B();
                    RequireOk(t, Cmd.PolicySigned(key, ps, nonce, 0, r, s), "policysigned");
                    RequireOk(t, Cmd.PolicyCommandCode(ps, Tpm.CC_NV_Increment), "policycommandcode");
                    // الأمرُ المُفوِّزُ الناجحُ يستهلكُ الجلسةَ (continueSession=0 في PolicyAuth):
                    RequireOk(t, Cmd.NvIncrement(0x01807700, Cmd.PolicyAuth(ps, new byte[32])), "authorized-increment");
                    // قياسٌ مباشرٌ فوريّ: الجلسةُ اختفت قبلَ التنظيفِ وقبلَ تحريرِ المفتاحِ.
                    bool sessionGone = !HandlePresent(t, 0x02000000, ps);
                    endOfLife.Invoke(ctx, new object[] { ps });
                    object[] ca = new object[] { ps, null };
                    bool sessionTypeRemoved = !((bool)trySessionType.Invoke(ctx, ca));
                    lines.Add("consumed: sessionGoneImmediately=" + sessionGone + " contextRemoved=" + sessionTypeRemoved);
                }
                finally { RequireOk(t, Cmd.NvUndefineSpace(new byte[0], 0x01807700), "anchor-undefine"); }
            }
            finally
            {
                RequireOk(t, Cmd.FlushContext(key), "cleanup-key");
                RequireOk(t, Cmd.FlushContext(prim), "cleanup-prim");
            }
            lines.Add("probe: done");
            return lines;
        }
    }
}
