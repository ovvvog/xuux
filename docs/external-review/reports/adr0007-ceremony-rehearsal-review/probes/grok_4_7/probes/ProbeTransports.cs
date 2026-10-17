using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Xuux.TpmCeremony;

namespace Xuux.TpmCeremony.Probes
{
    public sealed class ScriptedTransport : ICeremonyTransport
    {
        private readonly ICeremonyTransport _inner;
        private readonly string _mode;
        public readonly List<string> Seen = new List<string>();
        public int Scripted;

        public ScriptedTransport(ICeremonyTransport inner, string mode)
        {
            _inner = inner;
            _mode = mode;
        }

        public string Kind { get { return "probe:" + _mode; } }

        private static uint Cc(byte[] command)
        {
            return ((uint)command[6] << 24) | ((uint)command[7] << 16) | ((uint)command[8] << 8) | command[9];
        }

        private static byte[] RcOnly(uint rc)
        {
            return new Wr().U16(Tpm.ST_NO_SESSIONS).U32(10).U32(rc).Bytes();
        }

        private static byte[] IdentityOk()
        {
            // manufacturer IBM, vendor "SW   TPM", string3 = "EVIL", string4 = "XXXX" — to see if 3/4 are ignored.
            Wr p = new Wr().U8(0).U32(6).U32(5)
                .U32(0x105).U32(0x49424D00)
                .U32(0x106).U32(0x53572020)
                .U32(0x107).U32(0x2054504D)
                .U32(0x108).U32(0x4556494C)
                .U32(0x109).U32(0x58585858);
            byte[] body = p.Bytes();
            return new Wr().U16(Tpm.ST_NO_SESSIONS).U32((uint)(10 + body.Length)).U32(0).Raw(body).Bytes();
        }

        public byte[] Transmit(byte[] command)
        {
            uint cc = Cc(command);
            Seen.Add(Hex.U32(cc));
            if (_mode == "truncate-header" && Seen.Count == 1)
            {
                Scripted++;
                return new byte[] { 0x80, 0x01, 0x00 };
            }
            if (_mode == "size-mismatch" && Seen.Count == 1)
            {
                Scripted++;
                return new byte[] { 0x80, 0x01, 0x00, 0x00, 0x00, 20, 0x00, 0x00, 0x00, 0x00 };
            }
            if (_mode == "unexpected-rc" && cc == Tpm.CC_NV_DefineSpace)
            {
                Scripted++;
                return RcOnly(0x00000101);
            }
            if (_mode == "windows-family" && cc == Tpm.CC_NV_DefineSpace)
            {
                Scripted++;
                return RcOnly(0x8028012F);
            }
            if (_mode == "blocked-forever-undefine" && cc == Tpm.CC_NV_UndefineSpace)
            {
                Scripted++;
                return RcOnly(Tpm.TPM_E_COMMAND_BLOCKED);
            }
            if (_mode == "blocked-on-expected-failure" && cc == Tpm.CC_NV_Read)
            {
                Scripted++;
                return RcOnly(Tpm.TPM_E_COMMAND_BLOCKED);
            }
            if (_mode == "negative-unexpected-success" && cc == Tpm.CC_NV_Read)
            {
                Scripted++;
                byte[] data = new byte[] { 0, 0, 0, 0, 0, 0, 0, 1 };
                byte[] param = new Wr().B2B(data).Bytes();
                return new Wr().U16(Tpm.ST_NO_SESSIONS).U32((uint)(10 + param.Length)).U32(0).Raw(param).Bytes();
            }
            if (_mode == "drop-after-identity" && Seen.Count > 1)
            {
                Scripted++;
                throw new CeremonyFailedException("SIMULATOR_CONNECTION_CLOSED", 0);
            }
            if (_mode == "io-throw" && cc == Tpm.CC_NV_DefineSpace)
            {
                Scripted++;
                throw new IOException("probe write failed");
            }
            if (_mode == "identity-ignores-string34" && cc == Tpm.CC_GetCapability && Seen.Count == 1)
            {
                Scripted++;
                return IdentityOk();
            }
            if (_mode == "vendor-space-fold" && cc == Tpm.CC_GetCapability && Seen.Count == 1)
            {
                Scripted++;
                // "S W T" + "PM  " folds to SWTPM if spaces are stripped.
                Wr p = new Wr().U8(0).U32(6).U32(5)
                    .U32(0x105).U32(0x49424D00)
                    .U32(0x106).U32(0x53205720)
                    .U32(0x107).U32(0x5420504D)
                    .U32(0x108).U32(0).U32(0x109).U32(0);
                byte[] body = p.Bytes();
                return new Wr().U16(Tpm.ST_NO_SESSIONS).U32((uint)(10 + body.Length)).U32(0).Raw(body).Bytes();
            }
            if (_inner == null) throw new CeremonyFailedException("PROBE_NO_INNER", 0);
            return _inner.Transmit(command);
        }
    }
}
