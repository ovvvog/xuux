#Requires -Version 5.1
# tests/helpers/tpm-ceremony-harness.ps1
#
# حزامُ اختبارٍ (WL-412) لنواةِ البروفة sim/tpm-ceremony/TpmCeremonyCore.cs:
#   -Mode inject-blocked  : البروفةُ على swtpm عبرَ BlockingTransport (‏-BlockCc/-Nth) ⇒ تقريرٌ + ما مُرِّر.
#   -Mode foreign-identity: البروفةُ على نقلٍ يدّعي مصنّعاً غيرَ المحاكي ⇒ يجبُ ألّا يُرسَلَ إلا استعلامُ الهويّة.
#   -Mode host-guard      : أوامرُ المراسمِ بالمنشئِ نفسِه تُعرَضُ على حارسِ أداةِ المضيف (TpmGuard) عبرَ
#                           RecordingTransport ⇒ كلُّها تُرفَضُ ولا يبلغُ النقلَ شيء.
# يُستدعى من tests/sim/tpm-ceremony-*.test.mjs فقط، بعدَ assertSimulatorTcti في جهةِ Node.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('inject-blocked', 'foreign-identity', 'host-guard')][string]$Mode,
  [ValidateSet('127.0.0.1', '::1')][string]$SimHost = '127.0.0.1',
  [int]$SimPort = 2321,
  [string]$BlockCc,
  [int]$Nth = 1,
  [string]$Stages = 'ALL'
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$core = Join-Path $root 'sim/tpm-ceremony/TpmCeremonyCore.cs'
$helper = Join-Path $PSScriptRoot 'TpmCeremonyFaultTransport.cs'

if ($Mode -eq 'host-guard') {
  Add-Type -Path @($core, $helper, (Join-Path $root 'sim/tpm-host/TpmInventoryCore.cs'), (Join-Path $PSScriptRoot 'TpmHostSimTransport.cs')) -IgnoreWarnings
  $rec = New-Object Xuux.TpmHost.Tests.RecordingTransport
  $out = @()
  foreach ($kv in [Xuux.TpmCeremony.Tests.CommandEmitter]::All()) {
    $hex = $kv.Value
    $b = New-Object byte[] ($hex.Length / 2)
    for ($i = 0; $i -lt $b.Length; $i++) { $b[$i] = [Convert]::ToByte($hex.Substring($i * 2, 2), 16) }
    $rejected = $false; $msg = $null
    try { [void]$rec.Submit($b) } catch { $rejected = $true; $msg = $_.Exception.InnerException.Message; if (-not $msg) { $msg = $_.Exception.Message } }
    $out += [ordered]@{ name = $kv.Key; commandCode = ('0x' + $hex.Substring(12, 8)); rejected = $rejected; message = $msg }
  }
  $res = [ordered]@{ cases = $out; reached = @($rec.Reached); submittedCount = $rec.SubmittedCount }
  [Console]::Out.WriteLine(($res | ConvertTo-Json -Depth 6 -Compress))
  exit 0
}

Add-Type -Path @($core, $helper) -IgnoreWarnings

if ($Mode -eq 'foreign-identity') {
  $t = New-Object Xuux.TpmCeremony.Tests.ForeignIdentityTransport
  $r = (New-Object Xuux.TpmCeremony.CeremonyRehearsal($t)).Run($Stages)
  $res = [ordered]@{ report = ($r.ToJson() | ConvertFrom-Json); received = @($t.Received) }
  [Console]::Out.WriteLine(($res | ConvertTo-Json -Depth 8 -Compress))
  exit 0
}

if (-not $BlockCc) { throw 'inject-blocked requires -BlockCc' }
$inner = New-Object Xuux.TpmCeremony.SwtpmLoopbackTransport($SimHost, $SimPort)
try {
  $t = New-Object Xuux.TpmCeremony.Tests.BlockingTransport($inner, [Convert]::ToUInt32($BlockCc, 16), $Nth)
  $r = (New-Object Xuux.TpmCeremony.CeremonyRehearsal($t)).Run($Stages)
  $res = [ordered]@{ report = ($r.ToJson() | ConvertFrom-Json); forwarded = @($t.Forwarded); blockedCount = $t.BlockedCount }
  [Console]::Out.WriteLine(($res | ConvertTo-Json -Depth 8 -Compress))
} finally { $inner.Dispose() }
exit 0
