# sim/tpm-host/win11_qualification_readonly.ps1
#
# WL-510 — سياقُ تأهيلِ Windows 11 لمسارِ TBS (‏قرائيٌّ فقط، لا يرسلُ أيَّ أمرٍ إلى TPM عبرَ TBS).
# التصميم: docs/adr/0007-annex-f-windows11-tbs-qualification.md §5 (الفحصانِ W-R2 وW-R3).
#
# يقرأ:
#   1. نظامَ التشغيل: Caption وVersion وBuildNumber (‏Win32_OperatingSystem).
#   2. مُشغِّلَ TPM: إصدارُ ملفِّ tpm.sys وبصمتُه SHA-256 (‏قائمةُ السماحِ لأوامرِ TPM 2.0 مثبَّتةٌ في المُشغِّلِ
#      منذُ Windows 10 1809، فإصدارُه جزءٌ من الدليل).
#   3. خدمةَ TBS: حالتُها ونوعُ بدئِها فقط.
#   4. فئةَ المستدعي: هل الجلسةُ مرفوعةُ الصلاحيةِ (‏مدير) أم لا.
#   5. شهاداتِ مفتاحِ المصادقة (EK) عبرَ Get-TpmEndorsementKeyInfo — المُصدِرُ والموضوعُ والبصمةُ والصلاحيةُ وبصمةُ
#      SHA-256 للبايتاتِ العامّة. هذا دليلُ **أصالةِ عتاد**، لا دليلُ حداثة.
#   6. توزيعاتِ WSL: الاسمُ والإصدارُ وقيمةُ Flags وبتُّ التشغيلِ البينيِّ (‏0x1) من HKCU فقط.
#
# ما لا يفعلُه أبدًا: لا يستدعي Get-Tpm (‏يطبعُ OwnerAuth) ولا Tbsi_Get_OwnerAuth، ولا يقرأُ
# HKLM\SYSTEM\CurrentControlSet\Services\TPM\WMI (‏مخزنُ التفويضات)، ولا manage-bde، ولا يكتبُ في السجلِّ أو
# السياسات، ولا يبدأُ خدمةً أو يوقفُها، ولا يشغّلُ wsl.exe. الأثرُ الوحيد: ملفُّ JSON واحدٌ في -OutDir.
#
#   powershell -NoProfile -File .\sim\tpm-host\win11_qualification_readonly.ps1 [-OutDir <dir>]
#   (‏شغّلْه مرّتَين: جلسةً عاديّةً ثمّ جلسةَ مدير؛ شهاداتُ EK لا تُقرأُ إلا في الثانية.)
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

