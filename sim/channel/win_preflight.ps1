# sim/channel/win_preflight.ps1
#
# PoC تشخيصي مؤقت غير إنتاجي (transient, non-production, no-TPM-write diagnostic PoC).
# فحص استطاعة READ-ONLY على Windows قبل أي خطوة قناة: لا يكتب سجلّاً ولا جدار حماية
# ولا خدمة ولا يلمس TPM. يطبع تقريراً ثم يخرج.
#
# الاستخدام (PowerShell عادي — لا يحتاج مسؤولاً إلا hcsdiag):
#   powershell -ExecutionPolicy Bypass -File sim\channel\win_preflight.ps1

$ErrorActionPreference = 'Continue'
$report = [ordered]@{
  tool          = 'win_preflight'
  wsl_version   = $null
  wsl_vm_guid   = $null
  af_hyperv     = $null
  hvsock_key    = $null
  wsl_adapter   = $null
  nat_mode      = $null
  errors        = @()
}

function Add-Err($msg) { $script:report.errors += $msg }

# 1) إصدار WSL
try { $report.wsl_version = (wsl --version | Out-String).Trim() } catch { Add-Err "wsl --version: $_" }

# 2) GUID جهاز WL الافتراضي (يحتاج مسؤولاً في بعض الأنظمة؛ فشله غير حاسم)
try {
  $hcs = & hcsdiag list 2>$null
  if ($LASTEXITCODE -eq 0 -and $hcs) {
    $line = ($hcs | Select-String -Pattern '\{[0-9a-fA-F-]{36}\}').Matches | Select-Object -First 1
    $report.wsl_vm_guid = if ($line) { $line.Value } else { $null }
    $report.hcsdiag_note = "hcsdiag متاح؛ GUID الجهاز أعلاه (إن ظهر) يُستخدم لاحقاً لربط مستجيب AF_HYPERV بجهاز WSL بعينه."
  } else {
    $report.wsl_vm_guid = $null
    $report.hcsdiag_note = "hcsdiag غير متاح بدون مسؤول — غير حاسم لهذا الفحص."
  }
} catch { Add-Err "hcsdiag: $_" }

# 3) هل تدعم Winsock عائلة AF_HYPERV (34)؟ — إنشاء سوكيت فقط ثم إغلاق فوراً.
try {
  $src = @'
using System;
using System.Net.Sockets;
public static class HvSockProbe {
    public static string TryCreate() {
        try {
            using (var s = new Socket((AddressFamily)34, SocketType.Stream, (ProtocolType)1)) {
                return "supported (socket created)";
            }
        } catch (Exception e) {
            return "NOT supported: " + e.GetType().Name + ": " + e.Message;
        }
    }
}
'@
  Add-Type -TypeDefinition $src -ErrorAction Stop
  $report.af_hyperv = [HvSockProbe]::TryCreate()
} catch { $report.af_hyperv = 'probe failed: ' + $_.Exception.Message }

# 4) هل يوجد مفتاح GuestCommunicationServices لمنفذ PoC الخاص بنا؟ (قراءة فقط)
$pocPort = 60601
$serviceGuid = ('{0:x8}-facb-11e6-bd58-64006a7986d3' -f $pocPort)
$gcsPath = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Virtualization\GuestCommunicationServices'
try {
  if (Test-Path $gcsPath) {
    $report.hvsock_key = [ordered]@{
      path   = $gcsPath
      poc_guid = $serviceGuid
      exists = (Test-Path (Join-Path $gcsPath $serviceGuid))
    }
  } else {
    $report.hvsock_key = 'GuestCommunicationServices path not present'
  }
} catch { Add-Err "registry read: $_" }

# 5) محوّل vEthernet (WSL) — عنوان بوابة NAT كما يراه Windows (قراءة فقط)
try {
  $adapter = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
    Where-Object { $_.InterfaceAlias -like '*WSL*' } |
    Select-Object -First 1 IPAddress, InterfaceAlias
  $report.wsl_adapter = if ($adapter) { "$($adapter.InterfaceAlias) = $($adapter.IPAddress)" } else { 'not found' }
} catch { Add-Err "Get-NetIPAddress: $_" }

# 6) وضع الشبكة الحالي (NAT افتراضي أم mirrored) — قراءة فقط من .wslconfig إن وُجد
try {
  $wslconfig = Join-Path $env:USERPROFILE '.wslconfig'
  if (Test-Path $wslconfig) {
    $content = Get-Content $wslconfig -Raw
    if ($content -match '(?im)^\s*networkingMode\s*=\s*(\S+)') {
      $report.nat_mode = $Matches[1] + ' (معلن في .wslconfig)'
    } else {
      $report.nat_mode = 'NAT (افتراضي — لا سطر networkingMode في .wslconfig)'
    }
  } else {
    $report.nat_mode = 'NAT (افتراضي — لا يوجد .wslconfig)'
  }
} catch { $report.nat_mode = 'unknown: ' + $_.Exception.Message }

Write-Output ('PREFLIGHT_RESULT ' + ($report | ConvertTo-Json -Depth 5))
Write-Output ''
Write-Output 'ملاحظة: هذا الفحص للقراءة فقط — لم يُغيَّر أي إعداد أو سجل أو خدمة أو TPM.'
