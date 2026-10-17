#Requires -Version 5.1
# sim/tpm-ceremony/rehearse.ps1
#
# بروفةُ المراسمِ S1/S2 على المحاكي وحدَه (WL-412؛ WL-413). يتّصلُ بـswtpm على loopback فقط، ويتحقّقُ من
# هويّةِ المحاكي (خصائصُ المصنّعِ وسلاسلِ البائعِ الأربعُ كاملةً) قبلَ أيِّ أمرٍ مُغيِّر، ويطبعُ تقريرَ JSON
# (بصماتُ الأوامرِ لا بايتاتُها). لا TBS، ولا TPM حقيقيّ، ولا سقوطَ إلى بديل: أيُّ فشلٍ ⇒ توقّفٌ مغلق
# ثمّ جردُ مصالحةٍ قرائيٌّ للنتائجِ المجهولةِ وحذفُ ما أنشأَته البروفةُ وحدَه.
#
# عزلُ النقلِ (WL-413): ‏-SimPidFile إن مُرِّرَ تحقَّقَ أنّ المُستمِعَ على المنفذِ عمليةُ swtpm نفسُها
# (سياقُ تشغيلِ المحاكي)، لا مجردَ إقرارِ الطرفِ المقابلِ. وهذا تحقّقُ عمليّةٍ لا مصادقةٌ تشفيريّة؛
# حدودُ الثقةِ في المضيفِ المحليِّ موثّقةٌ في نموذجِ التهديدِ (§7 البند 11).
#
# الاستعمال (داخلَ بيئةِ المحاكاةِ فقط):
#   pwsh -NoProfile -File sim/tpm-ceremony/rehearse.ps1 -SimHost 127.0.0.1 -SimPort 2321 -Stages ALL -SimPidFile /run/swtpm.pid
# رموزُ الخروج: 0 COMPLETE · 1 FAILED_CLOSED/BLOCKED_FAIL_CLOSED · 4 TOOL_ERROR.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('127.0.0.1', '::1')][string]$SimHost,
  [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$SimPort,
  [ValidateSet('S1', 'S2', 'ALL')][string]$Stages = 'ALL',
  [string]$SimPidFile
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Write-ToolError {
  param([string]$Failure)
  [Console]::Out.WriteLine(('{"schema":"xuux.tpm-ceremony-rehearsal/1","status":"TOOL_ERROR","failure":"' + $Failure + '"}'))
  exit 4
}

if ($SimPidFile) {
  if (-not (Test-Path -LiteralPath $SimPidFile)) { Write-ToolError 'simulator pid file absent' }
  $simPidText = (Get-Content -LiteralPath $SimPidFile -ErrorAction Stop | Select-Object -First 1).Trim()
  $simPid = 0
  if (-not [int]::TryParse($simPidText, [ref]$simPid)) { Write-ToolError 'simulator pid file unreadable' }
  $simProc = $null
  try { $simProc = Get-Process -Id $simPid -ErrorAction Stop } catch { Write-ToolError 'simulator process not running' }
  if ($simProc.ProcessName -notmatch 'swtpm') { Write-ToolError ('simulator context mismatch: process name ' + $simProc.ProcessName) }
}

try {
  Add-Type -Path (Join-Path $PSScriptRoot 'TpmCeremonyCore.cs') -IgnoreWarnings
} catch {
  Write-ToolError 'core load failed'
}

$t = $null
try {
  $t = New-Object Xuux.TpmCeremony.SwtpmLoopbackTransport($SimHost, $SimPort)
  $report = (New-Object Xuux.TpmCeremony.CeremonyRehearsal($t)).Run($Stages)
} catch {
  Write-ToolError 'simulator transport unavailable'
} finally {
  if ($null -ne $t) { $t.Dispose() }
}
[Console]::Out.WriteLine($report.ToJson())
if ($report.Status -eq 'COMPLETE') { exit 0 }
if ($report.Status -eq 'TOOL_ERROR') { exit 4 }
exit 1
