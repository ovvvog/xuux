#Requires -Version 5.1
# حزامُ مسابرِ جولةِ المتابعةِ WL-414 (خارجَ الشجرةِ): يُجمِّعُ نواةَ البروفةِ من الشجرةِ عندَ
# رأسِ الفرعِ مع ناقلِ مسابرِ الجولةِ المحليِّ ويُجرِدُ المواردَ قبلَ البروفةِ وبعدَها.
# الجردُ "قبل" يُلتقطُ بعدَ إنشاءِ الناقلِ (أي بعدَ زرعِ المواردِ الحارسةِ/الأجنبيّةِ) وقبلَ Run
# — مطابقٌ لترتيبِ مسبرِ gpt_6_1_sol الخامِّ. لا يُعدِّلُ أيَّ ملفٍّ داخلَ الشجرةِ.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Fault,
  [ValidateSet('127.0.0.1', '::1')][string]$SimHost = '127.0.0.1',
  [int]$SimPort = 6100,
  [string]$Stages = 'ALL'
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$repo = '/home/user/workspace/repo'
$core = Join-Path $repo 'sim/tpm-ceremony/TpmCeremonyCore.cs'
$helper = Join-Path $PSScriptRoot 'CeremonyFaultTransport.cs'
Add-Type -Path @($core, $helper) -IgnoreWarnings

function Get-HandleList {
  param([Xuux.TpmCeremony.ICeremonyTransport]$Transport, [uint32]$Start)
  $p = [Xuux.TpmCeremony.Resp]::Parse($Transport.Transmit([Xuux.TpmCeremony.Cmd]::GetCapability(1, $Start, 64)), 0, 0x8001, 0, [bool[]]@())
  $r = New-Object Xuux.TpmCeremony.Rd -ArgumentList (,$p.Params)
  [void]$r.U8(); [void]$r.U32(); $count = $r.U32()
  $hs = @()
  for ($i = 0; $i -lt $count; $i++) { $hs += ('0x{0:x8}' -f $r.U32()) }
  return ,@($hs)
}

$inner = New-Object Xuux.TpmCeremony.SwtpmLoopbackTransport($SimHost, $SimPort)
try {
  $t = New-Object Xuux.TpmCeremony.CeremonyFaultTransport($inner, $Fault, $false)
  $nvBefore = Get-HandleList -Transport $inner -Start 0x01000000
  $sessionsBefore = Get-HandleList -Transport $inner -Start 0x02000000
  $transientsBefore = Get-HandleList -Transport $inner -Start ([uint32]2147483648)
  $r = (New-Object Xuux.TpmCeremony.CeremonyRehearsal($t)).Run($Stages)
  $nvAfter = Get-HandleList -Transport $inner -Start 0x01000000
  $sessionsAfter = Get-HandleList -Transport $inner -Start 0x02000000
  $transientsAfter = Get-HandleList -Transport $inner -Start ([uint32]2147483648)
  $faultMeta = [ordered]@{
    mode = $Fault; changes = $t.Changes; foreignNv = ('0x{0:x8}' -f $t.ForeignNv)
    sentinels = @($t.Sentinels | ForEach-Object { '0x{0:x8}' -f $_ })
    substitutions = @($t.Substitutions)
    flushed = @($t.Flushed | ForEach-Object { '0x{0:x8}' -f $_ })
  }
  $res = [ordered]@{
    report = ($r.ToJson() | ConvertFrom-Json)
    fault = $faultMeta
    nvBefore = $nvBefore; nvAfter = $nvAfter
    sessionsBefore = $sessionsBefore; sessionsAfter = $sessionsAfter
    transientsBefore = $transientsBefore; transientsAfter = $transientsAfter
  }
  [Console]::Out.WriteLine(($res | ConvertTo-Json -Depth 8 -Compress))
} finally { $inner.Dispose() }
exit 0
