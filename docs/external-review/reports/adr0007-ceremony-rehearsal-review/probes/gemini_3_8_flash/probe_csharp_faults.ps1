# probe_csharp_faults.ps1 - Extra fault injection against TpmCeremonyCore
$ErrorActionPreference = 'Stop'
$core = '/home/user/workspace/xuux-review-50518cf6/sim/tpm-ceremony/TpmCeremonyCore.cs'
Add-Type -Path $core -IgnoreWarnings

# Define a custom faulty transport in C# via inline type
$faultCode = @"
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
"@
Add-Type -TypeDefinition $faultCode -ReferencedAssemblies (Join-Path ([System.IO.Path]::GetDirectoryName([object].Assembly.Location)) "System.dll") -IgnoreWarnings

# Test 1: Malformed header
$t1 = New-Object Xuux.TpmCeremony.Probes.MalformedHeaderTransport
$r1 = (New-Object Xuux.TpmCeremony.CeremonyRehearsal($t1)).Run("ALL")
Write-Output "Test 1 (truncated header): status=$($r1.Status), failure=$($r1.Failure)"

# Test 2: Size mismatch
$t2 = New-Object Xuux.TpmCeremony.Probes.SizeMismatchTransport
$r2 = (New-Object Xuux.TpmCeremony.CeremonyRehearsal($t2)).Run("ALL")
Write-Output "Test 2 (size mismatch): status=$($r2.Status), failure=$($r2.Failure)"

# Test 3: TBS blocked on initial command
$t3 = New-Object Xuux.TpmCeremony.Probes.TbsBlockedTransport
$r3 = (New-Object Xuux.TpmCeremony.CeremonyRehearsal($t3)).Run("ALL")
Write-Output "Test 3 (tbs blocked): status=$($r3.Status), failure=$($r3.Failure)"

