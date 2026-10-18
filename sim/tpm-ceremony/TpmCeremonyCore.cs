// sim/tpm-ceremony/TpmCeremonyCore.cs
//
// بروفةُ المراسمِ S1/S2 على المحاكي وحدَه (WL-412؛ ADR 0007 §11.2؛ تفويضُ المالكِ 2026-10-17).
// معالجةُ نتائجِ المراجعةِ المستقلّةِ (WL-413، 2026-10-17): تدقيقُ الردودِ المشوّهةِ (SOL-01)،
// دفترُ المواردِ والجردُ بعدَ النتيجةِ المجهولةِ (SOL-02)، تحريرٌ لا يُخفي جلسةً (SOL-03)،
// رموزُ رفضٍ محدَّدةٌ لكلِّ حالةٍ سلبيّةٍ (SOL-04)، وهويّةُ المحاكيِ كاملةً بلا طيِّ مسافاتٍ (G47-1).
//
// ما هنا: منشئُ أوامرِ المراسمِ وترميزُها (TPM 2.0 Part 3)، والسماتُ (§4.1)، وحسابُ بصمةِ السياسةِ
// (§4.2)، ومنطقُ البروفةِ بفشلٍ مغلقٍ، ونقلٌ واحدٌ إلى swtpm على loopback.
//
// ما ليس هنا عمداً: لا DllImport، ولا tbs.dll، ولا أيُّ نقلٍ إلى TPM حقيقيّ. والبروفةُ تتحقّقُ من هويّةِ
// المحاكي (خصائصُ المصنّعِ وسلاسلِ البائعِ الأربعُ كاملةً بقيمٍ خامّةٍ) قبلَ أيِّ أمرٍ مُغيِّرٍ، فترفضُ غيرَه.
// ولا تُخرِجُ أوامرَ خامّةً قابلةً لإعادةِ الإرسال: التقريرُ يحملُ بصمةَ SHA-256 لكلِّ أمرٍ لا بايتاتِه،
// والمقابضُ والجلساتُ والـnonces تُولَّدُ لكلِّ تشغيل.
//
// حدودُ تصديقٍ لا تتجاوَزُها الشيفرةُ (WL-413 §2.7): فقدُ ردِّ أمرٍ مُغيِّرٍ لا يُثبتُ عدمَ التنفيذ،
// ومطابقةُ المنطقةِ العامّةِ تُثبتُ ملكيّةَ فهرسِ NV لِهذهِ الجولةِ وحدَها ولا تُثبتُ وِلايةَ طرفٍ ثالثٍ
// متزامنٍ؛ والكائناتُ العابرةُ والجلساتُ بلا منطقةٍ عامّةٍ فملكيّتُها تُعلَنُ غيرَ محسومةٍ ولا تُحذَف.
//
// C# 5 عمداً (Windows PowerShell 5.1) — فلا $"" ولا ?. ولا nameof ولا out var ولا أعضاءُ =>.

using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;

namespace Xuux.TpmCeremony
{
    public static class Tpm
    {
        public const ushort ST_NO_SESSIONS = 0x8001;
        public const ushort ST_SESSIONS = 0x8002;

        public const uint CC_NV_UndefineSpace = 0x00000122;
        public const uint CC_NV_DefineSpace = 0x0000012A;
        public const uint CC_CreatePrimary = 0x00000131;
        public const uint CC_NV_Increment = 0x00000134;
        public const uint CC_NV_Read = 0x0000014E;
        public const uint CC_Create = 0x00000153;
        public const uint CC_Load = 0x00000157;
        public const uint CC_Sign = 0x0000015D;
        public const uint CC_PolicySigned = 0x00000160;
        public const uint CC_FlushContext = 0x00000165;
        public const uint CC_NV_ReadPublic = 0x00000169;
        public const uint CC_PolicyCommandCode = 0x0000016C;
        public const uint CC_StartAuthSession = 0x00000176;
        public const uint CC_GetCapability = 0x0000017A;
        public const uint CC_PolicyGetDigest = 0x00000189;

        public const uint RH_OWNER = 0x40000001;
        public const uint RH_NULL = 0x40000007;
        public const uint RS_PW = 0x40000009;

        public const ushort ALG_SHA256 = 0x000B;
        public const ushort ALG_NULL = 0x0010;
        public const ushort ALG_ECDSA = 0x0018;
        public const ushort ALG_ECC = 0x0023;
        public const ushort ALG_AES = 0x0006;
        public const ushort ALG_CFB = 0x0043;
        public const ushort ECC_NIST_P256 = 0x0003;
        public const ushort ST_HASHCHECK = 0x8024;

        public const byte SE_HMAC = 0x00;
        public const byte SE_POLICY = 0x01;
        public const byte SE_TRIAL = 0x03;

        // TPMA_NV (Part 2 r1.38 Table 204)
        public const uint NV_AUTHWRITE = 1u << 2;
        public const uint NV_POLICYWRITE = 1u << 3;
        public const uint NV_TPM_NT_COUNTER = 0x1u << 4;
        public const uint NV_POLICY_DELETE = 1u << 10;
        public const uint NV_AUTHREAD = 1u << 18;
        public const uint NV_NO_DA = 1u << 25;
        public const uint NV_ORDERLY = 1u << 26;
        public const uint NV_WRITTEN = 1u << 29;

        // TPMA_OBJECT
        public const uint OBJ_FIXEDTPM = 1u << 1;
        public const uint OBJ_FIXEDPARENT = 1u << 4;
        public const uint OBJ_SENSITIVEDATAORIGIN = 1u << 5;
        public const uint OBJ_USERWITHAUTH = 1u << 6;
        public const uint OBJ_NODA = 1u << 10;
        public const uint OBJ_RESTRICTED = 1u << 16;
        public const uint OBJ_DECRYPT = 1u << 17;
        public const uint OBJ_SIGN = 1u << 18;

        public const uint OWNER_INDEX_FIRST = 0x01800000;
        public const uint OWNER_INDEX_LAST = 0x01BFFFFF;

        // Windows TBS: TPM_E_COMMAND_BLOCKED (winerror.h).
        public const uint TPM_E_COMMAND_BLOCKED = 0x80280400;

        // رمزُ رفضِ مقبضٍ غيرِ موجودٍ (TPM_RC_HANDLE) — يُستعملُ في جردِ المصالحةِ القرائيّ.
        public const uint RC_HANDLE = 0x0000018B;
        // رمزُ رفضِ قراءةِ عدّادٍ غيرِ مهيّأٍ (TPM_RC_NV_UNINITIALIZED).
        public const uint RC_NV_UNINITIALIZED = 0x0000014A;

        // سماتُ S1: فهرسُ سبرٍ مؤقّتٌ — عدّادٌ، كتابةٌ وقراءةٌ بقيمةِ تفويضٍ فارغة، NO_DA، ORDERLY=0.
        public const uint S1_PROBE_ATTRIBUTES = NV_TPM_NT_COUNTER | NV_AUTHWRITE | NV_AUTHREAD | NV_NO_DA;

        // سماتُ المرساةِ كما في ADR 0007 §4.1: TPM_NT_COUNTER، POLICYWRITE، قراءةٌ بلا سرٍّ (AUTHREAD بقيمةٍ
        // فارغة)، NO_DA، ORDERLY=0، بلا POLICY_DELETE، بلا PCR.
        public const uint ANCHOR_ATTRIBUTES = NV_TPM_NT_COUNTER | NV_POLICYWRITE | NV_AUTHREAD | NV_NO_DA;

        // هويّةُ المحاكيِ المتوقَّعةُ كاملةً (قيمٌ خامّةٌ، لا طيَّ مسافاتٍ ولا اقتطاعَ سلاسل): swtpm/libtpms
        // يُعلِنُ المصنّعَ "IBM" وسلاسلَ البائعِ الأربعَ "SW  " / " TPM" / 0 / 0 (قياسُ 2026-10-17 على 0.10.1).
        // هذهَ علامةُ تعريفٍ لا مصادقةٌ تشفيريّةٌ على الطرفِ المقابلِ؛ حدودُها في نموذجِ التهديدِ.
        public const uint EXPECTED_MANUFACTURER = 0x49424D00;
        public const uint EXPECTED_VENDOR_1 = 0x53572020;
        public const uint EXPECTED_VENDOR_2 = 0x2054504D;
        public const uint EXPECTED_VENDOR_3 = 0x00000000;
        public const uint EXPECTED_VENDOR_4 = 0x00000000;
    }

    public static class Hex
    {
        public static string Of(byte[] b)
        {
            if (b == null) return null;
            StringBuilder sb = new StringBuilder(b.Length * 2);
            for (int i = 0; i < b.Length; i++) sb.Append(b[i].ToString("x2"));
            return sb.ToString();
        }

        public static string U32(uint v) { return "0x" + v.ToString("x8"); }
    }

    public static class Sha
    {
        public static byte[] H(byte[] data)
        {
            using (SHA256 s = SHA256.Create()) { return s.ComputeHash(data); }
        }

        public static byte[] Concat(params byte[][] parts)
        {
            int n = 0;
            for (int i = 0; i < parts.Length; i++) n += parts[i].Length;
            byte[] r = new byte[n];
            int o = 0;
            for (int i = 0; i < parts.Length; i++) { Buffer.BlockCopy(parts[i], 0, r, o, parts[i].Length); o += parts[i].Length; }
            return r;
        }
    }

    public sealed class Wr
    {
        private readonly MemoryStream _m = new MemoryStream();
        public Wr U8(byte v) { _m.WriteByte(v); return this; }
        public Wr U16(ushort v) { _m.WriteByte((byte)(v >> 8)); _m.WriteByte((byte)v); return this; }
        public Wr U32(uint v) { U16((ushort)(v >> 16)); U16((ushort)v); return this; }
        public Wr Raw(byte[] b) { _m.Write(b, 0, b.Length); return this; }
        public Wr B2B(byte[] b)
        {
            if (b == null) b = new byte[0];
            if (b.Length > 0xFFFF) throw new ArgumentException("TPM2B too large");
            U16((ushort)b.Length); return Raw(b);
        }
        public byte[] Bytes() { return _m.ToArray(); }
    }

    public sealed class Rd
    {
        private readonly byte[] _b;
        private int _o;
        public Rd(byte[] b) { _b = b; _o = 0; }
        public int Remaining { get { return _b.Length - _o; } }
        private void Need(int n) { if (_o + n > _b.Length) throw new CeremonyFailedException("RESPONSE_TRUNCATED", 0); }
        public byte U8() { Need(1); return _b[_o++]; }
        public ushort U16() { Need(2); ushort v = (ushort)((_b[_o] << 8) | _b[_o + 1]); _o += 2; return v; }
        public uint U32() { Need(4); uint v = ((uint)_b[_o] << 24) | ((uint)_b[_o + 1] << 16) | ((uint)_b[_o + 2] << 8) | _b[_o + 3]; _o += 4; return v; }
        public byte[] Raw(int n) { Need(n); byte[] r = new byte[n]; Buffer.BlockCopy(_b, _o, r, 0, n); _o += n; return r; }
        public byte[] B2B() { ushort n = U16(); return Raw(n); }
    }

    // ── منشئُ الأوامر (Part 3). كلُّ أمرٍ يُبنى من معاملاتِ التشغيلِ؛ لا قوالبَ بايتٍ ثابتة. ──
    public static class Cmd
    {
        public static byte[] PasswordAuth(byte[] password)
        {
            return new Wr().U32(Tpm.RS_PW).B2B(new byte[0]).U8(0x01).B2B(password).Bytes();
        }

        public static byte[] PolicyAuth(uint session, byte[] nonceCaller)
        {
            // continueSession = 0: تُغلَقُ الجلسةُ بعدَ الأمرِ الناجح. HMAC فارغٌ (لا PolicyAuthValue/PolicyPassword).
            return new Wr().U32(session).B2B(nonceCaller).U8(0x00).B2B(new byte[0]).Bytes();
        }

        public static byte[] Build(uint cc, uint[] handles, byte[][] auths, byte[] parameters)
        {
            Wr body = new Wr();
            for (int i = 0; i < handles.Length; i++) body.U32(handles[i]);
            bool sessions = auths != null && auths.Length > 0;
            if (sessions)
            {
                Wr a = new Wr();
                for (int i = 0; i < auths.Length; i++) a.Raw(auths[i]);
                byte[] ab = a.Bytes();
                body.U32((uint)ab.Length).Raw(ab);
            }
            body.Raw(parameters ?? new byte[0]);
            byte[] b = body.Bytes();
            return new Wr().U16(sessions ? Tpm.ST_SESSIONS : Tpm.ST_NO_SESSIONS).U32((uint)(10 + b.Length)).U32(cc).Raw(b).Bytes();
        }

        public static byte[] GetCapability(uint cap, uint property, uint count)
        {
            return Build(Tpm.CC_GetCapability, new uint[0], null, new Wr().U32(cap).U32(property).U32(count).Bytes());
        }

        public static byte[] StartAuthSession(byte sessionType, byte[] nonceCaller)
        {
            byte[] p = new Wr().B2B(nonceCaller).B2B(new byte[0]).U8(sessionType).U16(Tpm.ALG_NULL).U16(Tpm.ALG_SHA256).Bytes();
            return Build(Tpm.CC_StartAuthSession, new uint[] { Tpm.RH_NULL, Tpm.RH_NULL }, null, p);
        }

        public static byte[] PolicySigned(uint authObject, uint session, byte[] nonceTpm, int expiration, byte[] sigR, byte[] sigS)
        {
            byte[] p = new Wr().B2B(nonceTpm).B2B(new byte[0]).B2B(new byte[0]).U32((uint)expiration)
                .U16(Tpm.ALG_ECDSA).U16(Tpm.ALG_SHA256).B2B(sigR).B2B(sigS).Bytes();
            return Build(Tpm.CC_PolicySigned, new uint[] { authObject, session }, null, p);
        }

        public static byte[] PolicyCommandCode(uint session, uint code)
        {
            return Build(Tpm.CC_PolicyCommandCode, new uint[] { session }, null, new Wr().U32(code).Bytes());
        }

        public static byte[] PolicyGetDigest(uint session)
        {
            return Build(Tpm.CC_PolicyGetDigest, new uint[] { session }, null, null);
        }

        public static byte[] FlushContext(uint handle)
        {
            return Build(Tpm.CC_FlushContext, new uint[0], null, new Wr().U32(handle).Bytes());
        }

        public static byte[] CreatePrimary(byte[] ownerAuth, byte[] template)
        {
            byte[] sensitive = new Wr().B2B(new byte[0]).B2B(new byte[0]).Bytes();
            byte[] p = new Wr().B2B(sensitive).B2B(template).B2B(new byte[0]).U32(0).Bytes();
            return Build(Tpm.CC_CreatePrimary, new uint[] { Tpm.RH_OWNER }, new byte[][] { PasswordAuth(ownerAuth) }, p);
        }

        public static byte[] Create(uint parent, byte[] parentAuth, byte[] template)
        {
            byte[] sensitive = new Wr().B2B(new byte[0]).B2B(new byte[0]).Bytes();
            byte[] p = new Wr().B2B(sensitive).B2B(template).B2B(new byte[0]).U32(0).Bytes();
            return Build(Tpm.CC_Create, new uint[] { parent }, new byte[][] { PasswordAuth(parentAuth) }, p);
        }

        public static byte[] Load(uint parent, byte[] parentAuth, byte[] outPrivate, byte[] outPublic)
        {
            byte[] p = new Wr().B2B(outPrivate).B2B(outPublic).Bytes();
            return Build(Tpm.CC_Load, new uint[] { parent }, new byte[][] { PasswordAuth(parentAuth) }, p);
        }

        public static byte[] Sign(uint key, byte[] keyAuth, byte[] digest)
        {
            byte[] p = new Wr().B2B(digest).U16(Tpm.ALG_ECDSA).U16(Tpm.ALG_SHA256)
                .U16(Tpm.ST_HASHCHECK).U32(Tpm.RH_NULL).B2B(new byte[0]).Bytes();
            return Build(Tpm.CC_Sign, new uint[] { key }, new byte[][] { PasswordAuth(keyAuth) }, p);
        }

        public static byte[] NvPublic(uint index, uint attributes, byte[] authPolicy, ushort dataSize)
        {
            return new Wr().U32(index).U16(Tpm.ALG_SHA256).U32(attributes).B2B(authPolicy).U16(dataSize).Bytes();
        }

        public static byte[] NvDefineSpace(byte[] ownerAuth, byte[] indexAuth, byte[] nvPublic)
        {
            byte[] p = new Wr().B2B(indexAuth).B2B(nvPublic).Bytes();
            return Build(Tpm.CC_NV_DefineSpace, new uint[] { Tpm.RH_OWNER }, new byte[][] { PasswordAuth(ownerAuth) }, p);
        }

        public static byte[] NvIncrement(uint index, byte[] authEntry)
        {
            return Build(Tpm.CC_NV_Increment, new uint[] { index, index }, new byte[][] { authEntry }, null);
        }

        public static byte[] NvRead(uint index, byte[] authEntry, ushort size, ushort offset)
        {
            return Build(Tpm.CC_NV_Read, new uint[] { index, index }, new byte[][] { authEntry }, new Wr().U16(size).U16(offset).Bytes());
        }

        public static byte[] NvReadPublic(uint index)
        {
            return Build(Tpm.CC_NV_ReadPublic, new uint[] { index }, null, null);
        }

