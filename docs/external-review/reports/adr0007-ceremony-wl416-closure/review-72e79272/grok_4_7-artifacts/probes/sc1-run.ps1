# Independent SC1 witness runner. Core and helper paths are arguments; does not edit the review tree.
param(
  [Parameter(Mandatory = $true)][string]$Core,
  [Parameter(Mandatory = $true)][string]$Helper,
  [Parameter(Mandatory = $true)][int]$Port
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
Add-Type -Path @($Core, $Helper) -IgnoreWarnings
$inner = New-Object Xuux.TpmCeremony.SwtpmLoopbackTransport('127.0.0.1', $Port)
try {
  $t = New-Object Xuux.TpmCeremony.Tests.CeremonyFaultTransport($inner, 'consumed-session-witness')
  $r = (New-Object Xuux.TpmCeremony.CeremonyRehearsal($t)).Run('ALL')
  $obj = $r.ToJson() | ConvertFrom-Json
  $fact = $null
  if ($obj.facts.PSObject.Properties.Name -contains 'ctx.endOfLife.sessionConsumed') {
    $fact = [string]$obj.facts.'ctx.endOfLife.sessionConsumed'
  }
  $summary = [ordered]@{
    status = [string]$obj.status
    failure = [string]$obj.failure
    changes = $t.Changes
    witnessSession = ('0x{0:x8}' -f $t.WitnessSession)
    witnessPresentBefore = [bool]$t.WitnessPresentBefore
    witnessPresentAfter = [bool]$t.WitnessPresentAfter
    fact = $fact
    knowsDerived = $(if ($fact -match 'contextGone=(True|False)') { $Matches[1] } else { $null })
  }
  [Console]::Out.WriteLine(($summary | ConvertTo-Json -Compress))
} finally {
  $inner.Dispose()
}
