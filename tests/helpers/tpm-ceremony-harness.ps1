#Requires -Version 5.1
# tests/helpers/tpm-ceremony-harness.ps1
#
# حزامُ اختبارٍ (WL-412؛ WL-413) لنواةِ البروفة sim/tpm-ceremony/TpmCeremonyCore.cs:
#   -Mode inject-blocked  : البروفةُ على swtpm عبرَ BlockingTransport (‏-BlockCc/-Nth، و-BlockAll للحجبِ الدائم)
#                           ⇒ تقريرٌ + ما مُرِّر.
#   -Mode foreign-identity: البروفةُ على نقلٍ يدّعي مصنّعاً غيرَ المحاكي ⇒ يجبُ ألّا يُرسَلَ إلا استعلامُ الهويّة.
#   -Mode fault          : مسابرُ WL-413 (‏-Fault): تشويهُ ردودٍ، فقدُ ردِّ تعريفٍ بعدَ/قبلَ التنفيذ، رفضُ تحريرٍ،
#                          رمزٌ عامٌّ مكانَ رفضٍ سلبيٍّ، حجبُ حذفٍ دائم، وهوياتُ محاكٍ محرَّفة — مع جردِ
#                          المواردِ قبلَ التشغيلِ وبعدَهُ (فهارسُ NV والجلساتُ) لإثباتِ البقايا على المحاكي.
#   -Mode policysigned-shapes: (WL-414 FUP-SOL-01/05) PolicySigned حقيقيٌّ على swtpm لكلِّ (سياسة/تجربة × expiration
#                          0/3600/-3600) وحكمُ ResponseSchema.Check على الردِّ غيرِ المشوَّه — حالاتٌ إيجابيّة.
#   -Mode host-guard     : أوامرُ المراسمِ بالمنشئِ نفسِه تُعرَضُ على حارسِ أداةِ المضيف (TpmGuard) عبرَ
#                           RecordingTransport ⇒ أوامرُ التغييرِ تُرفَضُ، واستعلاما الجرد يبلغان النقل.
# يُستدعى من tests/sim/tpm-ceremony-*.test.mjs فقط، بعدَ assertSimulatorTcti في جهةِ Node.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('inject-blocked', 'foreign-identity', 'fault', 'host-guard', 'policysigned-shapes', 'ctx-lifetime')][string]$Mode,
  [ValidateSet('127.0.0.1', '::1')][string]$SimHost = '127.0.0.1',
  [int]$SimPort = 2321,
  [string]$BlockCc,
  [int]$Nth = 1,
  [switch]$BlockAll,
  [string]$Fault,
  [string]$Stages = 'ALL'
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$core = Join-Path $root 'sim/tpm-ceremony/TpmCeremonyCore.cs'
$helper = Join-Path $PSScriptRoot 'TpmCeremonyFaultTransport.cs'

function Get-HandleList {
  param([Xuux.TpmCeremony.ICeremonyTransport]$Transport, [uint32]$Start)
  $p = [Xuux.TpmCeremony.Resp]::Parse($Transport.Transmit([Xuux.TpmCeremony.Cmd]::GetCapability(1, $Start, 64)), 0, 0x8001, 0, [bool[]]@())
  $r = New-Object Xuux.TpmCeremony.Rd -ArgumentList (,$p.Params)
  [void]$r.U8(); [void]$r.U32(); $count = $r.U32()
  $hs = @()
  for ($i = 0; $i -lt $count; $i++) { $hs += ('0x{0:x8}' -f $r.U32()) }
  return ,@($hs)
}

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

if ($Mode -eq 'policysigned-shapes') {
  $inner = New-Object Xuux.TpmCeremony.SwtpmLoopbackTransport($SimHost, $SimPort)
  try {
    $lines = [Xuux.TpmCeremony.Tests.PolicySignedShapes]::Run($inner)
    [Console]::Out.WriteLine((@{ shapes = @($lines) } | ConvertTo-Json -Depth 4 -Compress))
  } finally { $inner.Dispose() }
  exit 0
}