        public static byte[] NvUndefineSpace(byte[] ownerAuth, uint index)
        {
            return Build(Tpm.CC_NV_UndefineSpace, new uint[] { Tpm.RH_OWNER, index }, new byte[][] { PasswordAuth(ownerAuth) }, null);
        }
    }

    // ── القوالب (§4.2) ──
    public static class Templates
    {
        // مفتاحٌ أوّليٌّ للتخزين (ECC P-256، AES-128-CFB) — مؤقّتٌ يُحرَّرُ بعدَ البروفة.
        public static byte[] StoragePrimary()
        {
            uint attrs = Tpm.OBJ_FIXEDTPM | Tpm.OBJ_FIXEDPARENT | Tpm.OBJ_SENSITIVEDATAORIGIN | Tpm.OBJ_USERWITHAUTH
                | Tpm.OBJ_NODA | Tpm.OBJ_RESTRICTED | Tpm.OBJ_DECRYPT;
            return new Wr().U16(Tpm.ALG_ECC).U16(Tpm.ALG_SHA256).U32(attrs).B2B(new byte[0])
                .U16(Tpm.ALG_AES).U16(128).U16(Tpm.ALG_CFB)
                .U16(Tpm.ALG_NULL).U16(Tpm.ECC_NIST_P256).U16(Tpm.ALG_NULL)
                .B2B(new byte[0]).B2B(new byte[0]).Bytes();
        }

        // مفتاحُ خدمةٍ ECDSA P-256/SHA-256 غيرُ قابلٍ للتصدير (FixedTPM|FixedParent|Sign|NoDA) — §4.2.
        public static byte[] ServiceSigningKey()
        {
            uint attrs = Tpm.OBJ_FIXEDTPM | Tpm.OBJ_FIXEDPARENT | Tpm.OBJ_SENSITIVEDATAORIGIN | Tpm.OBJ_USERWITHAUTH
                | Tpm.OBJ_NODA | Tpm.OBJ_SIGN;
            return new Wr().U16(Tpm.ALG_ECC).U16(Tpm.ALG_SHA256).U32(attrs).B2B(new byte[0])
                .U16(Tpm.ALG_NULL)
                .U16(Tpm.ALG_ECDSA).U16(Tpm.ALG_SHA256).U16(Tpm.ECC_NIST_P256).U16(Tpm.ALG_NULL)
                .B2B(new byte[0]).B2B(new byte[0]).Bytes();
        }
    }

    // حسابُ بصمةِ السياسةِ بصيغةِ Part 3 (PolicyUpdate). مرجعيّةُ هذا الحسابِ ليست ذاتَه: البروفةُ تطابقُه
    // ببصمةِ جلسةِ تجربةٍ يحسبُها الـTPM، والاختبارُ يطابقُه بحسابٍ مستقلٍّ بلغةٍ أخرى (policy_digest.mjs).
    public static class Policy
    {
        private static byte[] U32(uint v) { return new Wr().U32(v).Bytes(); }

        public static byte[] PolicySigned(byte[] digest, byte[] authObjectName, byte[] policyRef)
        {
            byte[] d = Sha.H(Sha.Concat(digest, U32(Tpm.CC_PolicySigned), authObjectName));
            return Sha.H(Sha.Concat(d, policyRef ?? new byte[0]));
        }

        public static byte[] PolicyCommandCode(byte[] digest, uint code)
        {
            return Sha.H(Sha.Concat(digest, U32(Tpm.CC_PolicyCommandCode), U32(code)));
        }

        public static byte[] AnchorIncrementPolicy(byte[] serviceKeyName)
        {
            return PolicyCommandCode(PolicySigned(new byte[32], serviceKeyName, new byte[0]), Tpm.CC_NV_Increment);
        }

        public static byte[] AHash(byte[] nonceTpm, int expiration)
        {
            return Sha.H(Sha.Concat(nonceTpm, U32((uint)expiration), new byte[0], new byte[0]));
        }

        public static byte[] Name(byte[] publicArea)
        {
            return Sha.Concat(new byte[] { 0x00, 0x0B }, Sha.H(publicArea));
        }
    }

    // ── النقل ──
    public interface ICeremonyTransport
    {
        string Kind { get; }
        byte[] Transmit(byte[] command);
    }

    // النقلُ الوحيدُ في هذا الملف: swtpm على loopback. لا TBS ولا جهاز.
    public sealed class SwtpmLoopbackTransport : ICeremonyTransport, IDisposable
    {
        private readonly TcpClient _client;
        private readonly NetworkStream _stream;

        public SwtpmLoopbackTransport(string host, int port)
        {
            if (host != "127.0.0.1" && host != "::1") throw new CeremonyFailedException("SIMULATOR_TRANSPORT_LOOPBACK_ONLY", 0);
            if (port < 1 || port > 65535) throw new CeremonyFailedException("SIMULATOR_PORT_INVALID", 0);
            _client = new TcpClient(host, port);
            _stream = _client.GetStream();
            _stream.ReadTimeout = 15000;
        }

        public string Kind { get { return "simulator:swtpm-tcp"; } }

        public byte[] Transmit(byte[] command)
        {
            _stream.Write(command, 0, command.Length);
            byte[] head = ReadExact(10);
            uint size = new Rd(head).U32Skip2();
            if (size < 10 || size > 65536) throw new CeremonyFailedException("SIMULATOR_RESPONSE_SIZE", 0);
            byte[] rest = ReadExact((int)size - 10);
            return Sha.Concat(head, rest);
        }

        private byte[] ReadExact(int n)
        {
            byte[] b = new byte[n];
            int got = 0;
            while (got < n)
            {
                int k = _stream.Read(b, got, n - got);
                if (k <= 0) throw new CeremonyFailedException("SIMULATOR_CONNECTION_CLOSED", 0);
                got += k;
            }
            return b;
        }

        public void Dispose() { _stream.Dispose(); _client.Close(); }
    }

    public static class RdExt
    {
        public static uint U32Skip2(this Rd r) { r.U16(); return r.U32(); }
    }

    public class CeremonyFailedException : Exception
    {
        public readonly uint Rc;
        public CeremonyFailedException(string code, uint rc) : base(code) { Rc = rc; }
    }

    public sealed class CeremonyBlockedException : CeremonyFailedException
    {
        public CeremonyBlockedException(string step, uint rc) : base("BLOCKED_FAIL_CLOSED: " + step, rc) { }
    }

    // ردُّ خطأٍ من الـTPM كاملُ البنيةِ (رأسٌ فقط، وسمُ بلا جلساتٍ، رمزٌ معروفٌ) — WL-413 الدفعة الثالثة
    // (SOL413-05): الأدلّةُ القرائيّةُ (غيابُ فهرسٍ / عدّادٌ غيرُ مهيّأٍ) تُستنبَطُ من هذا النوعِ وحدَه؛
    // ردٌّ مشوَّهٌ يرفعُ الرمزَ نفسَهُ لا يُعَدُّ دليلَ غيابٍ بل فشلًا مسمّى (بنيتُهُ غيرُ معلومةٍ).
    public sealed class TpmErrorException : CeremonyFailedException
    {
        public TpmErrorException(string message, uint rc) : base(message, rc) { }
    }

    // بنيةُ ردٍّ ناجحٍ مخالفةٌ للبنيةِ المتوقَّعةِ من الطلبِ (SOL413-04/G47-413-3): البنيةُ فُكَّت
    // وشُيِّدت بالكاملِ، لكنّ محتواها لا يطابقُ مواصفةَ الطلبِ — فشلٌ مسمّى يمنعُ الافتراضاتِ على
    // أيِّ جزءٍ من المحتوى، ولا يُعامَلُ بوصفِهِ ردَّ خطأٍ من الـTPM.
    public sealed class ResponseMalformedException : CeremonyFailedException
    {
        public ResponseMalformedException(string code, uint rc) : base(code, rc) { }
    }

    // نتيجةٌ مجهولةٌ لأمرٍ مُغيِّرٍ (WL-413): الردَّ ضاعَ بعدَ الإرسالِ فلا يُعرفُ هل نُفِّذَ —
    // تُعالَجُ بجردِ مصالحةٍ قرائيٍّ قبلَ أيِّ تنظيفٍ، لا بتجاهلٍ ولا بافتراضِ عدمِ التنفيذ.
    public sealed class CeremonyUnknownOutcomeException : CeremonyFailedException
    {
        public CeremonyUnknownOutcomeException(string step, Exception inner)
            : base("OUTCOME_UNKNOWN: " + step + " (" + inner.GetType().Name + ": " + inner.Message + ")", 0) { }
    }

    public sealed class Resp
    {
        public ushort Tag;
        public uint Rc;
        public uint[] Handles = new uint[0];
        public byte[] Params = new byte[0];

        // تدقيقٌ صارمٌ مربوطٌ بشكلِ الطلبِ (WL-413/SOL-01): وسمُ الردِّ عندَ النجاحِ يطابقُ وسمَ الطلبِ،
        // وردُّ الخطأِ رأسٌ فقط (10 بايتاتٍ) بوسمِ بلا جلساتٍ، ومناطقُ تفويضِ الردِّ بعددِ جلساتِ الطلبِ
        // تُفكُّ وتُستهلَكُ كاملةً — أيُّ تشويهٍ يُفشِلُ مغلقًا برمزٍ مسمّى، لا يُتجاوَزُ إلى الافتراضات.
        public static Resp Parse(byte[] raw, int handleCount, ushort expectedTag, int authCount, bool[] passwordSessions)
        {
            if (raw == null || raw.Length < 10) throw new CeremonyFailedException("RESPONSE_TRUNCATED_HEADER", 0);
            Rd r = new Rd(raw);
            Resp p = new Resp();
            p.Tag = r.U16();
            uint size = r.U32();
            p.Rc = r.U32();
            if (size != raw.Length) throw new ResponseMalformedException("RESPONSE_SIZE_MISMATCH", p.Rc);
            if (p.Rc != 0)
            {
                // ردُّ الخطأِ لا يحملُ مقابضَ ولا معاملاتٍ ولا تفويضاتٍ (Part 3 §6.1): رأسٌ فقط.
                if (p.Tag != Tpm.ST_NO_SESSIONS) throw new ResponseMalformedException("RESPONSE_ERROR_TAG_MALFORMED", p.Rc);
                if (raw.Length != 10) throw new ResponseMalformedException("RESPONSE_ERROR_BODY_MALFORMED", p.Rc);
                return p;
            }
            if (p.Tag != expectedTag)
                throw new ResponseMalformedException("RESPONSE_TAG_MISMATCH: expected=0x" + expectedTag.ToString("x4") + " got=0x" + p.Tag.ToString("x4"), 0);
            p.Handles = new uint[handleCount];
            for (int i = 0; i < handleCount; i++) p.Handles[i] = r.U32();
            if (p.Tag == Tpm.ST_SESSIONS)
            {
                if (authCount < 1) throw new CeremonyFailedException("RESPONSE_AUTH_COUNT_MALFORMED", 0);
                uint ps = r.U32();
                // حدٌّ صريحٌ قبلَ التخصيصِ (WL-413 الدفعة الثالثة / SOL413-07): إعلانُ حجمٍ يفوقُ ما تبقّى
                // من الردِّ فشلٌ مسمّى لا تخصيصًا ضخمًا ولا اقتطاعًا صامتًا.
                if (ps > (uint)r.Remaining)
                    throw new ResponseMalformedException("RESPONSE_PARAMETER_SIZE_INVALID: " + ps + " > remaining " + r.Remaining, 0);
                p.Params = r.Raw((int)ps);
                try
                {
                    // منطقةُ تفويضِ الردِّ: TPMS_AUTH_RESPONSE لكلِّ جلسةٍ أُرسِلَت في الطلبِ (Part 2 §10.13.3).
                    // تدقيقُ المحتوى (WL-413 الدفعة الثالثة / SOL413-03): البروفةُ لا تُرسِلُ إلا نوعيْ تفويضٍ —
                    // كلمةَ سرٍّ (RS_PW) وجلسةَ سياسةٍ — فكلُّ ردِّ تفويضٍ يجبُ أن يطابقَ أحدَ الملفيْنِ كاملًا
                    // وإلّا فشلٌ مغلقٌ مسمّى لا يُمرَّرُ:
                    //   RS_PW  : nonceTPM فارغٌ (حجمُ 0)، sessionAttributes = continueSession وحده (0x01)، hmac فارغٌ.
                    //   policy : nonceTPM من 16..64 بايتًا، hmac فارغٌ (لا sessionKey لهذهِ الجلساتِ)،
                    //            sessionAttributes بلا بتّاتٍ محفوظةٍ (أعلىُ 4 بتّاتٍ صفرٌ دائمًا).
                    for (int i = 0; i < authCount; i++)
                    {
                        byte[] nonce = r.B2B();
                        byte attrs = r.U8();
                        byte[] hmac = r.B2B();
                        bool passwordProfile = nonce.Length == 0 && hmac.Length == 0 && attrs == 0x01;
                        bool policyProfile = nonce.Length == 32 && hmac.Length == 0 && attrs == 0x00; // قياسُ swtpm: بلا continueSession
                        bool expectPassword = passwordSessions != null && i < passwordSessions.Length && passwordSessions[i];
                        if (expectPassword ? !passwordProfile : !policyProfile)
                            throw new ResponseMalformedException("RESPONSE_AUTH_CONTENT_MALFORMED: auth#" + i + " nonceLen=" + nonce.Length + " attrs=0x" + attrs.ToString("x2") + " hmacLen=" + hmac.Length + " expected=" + (expectPassword ? "password" : "policy"), 0);
                    }
                }
                catch (ResponseMalformedException) { throw; }
                catch (Exception)
                {
                    throw new CeremonyFailedException("RESPONSE_AUTH_AREA_MALFORMED", 0);
                }
                if (r.Remaining != 0) throw new CeremonyFailedException("RESPONSE_TRAILING_BYTES", 0);
            }
            else
            {
                p.Params = r.Raw(r.Remaining);
            }
            return p;
        }
    }

    // ── مخططُ بنيةِ معاملاتِ الردِّ الناجحِ لكلِّ أمرٍ (WL-413 الدفعة الثانية / R2-03): يُستهلَكُ كلُّ
    // حقلٍ ويُتحقَّقُ من الأحجامِ الداخليّةِ ومن انعدامِ البايتاتِ الزائدةِ. أمرٌ بلا مخطّطٍ يُرفَضُ — لا
    // يُفسَّرُ ردٌّ لا يُعرَفُ شكلُه. البنى من TPM 2.0 Part 3 (ردودُ الأوامر) وPart 2 (الأنواع). ──
    // سياقُ الردودِ المُتحقَّقِ منها (WL-414 دورةُ المعالجةِ / FUP-SOL-01/02/05): يسجّلُ — بعدَ نجاحِ فحصِ
    // المخطّطِ فقط — اسمَ كلِّ كائنٍ أنشأتْه البروفةُ أو حمّلتْه، وهرميّتَه، واسمَه المؤهَّلَ، ونوعَ كلِّ جلسةٍ
    // بدأتْها. فحوصُ الردودِ التي تعتمدُ على حالةٍ سابقةٍ (اسمُ الأصلِ في بياناتِ الإنشاءِ، وتذكرةُ PolicySigned
    // الحقيقيّةُ عندَ expiration سالبٍ) تُربَطُ به؛ مقبضٌ غيرُ مسجّلٍ ⇒ فشلٌ مغلقٌ مسمّى لا قبولٌ بنيويٌّ.
    public sealed class ResponseContext
    {
        private readonly Dictionary<uint, byte[]> _names = new Dictionary<uint, byte[]>();
        private readonly Dictionary<uint, byte[]> _qualified = new Dictionary<uint, byte[]>();
        private readonly Dictionary<uint, uint> _hierarchy = new Dictionary<uint, uint>();
        private readonly Dictionary<uint, byte> _sessionType = new Dictionary<uint, byte>();

        public bool TryObject(uint h, out byte[] name, out byte[] qualifiedName, out uint hierarchy)
        {
            name = null; qualifiedName = null; hierarchy = 0;
            if (!_names.ContainsKey(h)) return false;
            name = _names[h]; qualifiedName = _qualified[h]; hierarchy = _hierarchy[h];
            return true;
        }

        public bool TrySessionType(uint h, out byte type)
        {
            type = 0;
            if (!_sessionType.ContainsKey(h)) return false;
            type = _sessionType[h];
            return true;
        }

        // الاسمُ المؤهَّلُ (Part 1 §16): QN(B) = nameAlg || H(QN(أصلِ B) || Name(B))، وQN للهرميّةِ = مقبضُها (4 بايتات).
        // قياسُ swtpm 2026-10-18: parentQualifiedName في ردِّ Create = 000B || SHA256(40000001 || Name(primary)).
        public static byte[] Qualified(byte[] parentQn, byte[] name)
        {
            byte[] cat = new byte[parentQn.Length + name.Length];
            Array.Copy(parentQn, 0, cat, 0, parentQn.Length);
            Array.Copy(name, 0, cat, parentQn.Length, name.Length);
            byte[] d = Sha.H(cat);
            byte[] q = new byte[2 + d.Length];
            q[0] = 0x00; q[1] = 0x0B;
            Array.Copy(d, 0, q, 2, d.Length);
            return q;
        }

        private static uint U32At(byte[] b, int o) { return ((uint)b[o] << 24) | ((uint)b[o + 1] << 16) | ((uint)b[o + 2] << 8) | b[o + 3]; }

        public static byte[] HierarchyName(uint h) { return new byte[] { (byte)(h >> 24), (byte)(h >> 16), (byte)(h >> 8), (byte)h }; }

