#Requires -Version 5.1
# sim/tpm-ceremony/rehearse.ps1
#
# بروفةُ المراسمِ S1/S2 على المحاكي وحدَه (WL-412؛ ADR 0007 §11.2؛ تفويضُ المالكِ 2026-10-17).
# يتّصلُ بـswtpm على loopback فقط، ويتحقّقُ من هويّةِ المحاكي قبلَ أيِّ أمرٍ مُغيِّر، ويطبعُ تقريرَ JSON
# (بصماتُ الأوامرِ لا بايتاتُها). لا TBS، ولا TPM حقيقيّ، ولا سقوطَ إلى بديل: أيُّ فشلٍ ⇒ توقّفٌ مغلق
# ثمّ حذفُ ما أنشأَته البروفةُ وحدَه.
#
# الاستعمال (داخلَ بيئةِ المحاكاةِ فقط):
#   pwsh -NoProfile -File sim/tpm-ceremony/rehearse.ps1 -SimHost 127.0.0.1 -SimPort 2321 -Stages ALL
# رموزُ الخروج: 0 COMPLETE · 1 FAILED_CLOSED/BLOCKED_FAIL_CLOSED · 4 TOOL_ERROR.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('127.0.0.1', '::1')][string]$SimHost,
  [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$SimPort,
  [ValidateSet('S1', 'S2', 'ALL')][string]$Stages = 'ALL'
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

try {
  Add-Type -Path (Join-Path $PSScriptRoot 'TpmCeremonyCore.cs') -IgnoreWarnings
} catch {
  [Console]::Out.WriteLine('{"schema":"xuux.tpm-ceremony-rehearsal/1","status":"TOOL_ERROR","failure":"core load failed"}')
  exit 4
}

$t = $null
try {
  $t = New-Object Xuux.TpmCeremony.SwtpmLoopbackTransport($SimHost, $SimPort)
  $report = (New-Object Xuux.TpmCeremony.CeremonyRehearsal($t)).Run($Stages)
} catch {
  [Console]::Out.WriteLine('{"schema":"xuux.tpm-ceremony-rehearsal/1","status":"TOOL_ERROR","failure":"simulator transport unavailable"}')
  exit 4
} finally {
  if ($null -ne $t) { $t.Dispose() }
}
[Console]::Out.WriteLine($report.ToJson())
if ($report.Status -eq 'COMPLETE') { exit 0 }
if ($report.Status -eq 'TOOL_ERROR') { exit 4 }
exit 1
