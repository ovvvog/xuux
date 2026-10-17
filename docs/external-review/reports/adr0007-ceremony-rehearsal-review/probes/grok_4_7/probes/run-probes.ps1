#Requires -Version 5.1
param(
  [Parameter(Mandatory = $true)][int]$SimPort
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$root = '/home/user/workspace/xuux-review-50518cf6'
$core = Join-Path $root 'sim/tpm-ceremony/TpmCeremonyCore.cs'
$probe = '/home/user/workspace/council-ceremony/grok_4_7/probes/ProbeTransports.cs'
Add-Type -Path @($core, $probe) -IgnoreWarnings

function Run-Mode([string]$mode, [string]$stages, [switch]$NoInner) {
  $inner = $null
  if (-not $NoInner) {
    $inner = New-Object Xuux.TpmCeremony.SwtpmLoopbackTransport('127.0.0.1', $SimPort)
  }
  try {
    $t = New-Object Xuux.TpmCeremony.Probes.ScriptedTransport($inner, $mode)
    $r = (New-Object Xuux.TpmCeremony.CeremonyRehearsal($t)).Run($stages)
    $obj = $r.ToJson() | ConvertFrom-Json
    $after = @()
    $blockedAt = -1
    for ($i = 0; $i -lt $obj.steps.Count; $i++) {
      if ($obj.steps[$i].outcome -eq 'blocked' -and $blockedAt -lt 0) { $blockedAt = $i }
    }
    if ($blockedAt -ge 0) { $after = @($obj.steps[($blockedAt + 1)..($obj.steps.Count - 1)]) }
    [ordered]@{
      mode = $mode
      status = $obj.status
      failure = $obj.failure
      leftovers = @($obj.cleanupLeftovers)
      scripted = $t.Scripted
      seen = @($t.Seen)
      stepCount = $obj.steps.Count
      outcomes = @($obj.steps | ForEach-Object { $_.outcome })
      lastSteps = @($obj.steps | Select-Object -Last 6 | ForEach-Object { $_.stage + ' ' + $_.name + ' ' + $_.outcome + ' ' + $_.responseCode })
      afterBlockStages = @($after | ForEach-Object { $_.stage })
      afterBlockCodes = @($after | ForEach-Object { $_.commandCode })
      factsManufacturer = $(if ($null -ne $obj.facts -and $obj.facts.PSObject.Properties['tpm.manufacturer']) { $obj.facts.PSObject.Properties['tpm.manufacturer'].Value } else { $null })
      factsVendor = $(if ($null -ne $obj.facts -and $obj.facts.PSObject.Properties['tpm.vendorString']) { $obj.facts.PSObject.Properties['tpm.vendorString'].Value } else { $null })
    }
  } finally {
    if ($null -ne $inner) { $inner.Dispose() }
  }
}

$modes = @(
  @{ m = 'truncate-header'; s = 'S1'; n = $true },
  @{ m = 'size-mismatch'; s = 'S1'; n = $true },
  @{ m = 'unexpected-rc'; s = 'S1'; n = $false },
  @{ m = 'windows-family'; s = 'S1'; n = $false },
  @{ m = 'blocked-forever-undefine'; s = 'S1'; n = $false },
  @{ m = 'blocked-on-expected-failure'; s = 'S1'; n = $false },
  @{ m = 'negative-unexpected-success'; s = 'S1'; n = $false },
  @{ m = 'drop-after-identity'; s = 'S1'; n = $false },
  @{ m = 'io-throw'; s = 'S1'; n = $false },
  @{ m = 'identity-ignores-string34'; s = 'S1'; n = $false },
  @{ m = 'vendor-space-fold'; s = 'S1'; n = $false }
)
$out = @()
foreach ($x in $modes) {
  try {
    if ($x.n) { $out += Run-Mode -mode $x.m -stages $x.s -NoInner }
    else { $out += Run-Mode -mode $x.m -stages $x.s }
  } catch {
    $out += [ordered]@{ mode = $x.m; status = 'PROBE_EXCEPTION'; failure = $_.Exception.Message }
  }
}
$out | ConvertTo-Json -Depth 8 -Compress