        // يُستدعى بعدَ ResponseSchema.Check الناجحِ فقط (ردُّ رمزِه صفرٌ ومخطّطُه صالح).
        public void Record(uint cc, byte[] cmd, uint[] handles, byte[] prm)
        {
            switch (cc)
            {
                case Tpm.CC_CreatePrimary:
                {
                    uint hier = U32At(cmd, 10);
                    Rd r = new Rd(prm); r.B2B(); r.B2B(); r.B2B(); r.U16(); r.U32(); r.B2B();
                    byte[] nm = r.B2B();
                    Put(handles[0], nm, Qualified(HierarchyName(hier), nm), hier);
                    return;
                }
                case Tpm.CC_Load:
                {
                    uint parent = U32At(cmd, 10);
                    byte[] pn, pq; uint ph;
                    if (!TryObject(parent, out pn, out pq, out ph)) return; // أصلٌ غيرُ معروفٍ ⇒ لا يُسجَّلُ الابنُ فتُرفضُ فحوصُه لاحقًا
                    byte[] nm = new Rd(prm).B2B();
                    Put(handles[0], nm, Qualified(pq, nm), ph);
                    return;
                }
                case Tpm.CC_StartAuthSession:
                {
                    Rd c = new Rd(cmd); c.Raw(10 + 8); c.B2B(); c.B2B();
                    // مقبضٌ كان كائنًا ثمّ عادَ جلسةً: سياقُ الكائنِ لا يُورَّثُ للجلسةِ (WL-416) — دورةُ حياةِ
                    // السياقِ تتبعُ دورةَ حياةِ المقبضِ، والعكسُ موجودٌ سلفًا في Put (إزالةُ نوعِ الجلسةِ).
                    _names.Remove(handles[0]); _qualified.Remove(handles[0]); _hierarchy.Remove(handles[0]);
                    _sessionType[handles[0]] = c.U8();
                    return;
                }
                case Tpm.CC_FlushContext:
                {
                    uint h = U32At(cmd, 10);
                    _names.Remove(h); _qualified.Remove(h); _hierarchy.Remove(h); _sessionType.Remove(h);
                    return;
                }
            }
        }

        private void Put(uint h, byte[] name, byte[] qn, uint hier)
        {
            _names[h] = name; _qualified[h] = qn; _hierarchy[h] = hier; _sessionType.Remove(h);
        }

        // ── إزالةُ السياقِ عندَ إثباتِ انتهاءِ العمرِ (WL-416) ──
        // تُربطُ بالحدثِ الذي يُثبتُ زوالَ المقبضِ أو الجلسةِ فعلًا، لا بمجردِ نتيجةٍ مجهولةٍ:
        //   1. نجاحُ FlushContext المؤكَّد (عبرَ Record عندَ رمزِ صفرٍ).
        //   2. جردٌ قرائيٌّ يُثبتُ غيابَ المقبضِ بعدَ فقدِ ردِّ التحريرِ (مسارُ المصالحةِ).
        //   3. نجاحُ العمليةِ التي تستهلكُ الجلسةَ (جلسةُ السياسةِ تُستهلَكُ بأمرِ التفويضِ الناجحِ —
        //      سلوكُ المحاكي المُثبَتُ: الجردُ النهائيّ لا يُبقي جلساتٍ مستعملةً).
        // المقبضُ الحيّ أو الجردُ غيرُ المحسومِ لا يُزيلُ السياقَ — الفشلُ المغلقُ باقٍ، والسياقُ المفقودُ لا
        // يتحوّلُ قبولًا افتراضيًّا: فحوصُ الكائناتِ والجلساتِ المجهولةِ تظلُّ مسمّاةً (CONTEXT_UNKNOWN).
        public void EndOfLife(uint h)
        {
            _names.Remove(h); _qualified.Remove(h); _hierarchy.Remove(h); _sessionType.Remove(h);
        }
    }

    public static class ResponseSchema
    {
        private static void End(Rd r, string what)
        {
            if (r.Remaining != 0) throw new CeremonyFailedException("RESPONSE_PARAMS_TRAILING_BYTES: " + what + " extra=" + r.Remaining, 0);
        }

        private static void Name(byte[] n, string what)
        {
            // TPM2B_NAME لكائنٍ/فهرسٍ بخوارزميّةِ SHA-256: nameAlg(2) || digest(32).
            if (n.Length != 34 || n[0] != 0x00 || n[1] != 0x0B) throw new CeremonyFailedException("RESPONSE_NAME_MALFORMED: " + what + " len=" + n.Length, 0);
        }

        // عددُ مقابضِ الطلبِ لكلِّ أمرٍ تستعملُه البروفةُ (Part 3) — لاستخراجِ منطقةِ معاملاتِ الطلبِ.
        // نوعُ كلِّ جلسةٍ في طلبٍ ما: RS_PW (كلمةُ سرٍّ) أم مقبضُ جلسةٍ (سياسة/تجريبية) — من بايتاتِ الطلبِ
        // نفسِه. يُربَطُ ملفُّ تفويضِ الردِّ بنوعِ الجلسةِ المُرسَلةِ (R3SOL-02/قياسُ المراجعينَ الثلاثةِ):
        // ملفُّ السياسةِ في ردِّ أمرٍ بكلمةِ سرٍّ — والعكسُ — كان يُقبلُ لأنّ الفاحصَ يقبلُ أحدَ الملفينِ
        // على أيِّ منطقةِ تفويضٍ. attrs=0x01 (continueSession وحده) للملفينِ، وnonceTPM للسياسةِ = 32
        // (حجمُ nonceCaller في هذهِ البروفةِ؛ nonceTPM يُحفظُ من أولِّ nonceCaller — Part 1 §19.6.3.2).
        public static bool[] ExpectedPasswordSessions(byte[] cmd, int authCount)
        {
            bool[] kinds = new bool[authCount];
            ushort tag = (ushort)((cmd[0] << 8) | cmd[1]);
            if (tag != Tpm.ST_SESSIONS || authCount == 0) return kinds;
            Rd c = new Rd(cmd);
            c.U16(); c.U32(); uint cc = c.U32();
            c.Raw(4 * HandleCountOf(cc));
            c.U32(); // حجمُ منطقةِ التفويضِ
            for (int i = 0; i < authCount; i++)
            {
                kinds[i] = c.U32() == Tpm.RS_PW;
                c.B2B(); c.U8(); c.B2B(); // nonce، السماتُ، hmac للطلبِ
            }
            return kinds;
        }

        private static int HandleCountOf(uint cc)
        {
            switch (cc)
            {
                case Tpm.CC_NV_DefineSpace: return 1;
                case Tpm.CC_NV_Increment: return 2;
                case Tpm.CC_NV_Read: return 2;
                case Tpm.CC_NV_UndefineSpace: return 2;
                case Tpm.CC_NV_ReadPublic: return 1;
                case Tpm.CC_CreatePrimary: return 1;
                case Tpm.CC_Create: return 1;
                case Tpm.CC_Load: return 1;
                case Tpm.CC_Sign: return 1;
                case Tpm.CC_PolicySigned: return 2;
                case Tpm.CC_PolicyCommandCode: return 1;
                case Tpm.CC_PolicyGetDigest: return 1;
                case Tpm.CC_FlushContext: return 0;
                case Tpm.CC_StartAuthSession: return 2;
                case Tpm.CC_GetCapability: return 0;
                default: throw new CeremonyFailedException("RESPONSE_SCHEMA_UNKNOWN_COMMAND: " + Hex.U32(cc), 0);
            }
        }

        // منطقةُ معاملاتِ الطلبِ: بعدَ الترويسةِ والمقابضِ ومنطقةِ التفويضِ إن وُجدت (كلُّ ذلك من بايتاتِ الطلبِ نفسِه).
        private static byte[] CmdParams(byte[] cmd)
        {
            Rd c = new Rd(cmd);
            ushort tag = c.U16(); c.U32(); uint cc = c.U32();
            c.Raw(4 * HandleCountOf(cc));
            if (tag == Tpm.ST_SESSIONS) { uint authSize = c.U32(); c.Raw((int)authSize); }
            return c.Raw(c.Remaining);
        }

        // قالبُ المفتاحِ من أمرِ Create/CreatePrimary: B2B(sensitive) ثمّ B2B(template).
        private static byte[] CmdTemplate(byte[] cmd)
        {
            Rd c = new Rd(CmdParams(cmd));
            c.B2B();
            return c.B2B();
        }

        // تذكرةُ إنشاءٍ (TPMT_TK_CREATION): الوسمُ 0x8021 (TPM_ST_CREATED) والهرميّةُ مقبضُ ثابتٍ صالحٌ
        // (قياسُ swtpm: 0x40000001 للمالك) — قياسُ 2026-10-18.
        private static void CreationTicket(ushort tag, uint hierarchy, string what)
        {
            if (tag != 0x8021) throw new ResponseMalformedException("RESPONSE_TICKET_TAG_MALFORMED: " + what + " 0x" + tag.ToString("x4"), 0);
            // قيمُ TPMI_RH_HIERARCHY الأربعُ حصرًا (Part 2 جدولُ 29/51/28: المالكُ 0x40000001،
            // NULL 0x40000007، التأييدُ 0x4000000B، المنصّةُ 0x4000000C) — نطاقٌ عدديٌّ متصلٌ يقبلُ
            // مقابضَ ليست هرميّةً (R3SOL-03/قياسُ المراجعينَ) ويَرفضُ هرميّةً صالحةً أعلى.
            if (hierarchy != 0x40000001u && hierarchy != 0x40000007u && hierarchy != 0x4000000Bu && hierarchy != 0x4000000Cu)
                throw new ResponseMalformedException("RESPONSE_TICKET_HIERARCHY_MALFORMED: " + what + " " + Hex.U32(hierarchy), 0);
        }

        // طولُ بصمةِ التذكرةِ الحقيقيّةِ (HMAC بمفتاحِ سلامةِ السياقِ) في swtpm/libtpms: 64 — القياسُ نفسُه
        // لتذكرةِ الإنشاءِ (Create/CreatePrimary) ولتذكرةِ PolicySigned عندَ expiration سالبٍ في جلسةِ سياسةٍ
        // (قياسُ 2026-10-18، probes/TicketShape.cs). تذكرةُ NULL بصمتُها فارغةٌ (Part 2 §10.7.5).
        private const int TicketDigestLen = 64;

        // تذكرةُ تفويضٍ (TPMT_TK_AUTH) في ردِّ PolicySigned (WL-414 FUP-SOL-01/05 + ربطُ طولِ البصمةِ): الوسمُ
        // TPM_ST_AUTH_SIGNED = 0x8025 حصرًا (Part 2 جدولُ 19؛ 0x8023 هو AUTH_SECRET لـPolicySecret — كان يُقبلُ
        // خطأً بتعليقٍ عكسَ الوسمينِ). شكلُ التذكرةِ يُستنتَجُ من الطلبِ لا من الردِّ (Part 3 §23.3 + قياسُ swtpm):
        //   expiration ≥ 0، أو جلسةُ تجربةٍ ⇒ تذكرةُ NULL: timeout فارغٌ، hierarchy = RH_NULL، بصمةٌ فارغةٌ.
        //   expiration < 0 في جلسةِ سياسةٍ ⇒ تذكرةٌ حقيقيّةٌ: timeout بـ8 بايتاتٍ (UINT64)، hierarchy = هرميّةُ
        //   authObject المسجّلةُ، بصمةٌ بـTicketDigestLen.
        // سابقًا: كانت أيُّ هرميّةٍ من الأربعِ وأيُّ بصمةٍ ≤64 تُقبلُ عندَ الصفرِ، وكان الردُّ الصحيحُ عندَ
        // expiration موجبٍ (timeout فارغٌ) يُرفضُ.
        private static void PolicySignedTicket(byte[] cmd, byte[] to, ushort tag, uint hierarchy, byte[] digest, ResponseContext ctx)
        {
            if (tag != 0x8025)
                throw new ResponseMalformedException("RESPONSE_TICKET_TAG_MALFORMED: PolicySigned 0x" + tag.ToString("x4"), 0);
            Rd cp = new Rd(CmdParams(cmd)); cp.B2B(); cp.B2B(); cp.B2B(); int expiration = (int)cp.U32();
            bool realTicket = false;
            uint expectedHierarchy = Tpm.RH_NULL;
            if (expiration < 0)
            {
                uint authObject = ((uint)cmd[10] << 24) | ((uint)cmd[11] << 16) | ((uint)cmd[12] << 8) | cmd[13];
                uint session = ((uint)cmd[14] << 24) | ((uint)cmd[15] << 16) | ((uint)cmd[16] << 8) | cmd[17];
                byte type; byte[] n, q; uint h;
                if (ctx == null || !ctx.TrySessionType(session, out type))
                    throw new ResponseMalformedException("RESPONSE_POLICY_CONTEXT_UNKNOWN: session " + Hex.U32(session) + " at expiration=" + expiration, 0);
                if (type == Tpm.SE_POLICY)
                {
                    if (!ctx.TryObject(authObject, out n, out q, out h))
                        throw new ResponseMalformedException("RESPONSE_POLICY_CONTEXT_UNKNOWN: authObject " + Hex.U32(authObject), 0);
                    realTicket = true;
                    expectedHierarchy = h;
                }
            }
            int expectedTimeout = realTicket ? 8 : 0;
            int expectedDigest = realTicket ? TicketDigestLen : 0;
            if (to.Length != expectedTimeout)
                throw new ResponseMalformedException("RESPONSE_POLICY_TIMEOUT_MALFORMED: len=" + to.Length + " expected=" + expectedTimeout + " at expiration=" + expiration, 0);
            if (hierarchy != expectedHierarchy)
                throw new ResponseMalformedException("RESPONSE_TICKET_HIERARCHY_MALFORMED: PolicySigned " + Hex.U32(hierarchy) + " expected=" + Hex.U32(expectedHierarchy), 0);
            if (digest.Length != expectedDigest)
                throw new ResponseMalformedException("RESPONSE_TICKET_DIGEST_MALFORMED: PolicySigned len=" + digest.Length + " expected=" + expectedDigest, 0);
        }

        // منطقةٌ عامّةٌ لمفتاحِ ECC-P256 (SOL413-04): رأسُها (كلُّ حقولِ TPMT_PUBLIC عدا unique) يطابقُ القالبَ
        // المُرسَلَ بايتًا ببايتٍ، وunique نقطةُ P-256 كاملةٌ: X وY بـ32 بايتًا لكلٍّ منهما.
        private static void EccPublic(byte[] pub, byte[] template, string what)
        {
            if (pub.Length != template.Length - 4 + 68)
                throw new ResponseMalformedException("RESPONSE_PUBLIC_AREA_MALFORMED: " + what + " len=" + pub.Length + " template=" + template.Length, 0);
            for (int i = 0; i < template.Length - 4; i++)
                if (pub[i] != template[i])
                    throw new ResponseMalformedException("RESPONSE_PUBLIC_AREA_MALFORMED: " + what + " head differs from sent template at " + i, 0);
            Rd u = new Rd(pub);
            u.Raw(template.Length - 4);
            if (u.B2B().Length != 32 || u.B2B().Length != 32)
                throw new ResponseMalformedException("RESPONSE_PUBLIC_AREA_MALFORMED: " + what + " unique not a P-256 point", 0);
        }