# WL-416: قياسُ دورةِ حياةِ سياقِ الردّ (ResponseContext) على swtpm حقيقيّ — حالاتُ فقدِ ردِّ التحريرِ
# وإثباتِ الغيابِ وإعادةِ الاستخدامِ واستهلاكِ جلسةِ السياسةِ (انظر ContextLifetimeProbe).
if ($Mode -eq 'ctx-lifetime') {
  $inner = New-Object Xuux.TpmCeremony.SwtpmLoopbackTransport($SimHost, $SimPort)
  try {
    $lines = [Xuux.TpmCeremony.Tests.ContextLifetimeProbe]::Run($inner)
    [Console]::Out.WriteLine((@{ cases = @($lines) } | ConvertTo-Json -Depth 4 -Compress))
  } finally { $inner.Dispose() }
  exit 0
}

if ($Mode -eq 'fault') {
  if (-not $Fault) { throw 'fault mode requires -Fault' }
  $inner = New-Object Xuux.TpmCeremony.SwtpmLoopbackTransport($SimHost, $SimPort)
  try {
    $nvBefore = Get-HandleList -Transport $inner -Start 0x01000000
    $sessionsBefore = Get-HandleList -Transport $inner -Start 0x02000000
    # session-alias (WL-413 R3 / SOL413-01): جلسةُ فخٍّ قبلَ البروفةِ لتكونَ في خطِّ الأساسِ.
    if ($Fault -eq 'session-alias') {
      $t = New-Object Xuux.TpmCeremony.Tests.CeremonyFaultTransport($inner, $Fault, $true)
    } else {
      $t = New-Object Xuux.TpmCeremony.Tests.CeremonyFaultTransport($inner, $Fault)
    }
    $r = (New-Object Xuux.TpmCeremony.CeremonyRehearsal($t)).Run($Stages)
    $nvAfter = Get-HandleList -Transport $inner -Start 0x01000000
    $sessionsAfter = Get-HandleList -Transport $inner -Start 0x02000000
    $res = [ordered]@{
      report = ($r.ToJson() | ConvertFrom-Json)
      fault = [ordered]@{ mode = $Fault; changes = $t.Changes; definedHandle = ('0x{0:x8}' -f $t.DefinedHandle); lostSession = ('0x{0:x8}' -f $t.LostSession); thirdPartyRc = ('0x{0:x8}' -f $t.ThirdPartyRc); witnessSession = ('0x{0:x8}' -f $t.WitnessSession); witnessPresentBefore = $t.WitnessPresentBefore; witnessPresentAfter = $t.WitnessPresentAfter }
      nvBefore = $nvBefore; nvAfter = $nvAfter; sessionsBefore = $sessionsBefore; sessionsAfter = $sessionsAfter
    }
    [Console]::Out.WriteLine(($res | ConvertTo-Json -Depth 8 -Compress))
  } finally { $inner.Dispose() }
  exit 0
}

if (-not $BlockCc) { throw 'inject-blocked requires -BlockCc' }
$inner = New-Object Xuux.TpmCeremony.SwtpmLoopbackTransport($SimHost, $SimPort)
try {
  $t = New-Object Xuux.TpmCeremony.Tests.BlockingTransport($inner, [Convert]::ToUInt32($BlockCc, 16), $Nth, [bool]$BlockAll)
  $r = (New-Object Xuux.TpmCeremony.CeremonyRehearsal($t)).Run($Stages)
  $res = [ordered]@{ report = ($r.ToJson() | ConvertFrom-Json); forwarded = @($t.Forwarded); blockedCount = $t.BlockedCount }
  [Console]::Out.WriteLine(($res | ConvertTo-Json -Depth 8 -Compress))
} finally { $inner.Dispose() }
exit 0
