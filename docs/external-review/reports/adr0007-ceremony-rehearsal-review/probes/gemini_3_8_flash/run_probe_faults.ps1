$ErrorActionPreference = 'Stop'
$core = '/home/user/workspace/xuux-review-50518cf6/sim/tpm-ceremony/TpmCeremonyCore.cs'
$probeHelper = '/home/user/workspace/council-ceremony/gemini_3_8_flash/ProbeFaultTransports.cs'
Add-Type -Path @($core, $probeHelper) -IgnoreWarnings

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