        // TPMS_CREATION_DATA (SOL413-04) كما يُعلّمُها swtpm/libtpms (قياسُ 2026-10-18): تحديدُ PCR بعددٍ
        // ومداخلَ محدودةٍ، ثمّ بصمةٌ بحجمِ 32، ثمّ locality وparentNameAlg ثمّ حقولُ B2B محدودةٌ تُستهلَكُ كاملةً.
        private static void CreationData(byte[] cd, string what, byte[] cmd, ResponseContext ctx)
        {
            try
            {
                if (cd.Length < 13 || cd.Length > 512)
                    throw new ResponseMalformedException("RESPONSE_CREATION_DATA_MALFORMED: " + what + " len=" + cd.Length, 0);
                Rd q = new Rd(cd);
                uint count = q.U32();
                if (count > 4) throw new ResponseMalformedException("RESPONSE_CREATION_DATA_MALFORMED: " + what + " pcrSelect count=" + count, 0);
                for (uint i = 0; i < count; i++)
                {
                    q.U16();
                    byte sz = q.U8();
                    if (sz > 16) throw new ResponseMalformedException("RESPONSE_CREATION_DATA_MALFORMED: " + what + " pcrSelect size=" + sz, 0);
                    q.Raw(sz);
                }
                // بصمةُ PCR: 32 (قياسُ swtpm عندَ قائمةٍ فارغةٍ) أو 0 عندَ قائمةٍ فارغةٍ (جملةُ الجدولِ
                // 222 في Part 2: pcrDigest.size صفرٌ عندَ قائمةٍ فارغةٍ) — كلا الترميزينِ سائغٌ (R3SOL-05).
                ushort dlen = q.U16();
                if (dlen != 32 && !(count == 0 && dlen == 0))
                    throw new ResponseMalformedException("RESPONSE_CREATION_DATA_MALFORMED: " + what + " pcrDigest len=" + dlen, 0);
                q.Raw(dlen);
                q.U8();  // locality
                // خوارزميّةُ اسمِ الأصلِ: ALG_NULL لإنشاءِ Primary بلا أصلٍ (قياسُ swtpm)، أو SHA-256
                // لإنشاءِ مفتاحٍ ابنٍ — ما عدا هذينِ فشلٌ مسمّى (قياسُ المراجعينَ: 0xffff كان يُقبلُ).
                ushort pna = q.U16();
                if (pna != Tpm.ALG_NULL && pna != Tpm.ALG_SHA256)
                    throw new ResponseMalformedException("RESPONSE_CREATION_DATA_MALFORMED: " + what + " parentNameAlg=0x" + pna.ToString("x4"), 0);
                // ثلاثةُ حقولِ B2B ذيليّةٍ حصرًا بترتيبِ Part 2 جدولِ 212: parentName ثمّ parentQualifiedName
                // ثمّ outsideInfo — حقولٌ ناقصةٌ أو رابعٌ زائدٌ كان يُقبلُ (قياسُ المراجعينَ).
                byte[][] tail = new byte[3][];
                int fields = 0;
                while (q.Remaining >= 2 && fields < 3) { tail[fields] = q.B2B(); fields++; }
                if (fields != 3 || q.Remaining != 0)
                    throw new ResponseMalformedException("RESPONSE_CREATION_DATA_MALFORMED: " + what + " tailFields=" + fields + " tail=" + q.Remaining, 0);
                // ربطُ الحقولِ الذيليّةِ بالطلبِ وبالأصلِ المعروفِ (WL-414 FUP-SOL-02): كانت تُستهلَكُ بنيويًّا
                // فقط، فقُبلَ outsideInfo مختلفٌ واسمُ أصلٍ مقلوبٌ (قياسُ المراجعِ على 3e67d362 وa3272058).
                Rd cp = new Rd(CmdParams(cmd)); cp.B2B(); cp.B2B(); byte[] askedOutside = cp.B2B();
                if (Hex.Of(tail[2]) != Hex.Of(askedOutside))
                    throw new ResponseMalformedException("RESPONSE_CREATION_DATA_MALFORMED: " + what + " outsideInfo differs from request", 0);
                uint parent = ((uint)cmd[10] << 24) | ((uint)cmd[11] << 16) | ((uint)cmd[12] << 8) | cmd[13];
                byte[] expName, expQn; ushort expAlg;
                if (CommandCodeOfCmd(cmd) == Tpm.CC_CreatePrimary)
                {
                    // Primary: لا أصلَ كائنيًّا ⇒ parentNameAlg = ALG_NULL، والاسمُ والاسمُ المؤهَّلُ = مقبضُ الهرميّةِ (قياسُ swtpm).
                    expAlg = Tpm.ALG_NULL;
                    expName = ResponseContext.HierarchyName(parent);
                    expQn = expName;
                }
                else
                {
                    uint ph;
                    if (ctx == null || !ctx.TryObject(parent, out expName, out expQn, out ph))
                        throw new ResponseMalformedException("RESPONSE_CREATION_PARENT_UNKNOWN: " + what + " parent " + Hex.U32(parent), 0);
                    expAlg = Tpm.ALG_SHA256;
                }
                if (pna != expAlg)
                    throw new ResponseMalformedException("RESPONSE_CREATION_DATA_MALFORMED: " + what + " parentNameAlg=0x" + pna.ToString("x4") + " expected=0x" + expAlg.ToString("x4"), 0);
                if (Hex.Of(tail[0]) != Hex.Of(expName))
                    throw new ResponseMalformedException("RESPONSE_CREATION_DATA_MALFORMED: " + what + " parentName differs from known parent", 0);
                if (Hex.Of(tail[1]) != Hex.Of(expQn))
                    throw new ResponseMalformedException("RESPONSE_CREATION_DATA_MALFORMED: " + what + " parentQualifiedName differs from known parent", 0);
            }
            catch (ResponseMalformedException) { throw; }
            catch (Exception)
            {
                throw new ResponseMalformedException("RESPONSE_CREATION_DATA_MALFORMED: " + what, 0);
            }
        }

        private static uint CommandCodeOfCmd(byte[] cmd) { return ((uint)cmd[6] << 24) | ((uint)cmd[7] << 16) | ((uint)cmd[8] << 8) | cmd[9]; }

        // بلا سياقٍ: الفحوصُ المعتمدةُ على حالةٍ سابقةٍ (اسمُ أصلِ Create، وتذكرةُ PolicySigned عندَ expiration سالبٍ)
        // تفشلُ مغلقةً باسمٍ. البروفةُ تستدعي الصيغةَ ذاتَ السياقِ دائمًا.
        public static void Check(uint cc, byte[] cmd, byte[] prm) { Check(cc, cmd, prm, null); }

        public static void Check(uint cc, byte[] cmd, byte[] prm, ResponseContext ctx)
        {
            Rd r = new Rd(prm);
            switch (cc)
            {
                case Tpm.CC_NV_DefineSpace:
                case Tpm.CC_NV_Increment:
                case Tpm.CC_NV_UndefineSpace:
                case Tpm.CC_FlushContext:
                case Tpm.CC_PolicyCommandCode:
                    End(r, "empty-params"); return;
                case Tpm.CC_NV_ReadPublic:
                {
                    byte[] pub = r.B2B(); byte[] nm = r.B2B(); End(r, "NV_ReadPublic");
                    if (pub.Length < 14) throw new CeremonyFailedException("RESPONSE_NV_PUBLIC_MALFORMED len=" + pub.Length, 0);
                    Name(nm, "NV_ReadPublic"); return;
                }
                case Tpm.CC_NV_Read:
                {
                    byte[] d = r.B2B(); End(r, "NV_Read");
                    // طولُ البياناتِ يطابقُ الحجمَ المطلوبَ في الأمرِ نفسِه (SOL413-04).
                    ushort size = new Rd(CmdParams(cmd)).U16();
                    if (d.Length != (int)size)
                        throw new ResponseMalformedException("RESPONSE_NV_READ_SIZE_MALFORMED: len=" + d.Length + " asked=" + size, 0);
                    return;
                }
                case Tpm.CC_StartAuthSession:
                {
                    byte[] nonce = r.B2B(); End(r, "StartAuthSession");
                    // nonceTPM بطولِ nonceCaller المُرسَلِ (32 في هذه البروفةِ) — لا nonce مُقتطَعٍ ولا فارغٍ (SOL413-04).
                    byte[] nonceCaller = new Rd(CmdParams(cmd)).B2B();
                    if (nonce.Length != nonceCaller.Length || nonce.Length < 16)
                        throw new ResponseMalformedException("RESPONSE_SESSION_NONCE_MALFORMED: len=" + nonce.Length + " nonceCaller=" + nonceCaller.Length, 0);
                    return;
                }
                case Tpm.CC_PolicyGetDigest:
                {
                    byte[] d = r.B2B(); End(r, "PolicyGetDigest");
                    if (d.Length != 32) throw new ResponseMalformedException("RESPONSE_POLICY_DIGEST_MALFORMED: len=" + d.Length, 0);
                    return;
                }
                case Tpm.CC_Load:
                {
                    // اسمُ الكائنِ المحمَّلِ يطابقُ المنطقةَ العامّةَ المُرسَلةَ في الطلبِ (R3SOL-03/قياسُ
                    // المراجعينَ): قلبُ بايتٍ في Name كان يُقبلُ لأنّ الفحصَ بنيويٌّ فقط.
                    byte[] nm = r.B2B(); End(r, "Load");
                    Name(nm, "Load");
                    Rd cp = new Rd(CmdParams(cmd)); cp.B2B(); byte[] pub = cp.B2B(); // outPrivate ثمّ المنطقةُ العامّةُ
                    if (Hex.Of(nm) != Hex.Of(Policy.Name(pub)))
                        throw new ResponseMalformedException("RESPONSE_NAME_HASH_MISMATCH: Load", 0);
                    return;
                }
                case Tpm.CC_Create:
                {
                    r.B2B(); // outPrivate
                    byte[] pub = r.B2B();
                    byte[] cd = r.B2B();
                    byte[] ch = r.B2B();
                    ushort ttag = r.U16(); uint h = r.U32(); byte[] tdg = r.B2B();
                    End(r, "Create");
                    EccPublic(pub, CmdTemplate(cmd), "Create");
                    CreationData(cd, "Create", cmd, ctx);
                    if (ch.Length != 32) throw new ResponseMalformedException("RESPONSE_CREATION_HASH_MALFORMED: len=" + ch.Length, 0);
                    // بصمةُ تذكرةِ الإنشاءِ بطولِها المقيسِ 64 (قياسُ swtpm؛ المراجعونَ قاسوا قبولَ بايتٍ واحدٍ
                    // و100) — فحصُ الطولِ الآن مسمّى (R3SOL-03).
                    if (tdg.Length != TicketDigestLen) throw new ResponseMalformedException("RESPONSE_TICKET_DIGEST_MALFORMED: Create len=" + tdg.Length, 0);
                    if (Hex.Of(Sha.H(cd)) != Hex.Of(ch))
                        throw new ResponseMalformedException("RESPONSE_CREATION_HASH_MISMATCH: Create", 0);
                    CreationTicket(ttag, h, "Create");
                    return;
                }
                case Tpm.CC_CreatePrimary:
                {
                    byte[] pub = r.B2B();
                    byte[] cd = r.B2B();
                    byte[] ch = r.B2B();
                    ushort ttag = r.U16(); uint h = r.U32(); byte[] tdg = r.B2B();
                    byte[] nm = r.B2B();
                    End(r, "CreatePrimary");
                    EccPublic(pub, CmdTemplate(cmd), "CreatePrimary");
                    CreationData(cd, "CreatePrimary", cmd, ctx);
                    if (ch.Length != 32) throw new ResponseMalformedException("RESPONSE_CREATION_HASH_MALFORMED: len=" + ch.Length, 0);
                    // بصمةُ تذكرةِ الإنشاءِ وفحصُ اتساقِ creationHash مع بياناتِ الإنشاءِ (R3SOL-03).
                    if (tdg.Length != TicketDigestLen) throw new ResponseMalformedException("RESPONSE_TICKET_DIGEST_MALFORMED: CreatePrimary len=" + tdg.Length, 0);
                    if (Hex.Of(Sha.H(cd)) != Hex.Of(ch))
                        throw new ResponseMalformedException("RESPONSE_CREATION_HASH_MISMATCH: CreatePrimary", 0);
                    CreationTicket(ttag, h, "CreatePrimary");
                    Name(nm, "CreatePrimary");
                    if (Hex.Of(nm) != Hex.Of(Policy.Name(pub)))
                        throw new ResponseMalformedException("RESPONSE_NAME_HASH_MISMATCH: CreatePrimary", 0);
                    return;
                }
                case Tpm.CC_Sign:
                {
                    ushort alg = r.U16();
                    if (alg != Tpm.ALG_ECDSA) throw new CeremonyFailedException("RESPONSE_SIGNATURE_ALG_UNEXPECTED: 0x" + alg.ToString("x4"), 0);
                    ushort hash = r.U16();
                    if (hash != Tpm.ALG_SHA256) throw new ResponseMalformedException("RESPONSE_SIGNATURE_HASH_UNEXPECTED: 0x" + hash.ToString("x4"), 0);
                    byte[] rr = r.B2B(); byte[] ss = r.B2B(); End(r, "Sign");
                    if (rr.Length != 32 || ss.Length != 32)
                        throw new ResponseMalformedException("RESPONSE_SIGNATURE_COMPONENT_MALFORMED: r=" + rr.Length + " s=" + ss.Length, 0);
                    return;
                }
                case Tpm.CC_PolicySigned:
                {
                    byte[] to = r.B2B();
                    ushort ttag = r.U16(); uint h = r.U32(); byte[] td = r.B2B();
                    End(r, "PolicySigned");
                    PolicySignedTicket(cmd, to, ttag, h, td, ctx);
                    return;
                }
                case Tpm.CC_GetCapability:
                {
                    Rd c = new Rd(cmd); c.Raw(10); uint askedCap = c.U32(); uint askedProp = c.U32(); uint askedCount = c.U32();
                    byte more = r.U8();
                    if (more > 1) throw new CeremonyFailedException("RESPONSE_CAPABILITY_MORE_MALFORMED", 0);
                    uint cap = r.U32();
                    if (cap != askedCap) throw new CeremonyFailedException("RESPONSE_CAPABILITY_MISMATCH: asked=" + Hex.U32(askedCap) + " got=" + Hex.U32(cap), 0);
                    uint n = r.U32();
                    if (n > 256) throw new CeremonyFailedException("RESPONSE_CAPABILITY_COUNT_IMPLAUSIBLE: " + n, 0);
                    // عددٌ يفوقُ المطلوبَ في الطلبِ فشلٌ مسمّى (R3SOL-01/فحصُ الحدودِ المباشر): الردُّ
                    // يعيدُ أكثرَ ممّا طُلب (65 لطلبِ 64) — الطلبُ هو المرجعُ (Part 3 §30.2).
                    if (n > askedCount) throw new ResponseMalformedException("RESPONSE_CAPABILITY_COUNT_MALFORMED: " + n + " > requested " + askedCount, 0);
                    // تقدّمٌ مزعومٌ بلا أثرٍ (SOL413-02): more=1 مع count=0 فشلٌ مسمّى لا نهايةٌ صامتةٌ للجردِ.
                    if (more == 1 && n == 0) throw new ResponseMalformedException("RESPONSE_CAPABILITY_NO_PROGRESS: more=1 count=0", 0);
                    int width = cap == 1 ? 4 : cap == 6 ? 8 : -1;
                    if (width < 0) throw new CeremonyFailedException("RESPONSE_CAPABILITY_UNSUPPORTED: " + Hex.U32(cap), 0);
                    if (cap == 1)
                    {
                        // فئةُ المقابضِ المعادةِ تطابقُ فئةَ property المطلوبِ (SOL413-02): مقبضٌ من فئةٍ أخرى
                        // في جردِ الجلساتِ/العابرةِ/NV فشلٌ مسمّى — لا إيقافٌ صامتٌ يجعلُ الجردَ ناقصًا.
                        // صعودٌ صارمٌ من قيمةِ الطلبِ (R3SOL-01/فحصُ الحدودِ): المقابضُ تعودُ تصاعديًا من
                        // property فلا مقبضَ دونَه ولا ترتيبًا تنازليًا ولا تكرارًا (Part 3 §30.2).
                        uint prev = 0;
                        for (uint i = 0; i < n; i++)
                        {
                            uint hd = r.U32();
                            byte cls = (byte)(hd >> 24);
                            byte want = (byte)(askedProp >> 24);
                            bool ok = (want == 0x02 || want == 0x03) ? (cls == 0x02 || cls == 0x03) : cls == want;
                            if (!ok) throw new ResponseMalformedException("RESPONSE_CAPABILITY_HANDLE_CLASS_MALFORMED: " + Hex.U32(hd) + " asked=" + Hex.U32(askedProp), 0);
                            if (hd < askedProp || (i > 0 && hd <= prev))
                                throw new ResponseMalformedException("RESPONSE_CAPABILITY_HANDLE_ORDER_MALFORMED: " + Hex.U32(hd) + " after " + Hex.U32(prev) + " from " + Hex.U32(askedProp), 0);
                            prev = hd;
                        }
                    }
                    else
                    {
                        // خاصيّةٌ تعودُ دونَ قيمةِ الطلبِ فشلٌ مسمّى (فحصُ الحدودِ المباشر): الاستئنافُ
                        // يبدأُ عندَ property أو أعلى (Part 3 §30.2).
                        for (uint i = 0; i < n; i++)
                        {
                            uint prop = r.U32(); r.U32();
                            if (prop < askedProp) throw new ResponseMalformedException("RESPONSE_CAPABILITY_PROPERTY_MALFORMED: " + Hex.U32(prop) + " < " + Hex.U32(askedProp), 0);
                        }
                    }
                    End(r, "GetCapability"); return;
                }
                default:
                    throw new CeremonyFailedException("RESPONSE_SCHEMA_UNKNOWN_COMMAND: " + Hex.U32(cc), 0);
            }
        }
    }

    public sealed class Step
    {
        public string Stage;
        public string Name;
        public uint CommandCode;
        public string CommandSha256;
        public uint ResponseCode;
        public string Expectation;
        public string Outcome;
    }

    public sealed class CeremonyReport
    {
        public string Schema = "xuux.tpm-ceremony-rehearsal/1";
        public string Transport;
        public string Stages;
        public string Status = "RUNNING";
        public string Failure;
        public readonly List<Step> Steps = new List<Step>();
        public readonly List<KeyValuePair<string, string>> Facts = new List<KeyValuePair<string, string>>();
        public readonly List<string> CleanupLeftovers = new List<string>();
        // جردُ المصالحةِ بعدَ نتيجةٍ مجهولةٍ (WL-413): مشاهداتٌ قرائيّةٌ وملكيّةٌ وإجراءٌ — لا حكمَ سلامةٍ.
        public readonly List<string> Reconciliation = new List<string>();
        // الجردُ القرائيُّ النهائيُّ بعدَ التنظيفِ (WL-413 الدفعة الثانية / R2-04): هو المرجعُ للحالةِ الفعليّةِ
        // على المحاكي. verified=false يعني أنّ الحالةَ المتبقّيةَ مجهولةٌ (لا ادّعاءَ نظافةٍ بلا دليل).
        public bool PostRunVerified;
        public string PostRunError;
        public readonly List<string> ResidualNv = new List<string>();
        public readonly List<string> ResidualSessions = new List<string>();
        public readonly List<string> ResidualTransients = new List<string>();

        public void Fact(string k, string v) { Facts.Add(new KeyValuePair<string, string>(k, v)); }

