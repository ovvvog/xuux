using System;
using Xuux.TpmCeremony;

namespace Xuux.TpmCeremony.Probes
{
    public sealed class MalformedHeaderTransport : ICeremonyTransport
    {
        public string Kind { get { return "fault:malformed-header"; } }
        public byte[] Transmit(byte[] command)
        {
            // Return truncated header of only 6 bytes
            return new byte[] { 0x80, 0x01, 0x00, 0x00, 0x00, 0x06 };
        }
    }

    public sealed class SizeMismatchTransport : ICeremonyTransport
    {
        public string Kind { get { return "fault:size-mismatch"; } }
        public byte[] Transmit(byte[] command)
        {
            // Declared size 14, but returned length 10
            return new byte[] { 0x80, 0x01, 0x00, 0x00, 0x00, 0x0e, 0x00, 0x00, 0x00, 0x00 };
        }
    }

    public sealed class TbsBlockedTransport : ICeremonyTransport
    {
        public string Kind { get { return "fault:tbs-blocked"; } }
        public byte[] Transmit(byte[] command)
        {
            // Return TPM_E_COMMAND_BLOCKED (0x80280400)
            return new byte[] { 0x80, 0x01, 0x00, 0x00, 0x00, 0x0a, 0x80, 0x28, 0x04, 0x00 };
        }
    }
}
