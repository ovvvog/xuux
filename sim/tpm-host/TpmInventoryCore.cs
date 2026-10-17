// sim/tpm-host/TpmInventoryCore.cs
//
// نواةُ جردِ TPM على مضيفِ Windows — للقراءةِ فقط (WL-410، ADR 0007 §9 البند 5).
//
// ما في هذا الملفِّ:
//   - TpmGuard: قائمةُ سماحٍ بنيويّةٌ — لا يمرُّ إلى TPM إلا أمرانِ للقراءةِ:
//       TPM2_GetCapability (0x0000017A) لقدراتٍ مسمّاةٍ، و TPM2_NV_ReadPublic (0x00000169)
//       لمقبضِ فهرسِ NV. كلُّ ما سواهما يُرفَضُ قبلَ أيِّ نداءٍ أصليٍّ.
//   - GuardedTransport: الطريقُ الوحيدُ إلى النقلِ؛ Submit غيرُ قابلٍ للتجاوزِ، ينسخُ
//       البايتاتِ ثمَّ يفحصُ النسخةَ ثمَّ يُرسلُها هي نفسَها (لا فجوةَ بينَ الفحصِ والإرسال).
//   - TbsTransport: TPM Base Services الرسميّةُ (tbs.dll) — النقلُ الوحيدُ في هذا الملفِّ.
//       لا نقلَ محاكاةٍ هنا، فلا مسارَ احتياطيَّ يسقطُ إلى محاكٍ.
//   - Inventory: يبني الطلباتِ داخليّاً (لا بايتاتٍ من المستدعي)، ويُقلِّبُ الصفحاتِ
//       بحدٍّ أعلى وتقدُّمٍ صارمٍ، ويحفظُ لكلِّ استعلامٍ: الطلبَ والردَّ خاميْنِ،
//       ورمزَ TBS، ورمزَ TPM، والخطأَ. التفسيرُ الكاملُ خارجَهُ (decode_inventory.mjs).
//
// قيدُ اللغةِ: C# 5 (مُصرِّفُ .NET Framework الذي يستعملُه Add-Type في Windows PowerShell 5.1):
// لا استيفاءَ نصوصٍ ($"…") ولا ?. ولا nameof ولا أعضاءَ بتعبيرٍ (=>) ولا out var.
// ويحرسُ ذلك tests/sim/tpm-host-guard.test.mjs.
//
// ممنوعٌ هنا نصّاً: أيُّ أمرٍ يُغيِّرُ حالةَ TPM (NV_DefineSpace/NV_Increment/NV_UndefineSpace/
// Clear/HierarchyChangeAuth…)، وأيُّ قراءةٍ لمحتوى فهرسٍ (NV_Read)، وأيُّ واجهةِ TBS غيرُ
// الأربعِ المعلنةِ أدناه.

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace Xuux.TpmHost
{
    public sealed class TpmCommandNotAllowedException : Exception
    {
        public TpmCommandNotAllowedException(string reason)
            : base("XUUX_TPM_COMMAND_NOT_ALLOWED: " + reason) { }
    }

    public static class TpmGuard
    {
        public const ushort TPM_ST_NO_SESSIONS = 0x8001;
        public const uint TPM_CC_GetCapability = 0x0000017A;
        public const uint TPM_CC_NV_ReadPublic = 0x00000169;

        public const uint TPM_CAP_ALGS = 0x00000000;
        public const uint TPM_CAP_HANDLES = 0x00000001;
        public const uint TPM_CAP_COMMANDS = 0x00000002;
        public const uint TPM_CAP_TPM_PROPERTIES = 0x00000006;
        public const uint TPM_CAP_ECC_CURVES = 0x00000008;

        public const uint MaxPropertyCount = 256;

        private static readonly uint[] AllowedCapabilities = new uint[] {
            TPM_CAP_ALGS, TPM_CAP_HANDLES, TPM_CAP_COMMANDS, TPM_CAP_TPM_PROPERTIES, TPM_CAP_ECC_CURVES
        };

        public static uint[] AllowedCommandCodes()
        {
            return new uint[] { TPM_CC_GetCapability, TPM_CC_NV_ReadPublic };
        }

        public static bool IsNvIndexHandle(uint handle)
        {
            return (handle >> 24) == 0x01;
        }

        // يرمي TpmCommandNotAllowedException لكلِّ ما ليس أحدَ الشكلَينِ المسموحَينِ حرفيّاً.
        public static void AssertAllowedCommand(byte[] cmd)
        {
            if (cmd == null) throw new TpmCommandNotAllowedException("null command");
            if (cmd.Length < 10) throw new TpmCommandNotAllowedException("shorter than a TPM header");
            ushort tag = Be.U16(cmd, 0);
            uint size = Be.U32(cmd, 2);
            uint cc = Be.U32(cmd, 6);
            if (tag != TPM_ST_NO_SESSIONS)
                throw new TpmCommandNotAllowedException("tag must be TPM_ST_NO_SESSIONS (no authorization sessions)");
            if (size != (uint)cmd.Length)
                throw new TpmCommandNotAllowedException("declared size does not equal buffer length");

            if (cc == TPM_CC_GetCapability)
            {
                if (cmd.Length != 22) throw new TpmCommandNotAllowedException("GetCapability must be exactly 22 bytes");
                uint capability = Be.U32(cmd, 10);
                uint property = Be.U32(cmd, 14);
                uint count = Be.U32(cmd, 18);
                if (Array.IndexOf(AllowedCapabilities, capability) < 0)
                    throw new TpmCommandNotAllowedException("capability not on the allowlist: 0x" + capability.ToString("x8"));
                if (count < 1 || count > MaxPropertyCount)
                    throw new TpmCommandNotAllowedException("propertyCount out of range");
                if (capability == TPM_CAP_HANDLES && !IsNvIndexHandle(property))
                    throw new TpmCommandNotAllowedException("handle enumeration is limited to the NV index range");
                return;
            }
            if (cc == TPM_CC_NV_ReadPublic)
            {
                if (cmd.Length != 14) throw new TpmCommandNotAllowedException("NV_ReadPublic must be exactly 14 bytes");
                uint handle = Be.U32(cmd, 10);
                if (!IsNvIndexHandle(handle))
                    throw new TpmCommandNotAllowedException("NV_ReadPublic handle outside the NV index range");
                return;
            }
            throw new TpmCommandNotAllowedException("command code not on the allowlist: 0x" + cc.ToString("x8"));
        }
    }

    public static class Be
    {
        public static ushort U16(byte[] b, int o)
        {
            return (ushort)((b[o] << 8) | b[o + 1]);
        }

        public static uint U32(byte[] b, int o)
        {
            return ((uint)b[o] << 24) | ((uint)b[o + 1] << 16) | ((uint)b[o + 2] << 8) | (uint)b[o + 3];
        }

        public static void Put16(List<byte> l, ushort v)
        {
            l.Add((byte)(v >> 8)); l.Add((byte)(v & 0xFF));
        }

        public static void Put32(List<byte> l, uint v)
        {
            l.Add((byte)(v >> 24)); l.Add((byte)((v >> 16) & 0xFF)); l.Add((byte)((v >> 8) & 0xFF)); l.Add((byte)(v & 0xFF));
        }

        public static string Hex(byte[] b)
        {
            if (b == null) return null;
            StringBuilder sb = new StringBuilder(b.Length * 2);
            for (int i = 0; i < b.Length; i++) sb.Append(b[i].ToString("x2"));
            return sb.ToString();
        }
    }

    // بُناةُ الطلباتِ — الطريقُ الوحيدُ لصنعِ بايتاتِ أمرٍ في هذه الأداة.
    public static class TpmCommands
    {
        public static byte[] GetCapability(uint capability, uint property, uint count)
        {
            List<byte> l = new List<byte>(22);
            Be.Put16(l, TpmGuard.TPM_ST_NO_SESSIONS);
            Be.Put32(l, 22);
            Be.Put32(l, TpmGuard.TPM_CC_GetCapability);
            Be.Put32(l, capability);
            Be.Put32(l, property);
            Be.Put32(l, count);
            return l.ToArray();
        }

        public static byte[] NvReadPublic(uint nvIndex)
        {
            List<byte> l = new List<byte>(14);
            Be.Put16(l, TpmGuard.TPM_ST_NO_SESSIONS);
            Be.Put32(l, 14);
            Be.Put32(l, TpmGuard.TPM_CC_NV_ReadPublic);
            Be.Put32(l, nvIndex);
            return l.ToArray();
        }
    }

    public sealed class TransportResult
    {
        public uint TransportCode;   // رمزُ طبقةِ النقلِ (TBS_RESULT على Windows). 0 = سُلِّمَ الأمرُ.
        public byte[] Response;      // الردُّ الخامُّ كما أعادَته الطبقةُ (قد يحملُ رمزَ خطأِ TPM).
        public string Note;
    }

    public abstract class GuardedTransport
    {
        private int _submitted;

        public int SubmittedCount { get { return _submitted; } }

        public abstract string Kind { get; }

        // غيرُ افتراضيٍّ عمداً: لا يملكُ صنفٌ مشتقٌّ أن يتجاوزَ الحارس.
        public TransportResult Submit(byte[] cmd)
        {
            if (cmd == null) throw new TpmCommandNotAllowedException("null command");
            byte[] copy = (byte[])cmd.Clone();
            TpmGuard.AssertAllowedCommand(copy);
            _submitted++;
            return SubmitChecked(copy);
        }

        protected abstract TransportResult SubmitChecked(byte[] checkedCommand);
    }

    // TPM Base Services — المراجعُ: Microsoft Learn (Tbsi_Context_Create، Tbsip_Submit_Command،
    // Tbsip_Context_Close، Tbsi_GetDeviceInfo، TBS_CONTEXT_PARAMS2). لا واجهةَ TBS غيرُها.
    public sealed class TbsTransport : GuardedTransport, IDisposable
    {
        public const uint TPM_VERSION_20 = 2;
        public const uint TBS_CONTEXT_INCLUDE_TPM20 = 0x4;   // البتُّ includeTpm20 في الاتحاد asUINT32
        public const uint TBS_COMMAND_LOCALITY_ZERO = 0;
        public const uint TBS_COMMAND_PRIORITY_NORMAL = 200;
        public const int ResultBufferSize = 4096;

        [StructLayout(LayoutKind.Sequential)]
        private struct TBS_CONTEXT_PARAMS2
        {
            public uint version;
            public uint asUINT32;
        }

        [DllImport("tbs.dll", EntryPoint = "Tbsi_Context_Create")]
        private static extern uint NativeContextCreate(ref TBS_CONTEXT_PARAMS2 pContextParams, out IntPtr phContext);

        [DllImport("tbs.dll", EntryPoint = "Tbsip_Context_Close")]
        private static extern uint NativeContextClose(IntPtr hContext);

        [DllImport("tbs.dll", EntryPoint = "Tbsip_Submit_Command")]
        private static extern uint NativeSubmit(IntPtr hContext, uint locality, uint priority,
            byte[] pabCommand, uint cbCommand, [Out] byte[] pabResult, ref uint pcbResult);

        [DllImport("tbs.dll", EntryPoint = "Tbsi_GetDeviceInfo")]
        private static extern uint NativeGetDeviceInfo(uint size, [Out] byte[] info);

        private IntPtr _ctx = IntPtr.Zero;
        private bool _open;

        public override string Kind { get { return "tbs"; } }

        public uint CreateCode;
        public uint CloseCode;
        public bool Closed;

        // يعيدُ رمزَ TBS لإنشاءِ السياق؛ 0 = نجاح. لا استثناءَ يبتلعُ الرمز.
        public uint Open()
        {
            TBS_CONTEXT_PARAMS2 p = new TBS_CONTEXT_PARAMS2();
            p.version = TPM_VERSION_20;
            p.asUINT32 = TBS_CONTEXT_INCLUDE_TPM20;
            IntPtr h;
            CreateCode = NativeContextCreate(ref p, out h);
            if (CreateCode == 0) { _ctx = h; _open = true; }
            return CreateCode;
        }

        // أربعةُ أعدادٍ 32-بت: structVersion, tpmVersion, tpmInterfaceType, tpmImpRevision.
        public static uint GetDeviceInfo(out uint[] values)
        {
            byte[] buf = new byte[16];
            uint rc = NativeGetDeviceInfo(16, buf);
            values = new uint[4];
            if (rc == 0)
            {
                for (int i = 0; i < 4; i++) values[i] = BitConverter.ToUInt32(buf, i * 4); // بنيةٌ أصليّةٌ: ترتيبُ المضيفِ
            }
            return rc;
        }

        protected override TransportResult SubmitChecked(byte[] checkedCommand)
        {
            TransportResult r = new TransportResult();
            if (!_open)
            {
                r.TransportCode = 0xFFFFFFFF;
                r.Note = "TBS context is not open";
                return r;
            }
            byte[] result = new byte[ResultBufferSize];
            uint cb = (uint)result.Length;
            r.TransportCode = NativeSubmit(_ctx, TBS_COMMAND_LOCALITY_ZERO, TBS_COMMAND_PRIORITY_NORMAL,
                checkedCommand, (uint)checkedCommand.Length, result, ref cb);
            if (r.TransportCode == 0)
            {
                if (cb > (uint)result.Length) { r.Note = "TBS reported a result larger than the buffer"; return r; }
                byte[] resp = new byte[cb];
                Array.Copy(result, resp, (int)cb);
                r.Response = resp;
            }
            return r;
        }

        public void Dispose()
        {
            if (_open)
            {
                CloseCode = NativeContextClose(_ctx);
                _open = false;
                Closed = true;
                _ctx = IntPtr.Zero;
            }
        }
    }

    public sealed class QueryRecord
    {
        public string Id;
        public string Command;          // "GetCapability" | "NV_ReadPublic"
        public string RequestHex;
        public long TransportCode = -1; // -1 = لم يُرسَل
        public string ResponseHex;
        public long TpmResponseCode = -1; // -1 = لا ردَّ قابلاً لقراءةِ الرأس
        public string Error;
    }

    public sealed class CapabilityRun
    {
        public string Name;
        public uint Capability;
        public uint StartProperty;
        public bool Complete;           // true فقط إن انتهى moreData=NO بلا خطأٍ ولا قصٍّ
        public string Incomplete;       // سببُ عدمِ الاكتمال
        public List<string> QueryIds = new List<string>();
    }

    public sealed class InventoryResult
    {
        public string Transport;
        public List<QueryRecord> Queries = new List<QueryRecord>();
        public List<CapabilityRun> Capabilities = new List<CapabilityRun>();
        public List<string> NvHandles = new List<string>();
        public bool NvHandlesComplete;
        public int NvReadPublicLimit;
        public bool NvReadPublicTruncated;
    }

    // تسلسلُ JSON يدويٌّ حتميٌّ — مشتركٌ بينَ أداةِ المضيفِ واختبارِ المحاكي فيُقاسُ الشكلُ نفسُه.
    public static class InventoryJson
    {
        public static string Str(string s)
        {
            if (s == null) return "null";
            StringBuilder sb = new StringBuilder(s.Length + 2);
            sb.Append('"');
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                if (c == '"') sb.Append("\\\"");
                else if (c == '\\') sb.Append("\\\\");
                else if (c < 0x20 || c > 0x7E) sb.Append("\\u").Append(((int)c).ToString("x4"));
                else sb.Append(c);
            }
            sb.Append('"');
            return sb.ToString();
        }

        public static string Hex32(long v)
        {
            if (v < 0) return "null";
            return Str("0x" + ((uint)v).ToString("x8"));
        }

        private static string Bool(bool b) { return b ? "true" : "false"; }

        public static string Serialize(InventoryResult inv)
        {
            StringBuilder sb = new StringBuilder();
            sb.Append("{\"transport\":").Append(Str(inv.Transport));
            sb.Append(",\"queries\":[");
            for (int i = 0; i < inv.Queries.Count; i++)
            {
                QueryRecord q = inv.Queries[i];
                if (i > 0) sb.Append(',');
                sb.Append("{\"id\":").Append(Str(q.Id));
                sb.Append(",\"command\":").Append(Str(q.Command));
                sb.Append(",\"requestHex\":").Append(Str(q.RequestHex));
                sb.Append(",\"transportCode\":").Append(Hex32(q.TransportCode));
                sb.Append(",\"tpmResponseCode\":").Append(Hex32(q.TpmResponseCode));
                sb.Append(",\"responseHex\":").Append(Str(q.ResponseHex));
                sb.Append(",\"error\":").Append(Str(q.Error)).Append('}');
            }
            sb.Append("],\"capabilities\":[");
            for (int i = 0; i < inv.Capabilities.Count; i++)
            {
                CapabilityRun c = inv.Capabilities[i];
                if (i > 0) sb.Append(',');
                sb.Append("{\"name\":").Append(Str(c.Name));
                sb.Append(",\"capability\":").Append(Hex32(c.Capability));
                sb.Append(",\"startProperty\":").Append(Hex32(c.StartProperty));
                sb.Append(",\"complete\":").Append(Bool(c.Complete));
                sb.Append(",\"incomplete\":").Append(Str(c.Incomplete));
                sb.Append(",\"queryIds\":[");
                for (int j = 0; j < c.QueryIds.Count; j++) { if (j > 0) sb.Append(','); sb.Append(Str(c.QueryIds[j])); }
                sb.Append("]}");
            }
            sb.Append("],\"nvHandles\":[");
            for (int i = 0; i < inv.NvHandles.Count; i++) { if (i > 0) sb.Append(','); sb.Append(Str(inv.NvHandles[i])); }
            sb.Append("],\"nvHandlesComplete\":").Append(Bool(inv.NvHandlesComplete));
            sb.Append(",\"nvReadPublicLimit\":").Append(inv.NvReadPublicLimit.ToString());
            sb.Append(",\"nvReadPublicTruncated\":").Append(Bool(inv.NvReadPublicTruncated));
            sb.Append('}');
            return sb.ToString();
        }
    }

    public static class Inventory
    {
        public const uint PageCount = 64;
        public const int MaxPages = 16;
        public const int MaxNvReadPublic = 64;

        private struct CapSpec
        {
            public string Name; public uint Cap; public uint Start; public int ItemSize;
            public CapSpec(string n, uint c, uint s, int i) { Name = n; Cap = c; Start = s; ItemSize = i; }
        }

        public static InventoryResult Collect(GuardedTransport t)
        {
            InventoryResult res = new InventoryResult();
            res.Transport = t.Kind;
            res.NvReadPublicLimit = MaxNvReadPublic;
            CapSpec[] specs = new CapSpec[] {
                // مجموعتا الخصائصِ تُطلَبانِ منفصلتَينِ: بعضُ التنفيذاتِ (libtpms) تقفُ عندَ نهايةِ
                // المجموعةِ بـmoreData=NO ولا تعبرُ إلى PT_VAR.
                new CapSpec("tpm-properties-fixed", TpmGuard.TPM_CAP_TPM_PROPERTIES, 0x00000100, 8),
                new CapSpec("tpm-properties-var", TpmGuard.TPM_CAP_TPM_PROPERTIES, 0x00000200, 8),
                new CapSpec("nv-index-handles", TpmGuard.TPM_CAP_HANDLES, 0x01000000, 4),
                new CapSpec("commands", TpmGuard.TPM_CAP_COMMANDS, 0x0000011F, 4),
                new CapSpec("algorithms", TpmGuard.TPM_CAP_ALGS, 0x00000001, 6),
                new CapSpec("ecc-curves", TpmGuard.TPM_CAP_ECC_CURVES, 0x00000001, 2),
            };
            List<uint> nvHandles = new List<uint>();
            for (int s = 0; s < specs.Length; s++)
            {
                CapabilityRun run = RunCapability(t, res, specs[s], specs[s].Cap == TpmGuard.TPM_CAP_HANDLES ? nvHandles : null);
                res.Capabilities.Add(run);
                if (specs[s].Cap == TpmGuard.TPM_CAP_HANDLES) res.NvHandlesComplete = run.Complete;
            }
            for (int i = 0; i < nvHandles.Count; i++) res.NvHandles.Add("0x" + nvHandles[i].ToString("x8"));
            int n = 0;
            for (int i = 0; i < nvHandles.Count; i++)
            {
                if (n >= MaxNvReadPublic) { res.NvReadPublicTruncated = true; break; }
                Send(t, res, "nv-readpublic-" + nvHandles[i].ToString("x8"), "NV_ReadPublic",
                    TpmCommands.NvReadPublic(nvHandles[i]));
                n++;
            }
            return res;
        }

        private static QueryRecord Send(GuardedTransport t, InventoryResult res, string id, string command, byte[] cmd)
        {
            QueryRecord q = new QueryRecord();
            q.Id = id; q.Command = command; q.RequestHex = Be.Hex(cmd);
            res.Queries.Add(q);
            try
            {
                TransportResult tr = t.Submit(cmd);
                q.TransportCode = tr.TransportCode;
                q.ResponseHex = Be.Hex(tr.Response);
                if (tr.Note != null) q.Error = tr.Note;
                if (tr.TransportCode == 0 && tr.Response != null)
                {
                    if (tr.Response.Length >= 10)
                    {
                        uint size = Be.U32(tr.Response, 2);
                        q.TpmResponseCode = Be.U32(tr.Response, 6);
                        if (size != (uint)tr.Response.Length) q.Error = "response size field does not match length";
                    }
                    else q.Error = "response shorter than a TPM header";
                }
            }
            catch (TpmCommandNotAllowedException e) { q.Error = e.Message; }
            catch (Exception e) { q.Error = e.GetType().Name + ": " + e.Message; }
            return q;
        }

        private static CapabilityRun RunCapability(GuardedTransport t, InventoryResult res, CapSpec spec, List<uint> collectHandles)
        {
            CapabilityRun run = new CapabilityRun();
            run.Name = spec.Name; run.Capability = spec.Cap; run.StartProperty = spec.Start;
            uint property = spec.Start;
            for (int page = 0; page < MaxPages; page++)
            {
                string id = spec.Name + "-p" + page.ToString();
                run.QueryIds.Add(id);
                QueryRecord q = Send(t, res, id, "GetCapability", TpmCommands.GetCapability(spec.Cap, property, PageCount));
                if (q.Error != null) { run.Incomplete = "query error: " + q.Error; return run; }
                if (q.TransportCode != 0) { run.Incomplete = "transport code 0x" + q.TransportCode.ToString("x8"); return run; }
                if (q.TpmResponseCode != 0) { run.Incomplete = "TPM response code 0x" + q.TpmResponseCode.ToString("x8"); return run; }
                byte[] r = FromHex(q.ResponseHex);
                // رأسٌ 10 + moreData 1 + capability 4 + count 4
                if (r.Length < 19) { run.Incomplete = "capability response truncated"; return run; }
                byte more = r[10];
                uint cap = Be.U32(r, 11);
                uint count = Be.U32(r, 15);
                if (more > 1) { run.Incomplete = "moreData is not a TPMI_YES_NO"; return run; }
                if (cap != spec.Cap) { run.Incomplete = "capability selector mismatch"; return run; }
                if (count > PageCount) { run.Incomplete = "count exceeds requested propertyCount"; return run; }
                long expected = 19L + (long)count * spec.ItemSize;
                if (r.Length != expected) { run.Incomplete = "capability list length inconsistent with count"; return run; }
                uint last = 0; bool any = false;
                for (int i = 0; i < count; i++)
                {
                    int o = 19 + i * spec.ItemSize;
                    uint key;
                    if (spec.ItemSize == 2 || spec.ItemSize == 6) key = Be.U16(r, o); else key = Be.U32(r, o);
                    if (spec.Cap == TpmGuard.TPM_CAP_COMMANDS) key = key & 0x2000FFFF; // commandIndex + V
                    if (any && key <= last) { run.Incomplete = "items not strictly increasing"; return run; }
                    if (key < property && !(spec.Cap == TpmGuard.TPM_CAP_COMMANDS)) { run.Incomplete = "item precedes requested property"; return run; }
                    last = key; any = true;
                    if (collectHandles != null)
                    {
                        if (!TpmGuard.IsNvIndexHandle(key)) { more = 0; break; } // خرجَ من مجالِ NV ⇒ انتهى المجال
                        collectHandles.Add(key);
                    }
                }
                if (more == 0) { run.Complete = true; return run; }
                if (!any) { run.Incomplete = "moreData=YES with an empty page"; return run; }
                if (last == 0xFFFFFFFF) { run.Incomplete = "cannot advance past 0xFFFFFFFF"; return run; }
                uint next = last + 1;
                if (spec.Cap == TpmGuard.TPM_CAP_HANDLES && !TpmGuard.IsNvIndexHandle(next)) { run.Complete = true; return run; }
                if (next <= property) { run.Incomplete = "continuation did not advance"; return run; }
                property = next;
            }
            run.Incomplete = "page limit reached (" + MaxPages.ToString() + ")";
            return run;
        }

        public static byte[] FromHex(string h)
        {
            if (h == null) return new byte[0];
            byte[] b = new byte[h.Length / 2];
            for (int i = 0; i < b.Length; i++) b[i] = Convert.ToByte(h.Substring(i * 2, 2), 16);
            return b;
        }
    }
}
