// tests/helpers/TpmCeremonyFaultTransport.cs
//
// أدواتُ اختبارٍ (WL-412) لنواةِ البروفة sim/tpm-ceremony/TpmCeremonyCore.cs — لا تُشحَنُ مع الأداة.
//   BlockingTransport : يلفُّ نقلَ المحاكي؛ عندَ ظهورِ كودِ الأمرِ المستهدفِ (المرّةَ n) لا يُمرِّرُه ويعيدُ
//                       ردَّ Windows TBS: TPM_E_COMMAND_BLOCKED (0x80280400) — حقنُ خطأٍ داخلَ الاختبار،
//                       لا ادّعاءٌ بسلوكِ TBS الحقيقيّ.
//   ForeignIdentityTransport : يجيبُ استعلامَ الهويّةِ بمصنّعٍ غيرِ المحاكي ("IFX") ويسجّلُ كلَّ ما عداه.
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
        private int _seen;
        public readonly List<string> Forwarded = new List<string>();
        public int BlockedCount;

        public BlockingTransport(ICeremonyTransport inner, uint commandCode, int nth)
        {
            _inner = inner; _cc = commandCode; _nth = nth;
        }

        public string Kind { get { return _inner.Kind + "+fault-injection"; } }

        public byte[] Transmit(byte[] command)
        {
            uint cc = ((uint)command[6] << 24) | ((uint)command[7] << 16) | ((uint)command[8] << 8) | command[9];
            if (cc == _cc)
            {
                _seen++;
                if (_seen == _nth)
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

    public static class CommandEmitter
    {
        // كلُّ شكلِ أمرٍ تُرسِلُه البروفة، بقيمٍ عشوائيةٍ غيرِ صالحةٍ للعتاد — يُعرَضُ على حارسِ المضيفِ فقط.
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
            return l;
        }

        private static void Add(List<KeyValuePair<string, string>> l, string n, byte[] b)
        {
            l.Add(new KeyValuePair<string, string>(n, Hex.Of(b)));
        }
    }
}
