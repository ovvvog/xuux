// sim/tpm-ceremony/TpmCeremonyCore.cs
//
// بروفةُ المراسمِ S1/S2 على المحاكي وحدَه (WL-412؛ ADR 0007 §11.2؛ تفويضُ المالكِ 2026-10-17).
//
// ما هنا: منشئُ أوامرِ المراسمِ وترميزُها (TPM 2.0 Part 3)، والسماتُ (§4.1)، وحسابُ بصمةِ السياسةِ
// (§4.2)، ومنطقُ البروفةِ بفشلٍ مغلقٍ، ونقلٌ واحدٌ إلى swtpm على loopback.
//
// ما ليس هنا عمداً: لا DllImport، ولا tbs.dll، ولا أيُّ نقلٍ إلى TPM حقيقيّ. والبروفةُ تتحقّقُ من هويّةِ
// المحاكي (TPM_PT_MANUFACTURER = "IBM" وسلسلةُ البائع "SW TPM") قبلَ أيِّ أمرٍ مُغيِّرٍ، فترفضُ غيرَه.
// ولا تُخرِجُ أوامرَ خامّةً قابلةً لإعادةِ الإرسال: التقريرُ يحملُ بصمةَ SHA-256 لكلِّ أمرٍ لا بايتاتِه،
// والمقابضُ والجلساتُ والـnonces تُولَّدُ لكلِّ تشغيل.
//
// C# 5 عمداً (Windows PowerShell 5.1) — فلا $"..." ولا ?. ولا nameof ولا out var ولا أعضاءُ =>.

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

        // سماتُ S1: فهرسُ سبرٍ مؤقّتٌ — عدّادٌ، كتابةٌ وقراءةٌ بقيمةِ تفويضٍ فارغة، NO_DA، ORDERLY=0.
        public const uint S1_PROBE_ATTRIBUTES = NV_TPM_NT_COUNTER | NV_AUTHWRITE | NV_AUTHREAD | NV_NO_DA;

        // سماتُ المرساةِ كما في ADR 0007 §4.1: TPM_NT_COUNTER، POLICYWRITE، قراءةٌ بلا سرٍّ (AUTHREAD بقيمةٍ
        // فارغة)، NO_DA، ORDERLY=0، بلا POLICY_DELETE، بلا PCR.
        public const uint ANCHOR_ATTRIBUTES = NV_TPM_NT_COUNTER | NV_POLICYWRITE | NV_AUTHREAD | NV_NO_DA;
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

    public sealed class Resp
    {
        public ushort Tag;
        public uint Rc;
        public uint[] Handles = new uint[0];
        public byte[] Params = new byte[0];

        public static Resp Parse(byte[] raw, int handleCount)
        {
            if (raw == null || raw.Length < 10) throw new CeremonyFailedException("RESPONSE_TRUNCATED_HEADER", 0);
            Rd r = new Rd(raw);
            Resp p = new Resp();
            p.Tag = r.U16();
            uint size = r.U32();
            p.Rc = r.U32();
            if (size != raw.Length) throw new CeremonyFailedException("RESPONSE_SIZE_MISMATCH", p.Rc);
            if (p.Rc != 0) return p;
            p.Handles = new uint[handleCount];
            for (int i = 0; i < handleCount; i++) p.Handles[i] = r.U32();
            if (p.Tag == Tpm.ST_SESSIONS)
            {
                uint ps = r.U32();
                p.Params = r.Raw((int)ps);
            }
            else
            {
                p.Params = r.Raw(r.Remaining);
            }
            return p;
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
            return sb.Append('"').ToString();
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
            sb.Append("]}");
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

        public CeremonyRehearsal(ICeremonyTransport transport)
        {
            if (transport == null) throw new ArgumentNullException("transport");
            _t = transport;
            _r.Transport = transport.Kind;
        }

        public CeremonyReport Report { get { return _r; } }

        private byte[] Random(int n) { byte[] b = new byte[n]; _rng.GetBytes(b); return b; }

        private static uint CommandCodeOf(byte[] cmd) { return ((uint)cmd[6] << 24) | ((uint)cmd[7] << 16) | ((uint)cmd[8] << 8) | cmd[9]; }

        private Resp Send(string name, byte[] cmd, int respHandles, string expectation)
        {
            Step s = new Step();
            s.Stage = _cleanup ? "cleanup" : _stage;
            s.Name = name;
            s.CommandCode = CommandCodeOf(cmd);
            s.CommandSha256 = Hex.Of(Sha.H(cmd));
            s.Expectation = expectation;
            _r.Steps.Add(s);
            byte[] raw = _t.Transmit(cmd);
            Resp p = Resp.Parse(raw, respHandles);
            s.ResponseCode = p.Rc;
            // رفضُ الطبقةِ (TBS) أو أيُّ رمزِ Windows ⇒ توقّفٌ مغلقٌ: لا إعادة، ولا بديل، ولا تخفيفُ سمات.
            if ((p.Rc & 0xFFFF0000u) == 0x80280000u)
            {
                s.Outcome = "blocked";
                throw new CeremonyBlockedException(name, p.Rc);
            }
            if (expectation == "success")
            {
                if (p.Rc != 0) { s.Outcome = "unexpected-failure"; throw new CeremonyFailedException("TPM_ERROR: " + name, p.Rc); }
                s.Outcome = "ok";
            }
            else
            {
                if (p.Rc == 0) { s.Outcome = "unexpected-success"; throw new CeremonyFailedException("NEGATIVE_TEST_SUCCEEDED: " + name, 0); }
                s.Outcome = "rejected-as-expected";
            }
            return p;
        }

        private Resp Ok(string name, byte[] cmd, int respHandles) { return Send(name, cmd, respHandles, "success"); }
        private Resp Refused(string name, byte[] cmd) { return Send(name, cmd, 0, "failure"); }

        // ── الهويّة: تُرفَضُ أيُّ شريحةٍ ليست المحاكي قبلَ أيِّ أمرٍ مُغيِّر ──
        private void AssertSimulatorIdentity()
        {
            Resp p = Ok("identity:GetCapability(TPM_PT_MANUFACTURER..VENDOR_STRING_4)", Cmd.GetCapability(6, 0x105, 5), 0);
            Rd r = new Rd(p.Params);
            r.U8();
            if (r.U32() != 6) throw new CeremonyFailedException("SIMULATOR_IDENTITY_UNREADABLE", 0);
            uint count = r.U32();
            Dictionary<uint, uint> props = new Dictionary<uint, uint>();
            for (uint i = 0; i < count; i++) { uint k = r.U32(); props[k] = r.U32(); }
            uint man; uint v1; uint v2;
            if (!props.TryGetValue(0x105, out man) || !props.TryGetValue(0x106, out v1) || !props.TryGetValue(0x107, out v2))
                throw new CeremonyFailedException("SIMULATOR_IDENTITY_UNREADABLE", 0);
            string vendor = Ascii(v1) + Ascii(v2);
            _r.Fact("tpm.manufacturer", Ascii(man));
            _r.Fact("tpm.vendorString", vendor);
            if (Ascii(man) != "IBM" || vendor.Replace(" ", "") != "SWTPM")
                throw new CeremonyFailedException("SIMULATOR_IDENTITY_REQUIRED: manufacturer=" + Ascii(man), 0);
        }

        private static string Ascii(uint v)
        {
            byte[] b = new byte[] { (byte)(v >> 24), (byte)(v >> 16), (byte)(v >> 8), (byte)v };
            return Encoding.ASCII.GetString(b).TrimEnd('\0');
        }

        private uint Property(uint pt)
        {
            Resp p = Ok("inventory:GetCapability(" + Hex.U32(pt) + ")", Cmd.GetCapability(6, pt, 1), 0);
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
                Resp p = Ok("inventory:GetCapability(HANDLES," + Hex.U32(next) + ")", Cmd.GetCapability(1, next, 64), 0);
                Rd r = new Rd(p.Params);
                byte more = r.U8();
                r.U32();
                uint n = r.U32();
                uint last = 0;
                bool outOfRange = false;
                for (uint i = 0; i < n; i++)
                {
                    uint h = r.U32();
                    if ((h >> 24) != 0x01) { outOfRange = true; break; }
                    set.Add(h);
                    last = h;
                }
                if (more == 0 || outOfRange || n == 0) return set;
                next = last + 1;
            }
            throw new CeremonyFailedException("NV_HANDLE_ENUMERATION_INCOMPLETE", 0);
        }

        // جردٌ فوريٌّ قبلَ كلِّ تعريف ⇒ مقبضٌ عشوائيٌّ خالٍ في مجالِ المالك. لا مقبضَ ثابتٌ ولا إعادةُ محاولة.
        private uint PickVacantHandle(string purpose)
        {
            HashSet<uint> used = NvHandles();
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

        private NvPub ReadPublic(string name, uint index)
        {
            Resp p = Ok(name, Cmd.NvReadPublic(index), 0);
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

        private void Define(string label, uint index, uint attributes, byte[] authPolicy)
        {
            byte[] pub = Cmd.NvPublic(index, attributes, authPolicy, 8);
            Ok(label + ":NV_DefineSpace", Cmd.NvDefineSpace(_ownerAuth, new byte[0], pub), 0);
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

        private ulong ReadCounter(string label, uint index)
        {
            Resp p = Ok(label, Cmd.NvRead(index, Cmd.PasswordAuth(new byte[0]), 8, 0), 0);
            byte[] d = new Rd(p.Params).B2B();
            if (d.Length != 8) throw new CeremonyFailedException("COUNTER_SIZE_NOT_8", 0);
            ulong v = 0;
            for (int i = 0; i < 8; i++) v = (v << 8) | d[i];
            return v;
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
            Ok(label + ":NV_UndefineSpace", Cmd.NvUndefineSpace(_ownerAuth, index), 0);
            _definedByRun.Remove(index);
            Refused(label + ":NV_ReadPublic(after-undefine)", Cmd.NvReadPublic(index));
        }

        private uint StartSession(string label, byte type, out byte[] nonceTpm)
        {
            Resp p = Ok(label + ":StartAuthSession", Cmd.StartAuthSession(type, Random(32)), 1);
            nonceTpm = new Rd(p.Params).B2B();
            _transients.Add(p.Handles[0]);
            return p.Handles[0];
        }

        private void Flush(string label, uint h)
        {
            if (!_transients.Contains(h)) return;
            _transients.Remove(h);
            Ok(label + ":FlushContext", Cmd.FlushContext(h), 0);
        }

        private void SessionConsumed(uint h) { _transients.Remove(h); }

        private void SignAHash(string label, uint key, byte[] nonceTpm, out byte[] r, out byte[] s)
        {
            Resp p = Ok(label + ":Sign(aHash)", Cmd.Sign(key, new byte[0], Policy.AHash(nonceTpm, 0)), 0);
            Rd q = new Rd(p.Params);
            if (q.U16() != Tpm.ALG_ECDSA || q.U16() != Tpm.ALG_SHA256) throw new CeremonyFailedException("SIGNATURE_SCHEME_UNEXPECTED", 0);
            r = q.B2B(); s = q.B2B();
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
            Refused("s1.probe:NV_Read(before-first-increment)", Cmd.NvRead(h, Cmd.PasswordAuth(new byte[0]), 8, 0));
            Ok("s1.probe:NV_Increment#1", Cmd.NvIncrement(h, Cmd.PasswordAuth(new byte[0])), 0);
            ulong v1 = ReadCounter("s1.probe:NV_Read#1", h);
            Ok("s1.probe:NV_Increment#2", Cmd.NvIncrement(h, Cmd.PasswordAuth(new byte[0])), 0);
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
            Ok("s1.redefine:NV_Increment#1", Cmd.NvIncrement(h2, Cmd.PasswordAuth(new byte[0])), 0);
            ulong v3 = ReadCounter("s1.redefine:NV_Read#1", h2);
            _r.Fact("s1.redefine.value1", v3.ToString());
            _r.Fact("s1.redefine.aboveProbe", (v3 > v2) ? "true" : "false");
            UndefineOwn("s1.redefine", h2);
        }

        private void StageS2()
        {
            _stage = "S2";
            Resp pp = Ok("s2:CreatePrimary(storage,ECC-P256)", Cmd.CreatePrimary(_ownerAuth, Templates.StoragePrimary()), 1);
            _primary = pp.Handles[0];
            _transients.Add(_primary);
            Resp cr = Ok("s2:Create(service-key,ECDSA-P256)", Cmd.Create(_primary, new byte[0], Templates.ServiceSigningKey()), 0);
            Rd q = new Rd(cr.Params);
            byte[] priv = q.B2B();
            byte[] pub = q.B2B();
            Resp ld = Ok("s2:Load(service-key)", Cmd.Load(_primary, new byte[0], priv, pub), 1);
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
            Ok("s2.trial:PolicySigned", Cmd.PolicySigned(_serviceKey, trial, nonce, 0, sr, ss), 0);
            Ok("s2.trial:PolicyCommandCode(NV_Increment)", Cmd.PolicyCommandCode(trial, Tpm.CC_NV_Increment), 0);
            Resp dg = Ok("s2.trial:PolicyGetDigest", Cmd.PolicyGetDigest(trial), 0);
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

            Refused("s2v:NV_Increment(password-auth)", Cmd.NvIncrement(h, Cmd.PasswordAuth(new byte[0])));

            byte[] nonce;
            uint ps = StartSession("s2v.policy", Tpm.SE_POLICY, out nonce);
            byte[] sr; byte[] ss;
            SignAHash("s2v.policy", _serviceKey, nonce, out sr, out ss);
            Ok("s2v.policy:PolicySigned", Cmd.PolicySigned(_serviceKey, ps, nonce, 0, sr, ss), 0);
            Ok("s2v.policy:PolicyCommandCode(NV_Increment)", Cmd.PolicyCommandCode(ps, Tpm.CC_NV_Increment), 0);
            Ok("s2v.policy:NV_Increment(policy-session)", Cmd.NvIncrement(h, Cmd.PolicyAuth(ps, Random(32))), 0);
            SessionConsumed(ps);
            ulong v1 = ReadCounter("s2v:NV_Read(empty-auth)#1", h);

            // إعادةُ توقيعٍ قديمٍ على جلسةٍ جديدة (nonce مختلف) ⇒ يُرفَض.
            byte[] nonce2;
            uint ps2 = StartSession("s2v.replay", Tpm.SE_POLICY, out nonce2);
            Refused("s2v.replay:PolicySigned(old-signature)", Cmd.PolicySigned(_serviceKey, ps2, nonce2, 0, sr, ss));
            Flush("s2v.replay", ps2);

            // توقيعُ مفتاحٍ آخرَ على nonce الجلسة ⇒ يُرفَض.
            Resp cr = Ok("s2v.foreign:Create(other-key)", Cmd.Create(_primary, new byte[0], Templates.ServiceSigningKey()), 0);
            Rd q = new Rd(cr.Params);
            byte[] priv = q.B2B(); byte[] pub = q.B2B();
            Resp ld = Ok("s2v.foreign:Load(other-key)", Cmd.Load(_primary, new byte[0], priv, pub), 1);
            uint other = ld.Handles[0];
            _transients.Add(other);
            byte[] nonce3;
            uint ps3 = StartSession("s2v.foreign", Tpm.SE_POLICY, out nonce3);
            byte[] fr; byte[] fs;
            SignAHash("s2v.foreign", other, nonce3, out fr, out fs);
            Refused("s2v.foreign:PolicySigned(foreign-signature)", Cmd.PolicySigned(_serviceKey, ps3, nonce3, 0, fr, fs));
            Flush("s2v.foreign", ps3);
            // سياسةٌ بمفتاحِ الآخرِ كاملةً ⇒ بصمةٌ أخرى ⇒ الزيادةُ تُرفَض.
            byte[] nonce4;
            uint ps4 = StartSession("s2v.otherkey", Tpm.SE_POLICY, out nonce4);
            SignAHash("s2v.otherkey", other, nonce4, out fr, out fs);
            Ok("s2v.otherkey:PolicySigned(other-key)", Cmd.PolicySigned(other, ps4, nonce4, 0, fr, fs), 0);
            Ok("s2v.otherkey:PolicyCommandCode(NV_Increment)", Cmd.PolicyCommandCode(ps4, Tpm.CC_NV_Increment), 0);
            Refused("s2v.otherkey:NV_Increment(policy-of-other-key)", Cmd.NvIncrement(h, Cmd.PolicyAuth(ps4, Random(32))));
            Flush("s2v.otherkey", ps4);
            Flush("s2v.foreign", other);

            // سياسةٌ بأمرٍ آخر (NV_Read) ⇒ الزيادةُ تُرفَض.
            byte[] nonce5;
            uint ps5 = StartSession("s2v.wrongcc", Tpm.SE_POLICY, out nonce5);
            SignAHash("s2v.wrongcc", _serviceKey, nonce5, out sr, out ss);
            Ok("s2v.wrongcc:PolicySigned", Cmd.PolicySigned(_serviceKey, ps5, nonce5, 0, sr, ss), 0);
            Ok("s2v.wrongcc:PolicyCommandCode(NV_Read)", Cmd.PolicyCommandCode(ps5, Tpm.CC_NV_Read), 0);
            Refused("s2v.wrongcc:NV_Increment(policy-for-NV_Read)", Cmd.NvIncrement(h, Cmd.PolicyAuth(ps5, Random(32))));
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

        private void Cleanup()
        {
            _cleanup = true;
            List<uint> nv = new List<uint>(_definedByRun.Keys);
            foreach (uint h in nv)
            {
                try { UndefineOwn("cleanup", h); }
                catch (Exception e) { _r.CleanupLeftovers.Add("nv " + Hex.U32(h) + ": " + e.Message); }
            }
            List<uint> tr = new List<uint>(_transients);
            tr.Reverse();
            foreach (uint h in tr)
            {
                try { Flush("cleanup", h); }
                catch (Exception e) { _r.CleanupLeftovers.Add("transient " + Hex.U32(h) + ": " + e.Message); }
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
                if (stages == "S1" || stages == "ALL") StageS1();
                if (stages == "S2" || stages == "ALL") StageS2();
                if (stages == "ALL") StageS2Validation();
                _r.Status = "COMPLETE";
            }
            catch (CeremonyBlockedException e) { _r.Status = "BLOCKED_FAIL_CLOSED"; _r.Failure = e.Message + " rc=" + Hex.U32(e.Rc); }
            catch (CeremonyFailedException e) { _r.Status = "FAILED_CLOSED"; _r.Failure = e.Message + " rc=" + Hex.U32(e.Rc); }
            catch (Exception e) { _r.Status = "TOOL_ERROR"; _r.Failure = e.GetType().FullName + ": " + e.Message; }
            try { Cleanup(); }
            catch (Exception e) { _r.CleanupLeftovers.Add("cleanup aborted: " + e.Message); }
            if (_r.CleanupLeftovers.Count > 0 && _r.Status == "COMPLETE") _r.Status = "FAILED_CLOSED";
            return _r;
        }
    }
}
