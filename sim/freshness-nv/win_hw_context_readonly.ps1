# sim/freshness-nv/win_hw_context_readonly.ps1
#
# WL-432 — سياقُ Windows لخطّةِ التأهيلِ العتاديِّ (‏قرائيٌّ فقط، لا يرسلُ أيَّ أمرٍ إلى TPM).
#
# يقرأ:
#   1. قوائمَ السماحِ والحجبِ في TBS لأوامرِ الخطّة (‏أسماءُ القيمِ في السجلِّ فقط).
#   2. قيمًا مسمّاةً من سياسةِ TPM: OSManagedAuthLevel وIgnoreDefaultList وIgnoreLocalList.
#   3. BitLocker: لكلِّ مجلّدٍ حالتُه وأنواعُ حُماته فقط — **لا** معرّفاتِ الحُماةِ ولا كلماتِ الاسترداد.
#   4. Windows Hello / الانضمام: أسطرُ NgcSet وAzureAdJoined وDomainJoined وWorkplaceJoined من dsregcmd فقط.
#
# ما لا يفعلُه أبدًا: لا يقرأُ HKLM\SYSTEM\CurrentControlSet\Services\TPM\WMI (‏مخزنُ التفويضات)، ولا يستدعي
# Get-Tpm (‏يطبعُ OwnerAuth)، ولا manage-bde -protectors، ولا يكتبُ في السجلِّ أو السياسات، ولا يمسُّ TPM.
# الأثرُ الوحيد: ملفُّ JSON واحدٌ في -OutDir.
#
#   powershell -NoProfile -File .\sim\freshness-nv\win_hw_context_readonly.ps1 [-OutDir <dir>]
#
# خروج: 0 مكتمل · 1 جزئيّ (‏الأسبابُ في الملف) · 2 ليس Windows · 4 عطلٌ في الأداة.

