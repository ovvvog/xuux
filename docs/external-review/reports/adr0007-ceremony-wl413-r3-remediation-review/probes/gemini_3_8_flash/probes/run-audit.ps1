# run-audit.ps1
param(
  [string]$SimHost = '127.0.0.1',
  [int]$SimPort = 5700,
  [string]$Probe
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$root = '/home/user/workspace/xuux-review-de099aa8'
$core = Join-Path $root 'sim/tpm-ceremony/TpmCeremonyCore.cs'
$probeSource = '/home/user/workspace/council-wl413-r3/gemini_3_8_flash/probes/AuditProbes.cs'

Add-Type -Path @($core, $probeSource) -IgnoreWarnings

$inner = New-Object Xuux.TpmCeremony.SwtpmLoopbackTransport($SimHost, $SimPort)
try {
  $t = New-Object Xuux.TpmCeremony.Audit.AuditProbeTransport($inner, $Probe)
  $rehearsal = New-Object Xuux.TpmCeremony.CeremonyRehearsal($t)
  $r = $rehearsal.Run('ALL')
  $res = [ordered]@{
    probe = $Probe
    changes = $t.Changes
    status = $r.Status
    failure = $r.Failure
    report = ($r.ToJson() | ConvertFrom-Json)
  }
  [Console]::Out.WriteLine(($res | ConvertTo-Json -Depth 6 -Compress))
} finally {
  $inner.Dispose()
}
