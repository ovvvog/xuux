#Requires -Version 5.1
# tests/helpers/tpm-host-sim-harness.ps1
#
# حزامُ اختبارٍ (WL-410) — يُشغِّلُ نواةَ أداةِ المضيفِ نفسَها (sim/tpm-host/TpmInventoryCore.cs)
# بلا TBS:
#   -Mode guard     : أوامرُ ممنوعةٌ عبرَ RecordingTransport ⇒ كلُّها تُرفَضُ ولا يبلغُ النقلَ شيء.
#   -Mode inventory : Inventory.Collect على swtpm (loopback فقط) ⇒ JSON بالمُسلسِلِ نفسِه.
# يُستدعى من tests/sim/tpm-host-*.test.mjs فقط، بعدَ assertSimulatorTcti في جهةِ Node.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('guard', 'inventory')][string]$Mode,
  [string]$SimHost = '127.0.0.1',
  [int]$SimPort = 2321,
  [string]$CasesFile
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Add-Type -Path @((Join-Path $root 'sim/tpm-host/TpmInventoryCore.cs'), (Join-Path $PSScriptRoot 'TpmHostSimTransport.cs')) -IgnoreWarnings

function HexToBytes([string]$h) {
  $b = New-Object byte[] ($h.Length / 2)
  for ($i = 0; $i -lt $b.Length; $i++) { $b[$i] = [Convert]::ToByte($h.Substring($i * 2, 2), 16) }
  return , $b
}

if ($Mode -eq 'guard') {
  if (-not $CasesFile) { throw 'guard mode requires -CasesFile' }
  # الحالاتُ يبنيها اختبارُ Node (كلُّ أمرٍ في المجالِ وأشكالٌ تالفة) — مصفوفةُ {name, hex}.
  $cases = Get-Content -Raw -LiteralPath $CasesFile | ConvertFrom-Json
  $rec = New-Object Xuux.TpmHost.Tests.RecordingTransport
  $out = @()
  foreach ($c in $cases) {
    $k = [string]$c.name
    $bytes = HexToBytes ([string]$c.hex)
    $rejected = $false; $msg = $null
    try { [void]$rec.Submit($bytes) } catch { $rejected = $true; $msg = $_.Exception.InnerException.Message; if (-not $msg) { $msg = $_.Exception.Message } }
    $out += [ordered]@{ name = $k; rejected = $rejected; message = $msg }
  }
  # الشكلانِ المسموحانِ يبلغانِ النقلَ — دليلُ أنّ الحارسَ ليس رفضاً شاملاً.
  [void]$rec.Submit([Xuux.TpmHost.TpmCommands]::GetCapability(6, 0x100, 64))
  [void]$rec.Submit([Xuux.TpmHost.TpmCommands]::NvReadPublic(0x01500016))
  $res = [ordered]@{
    cases = $out
    reached = @($rec.Reached)
    submittedCount = $rec.SubmittedCount
    allowedCommandCodes = @([Xuux.TpmHost.TpmGuard]::AllowedCommandCodes() | ForEach-Object { '0x{0:x8}' -f $_ })
  }
  [Console]::Out.WriteLine(($res | ConvertTo-Json -Depth 6 -Compress))
  exit 0
}

$t = New-Object Xuux.TpmHost.Tests.SwtpmTcpTransport($SimHost, $SimPort)
try {
  $inv = [Xuux.TpmHost.Inventory]::Collect($t)
  [Console]::Out.WriteLine([Xuux.TpmHost.InventoryJson]::Serialize($inv))
} finally { $t.Dispose() }
exit 0
