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

        public CeremonyFaultTransport(ICeremonyTransport inner, string mode) { _inner = inner; _mode = mode; }

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
            byte[] raw = _inner.Transmit(command);
            Rd header = new Rd(raw);
            ushort tag = header.U16(); header.U32(); uint rc = header.U32();
            if (_mode == "define-response-loss" && cc == Tpm.CC_NV_DefineSpace && rc == 0 && Changes == 0)
            {
                Rd c = new Rd(command); c.U16(); c.U32(); c.U32(); c.U32(); uint authSize = c.U32(); c.Raw((int)authSize); c.B2B();
                DefinedPublic = c.B2B(); DefinedHandle = new Rd(DefinedPublic).U32(); Changes++;
                throw new System.IO.IOException("WL413_RESPONSE_LOSS_AFTER_DEFINE_EXECUTION");
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