[CmdletBinding()]
param(
  [string]$OutDir = (Get-Location).Path
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

if (-not ($PSVersionTable.PSEdition -eq 'Desktop' -or $IsWindows)) {
  [Console]::Error.WriteLine('NOT_WINDOWS: no read, no substitute')
  exit 2
}

# أوامرُ الخطّةِ برموزِها العشريّة (‏TPM 2.0 Part 2، TPM_CC).
$PlanCommands = [ordered]@{
  'TPM2_NV_UndefineSpace' = 290; 'TPM2_NV_DefineSpace' = 298; 'TPM2_NV_Increment' = 308
  'TPM2_NV_Write' = 311; 'TPM2_NV_Read' = 334; 'TPM2_PolicySigned' = 352; 'TPM2_NV_ReadPublic' = 361
  'TPM2_PolicyCommandCode' = 364; 'TPM2_StartAuthSession' = 374; 'TPM2_GetCapability' = 378
  'TPM2_NV_Certify' = 388
}
$TbsLists = [ordered]@{
  allowedAdmin = 'HKLM:\SOFTWARE\Microsoft\Tpm\AllowedW8Commands\List'
  allowedUser = 'HKLM:\SOFTWARE\Microsoft\Tpm\AllowedW8UserCommands\List'
  blockedAdmin = 'HKLM:\SOFTWARE\Microsoft\Tpm\BlockedCommands\List'
  blockedUser = 'HKLM:\SOFTWARE\Microsoft\Tpm\BlockedUserCommands\List'
  blockedGroupPolicy = 'HKLM:\SOFTWARE\Policies\Microsoft\Tpm\BlockedCommands\List'
}
$PolicyKey = 'HKLM:\SOFTWARE\Policies\Microsoft\TPM'
$PolicyBlockedKey = 'HKLM:\SOFTWARE\Policies\Microsoft\TPM\BlockedCommands'
$PolicyValues = @('OSManagedAuthLevel')
$PolicyBlockedValues = @('IgnoreDefaultList', 'IgnoreLocalList')
$DsregLines = @('NgcSet', 'AzureAdJoined', 'DomainJoined', 'WorkplaceJoined', 'EnterpriseJoined')

$report = [ordered]@{
  schema = 'xuux.fnv-hw-context/1'
  readOnly = $true
  startedUtc = [DateTime]::UtcNow.ToString('o')
  status = 'COMPLETE'
  errors = @()
  tbs = [ordered]@{}
  tbsNote = 'registry configuration only; a command being listed is not proof that TBS will pass it for the ceremony account'
  policy = [ordered]@{}
  bitlocker = @()
  windowsHello = [ordered]@{}
}
$errs = New-Object System.Collections.Generic.List[string]

function Get-ValueNames([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  return @((Get-Item -LiteralPath $path).GetValueNames())
}

try {
  foreach ($k in $TbsLists.Keys) {
    $names = $null
    try { $names = Get-ValueNames $TbsLists[$k] } catch { $errs.Add("TBS_LIST_UNREADABLE:${k}: " + $_.Exception.GetType().Name) }
    $entry = [ordered]@{ present = ($null -ne $names) }
    foreach ($c in $PlanCommands.Keys) {
      $entry[$c] = if ($null -eq $names) { $null } else { [bool]($names -contains [string]$PlanCommands[$c]) }
    }
    $report.tbs[$k] = $entry
  }

  foreach ($pair in @(@($PolicyKey, $PolicyValues), @($PolicyBlockedKey, $PolicyBlockedValues))) {
    foreach ($v in $pair[1]) {
      $val = $null
      try {
        if (Test-Path -LiteralPath $pair[0]) { $val = (Get-Item -LiteralPath $pair[0]).GetValue($v, $null) }
      } catch { $errs.Add("POLICY_UNREADABLE:${v}: " + $_.Exception.GetType().Name) }
      $report.policy[$v] = if ($null -eq $val) { 'not-configured' } else { [int]$val }
    }
  }

  if (Get-Command Get-BitLockerVolume -ErrorAction SilentlyContinue) {
    try {
      foreach ($vol in @(Get-BitLockerVolume)) {
        $types = @($vol.KeyProtector | ForEach-Object { [string]$_.KeyProtectorType }) | Sort-Object -Unique
        $report.bitlocker += [ordered]@{
          mountPoint = [string]$vol.MountPoint
          volumeStatus = [string]$vol.VolumeStatus
          protectionStatus = [string]$vol.ProtectionStatus
          keyProtectorTypes = @($types)
        }
      }
    } catch { $errs.Add('BITLOCKER_UNREADABLE: ' + $_.Exception.GetType().Name) }
  } else { $errs.Add('BITLOCKER_CMDLET_ABSENT') }

  $dsreg = Join-Path $env:SystemRoot 'System32\dsregcmd.exe'
  if (Test-Path -LiteralPath $dsreg) {
    try {
      $lines = & $dsreg /status 2>$null
      foreach ($name in $DsregLines) {
        $m = $lines | Where-Object { $_ -match ('^\s*' + [regex]::Escape($name) + '\s*:\s*(YES|NO)\s*$') } | Select-Object -First 1
        $report.windowsHello[$name] = if ($m -and ($m -match ':\s*(YES|NO)')) { $Matches[1] } else { $null }
      }
    } catch { $errs.Add('DSREGCMD_FAILED: ' + $_.Exception.GetType().Name) }
  } else { $errs.Add('DSREGCMD_ABSENT') }

  $report.errors = @($errs)
  if ($errs.Count -gt 0) { $report.status = 'PARTIAL' }
  $report.finishedUtc = [DateTime]::UtcNow.ToString('o')
  $file = Join-Path $OutDir ('fnv-hw-context-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '.json')
  ($report | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $file -Encoding UTF8
  [Console]::Out.WriteLine($file)
  if ($errs.Count -gt 0) { exit 1 } else { exit 0 }
} catch {
  [Console]::Error.WriteLine('TOOL_FAILURE: ' + $_.Exception.GetType().FullName)
  exit 4
}