        private static string S(string s)
        {
            if (s == null) return "null";
            StringBuilder sb = new StringBuilder("\"");
            foreach (char c in s)
            {
                if (c == '"') sb.Append("\\\"");
                else if (c == '\\') sb.Append("\\\\");
                else if (c < 0x20 || c > 0x7E) sb.Append("\\u").Append(((int)c).ToString("x4"));
                else sb.Append(c);
            }
            return sb.Append('\"').ToString();
        }

        private static string Arr(List<string> xs)
        {
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < xs.Count; i++) { if (i > 0) sb.Append(','); sb.Append(S(xs[i])); }
            return sb.Append(']').ToString();
        }

        public string ToJson()
        {
            StringBuilder sb = new StringBuilder();
            sb.Append("{\"schema\":").Append(S(Schema));
            sb.Append(",\"transport\":").Append(S(Transport));
            sb.Append(",\"stages\":").Append(S(Stages));
            sb.Append(",\"status\":").Append(S(Status));
            sb.Append(",\"failure\":").Append(S(Failure));
            sb.Append(",\"steps\":[");
            for (int i = 0; i < Steps.Count; i++)
            {
                Step s = Steps[i];
                if (i > 0) sb.Append(',');
                sb.Append("{\"stage\":").Append(S(s.Stage)).Append(",\"name\":").Append(S(s.Name));
                sb.Append(",\"commandCode\":").Append(S(Hex.U32(s.CommandCode)));
                sb.Append(",\"commandSha256\":").Append(S(s.CommandSha256));
                sb.Append(",\"responseCode\":").Append(S(Hex.U32(s.ResponseCode)));
                sb.Append(",\"expectation\":").Append(S(s.Expectation));
                sb.Append(",\"outcome\":").Append(S(s.Outcome)).Append('}');
            }
            sb.Append("],\"facts\":{");
            for (int i = 0; i < Facts.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append(S(Facts[i].Key)).Append(':').Append(S(Facts[i].Value));
            }
            sb.Append("},\"cleanupLeftovers\":[");
            for (int i = 0; i < CleanupLeftovers.Count; i++) { if (i > 0) sb.Append(','); sb.Append(S(CleanupLeftovers[i])); }
            sb.Append("],\"reconciliation\":[");
            for (int i = 0; i < Reconciliation.Count; i++) { if (i > 0) sb.Append(','); sb.Append(S(Reconciliation[i])); }
            sb.Append("],\"postRunInventory\":{\"verified\":").Append(PostRunVerified ? "true" : "false");
            sb.Append(",\"error\":").Append(S(PostRunError));
            sb.Append(",\"residualNv\":").Append(Arr(ResidualNv));
            sb.Append(",\"residualSessions\":").Append(Arr(ResidualSessions));
            sb.Append(",\"residualTransients\":").Append(Arr(ResidualTransients));
            sb.Append("}}");
            return sb.ToString();
        }
    }

    public sealed class CeremonyRehearsal
    {
        private readonly ICeremonyTransport _t;
        private readonly RandomNumberGenerator _rng = RandomNumberGenerator.Create();
        private readonly CeremonyReport _r = new CeremonyReport();
        private readonly byte[] _ownerAuth = new byte[0]; // swtpm: تفويضُ المالكِ فارغ. لا سرَّ يُطلَب.
        private readonly Dictionary<uint, byte[]> _definedByRun = new Dictionary<uint, byte[]>();
        private readonly List<uint> _transients = new List<uint>();
        private bool _cleanup;
        private string _stage = "identity";

        // ── دفترُ المواردِ (WL-413/SOL-02): كلُّ أمرٍ مُغيِّرٍ يُسجَّلُ مرشَّحُهُ قبلَ الإرسالِ؛ فإنْ ضاعَ الردُّ
        // بقيتَ الحالةُ «مجهولةً» ويُجردُ المصالحةُ أثرَها قرائيًّا قبلَ أيِّ تنظيفٍ. لا يُفترَضُ عدمُ التنفيذِ
        // لمجردِ غيابِ الردِّ، ولا تُحذَفُ قيمةٌ لمجردِ وجودِها في المقبضِ المتوقَّعِ. ──
        private sealed class Pending
        {
            public string Kind;          // nv-define | nv-increment | nv-undefine | flush | object-create | session-create | policy-mutation
            public uint Handle;           // 0 = المقبضُ في الردِّ الذي ضاع
            public byte[] ExpectedPublic; // لـnv-define: المنطقةُ العامّةُ كما أُرسِلَت
            public ulong? BeforeValue;    // لـnv-increment: القيمةُ قبلَ الزيادةِ (null = غيرُ مهيّأٍ)
        }
        private readonly List<Pending> _pending = new List<Pending>();
        private HashSet<uint> _baselineNv;
        private HashSet<uint> _baselineTransients;
        private HashSet<uint> _baselineSessions;

        // حدٌّ صريحٌ لمحاولاتِ التنظيفِ (WL-413 §2.3): محاولةٌ واحدةٌ لكلِّ موردٍ في جولةِ تنظيفٍ واحدةٍ —
        // لا إعادةً غيرَ محدودةٍ ولا تخفيفُ سياسةٍ لتجاوزِ رفضٍ.
        private const int MaxCleanupAttemptsPerResource = 1;

        // سياقُ الردودِ المُتحقَّقِ منها (WL-414 FUP-SOL-01/02/05) — يُغذّى من Send بعدَ نجاحِ فحصِ المخطّطِ.
        private readonly ResponseContext _ctx = new ResponseContext();

        // جولةُ التنظيفِ الوحيدةُ انتهتْ (WL-414 FUP-SOL-04): بعدَها لا محاولةَ تنظيفٍ لاحقةً، فنصُّ المصالحةِ
        // يصفُ الميزانيّةَ المستنفدةَ ويُعلِنُ البقيّةَ صراحةً — لا «متروكٌ لمحاولةِ التنظيفِ» بلا محاولةٍ تالية.
        private bool _cleanupDone;

        // نصُّ المصالحةِ لموردٍ باقٍ بعدَ نتيجةٍ مجهولةٍ: قبلَ التنظيفِ يُترَكُ لمحاولتِه الوحيدةِ؛ بعدَه تُعلَنُ البقيّةُ.
        private string LeftForCleanup(string leftoverKey, string leftoverText)
        {
            if (!_cleanupDone) return "left for the bounded cleanup attempt (declared as leftover if it remains)";
            bool declared = false;
            foreach (string l in _r.CleanupLeftovers) if (l.StartsWith(leftoverKey + ":")) { declared = true; break; }
            if (!declared) _r.CleanupLeftovers.Add(leftoverKey + ": " + leftoverText);
            return "cleanup attempt budget already spent (" + MaxCleanupAttemptsPerResource + " per resource; no further attempt); declared as leftover";
        }

        public CeremonyRehearsal(ICeremonyTransport transport)
        {
            if (transport == null) throw new ArgumentNullException("transport");
            _t = transport;
            _r.Transport = transport.Kind;
        }

        public CeremonyReport Report { get { return _r; } }

        private byte[] Random(int n) { byte[] b = new byte[n]; _rng.GetBytes(b); return b; }

        private static uint CommandCodeOf(byte[] cmd) { return ((uint)cmd[6] << 24) | ((uint)cmd[7] << 16) | ((uint)cmd[8] << 8) | cmd[9]; }

        private static ushort TagOf(byte[] cmd) { return (ushort)((cmd[0] << 8) | cmd[1]); }

        // الأوامرُ التي تغيِّرُ حالةَ الـTPM: فقدُ ردِّها بعدَ الإرسالِ يجعلُ الأثرَ مجهولًا لا معدومًا.
        private static readonly HashSet<uint> StateChanging = new HashSet<uint>
        {
            Tpm.CC_NV_DefineSpace, Tpm.CC_NV_Increment, Tpm.CC_NV_UndefineSpace,
            Tpm.CC_CreatePrimary, Tpm.CC_Create, Tpm.CC_Load, Tpm.CC_StartAuthSession,
            Tpm.CC_PolicySigned, Tpm.CC_PolicyCommandCode, Tpm.CC_FlushContext
        };

        private Resp Send(string name, byte[] cmd, int respHandles, string expectation, int authCount)
        {
            Step s = new Step();
            s.Stage = _cleanup ? "cleanup" : _stage;
            s.Name = name;
            s.CommandCode = CommandCodeOf(cmd);
            s.CommandSha256 = Hex.Of(Sha.H(cmd));
            s.Expectation = expectation;
            _r.Steps.Add(s);
            Resp p;
            try
            {
                byte[] raw = _t.Transmit(cmd);
                p = Resp.Parse(raw, respHandles, TagOf(cmd), authCount, ResponseSchema.ExpectedPasswordSessions(cmd, authCount));
                if (p.Rc == 0)
                {
                    ResponseSchema.Check(CommandCodeOf(cmd), cmd, p.Params, _ctx);
                    _ctx.Record(CommandCodeOf(cmd), cmd, p.Handles, p.Params);
                }
                // فحصُ تبنّي المقبضِ داخلَ الإرسالِ نفسه (إصلاحٌ R3): مقبضٌ من خطِّ الأساسِ في ردِّ إنشاءٍ يُرمى هنا — فيُغلّفُ الفشلُ للأمرِ
                // المُغيّرِ بنتيجةٍ مجهولةٍ ويُجرَدُ كسائرِهَا (SOL413-01)، لا فشلٌ مجردًا يفقدُ التسميةَ.
                for (int i = 0; i < p.Handles.Length; i++) AdoptHandle(p.Handles[i], NameSuffix(name));
            }
            catch (CeremonyUnknownOutcomeException) { throw; }
            catch (Exception e)
            {
                // الردُّ لم يُستلَمْ بعدَ إرسالِ أمرٍ مُغيِّرٍ: الأثرُ مجهولٌ — يُفشِلُ مغلقًا ويُجردُ لاحقًا.
                if (StateChanging.Contains(CommandCodeOf(cmd)))
                {
                    s.Outcome = "unknown";
                    throw new CeremonyUnknownOutcomeException(name, e);
                }
                throw;
            }
            s.ResponseCode = p.Rc;
            // رفضُ الطبقةِ (TBS) أو أيُّ رمزِ Windows ⇒ توقّفٌ مغلقٌ: لا إعادة، ولا بديل، ولا تخفيفُ سمات.
            if ((p.Rc & 0xFFFF0000u) == 0x80280000u)
            {
                s.Outcome = "blocked";
                throw new CeremonyBlockedException(name, p.Rc);
            }
            if (expectation == "success")
            {
                // ردُّ خطأٍ من الـTPM كاملُ البنيةِ (رأسٌ فقط) — نتيجةٌ معلومةٌ مسمّاةٌ (SOL413-05): الأدلّةُ
                // القرائيّةُ تُستنبَطُ من هذا النوعِ وحدَه؛ الردُّ المشوَّهُ فشلٌ آخرُ لا دليلَ غيابٍ.
                if (p.Rc != 0) { s.Outcome = "unexpected-failure"; throw new TpmErrorException("TPM_ERROR: " + name, p.Rc); }
                s.Outcome = "ok";
            }
            else
            {
                // الحالةُ السلبيّةُ تحدِّدُ رمزَ الرفضِ المتوقَّعَ تحديدًا (WL-413/SOL-04): أيُّ رمزٍ آخرَ —
                // أو نجاحٍ — فشلٌ مغلقٌ مسمّى، لا يُقبَلُ خطأٌ عامٌّ بديلًا عن الرفضِ المقصودِ بالاختبار.
                uint expectedRc = ParseExpectedRc(expectation, name);
                if (p.Rc == 0) { s.Outcome = "unexpected-success"; throw new CeremonyFailedException("NEGATIVE_TEST_SUCCEEDED: " + name, 0); }
                if (p.Rc != expectedRc)
                {
                    s.Outcome = "wrong-rejection-code";
                    throw new CeremonyFailedException("NEGATIVE_WRONG_RC: " + name + " expected=" + Hex.U32(expectedRc) + " got=" + Hex.U32(p.Rc), p.Rc);
                }
                s.Outcome = "rejected-as-expected";
            }
            return p;
        }

        private static uint ParseExpectedRc(string expectation, string name)
        {
            // الصيغةُ: "failure:0x0000014a". بلا رمزٍ محدَّدٍ لا يُقبلُ اختبارٌ سلبيٌّ أصلًا.
            int i = expectation.IndexOf("failure:0x", StringComparison.Ordinal);
            if (i < 0) throw new CeremonyFailedException("NEGATIVE_TEST_WITHOUT_EXPECTED_RC: " + name, 0);
            string hex = expectation.Substring(i + 8);
            return Convert.ToUInt32(hex, 16);
        }

        private Resp Ok(string name, byte[] cmd, int respHandles, int authCount)
        { return Send(name, cmd, respHandles, "success", authCount); }

        private Resp Refused(string name, byte[] cmd, uint expectedRc, int authCount)
        { return Send(name, cmd, 0, "failure:0x" + expectedRc.ToString("x8"), authCount); }

        // زيادةٌ يُتوقَّعُ رفضُها (WL-413 الدفعة الثانية / R2-02): تُقيَّدُ في دفترِ المواردِ كأيِّ أمرٍ مُغيِّرٍ،
        // فإن ضاعَ ردُّها تُجرَدُ قيمةُ العدّادِ قرائيًّا (لم يُنفَّذْ / نُفِّذَ) ولا يبقى أثرُها صامتًا في التقرير.
        private void RefusedIncrement(string name, uint index, byte[] auth, uint expectedRc, ulong? before)
        {
            Pending pending = Tracked("nv-increment", index, null, before);
            _pending.Add(pending);
            try
            {
                Refused(name, Cmd.NvIncrement(index, auth), expectedRc, 1);
                _pending.Remove(pending);
            }
            catch (CeremonyUnknownOutcomeException) { throw; }
            catch
            {
                // رمزٌ آخرُ أو نجاحٌ غيرُ متوقَّعٍ: النتيجةُ معلومةٌ ومسمّاةٌ في الفشلِ — لا جردَ مطلوب.
                _pending.Remove(pending);
                throw;
            }
        }

        // إرسالُ أمرٍ مُغيِّرٍ مع قيدِهِ في دفترِ المواردِ: النتيجةُ المعلومةُ (نجاحٌ أو ردُّ خطأٍ من الـTPM)
        // تُخرِجُهُ من الدفترِ؛ المجهولةُ تُبقيهِ للجردِ.
        // رفضٌ سلبيٌ لأمرٍ مُغيّرٍ مُقيّدٌ في دفترِ المواردِ (WL-413 الدفعة الثالثة / SOL413-06): الرفضُ نتيجةٌ
        // معلومةٌ (لا أثرَ تمَّ) ويُخرِجُ القيدَ منه؛ فقدُ ردِّهِ نتيجةٌ مجهولةٌ تُبقيهِ للجردِ — لا يختفي أثرُ الجلسةِ من التقريرِ ولا يُعلَنُ التنطيفُ نطيفاً، ولا يُنفذُ أمرٌ مُغيّرٍ لاحقاًٌ إلا مصالحةً/تنطيفً قراءيً مسموحً فقطَ؟
        private void RefusedTracked(string name, byte[] cmd, uint expectedRc, int authCount, Pending pending)
        {
            _pending.Add(pending);
            try
            {
                Refused(name, cmd, expectedRc, authCount);
                _pending.Remove(pending);
            }
            catch (CeremonyUnknownOutcomeException) { throw; }
            catch
            {
                _pending.Remove(pending);
                throw;
            }
        }

        private Resp SendTracked(string name, byte[] cmd, int respHandles, int authCount, Pending pending)
        {
            _pending.Add(pending);
            try
            {
                Resp p = Send(name, cmd, respHandles, "success", authCount);
                _pending.Remove(pending);
                return p;
            }
            catch (CeremonyUnknownOutcomeException) { throw; }
            catch
            {
                // ردُّ خطأٍ وصلَ من الـTPM: التنفيذُ لم يقعَ — نتيجةٌ معلومةٌ.
                _pending.Remove(pending);
                throw;
            }
        }

        private Pending Tracked(string kind, uint handle, byte[] expectedPublic, ulong? beforeValue)
        {
            Pending p = new Pending();
            p.Kind = kind; p.Handle = handle; p.ExpectedPublic = expectedPublic; p.BeforeValue = beforeValue;
            return p;
        }

        // ── الهويّة: كلُّ خصائصِ المصنّعِ وسلاسلِ البائعِ الأربعُ بقيمٍ خامّةٍ — لا طيَّ مسافاتٍ ولا
        // إغفالَ سلسلةٍ (WL-413/G47-1). تُرفَضُ أيُّ جهةٍ لا تُعلِنُ الهويّةَ الكاملةَ المتوقَّعةَ قبلَ أيِّ أمرٍ مُغيِّر. ──
        private void AssertSimulatorIdentity()
        {
            Resp p = Ok("identity:GetCapability(TPM_PT_MANUFACTURER..VENDOR_STRING_4)", Cmd.GetCapability(6, 0x105, 5), 0, 0);
            Rd r = new Rd(p.Params);
            r.U8();
            if (r.U32() != 6) throw new CeremonyFailedException("SIMULATOR_IDENTITY_UNREADABLE", 0);
            uint count = r.U32();
            if (count != 5) throw new CeremonyFailedException("SIMULATOR_IDENTITY_INCOMPLETE: properties=" + count, 0);
            Dictionary<uint, uint> props = new Dictionary<uint, uint>();
            for (uint i = 0; i < count; i++) { uint k = r.U32(); props[k] = r.U32(); }
            uint man; uint v1; uint v2; uint v3; uint v4;
            if (!props.TryGetValue(0x105, out man) || !props.TryGetValue(0x106, out v1) || !props.TryGetValue(0x107, out v2)
                || !props.TryGetValue(0x108, out v3) || !props.TryGetValue(0x109, out v4))
                throw new CeremonyFailedException("SIMULATOR_IDENTITY_INCOMPLETE", 0);
            _r.Fact("tpm.manufacturer", Ascii(man));
            _r.Fact("tpm.vendorString", Ascii(v1) + Ascii(v2));
            _r.Fact("tpm.vendorString3", Ascii(v3));
            _r.Fact("tpm.vendorString4", Ascii(v4));
            if (man != Tpm.EXPECTED_MANUFACTURER || v1 != Tpm.EXPECTED_VENDOR_1 || v2 != Tpm.EXPECTED_VENDOR_2
                || v3 != Tpm.EXPECTED_VENDOR_3 || v4 != Tpm.EXPECTED_VENDOR_4)
                throw new CeremonyFailedException("SIMULATOR_IDENTITY_REQUIRED: manufacturer=" + Ascii(man)
                    + " vendor=" + Hex.U32(v1) + "," + Hex.U32(v2) + "," + Hex.U32(v3) + "," + Hex.U32(v4), 0);
        }

        private static string Ascii(uint v)
        {
            byte[] b = new byte[] { (byte)(v >> 24), (byte)(v >> 16), (byte)(v >> 8), (byte)v };
            return Encoding.ASCII.GetString(b).TrimEnd('\0');
        }

        private uint Property(uint pt)
        {
            Resp p = Ok("inventory:GetCapability(" + Hex.U32(pt) + ")", Cmd.GetCapability(6, pt, 1), 0, 0);
            Rd r = new Rd(p.Params);
            r.U8(); r.U32();
            if (r.U32() != 1) throw new CeremonyFailedException("PROPERTY_ABSENT: " + Hex.U32(pt), 0);
            if (r.U32() != pt) throw new CeremonyFailedException("PROPERTY_ABSENT: " + Hex.U32(pt), 0);
            return r.U32();
        }

        private HashSet<uint> NvHandles()
        {
            HashSet<uint> set = new HashSet<uint>();
            uint next = 0x01000000;
            for (int page = 0; page < 16; page++)
            {
                Resp p = Ok("inventory:GetCapability(HANDLES," + Hex.U32(next) + ")", Cmd.GetCapability(1, next, 64), 0, 0);
                Rd r = new Rd(p.Params);
                byte more = r.U8();
                r.U32();
                uint n = r.U32();
                uint last = 0;
                for (uint i = 0; i < n; i++)
                {
                    uint h = r.U32();
                    // مقبضٌ من فئةٍ أخرى في جردِ NV فشلٌ مسمّى (SOL413-02): الجردُ الناقصُ لا يُدّعى
                    // اكتمالُهُ ولا يُبنى عليهِ خطُّ أساسٍ أو جردٌ نهائيٌّ.
                    if ((h >> 24) != 0x01)
                        throw new ResponseMalformedException("RESPONSE_CAPABILITY_HANDLE_CLASS_MALFORMED: " + Hex.U32(h) + " in NV enumeration", 0);
                    // مقبضٌ مكرّرٌ في صفحةِ جردٍ فشلٌ مسمّى (R3SOL-01/قياسُ المراجعينَ): التكرارُ يخفي
                    // كائنًا من خطِّ الأساسِ ويتيحُ التفافَ التبنّي — لا يُقبلُ إذن صفحةً بمقبضٍ واحدٍ مرتينِ.
                    if (!set.Add(h))
                        throw new ResponseMalformedException("RESPONSE_CAPABILITY_DUPLICATE_HANDLE: " + Hex.U32(h) + " in NV enumeration", 0);
                    last = h;
                }
                if (more == 1 && n == 0)
                    throw new ResponseMalformedException("RESPONSE_CAPABILITY_NO_PROGRESS: more=1 count=0 at " + Hex.U32(next), 0);
                if (more == 0 || n == 0) return set;
                next = last + 1;
            }
            throw new CeremonyFailedException("NV_HANDLE_ENUMERATION_INCOMPLETE", 0);
        }

        // جردُ مقابضَ عامٌّ قرائيّ: الجلساتُ المحمّلةُ (HMAC والسياسة) والكائناتُ العابرة.
        private HashSet<uint> HandleSet(uint start, bool sessions)
        {
            HashSet<uint> set = new HashSet<uint>();
            uint next = start;
            for (int page = 0; page < 16; page++)
            {
                Resp p = Ok("inventory:GetCapability(HANDLES," + Hex.U32(next) + ")", Cmd.GetCapability(1, next, 64), 0, 0);
                Rd r = new Rd(p.Params);
                byte more = r.U8();
                r.U32();
                uint n = r.U32();
                uint last = 0;
                for (uint i = 0; i < n; i++)
                {
                    uint h = r.U32();
                    if (sessions)
                    {
                        // جلساتُ HMAC (0x02xxxxxx) وجلساتُ سياسةٍ (0x03xxxxxx) معًا (Part 3 §30.2). مقبضٌ من
                        // فئةٍ أخرى فشلٌ مسمّى (SOL413-02) — لا إيقافٌ صامتٌ يُخفي بقيّةً ويُدّعي جردًا كاملًا.
                        if ((h >> 24) != 0x02 && (h >> 24) != 0x03)
                            throw new ResponseMalformedException("RESPONSE_CAPABILITY_HANDLE_CLASS_MALFORMED: " + Hex.U32(h) + " in session enumeration", 0);
                    }
                    else
                    {
                        if ((h >> 24) != 0x80)
                            throw new ResponseMalformedException("RESPONSE_CAPABILITY_HANDLE_CLASS_MALFORMED: " + Hex.U32(h) + " in transient enumeration", 0);
                    }
                    if (!set.Add(h))
                        throw new ResponseMalformedException("RESPONSE_CAPABILITY_DUPLICATE_HANDLE: " + Hex.U32(h) + " in session/transient enumeration", 0);
                    last = h;
                }
                if (more == 1 && n == 0)
                    throw new ResponseMalformedException("RESPONSE_CAPABILITY_NO_PROGRESS: more=1 count=0 at " + Hex.U32(next), 0);
                if (more == 0 || n == 0) return set;
                next = last + 1;
            }
            throw new CeremonyFailedException("HANDLE_ENUMERATION_INCOMPLETE", 0);
        }

        // خطُّ الأساسِ قبلَ أيِّ أمرٍ مُغيِّرٍ: يُنسبُ إليهِ كلُّ مقبضٍ جديدٍ لاحقًا (جردُ المصالحةِ).
        private void SnapshotBaseline()
        {
            _baselineNv = NvHandles();
            _baselineTransients = HandleSet(0x80000000, false);
            _baselineSessions = HandleSet(0x02000000, true);
            _r.Fact("baseline.nvHandles", _baselineNv.Count.ToString());
            _r.Fact("baseline.transients", _baselineTransients.Count.ToString());
            _r.Fact("baseline.sessions", _baselineSessions.Count.ToString());
            // حاجزُ ملكيةِ فهارسِ NV (قرارُ المالكِ — WL-416): بعدَ اكتمالِ الجردِ القرائيّ وقبلَ أيِّ أمرٍ مُغيِّرٍ.
        }

        // ── حاجزُ إرهاقِ فهارسِ NV: قرارُ المالكِ المحافِظ (WL-416) ──
        // أيُّ فهرسٍ NV داخلَ مجالِ المالكِ المُعلَن (0x01800000–0x01BFFFFF) لا يمكنُ إثباتُ أنّ هذه البروفةَ
        // أنشأتهُ وتملكُ حقَّ تنظيفه ⇒ إيقافُ البروفةِ (فشلٌ مسمّى) قبلَ أيِّ أمرٍ مُغيِّرٍ. لا يُحذَفُ شىءٌ،
        // ولا يُغَطّي الفحصُ سوى مجالِ المالك (الرقابةُ على حقّ المالكِ لا الحذفَ). عتبةُ الإيقاف: فهرسٌ واحدٌ
        // غيرُ محسومٍ (السياسةُ المحافِظةُ: لا يوجدُ دليلٌ كافٍ لتبريرِ عتبةٍ أعلى).
        private const int UnresolvedNvStopThreshold = 1;

        private void AssertNvRangeOwnership()
        {
            HashSet<uint> present = NvHandles();
            List<uint> unresolved = new List<uint>();
            foreach (uint h in present)
            {
                if (h >= Tpm.OWNER_INDEX_FIRST && h <= Tpm.OWNER_INDEX_LAST && !_definedByRun.ContainsKey(h))
                    unresolved.Add(h);
            }
            if (unresolved.Count >= UnresolvedNvStopThreshold)
            {
                _r.Fact("nvOwnershipGuard.ownerRange",
                    string.Format("0x{0:X8}-0x{1:X8}", Tpm.OWNER_INDEX_FIRST, Tpm.OWNER_INDEX_LAST));
                _r.Fact("nvOwnershipGuard.unresolvedCount", unresolved.Count.ToString());
                // قائمةُ الفهارسِ غيرِ المنسوبةِ للمراجعةِ (سجلٌّ كاملٌ لا عددًا وحدَهُ — WL-416 جولةُ المراجعةِ الثانيةِ):
                _r.Fact("nvOwnershipGuard.unresolvedIndices", string.Join(",", unresolved.ConvertAll(h => "0x" + h.ToString("X8")).ToArray()));
                _r.Fact("nvOwnershipGuard.stopThreshold", UnresolvedNvStopThreshold.ToString());
                throw new CeremonyFailedException(
                    "NV_INDEX_UNATTRIBUTABLE_OWNER_REVIEW_REQUIRED: NV index(es) inside the declared XUUX owner range " +
                    "cannot be proven as created-by-this-run and safely deletable; rehearsal halted before any state-changing " +
                    "command. Matching the public area to the request is not proof of ownership. " +
                    "Owner review of the recorded index list is required before any cleanup.", 0);
            }
        }

        // جردٌ فوريٌّ قبلَ كلِّ تعريف ⇒ مقبضٌ عشوائيٌّ خالٍ في مجالِ المالك. لا مقبضَ ثابتٌ ولا إعادةُ محاولة.
        // حاجزُ ملكيةِ مجالِ المالكِ يُفحَصُ هنا أيضًا: ظهورُ فهرسٍ من طرفٍ ثالثٍ بعدَ الأساسِ لا يُمرَّرُ.
        private uint PickVacantHandle(string purpose)
        {
            HashSet<uint> used = NvHandles();
            AssertNvRangeOwnership();
            uint countersMax = Property(0x116);
            uint counters = Property(0x20A);
            _r.Fact(purpose + ".nvHandlesBefore", used.Count.ToString());
            _r.Fact(purpose + ".nvCountersBefore", counters.ToString());
            _r.Fact(purpose + ".nvCountersMax", countersMax.ToString());
            if (countersMax > 0 && counters >= countersMax) throw new CeremonyFailedException("NO_COUNTER_HEADROOM", 0);
            for (int i = 0; i < 64; i++)
            {
                byte[] b = Random(4);
                uint span = Tpm.OWNER_INDEX_LAST - Tpm.OWNER_INDEX_FIRST + 1;
                uint h = Tpm.OWNER_INDEX_FIRST + ((((uint)b[0] << 24) | ((uint)b[1] << 16) | ((uint)b[2] << 8) | b[3]) % span);
                if (!used.Contains(h) && !_definedByRun.ContainsKey(h)) return h;
            }
            throw new CeremonyFailedException("NO_VACANT_HANDLE_FOUND", 0);
        }

        private sealed class NvPub
        {
            public uint Index; public ushort NameAlg; public uint Attributes; public byte[] AuthPolicy; public ushort DataSize;
            public byte[] PublicArea; public byte[] Name;
        }

        // نسخةٌ من TPMS_NV_PUBLIC ببتِّ WRITTEN مُصفَّرًا — للمقارنةِ التشخيصيّةِ فقط.
        private static byte[] PublicWithoutWritten(byte[] pub)
        {
            byte[] c = (byte[])pub.Clone();
            uint a = ((uint)c[6] << 24) | ((uint)c[7] << 16) | ((uint)c[8] << 8) | c[9];
            a &= ~Tpm.NV_WRITTEN;
            c[6] = (byte)(a >> 24); c[7] = (byte)(a >> 16); c[8] = (byte)(a >> 8); c[9] = (byte)a;
            return c;
        }

        private NvPub ReadPublic(string name, uint index)
        {
            Resp p = Ok(name, Cmd.NvReadPublic(index), 0, 0);
            Rd r = new Rd(p.Params);
            byte[] pub = r.B2B();
            byte[] nm = r.B2B();
            Rd q = new Rd(pub);
            NvPub n = new NvPub();
            n.Index = q.U32(); n.NameAlg = q.U16(); n.Attributes = q.U32(); n.AuthPolicy = q.B2B(); n.DataSize = q.U16();
            if (q.Remaining != 0) throw new CeremonyFailedException("NV_PUBLIC_TRAILING_BYTES", 0);
            n.PublicArea = pub; n.Name = nm;
            return n;
        }

        // استعلامٌ قرائيٌّ: هل الفهرسُ موجودٌ؟ ردُّ خطأٍ كاملُ البنيةِ برمزِ 0x18B يعني غيابَهُ (SOL413-05):
        // ردٌّ مشوَّهٌ يرفعُ الرمزَ نفسَهُ لا يُعَدُّ دليلَ غيابٍ — فشلٌ مسمّى يُعلَنُ في المصالحةِ.
        private bool NvIndexExists(uint index, out NvPub pub)
        {
            try { pub = ReadPublic("reconcile:NV_ReadPublic(" + Hex.U32(index) + ")", index); return true; }
            catch (TpmErrorException e)
            {
                if (e.Rc == Tpm.RC_HANDLE) { pub = null; return false; }
                throw;
            }
        }

        private void Define(string label, uint index, uint attributes, byte[] authPolicy)
        {
            byte[] pub = Cmd.NvPublic(index, attributes, authPolicy, 8);
            SendTracked(label + ":NV_DefineSpace", Cmd.NvDefineSpace(_ownerAuth, new byte[0], pub), 0, 1,
                Tracked("nv-define", index, pub, null));
            _definedByRun[index] = pub;
            NvPub n = ReadPublic(label + ":NV_ReadPublic(after-define)", index);
            // التحقّقُ من السماتِ والأسماءِ والأحجامِ كما عُرِّفت — أيُّ فرقٍ ⇒ فشلٌ مغلق.
            if (n.Index != index || n.NameAlg != Tpm.ALG_SHA256 || n.Attributes != attributes || n.DataSize != 8
                || Hex.Of(n.AuthPolicy) != Hex.Of(authPolicy ?? new byte[0]))
                throw new CeremonyFailedException("NV_PUBLIC_DIFFERS_FROM_DEFINITION: " + label, 0);
            if (Hex.Of(n.Name) != Hex.Of(Policy.Name(n.PublicArea))) throw new CeremonyFailedException("NV_NAME_MISMATCH: " + label, 0);
            _r.Fact(label + ".handle", Hex.U32(index));
            _r.Fact(label + ".nvPublicHex(after-define)", Hex.Of(n.PublicArea));
            _r.Fact(label + ".nvName(after-define)", Hex.Of(n.Name));
        }

        private void Increment(string label, uint index, byte[] authEntry, ulong? before)
        {
            SendTracked(label, Cmd.NvIncrement(index, authEntry), 0, 1, Tracked("nv-increment", index, null, before));
        }

        private ulong ReadCounter(string label, uint index)
        {
            Resp p = Ok(label, Cmd.NvRead(index, Cmd.PasswordAuth(new byte[0]), 8, 0), 0, 1);
            byte[] d = new Rd(p.Params).B2B();
            if (d.Length != 8) throw new CeremonyFailedException("COUNTER_SIZE_NOT_8", 0);
            ulong v = 0;
            for (int i = 0; i < 8; i++) v = (v << 8) | d[i];
            return v;
        }

        private ulong ReadCounterIfExists(string label, uint index, out bool uninitialized)
        {
            try { uninitialized = false; return ReadCounter(label, index); }
            catch (TpmErrorException e)
            {
                if (e.Rc == Tpm.RC_NV_UNINITIALIZED) { uninitialized = true; return 0; }
                throw;
            }
        }

        // يُحذَفُ فقط ما عرَّفَته هذه البروفة، وبعدَ التحقّقِ من أنّ منطقتَه العامّةَ هي ما عرَّفناه (عدا WRITTEN).
        private void UndefineOwn(string label, uint index)
        {
            byte[] ours;
            if (!_definedByRun.TryGetValue(index, out ours)) throw new CeremonyFailedException("REFUSE_UNDEFINE_NOT_CREATED_BY_RUN", 0);
            NvPub n = ReadPublic(label + ":NV_ReadPublic(ownership-check)", index);
            Rd q = new Rd(ours);
            uint oi = q.U32(); ushort oa = q.U16(); uint oat = q.U32(); byte[] op = q.B2B(); ushort os = q.U16();
            if (n.Index != oi || n.NameAlg != oa || (n.Attributes & ~Tpm.NV_WRITTEN) != oat || Hex.Of(n.AuthPolicy) != Hex.Of(op) || n.DataSize != os)
                throw new CeremonyFailedException("REFUSE_UNDEFINE_PUBLIC_AREA_NOT_OURS", 0);
            SendTracked(label + ":NV_UndefineSpace", Cmd.NvUndefineSpace(_ownerAuth, index), 0, 1,
                Tracked("nv-undefine", index, null, null));
            _definedByRun.Remove(index);
            Refused(label + ":NV_ReadPublic(after-undefine)", Cmd.NvReadPublic(index), Tpm.RC_HANDLE, 0);
        }

        private uint StartSession(string label, byte type, out byte[] nonceTpm)
        {
            Resp p = SendTracked(label + ":StartAuthSession", Cmd.StartAuthSession(type, Random(32)), 1, 0,
                Tracked("session-create", 0, null, null));
            nonceTpm = new Rd(p.Params).B2B();
            // فئةُ مقبضِ الجلسةِ المُنشأةِ: 0x03 (جلسةُ سياسةٍ أو تجريبيةٍ — Part 1 §15.3–15.6، جدولُ 16
            // Part 3 §11.1: TPMI_SH_AUTH_SESSION). مقبضٌ بفئةِ كائنٍ عابرٍ كان يُقبلُ ثمّ يرفضُهُ TPM
            // لاحقًا برمزٍ عامٍّ (قياسُ المراجعينَ) — يُرفضُ الآنَ باسمٍ معَ تتبُّعِهِ للتنظيفِ.
            if ((p.Handles[0] >> 24) != 0x03)
            {
                _transients.Add(p.Handles[0]);
                throw new ResponseMalformedException("RESPONSE_SESSION_HANDLE_CLASS_MALFORMED: StartAuthSession " + Hex.U32(p.Handles[0]), 0);
            }
            AdoptHandle(p.Handles[0], "StartAuthSession");
            _transients.Add(p.Handles[0]);
            return p.Handles[0];
        }

        // لا يُسقَطُ المقبضُ من التتبّعِ إلا بعدَ نجاحِ التحريرِ (WL-413/SOL-03): رفضُ التحريرِ يُبقيهِ
        // مُعلَنًا في بقايا التنظيفِ بيدِهِ المعلومةِ، لا جلسةً مخفيّةً خلفَ تقريرٍ نظيفٍ.
        private void Flush(string label, uint h)
        {
            if (!_transients.Contains(h)) return;
            SendTracked(label + ":FlushContext", Cmd.FlushContext(h), 0, 0, Tracked("flush", h, null, null));
            _transients.Remove(h);
        }

        // المقبضُ المعادُ في ردِّ إنشاءٍ لا يجوزُ أن يكونَ موجوداً قبلَ الجولةِ (SOL413-01): مقبضٌ في خطِّ
        // الأساسِ يعني أنّ الردّ يدّعي إنشاءَ ما كانَ موجودًا — لا يُتبنّى، وفشلٌ مغلقٌ مسمّى (الأمرُ مُغيّرٌ
        // فالنتيجةُ مجهولةٌ وتُجرَدُ كما في سائرِ النتائجِ المجهولةِ).
        // ملصقٌ اسمِ الأمرِ من خطوةِ التسمية (label:Command) — لرسالِ رفضِ التبنّي باسمٍ معروفٍ.
        private static string NameSuffix(string stepName)
        {
            int i = stepName.LastIndexOf(':');
            return i < 0 ? stepName : stepName.Substring(i + 1);
        }

        private void AdoptHandle(uint h, string what)
        {
            // مقبضٌ يعودُ من ردِّ أمرٍ وهو ما يزالُ حيًّا في هذهِ الجولةِ (لم يُحرَّر) فشلٌ مسمّى (قياسُ
            // المراجعينَ): ردُّ Load يعيدُ مقبضَ CreatePrimary الحيّ — التبنيَ كان يقارنُ خطَّ الأساسِ فقط
            // فلا يسمّي الالتفافَ داخلَ الجولةِ (يُفشِلُ مغلقًا لاحقًا عندَ الاستعمالِ برمزٍ عامٍّ). أما إعادةُ
            // المقابضِ بعدَ التحريرِ فسلوكُ المحاكي المشروعُ (0x80000000 يعودُ لـPrimary جديدٍ بعدَ تحريرِ
            // سابقِهِ) ولا يُرفضُ — المقياسُ هو الحياةُ اللحظيّةُ لا العودةُ التاريخيّةُ.
            if (_transients.Contains(h))
                throw new ResponseMalformedException("RESPONSE_HANDLE_REISSUED: " + what + " " + Hex.U32(h) + " still live in this run (not flushed)", 0);
            if (_baselineNv != null && _baselineNv.Contains(h))
                throw new ResponseMalformedException("RESPONSE_HANDLE_PREEXISTING: " + what + " " + Hex.U32(h) + " existed in baseline NV inventory", 0);
            if (_baselineTransients != null && _baselineTransients.Contains(h))
                throw new ResponseMalformedException("RESPONSE_HANDLE_PREEXISTING: " + what + " " + Hex.U32(h) + " existed in baseline transients inventory", 0);
            if (_baselineSessions != null && _baselineSessions.Contains(h))
                throw new ResponseMalformedException("RESPONSE_HANDLE_PREEXISTING: " + what + " " + Hex.U32(h) + " existed in baseline sessions inventory", 0);
        }

        private void SessionConsumed(uint h) { _transients.Remove(h); _ctx.EndOfLife(h); } // استهلاكُ الجلسةِ زوالُ عمرٍ مُثبَتٌ (WL-416)

        private void SignAHash(string label, uint key, byte[] nonceTpm, out byte[] r, out byte[] s)
        {
            Resp p = Ok(label + ":Sign(aHash)", Cmd.Sign(key, new byte[0], Policy.AHash(nonceTpm, 0)), 0, 1);
            Rd q = new Rd(p.Params);
            if (q.U16() != Tpm.ALG_ECDSA || q.U16() != Tpm.ALG_SHA256) throw new CeremonyFailedException("SIGNATURE_SCHEME_UNEXPECTED", 0);
            r = q.B2B(); s = q.B2B();
        }

        private void PolicySignedStep(string label, uint key, uint session, byte[] nonce, byte[] r, byte[] s)
        {
            SendTracked(label + ":PolicySigned", Cmd.PolicySigned(key, session, nonce, 0, r, s), 0, 0,
                Tracked("policy-mutation", session, null, null));
        }

        private void PolicyCommandCodeStep(string label, uint session, uint code)
        {
            SendTracked(label + ":PolicyCommandCode", Cmd.PolicyCommandCode(session, code), 0, 0,
                Tracked("policy-mutation", session, null, null));
        }

        private uint _primary;
        private uint _serviceKey;
        private byte[] _serviceKeyName;
        private byte[] _policy;

        private void StageS1()
        {
            _stage = "S1";
            uint h = PickVacantHandle("s1.probe");
            Define("s1.probe", h, Tpm.S1_PROBE_ATTRIBUTES, new byte[0]);
            Refused("s1.probe:NV_Read(before-first-increment)", Cmd.NvRead(h, Cmd.PasswordAuth(new byte[0]), 8, 0), Tpm.RC_NV_UNINITIALIZED, 1);
            Increment("s1.probe:NV_Increment#1", h, Cmd.PasswordAuth(new byte[0]), null);
            ulong v1 = ReadCounter("s1.probe:NV_Read#1", h);
            Increment("s1.probe:NV_Increment#2", h, Cmd.PasswordAuth(new byte[0]), v1);
            ulong v2 = ReadCounter("s1.probe:NV_Read#2", h);
            if (v2 != v1 + 1) throw new CeremonyFailedException("COUNTER_NOT_INCREMENTED_BY_ONE", 0);
            NvPub w = ReadPublic("s1.probe:NV_ReadPublic(after-write)", h);
            if ((w.Attributes & Tpm.NV_WRITTEN) == 0) throw new CeremonyFailedException("WRITTEN_NOT_SET", 0);
            if (Hex.Of(w.Name) != Hex.Of(Policy.Name(w.PublicArea))) throw new CeremonyFailedException("NV_NAME_MISMATCH: s1.probe", 0);
            _r.Fact("s1.probe.value1", v1.ToString());
            _r.Fact("s1.probe.value2", v2.ToString());
            _r.Fact("s1.probe.nvPublicHex(after-write)", Hex.Of(w.PublicArea));
            _r.Fact("s1.probe.nvName(after-write)", Hex.Of(w.Name));
            UndefineOwn("s1.probe", h);

            // إعادةُ التعريفِ في مقبضٍ جديد: على المحاكي تبدأُ القيمةُ فوقَ أعلى ما عرفَه (Part 1 §37.2.4.3 في
            // libtpms) — قياسُ محاكٍ لا يُنقَلُ إلى العتاد.
            uint h2 = PickVacantHandle("s1.redefine");
            Define("s1.redefine", h2, Tpm.S1_PROBE_ATTRIBUTES, new byte[0]);
            Increment("s1.redefine:NV_Increment#1", h2, Cmd.PasswordAuth(new byte[0]), null);
            ulong v3 = ReadCounter("s1.redefine:NV_Read#1", h2);
            _r.Fact("s1.redefine.value1", v3.ToString());
            _r.Fact("s1.redefine.aboveProbe", (v3 > v2) ? "true" : "false");
            UndefineOwn("s1.redefine", h2);
        }

        private void StageS2()
        {
            _stage = "S2";
            Resp pp = SendTracked("s2:CreatePrimary(storage,ECC-P256)", Cmd.CreatePrimary(_ownerAuth, Templates.StoragePrimary()), 1, 1,
                Tracked("object-create", 0, null, null));
            AdoptHandle(pp.Handles[0], "CreatePrimary");
            _primary = pp.Handles[0];
            _transients.Add(_primary);
            // Create مُغيّرٌ فيُقيَّدُ في دفترِ المواردِ (SOL413-06): فقدُ ردّهِ ⇒ نتيجةٌ مجهولةٌ تُجرَدُ.
            Resp cr = SendTracked("s2:Create(service-key,ECDSA-P256)", Cmd.Create(_primary, new byte[0], Templates.ServiceSigningKey()), 0, 1,
                Tracked("object-create", 0, null, null));
            Rd q = new Rd(cr.Params);
            byte[] priv = q.B2B();
            byte[] pub = q.B2B();
            Resp ld = SendTracked("s2:Load(service-key)", Cmd.Load(_primary, new byte[0], priv, pub), 1, 1,
                Tracked("object-create", 0, null, null));
            AdoptHandle(ld.Handles[0], "Load");
            _serviceKey = ld.Handles[0];
            _transients.Add(_serviceKey);
            _serviceKeyName = new Rd(ld.Params).B2B();
            if (Hex.Of(_serviceKeyName) != Hex.Of(Policy.Name(pub))) throw new CeremonyFailedException("OBJECT_NAME_MISMATCH", 0);
            _r.Fact("s2.serviceKey.publicAreaHex", Hex.Of(pub));
            _r.Fact("s2.serviceKey.name", Hex.Of(_serviceKeyName));

            byte[] nonce;
            uint trial = StartSession("s2.trial", Tpm.SE_TRIAL, out nonce);
            byte[] sr; byte[] ss;
            SignAHash("s2.trial", _serviceKey, nonce, out sr, out ss);
            PolicySignedStep("s2.trial", _serviceKey, trial, nonce, sr, ss);
            PolicyCommandCodeStep("s2.trial", trial, Tpm.CC_NV_Increment);
            Resp dg = Ok("s2.trial:PolicyGetDigest", Cmd.PolicyGetDigest(trial), 0, 0);
            byte[] tpmDigest = new Rd(dg.Params).B2B();
            Flush("s2.trial", trial);
            byte[] formula = Policy.AnchorIncrementPolicy(_serviceKeyName);
            _r.Fact("s2.policy.tpmTrialDigest", Hex.Of(tpmDigest));
            _r.Fact("s2.policy.coreFormulaDigest", Hex.Of(formula));
            if (Hex.Of(tpmDigest) != Hex.Of(formula)) throw new CeremonyFailedException("POLICY_DIGEST_MISMATCH", 0);
            _policy = tpmDigest;
        }

        // التحقّقُ من السماتِ الكاملةِ والسياسةِ (§4.1/§4.2) على فهرسٍ مؤقّتٍ في المحاكي يُحذَفُ — ليس S3:
        // S3 فهرسُ مرساةٍ دائمٌ على العتادِ، وهو غيرُ مأذون.
        private void StageS2Validation()
        {
            _stage = "S2-validate";
            uint h = PickVacantHandle("s2v.anchorShape");
            Define("s2v.anchorShape", h, Tpm.ANCHOR_ATTRIBUTES, _policy);

            RefusedIncrement("s2v:NV_Increment(password-auth)", h, Cmd.PasswordAuth(new byte[0]), 0x0000012F, null);

            byte[] nonce;
            uint ps = StartSession("s2v.policy", Tpm.SE_POLICY, out nonce);
            byte[] sr; byte[] ss;
            SignAHash("s2v.policy", _serviceKey, nonce, out sr, out ss);
            PolicySignedStep("s2v.policy", _serviceKey, ps, nonce, sr, ss);
            PolicyCommandCodeStep("s2v.policy", ps, Tpm.CC_NV_Increment);
            Increment("s2v.policy:NV_Increment(policy-session)", h, Cmd.PolicyAuth(ps, Random(32)), null);
            SessionConsumed(ps);
            ulong v1 = ReadCounter("s2v:NV_Read(empty-auth)#1", h);

            // إعادةُ توقيعٍ قديمٍ على جلسةٍ جديدة (nonce مختلف) ⇒ يُرفَضُ برمزِ توقيعٍ غيرِ صالحٍ (0x5DB).
            byte[] nonce2;
            uint ps2 = StartSession("s2v.replay", Tpm.SE_POLICY, out nonce2);
            // رفضٌ سلبيّ لأمرٍ مُغيّرٍ (PolicySigned) يُقيَّدُ في دفترِ المواردِ (SOL413-06): فقدُ ردّهِ ⇒
            // نتيجةٌ مجهولةٌ تُجرَدُ جلسةً وسياسةً، لا تختفي من التقريرِ.
            RefusedTracked("s2v.replay:PolicySigned(old-signature)", Cmd.PolicySigned(_serviceKey, ps2, nonce2, 0, sr, ss), 0x000005DB, 0,
                Tracked("policy-mutation", ps2, null, null));
            Flush("s2v.replay", ps2);

            // توقيعُ مفتاحٍ آخرَ على nonce الجلسة ⇒ يُرفَضُ بالرمزِ نفسِهِ (0x5DB).
            Resp cr = SendTracked("s2v.foreign:Create(other-key)", Cmd.Create(_primary, new byte[0], Templates.ServiceSigningKey()), 0, 1,
                Tracked("object-create", 0, null, null));
            Rd q = new Rd(cr.Params);
            byte[] priv = q.B2B(); byte[] pub = q.B2B();
            Resp ld = SendTracked("s2v.foreign:Load(other-key)", Cmd.Load(_primary, new byte[0], priv, pub), 1, 1,
                Tracked("object-create", 0, null, null));
            AdoptHandle(ld.Handles[0], "Load");
            uint other = ld.Handles[0];
            _transients.Add(other);
            byte[] nonce3;
            uint ps3 = StartSession("s2v.foreign", Tpm.SE_POLICY, out nonce3);
            byte[] fr; byte[] fs;
            SignAHash("s2v.foreign", other, nonce3, out fr, out fs);
            RefusedTracked("s2v.foreign:PolicySigned(foreign-signature)", Cmd.PolicySigned(_serviceKey, ps3, nonce3, 0, fr, fs), 0x000005DB, 0,
                Tracked("policy-mutation", ps3, null, null));
            Flush("s2v.foreign", ps3);
            // سياسةٌ بمفتاحِ الآخرِ كاملةً ⇒ بصمةٌ أخرى ⇒ الزيادةُ تُرفَضُ بفشلِ سياسةٍ (0x99D).
            byte[] nonce4;
            uint ps4 = StartSession("s2v.otherkey", Tpm.SE_POLICY, out nonce4);
            SignAHash("s2v.otherkey", other, nonce4, out fr, out fs);
            PolicySignedStep("s2v.otherkey", other, ps4, nonce4, fr, fs);
            PolicyCommandCodeStep("s2v.otherkey", ps4, Tpm.CC_NV_Increment);
            RefusedIncrement("s2v.otherkey:NV_Increment(policy-of-other-key)", h, Cmd.PolicyAuth(ps4, Random(32)), 0x0000099D, v1);
            Flush("s2v.otherkey", ps4);
            Flush("s2v.foreign", other);

            // سياسةٌ بأمرٍ آخر (NV_Read) ⇒ الزيادةُ تُرفَضُ بفشلِ سياسةٍ (0x99D).
            byte[] nonce5;
            uint ps5 = StartSession("s2v.wrongcc", Tpm.SE_POLICY, out nonce5);
            SignAHash("s2v.wrongcc", _serviceKey, nonce5, out sr, out ss);
            PolicySignedStep("s2v.wrongcc", _serviceKey, ps5, nonce5, sr, ss);
            PolicyCommandCodeStep("s2v.wrongcc", ps5, Tpm.CC_NV_Read);
            RefusedIncrement("s2v.wrongcc:NV_Increment(policy-for-NV_Read)", h, Cmd.PolicyAuth(ps5, Random(32)), 0x0000099D, v1);
            Flush("s2v.wrongcc", ps5);

            ulong v2 = ReadCounter("s2v:NV_Read(empty-auth)#2", h);
            if (v2 != v1) throw new CeremonyFailedException("COUNTER_CHANGED_BY_REJECTED_PATH", 0);
            NvPub w = ReadPublic("s2v:NV_ReadPublic(after-write)", h);
            if (w.Attributes != (Tpm.ANCHOR_ATTRIBUTES | Tpm.NV_WRITTEN)) throw new CeremonyFailedException("ANCHOR_ATTRIBUTES_AFTER_WRITE", 0);
            _r.Fact("s2v.anchorShape.value1", v1.ToString());
            _r.Fact("s2v.anchorShape.valueAfterRejectedPaths", v2.ToString());
            _r.Fact("s2v.anchorShape.nvPublicHex(after-write)", Hex.Of(w.PublicArea));
            _r.Fact("s2v.anchorShape.nvName(after-write)", Hex.Of(w.Name));
            UndefineOwn("s2v.anchorShape", h);
        }

        // ── جردُ المصالحةِ (WL-413/SOL-02): يُجرى قبلَ التنظيفِ وبأوامرَ قرائيّةٍ فقط. يُثبتُ وقوعَ الأثرِ
        // أو غيابَهُ، ويُثبتُ ملكيّةَ فهرسِ NV بمطابقةِ منطقتِهِ العامّةِ قبلَ أيِّ حذفٍ. ما تعذّرَ إثباتُ
        // ملكيّتِهِ (كائنٌ عابرٌ أو جلسةٌ بلا منطقةٍ عامّةٍ) يُعلَنُ غيرَ محسومٍ ولا يُمسُّ. ──
        private void ReconcileUnknownOutcomes()
        {
            _cleanup = false;
            _stage = "reconcile";
            foreach (Pending p in new List<Pending>(_pending))
            {
                try { ReconcileOne(p); }
                catch (Exception e) { _r.CleanupLeftovers.Add("reconcile " + p.Kind + " " + Hex.U32(p.Handle) + " unverifiable: " + e.Message); }
                finally { _pending.Remove(p); }
            }
        }

        private void ReconcileOne(Pending p)
        {
            if (p.Kind == "nv-define")
            {
                NvPub n;
                if (!NvIndexExists(p.Handle, out n))
                {
                    _r.Reconciliation.Add("nv-define " + Hex.U32(p.Handle) + ": not-executed (verified absent by read-only inventory)");
                    return;
                }
                // WL-413 الدفعة الثانية (R2-01): هذه البروفةُ لم تكتبْ الفهرسَ قطُّ قبلَ ضياعِ ردِّ تعريفِهِ،
                // فالمنطقةُ العامّةُ لفهرسٍ نحن أنشأناه يجبُ أن تطابقَ ما أُرسِلَ بايتًا ببايتٍ — WRITTEN صفرٌ.
                // بتُّ WRITTEN مرفوعٌ يعني أنّ طرفًا آخرَ كتبَهُ: الملكيّةُ (أو على الأقلِّ حصريّتُها) غيرُ مُثبَتةٍ.
                if ((n.Attributes & Tpm.NV_WRITTEN) != 0 && Hex.Of(PublicWithoutWritten(n.PublicArea)) == Hex.Of(p.ExpectedPublic))
                {
                    _r.Reconciliation.Add("nv-define " + Hex.U32(p.Handle) + ": exists with matching definition but TPMA_NV_WRITTEN is set although this run never wrote it; written by another party; ownership undetermined; left in place");
                    _r.CleanupLeftovers.Add("nv " + Hex.U32(p.Handle) + ": ownership-undetermined (written by another party after lost define reply); left in place");
                    return;
                }
                bool ours = Hex.Of(n.PublicArea) == Hex.Of(p.ExpectedPublic);
                if (!ours)
                {
                    // موجودٌ لكنّهُ ليس منطقتَنا: لا يُحذَفُ لمجردِ وجودِهِ في المقبضِ المتوقَّعِ.
                    _r.Reconciliation.Add("nv-define " + Hex.U32(p.Handle) + ": exists but publicArea differs from this run's definition; ownership undetermined; left in place");
                    _r.CleanupLeftovers.Add("nv " + Hex.U32(p.Handle) + ": ownership-undetermined (publicArea differs); left in place");
                    return;
                }
                // موجودٌ بتعريفٍ مطابقٍ، لكنّ ردَّ التعريفِ لم يصلْ صالحًًا للبروفةِ (WL-413 الدفعة الثالثة / G47-413-1): التنفيذُ والملكيّةُ
                // غيرُ قابلَينِ للإثباتِ — طرفٌ ثالثٌ يعرفُ تفويضَ المالكِ قد يكونُ عرَّفَ الفهرسَ نفسهُ فيهِ ففشلَ تعريفُنا، والمطابقةُ لا تُميّزُ
                // بينَ الحالتينِ، ولا يُثبتُ أنَّ أمرُنا نُفِّذَ ليكونَ لنا مُطلقًا. لا يُحذَفُ ولا يُتبنّى للتنطيفِ، ويُعلَنُ غيرَ محسومِ
                // الملكيّةِ، والقرارُ للمالكِ، والجردُ النهائيُّ يُثبتُ بقاءَهُ.
                _r.Reconciliation.Add("nv-define " + Hex.U32(p.Handle) + ": exists with definition matching this run's request; the define reply was lost or unusable so execution and ownership cannot be proven (an identical pre-existing index is indistinguishable); left in place");
                _r.CleanupLeftovers.Add("nv " + Hex.U32(p.Handle) + ": ownership-undetermined (define reply lost; matching publicArea is not proof); left in place");
                return;
            }
            if (p.Kind == "nv-increment")
            {
                NvPub n;
                if (!NvIndexExists(p.Handle, out n))
                {
                    _r.Reconciliation.Add("nv-increment " + Hex.U32(p.Handle) + ": index absent (removed in cleanup path); outcome unobserved");
                    return;
                }
                bool uninit;
                ulong v = ReadCounterIfExists("reconcile:NV_Read(" + Hex.U32(p.Handle) + ")", p.Handle, out uninit);
                if (uninit)
                {
                    _r.Reconciliation.Add("nv-increment " + Hex.U32(p.Handle) + ": not-executed (counter still uninitialized)");
                    return;
                }
                if (p.BeforeValue.HasValue && v == p.BeforeValue.Value)
                    _r.Reconciliation.Add("nv-increment " + Hex.U32(p.Handle) + ": not-executed (value still " + v + ")");
                else
                    _r.Reconciliation.Add("nv-increment " + Hex.U32(p.Handle) + ": executed (value " + v + "); one-time effect recorded; index cleanup follows ownership check");
                return;
            }
            if (p.Kind == "nv-undefine")
            {
                NvPub n;
                if (!NvIndexExists(p.Handle, out n))
                {
                    _r.Reconciliation.Add("nv-undefine " + Hex.U32(p.Handle) + ": verified absent (deletion took effect)");
                    _definedByRun.Remove(p.Handle); // الغيابُ محقَّقٌ: لا يُحذَفُ ما ليس موجودًا في التنظيفِ.
                    return;
                }
                _r.Reconciliation.Add("nv-undefine " + Hex.U32(p.Handle) + ": still present; deletion outcome unknown; " +
                    LeftForCleanup("nv " + Hex.U32(p.Handle), "still present after lost undefine reply; cleanup budget spent"));
                return;
            }
            if (p.Kind == "flush")
            {
                HashSet<uint> now = HandleSet(0x02000000, true);
                now.UnionWith(HandleSet(0x80000000, false));
                if (!now.Contains(p.Handle))
                {
                    _r.Reconciliation.Add("flush " + Hex.U32(p.Handle) + ": verified absent (release took effect)");
                    _transients.Remove(p.Handle);
                    _ctx.EndOfLife(p.Handle); // انتهاءُ عمرٍ مُثبَتٌ بجردٍ قرائيّ: يُزالُ السياقُ المسجَّلُ (WL-416)
                    return;
                }
                _r.Reconciliation.Add("flush " + Hex.U32(p.Handle) + ": still present; release outcome unknown; " +
                    LeftForCleanup("transient " + Hex.U32(p.Handle), "still present after lost flush reply; cleanup budget spent"));
                return;
            }
            if (p.Kind == "object-create" || p.Kind == "session-create")
            {
                bool sessions = p.Kind == "session-create";
                HashSet<uint> now = sessions ? HandleSet(0x02000000, true) : HandleSet(0x80000000, false);
                HashSet<uint> baseline = sessions ? _baselineSessions : _baselineTransients;
                List<uint> appeared = new List<uint>();
                foreach (uint h in now) if (!baseline.Contains(h) && !_transients.Contains(h)) appeared.Add(h);
                if (appeared.Count == 0)
                {
                    _r.Reconciliation.Add(p.Kind + ": no new handle since baseline (execution undetermined from handle inventory; Create returns no object handle and a created object may have been flushed by another party)");
                    return;
                }
                foreach (uint h in appeared)
                {
                    // مقبضٌ جديدٌ لم يُرَدَّ لنا: الملكيّةُ غيرُ قابلةٍ للإثباتِ (لا منطقةً عامّةً تُطابَق) —
                    // يُعلَنُ غيرَ محسومٍ ولا يُحذَفُ ولا يُحرَّرُ.
                    _r.Reconciliation.Add(p.Kind + " " + Hex.U32(h) + ": appeared during run; ownership not provable; left in place");
                    _r.CleanupLeftovers.Add((sessions ? "session " : "transient ") + Hex.U32(h) + ": ownership-undetermined (appeared during run); not removed");
                }
                return;
            }
            if (p.Kind == "policy-mutation")
            {
                HashSet<uint> now = HandleSet(0x02000000, true);
                if (!now.Contains(p.Handle))
                {
                    _r.Reconciliation.Add("policy-mutation " + Hex.U32(p.Handle) + ": session gone; effect unverifiable and moot");
                    _transients.Remove(p.Handle);
                    _ctx.EndOfLife(p.Handle); // الجلسةُ اختفت فعلًا ⇒ زوالُ عمرٍ مُثبَتٌ (WL-416)
                    return;
                }
                _r.Reconciliation.Add("policy-mutation " + Hex.U32(p.Handle) + ": session still present; policy state unverifiable after lost response; " +
                    (_cleanupDone ? LeftForCleanup("transient " + Hex.U32(p.Handle), "session still present after lost policy response; cleanup budget spent") : "left for bounded cleanup"));
                return;
            }
            throw new CeremonyFailedException("RECONCILE_UNKNOWN_KIND: " + p.Kind, 0);
        }

        // جردٌ قرائيٌّ نهائيٌّ مقابلَ خطِّ الأساس (WL-413 الدفعة الثانية / R2-04). كلُّ مقبضٍ جديدٍ باقٍ يُعلَنُ في
        // البقايا إن لم يكن معلَنًا؛ وكلُّ بقيّةٍ معلَنةٍ ثبتَ غيابُها تُوثَّقُ في المصالحةِ (البقيّةُ المعلَنةُ لا تُمحى).
        // تعذُّرُ الجردِ (نقلٌ مقطوعٌ مثلًا) ⇒ الحالةُ المتبقّيةُ مجهولةٌ ⇒ بقيّةٌ معلَنةٌ وفشلٌ مغلق.
        private void PostRunInventory()
        {
            if (_baselineNv == null)
            {
                _r.PostRunError = "no baseline: run stopped before the read-only baseline snapshot (no state-changing command was sent)";
                return;
            }
            // خطُّ أساسٍ جزئيٌّ لا يُقارَنُ إليه جردٌ (R3SOL-04/قياسُ المراجعينَ): توقّفُ الجولةِ أثناءَ
            // الالتقاطِ بعدَ اكتمالِ جردِ NV يتركُ خطَّ أساسِ الجلساتِ/العابرةِ معدومًا؛ فجردٌ نهائيٌّ
            // بقوائمَ فارغةٍ كان يحملُ verified=true — الآن يُعلَنُ التعذُّرُ ولا يُدَّعى التحقيقُ.
            if (_baselineTransients == null || _baselineSessions == null)
            {
                _r.PostRunVerified = false;
                _r.PostRunError = "partial baseline: run stopped during the baseline snapshot (transients/sessions baseline absent)";
                _r.CleanupLeftovers.Add("post-run inventory not comparable: partial baseline; residual state unknown");
                return;
            }
            _cleanup = false;
            _stage = "post-run";
            try
            {
                HashSet<uint> nv = NvHandles();
                HashSet<uint> se = HandleSet(0x02000000, true);
                HashSet<uint> tr = HandleSet(0x80000000, false);
                foreach (uint h in nv) if (!_baselineNv.Contains(h)) _r.ResidualNv.Add(Hex.U32(h));
                foreach (uint h in se) if (!_baselineSessions.Contains(h)) _r.ResidualSessions.Add(Hex.U32(h));
                foreach (uint h in tr) if (!_baselineTransients.Contains(h)) _r.ResidualTransients.Add(Hex.U32(h));
                _r.PostRunVerified = true;
            }
            catch (Exception e)
            {
                _r.PostRunVerified = false;
                _r.PostRunError = e.Message;
                _r.CleanupLeftovers.Add("post-run inventory unavailable: residual state unknown (" + e.Message + ")");
                return;
            }
            List<string> residual = new List<string>();
            residual.AddRange(_r.ResidualNv); residual.AddRange(_r.ResidualSessions); residual.AddRange(_r.ResidualTransients);
            foreach (string h in residual)
            {
                bool declared = false;
                foreach (string l in _r.CleanupLeftovers) if (l.IndexOf(h, StringComparison.Ordinal) >= 0) { declared = true; break; }
                if (!declared) _r.CleanupLeftovers.Add("residual " + h + ": present after run, absent from baseline; not removed");
            }
            foreach (string l in new List<string>(_r.CleanupLeftovers))
            {
                int i = l.IndexOf("0x", StringComparison.Ordinal);
                if (i < 0 || i + 10 > l.Length) continue;
                string h = l.Substring(i, 10);
                if (!residual.Contains(h) && (l.StartsWith("nv ") || l.StartsWith("transient ") || l.StartsWith("session ")))
                    _r.Reconciliation.Add("post-run: " + h + " declared as leftover above but verified absent by final inventory");
            }
        }

        private void Cleanup()
        {
            _cleanup = true;
            List<uint> nv = new List<uint>(_definedByRun.Keys);
            foreach (uint h in nv)
            {
                for (int attempt = 0; attempt <= MaxCleanupAttemptsPerResource - 1; attempt++)
                {
                    try { UndefineOwn("cleanup", h); break; }
                    catch (Exception e) { _r.CleanupLeftovers.Add("nv " + Hex.U32(h) + ": " + e.Message); }
                }
            }
            List<uint> tr = new List<uint>(_transients);
            tr.Reverse();
            foreach (uint h in tr)
            {
                for (int attempt = 0; attempt <= MaxCleanupAttemptsPerResource - 1; attempt++)
                {
                    try { Flush("cleanup", h); break; }
                    catch (Exception e) { _r.CleanupLeftovers.Add("transient " + Hex.U32(h) + ": " + e.Message); }
                }
            }
        }

        // stages: "S1" أو "S2" أو "ALL" (S1 ثمّ S2 ثمّ التحقّقُ من السماتِ والسياسة).
        public CeremonyReport Run(string stages)
        {
            _r.Stages = stages;
            if (stages != "S1" && stages != "S2" && stages != "ALL") { _r.Status = "TOOL_ERROR"; _r.Failure = "UNKNOWN_STAGES"; return _r; }
            try
            {
                AssertSimulatorIdentity();
                SnapshotBaseline();
                // الحاجزُ المحافِظُ بعدَ اكتمالِ خطِّ الأساسِ القرائيّ وقبلَ أيِّ أمرٍ مُغيِّرٍ (قرارُ المالكِ — WL-416).
                AssertNvRangeOwnership();
                if (stages == "S1" || stages == "ALL") StageS1();
                if (stages == "S2" || stages == "ALL") StageS2();
                if (stages == "ALL") StageS2Validation();
                _r.Status = "COMPLETE";
            }
            catch (CeremonyBlockedException e) { _r.Status = "BLOCKED_FAIL_CLOSED"; _r.Failure = e.Message + " rc=" + Hex.U32(e.Rc); }
            catch (CeremonyUnknownOutcomeException e) { _r.Status = "FAILED_CLOSED"; _r.Failure = e.Message; }
            catch (CeremonyFailedException e) { _r.Status = "FAILED_CLOSED"; _r.Failure = e.Message + " rc=" + Hex.U32(e.Rc); }
            catch (Exception e) { _r.Status = "TOOL_ERROR"; _r.Failure = e.GetType().FullName + ": " + e.Message; }
            // النتيجةُ المجهولةُ تُجردُ قبلَ التنظيفِ (قرائيًّا)؛ ثمّ تنظيفٌ محدودُ المحاولاتِ مرةً واحدة.
            if (_pending.Count > 0)
            {
                try { ReconcileUnknownOutcomes(); }
                catch (Exception e) { _r.CleanupLeftovers.Add("reconcile aborted: " + e.Message); }
            }
            try { Cleanup(); }
            catch (Exception e) { _r.CleanupLeftovers.Add("cleanup aborted: " + e.Message); }
            _cleanupDone = true;
            // نتيجةٌ مجهولةٌ وقعت أثناءَ التنظيفِ نفسِه (فقدُ ردِّ حذفٍ مثلًا): جردٌ قرائيٌّ ثانٍ محدودٌ
            // يُثبتُ الأثرَ أو غيابَهُ ويُسجَّلُ في المصالحةِ — البقايا المعلَنةُ لا تُمحى، والتحققُ يُوثّق.
            if (_pending.Count > 0)
            {
                try { ReconcileUnknownOutcomes(); }
                catch (Exception e) { _r.CleanupLeftovers.Add("reconcile-after-cleanup aborted: " + e.Message); }
            }
            PostRunInventory();
            if (_r.CleanupLeftovers.Count > 0 && _r.Status == "COMPLETE") _r.Status = "FAILED_CLOSED";
            return _r;
        }
    }
}
