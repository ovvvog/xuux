// ProbeWl413.cs
// Independent test probes by reviewer gemini_3_8_flash for WL-413 review
// Compiled and executed in /home/user/workspace/council-wl413/gemini_3_8_flash/

using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using Xuux.TpmCeremony;

namespace Xuux.TpmCeremony.Probes
{
    // Probe transport wrapping an underlying ICeremonyTransport to inject targeted faults
    public sealed class GeminiFaultTransport : ICeremonyTransport
    {
        private readonly ICeremonyTransport _inner;
        private readonly string _scenario;
        public int CallCount;
        public uint LastCommandCode;
        public byte[] CapturedPublic;
        public uint CapturedHandle;
        public bool Triggered;

        public GeminiFaultTransport(ICeremonyTransport inner, string scenario)
        {
            _inner = inner;
            _scenario = scenario;
        }

        public string Kind { get { return "gemini-probe:" + _scenario; } }

        private static uint GetCc(byte[] cmd)
        {
            return ((uint)cmd[6] << 24) | ((uint)cmd[7] << 16) | ((uint)cmd[8] << 8) | cmd[9];
        }

        public byte[] Transmit(byte[] command)
        {
            CallCount++;
            uint cc = GetCc(command);
            LastCommandCode = cc;

            // Scenario 1: SOL-01 - Corrupted tag on first command (identity)
            if (_scenario == "sol01-invalid-tag" && cc == Tpm.CC_GetCapability)
            {
                byte[] raw = _inner.Transmit(command);
                raw[0] = 0x99; raw[1] = 0x88; // Invalid tag
                Triggered = true;
                return raw;
            }

            // Scenario 2: SOL-01 - Missing response auth area on ST_SESSIONS response
            if (_scenario == "sol01-missing-auth" && cc == Tpm.CC_CreatePrimary)
            {
                byte[] raw = _inner.Transmit(command);
                // Strip response auth area: keep header (10) + handle (4) + parameterSize (4) + params
                Rd r = new Rd(raw); r.Raw(14);
                uint ps = r.U32();
                int keep = 10 + 4 + 4 + (int)ps;
                byte[] truncated = new byte[keep];
                Buffer.BlockCopy(raw, 0, truncated, 0, keep);
                byte[] szBytes = new Wr().U32((uint)keep).Bytes();
                Buffer.BlockCopy(szBytes, 0, truncated, 2, 4);
                Triggered = true;
                return truncated;
            }

            // Scenario 3: SOL-02 - Lost response after NV_DefineSpace execution
            if (_scenario == "sol02-lost-define-executed" && cc == Tpm.CC_NV_DefineSpace && !Triggered)
            {
                Rd c = new Rd(command); c.U16(); c.U32(); c.U32(); c.U32();
                uint authSize = c.U32(); c.Raw((int)authSize); c.B2B();
                CapturedPublic = c.B2B();
                CapturedHandle = new Rd(CapturedPublic).U32();
                // Send to simulator to actually execute
                _inner.Transmit(command);
                Triggered = true;
                throw new IOException("SIMULATED_LOST_RESPONSE_AFTER_DEFINE");
            }

            // Scenario 4: SOL-02 - Lost response before NV_DefineSpace execution
            if (_scenario == "sol02-lost-define-not-executed" && cc == Tpm.CC_NV_DefineSpace && !Triggered)
            {
                Triggered = true;
                throw new IOException("SIMULATED_DROPPED_BEFORE_DEFINE_EXECUTION");
            }

            // Scenario 5: SOL-03 - FlushContext refusal
            if (_scenario == "sol03-flush-refusal" && cc == Tpm.CC_FlushContext)
            {
                Triggered = true;
                // Return TBS blocked or custom error
                return new byte[] { 0x80, 0x01, 0x00, 0x00, 0x00, 0x0A, 0x80, 0x28, 0x04, 0x00 };
            }

            // Scenario 6: SOL-04 - Generic error code (0x101) instead of specific expected RC
            if (_scenario == "sol04-generic-rc" && cc == Tpm.CC_PolicySigned && CallCount >= 10)
            {
                Triggered = true;
                // Return 0x101 (TPM_RC_FAILURE)
                return new byte[] { 0x80, 0x01, 0x00, 0x00, 0x00, 0x0A, 0x00, 0x00, 0x01, 0x01 };
            }

            // Scenario 7: G47-1 - Space folding in vendor string
            if (_scenario == "g47-1-spacefold" && cc == Tpm.CC_GetCapability && CallCount == 1)
            {
                Triggered = true;
                Wr p = new Wr().U8(0).U32(6).U32(5)
                    .U32(0x105).U32(0x49424D00)
                    .U32(0x106).U32(0x53205720)   // "S W "
                    .U32(0x107).U32(0x5420504D)   // "T PM"
                    .U32(0x108).U32(0).U32(0x109).U32(0);
                byte[] body = p.Bytes();
                return new Wr().U16(Tpm.ST_NO_SESSIONS).U32((uint)(10 + body.Length)).U32(0).Raw(body).Bytes();
            }

            // Scenario 8: G47-1 - Extra vendor strings
            if (_scenario == "g47-1-extra-vendor" && cc == Tpm.CC_GetCapability && CallCount == 1)
            {
                Triggered = true;
                Wr p = new Wr().U8(0).U32(6).U32(5)
                    .U32(0x105).U32(0x49424D00)
                    .U32(0x106).U32(0x53572020)
                    .U32(0x107).U32(0x2054504D)
                    .U32(0x108).U32(0x4556494C)   // "EVIL"
                    .U32(0x109).U32(0x58585858);  // "XXXX"
                byte[] body = p.Bytes();
                return new Wr().U16(Tpm.ST_NO_SESSIONS).U32((uint)(10 + body.Length)).U32(0).Raw(body).Bytes();
            }

            // Scenario 9: G47-2 - Persistent undefine blocking
            if (_scenario == "g47-2-persistent-undefine-block" && cc == Tpm.CC_NV_UndefineSpace)
            {
                Triggered = true;
                return new byte[] { 0x80, 0x01, 0x00, 0x00, 0x00, 0x0A, 0x80, 0x28, 0x04, 0x00 };
            }

            // Scenario 10: R2-01 - Third-party write after define response lost
            if (_scenario == "r2-01-third-party-write" && cc == Tpm.CC_NV_DefineSpace && !Triggered)
            {
                Rd c = new Rd(command); c.U16(); c.U32(); c.U32(); c.U32();
                uint authSize = c.U32(); c.Raw((int)authSize); c.B2B();
                CapturedPublic = c.B2B();
                CapturedHandle = new Rd(CapturedPublic).U32();
                _inner.Transmit(command); // Defined on TPM!
                // Third party writes to the counter (NV_Increment with empty auth)
                byte[] incCmd = Cmd.NvIncrement(CapturedHandle, Cmd.PasswordAuth(new byte[0]));
                _inner.Transmit(incCmd);
                Triggered = true;
                throw new IOException("SIMULATED_LOST_DEFINE_AND_THIRD_PARTY_WRITE");
            }

            // Scenario 11: R2-02 - Negative increment response lost
            if (_scenario == "r2-02-negative-inc-loss" && cc == Tpm.CC_NV_Increment)
            {
                // In S2Validation, the 4th increment is s2v:NV_Increment(password-auth) which fails
                if (CallCount >= 20)
                {
                    _inner.Transmit(command);
                    Triggered = true;
                    throw new IOException("SIMULATED_LOST_NEGATIVE_INCREMENT_RESPONSE");
                }
            }

            // Scenario 12: R2-03 - Trailing bytes in parameters
            if (_scenario == "r2-03-trailing-readpublic" && cc == Tpm.CC_NV_ReadPublic)
            {
                byte[] raw = _inner.Transmit(command);
                Rd h = new Rd(raw); h.U16(); h.U32(); uint rc = h.U32();
                if (rc == 0)
                {
                    byte[] extra = new byte[] { 0xCA, 0xFE, 0xBA, 0xBE };
                    byte[] appended = new byte[raw.Length + extra.Length];
                    Buffer.BlockCopy(raw, 0, appended, 0, raw.Length);
                    Buffer.BlockCopy(extra, 0, appended, raw.Length, extra.Length);
                    byte[] sz = new Wr().U32((uint)appended.Length).Bytes();
                    Buffer.BlockCopy(sz, 0, appended, 2, 4);
                    Triggered = true;
                    return appended;
                }
                return raw;
            }

            // Scenario 13: R2-03 - Bad signature algorithm in Sign response
            if (_scenario == "r2-03-bad-sig-alg" && cc == Tpm.CC_Sign)
            {
                byte[] raw = _inner.Transmit(command);
                // Corrupt signature alg: replace ALG_ECDSA (0x0018) with ALG_RSASSA (0x0014)
                // Locate parameters in ST_SESSIONS response:
                Rd r = new Rd(raw); r.Raw(10); // header
                uint ps = r.U32();
                raw[14] = 0x00; raw[15] = 0x14; // replace alg at start of params
                Triggered = true;
                return raw;
            }

            return _inner.Transmit(command);
        }
    }

    public static class ProbeRunner
    {
        public static string RunScenario(string host, int port, string scenario, string stages)
        {
            using (SwtpmLoopbackTransport baseTransport = new SwtpmLoopbackTransport(host, port))
            {
                GeminiFaultTransport faultTransport = new GeminiFaultTransport(baseTransport, scenario);
                CeremonyRehearsal rehearsal = new CeremonyRehearsal(faultTransport);
                CeremonyReport report = rehearsal.Run(stages);
                return report.ToJson();
            }
        }
    }
}