function Get-Sha256Hex([byte[]]$bytes) {
  $h = [System.Security.Cryptography.SHA256]::Create()
  try { return (($h.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join '') } finally { $h.Dispose() }
}

function Get-CertSummary($cert) {
  return [ordered]@{
    subject = $cert.Subject
    issuer = $cert.Issuer
    thumbprintSha1 = $cert.Thumbprint
    notBeforeUtc = $cert.NotBefore.ToUniversalTime().ToString('o')
    notAfterUtc = $cert.NotAfter.ToUniversalTime().ToString('o')
    rawSha256 = (Get-Sha256Hex $cert.RawData)
  }
}

$report = [ordered]@{
  schema = 'xuux.win11-qualification/1'
  readOnly = $true
  tpmCommandsSent = 0
  startedUtc = [DateTime]::UtcNow.ToString('o')
  status = 'COMPLETE'
  errors = @()
  os = [ordered]@{}
  tpmDriver = [ordered]@{}
  tbsService = [ordered]@{}
  caller = [ordered]@{}
  ek = [ordered]@{ read = $false }
  wsl = [ordered]@{ distributions = @() }
  note = 'hardware-identity and platform context only; nothing here is evidence of state freshness'
}
$errs = New-Object System.Collections.Generic.List[string]

try {
  if (-not (Test-Path -LiteralPath $OutDir)) { throw 'OutDir does not exist' }

  try {
    $os = Get-CimInstance -ClassName Win32_OperatingSystem
    $report.os = [ordered]@{ caption = $os.Caption; version = $os.Version; buildNumber = $os.BuildNumber }
  } catch { $errs.Add('OS_UNREADABLE: ' + $_.Exception.GetType().Name) }

  $drv = Join-Path $env:SystemRoot 'System32\drivers\tpm.sys'
  if (Test-Path -LiteralPath $drv) {
    try {
      $item = Get-Item -LiteralPath $drv
      $report.tpmDriver = [ordered]@{
        fileVersion = $item.VersionInfo.FileVersion
        sha256 = (Get-FileHash -LiteralPath $drv -Algorithm SHA256).Hash.ToLowerInvariant()
      }
    } catch { $errs.Add('TPM_DRIVER_UNREADABLE: ' + $_.Exception.GetType().Name) }
  } else { $errs.Add('TPM_DRIVER_ABSENT') }

  try {
    $svc = Get-Service -Name 'TBS'
    $report.tbsService = [ordered]@{ status = [string]$svc.Status; startType = [string]$svc.StartType }
  } catch { $errs.Add('TBS_SERVICE_UNREADABLE: ' + $_.Exception.GetType().Name) }

  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  $elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  $report.caller = [ordered]@{ elevated = $elevated }

  if (-not $elevated) {
    $errs.Add('EK_REQUIRES_ELEVATION')
  } elseif (-not (Get-Command Get-TpmEndorsementKeyInfo -ErrorAction SilentlyContinue)) {
    $errs.Add('EK_CMDLET_ABSENT')
  } else {
    try {
      $ek = Get-TpmEndorsementKeyInfo -HashAlgorithm Sha256
      $report.ek = [ordered]@{
        read = $true
        isPresent = [bool]$ek.IsPresent
        publicKeyHashSha256 = $ek.PublicKeyHash
        manufacturerCertificates = @($ek.ManufacturerCertificates | ForEach-Object { Get-CertSummary $_ })
        additionalCertificates = @($ek.AdditionalCertificates | ForEach-Object { Get-CertSummary $_ })
      }
    } catch { $errs.Add('EK_UNREADABLE: ' + $_.Exception.GetType().Name) }
  }

  $lxss = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss'
  if (Test-Path -LiteralPath $lxss) {
    try {
      $default = (Get-Item -LiteralPath $lxss).GetValue('DefaultDistribution', $null)
      $list = @()
      foreach ($k in @(Get-ChildItem -LiteralPath $lxss)) {
        $flags = $k.GetValue('Flags', $null)
        $list += [ordered]@{
          name = $k.GetValue('DistributionName', $null)
          isDefault = ($k.PSChildName -eq $default)
          version = $k.GetValue('Version', $null)
          flags = $flags
          interopFlag = if ($null -eq $flags) { $null } else { [bool]($flags -band 1) }
        }
      }
      $report.wsl.distributions = $list
    } catch { $errs.Add('WSL_REGISTRY_UNREADABLE: ' + $_.Exception.GetType().Name) }
  } else { $errs.Add('WSL_NOT_REGISTERED') }

  $report.errors = @($errs)
  if ($errs.Count -gt 0) { $report.status = 'PARTIAL' }
  $report.finishedUtc = [DateTime]::UtcNow.ToString('o')
  $file = Join-Path $OutDir ('win11-qualification-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '.json')
  ($report | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $file -Encoding UTF8
  [Console]::Out.WriteLine($file)
  [Console]::Out.WriteLine('sha256=' + (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant())
  if ($errs.Count -gt 0) { exit 1 } else { exit 0 }
} catch {
  [Console]::Error.WriteLine('TOOL_FAILURE: ' + $_.Exception.GetType().FullName)
  exit 4
}
