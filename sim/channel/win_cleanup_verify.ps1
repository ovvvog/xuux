# sim/channel/win_cleanup_verify.ps1
#
# PoC تشخيصي مؤقت غير إنتاجي — أمر تحقق مستقل بعد كل خطوة قناة على Windows.
# يثبت عدم بقاء: مستمع على منافذ PoC، عملية أدوات PoC، مفتاح سجل مؤقت،
# أو قاعدة جدار حماية باسم PoC. للقراءة فقط — لا يغيّر شيئاً.
#
# الاستخدام:
#   powershell -ExecutionPolicy Bypass -File sim\channel\win_cleanup_verify.ps1 [-Ports 47849,60601]

param(
  [int[]]$Ports = @(47849, 60601)
)

$ErrorActionPreference = 'Continue'
$verdict = [ordered]@{
  tool = 'win_cleanup_verify'
  listeners = @()
  poc_processes = @()
  registry_keys = @()
  firewall_rules = @()
  clean = $true
}

foreach ($p in $Ports) {
  # 1) مستمع TCP متبقٍّ على المنفذ؟
  $l = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue
  if ($l) {
    $verdict.listeners += "port ${p}: STILL LISTENING (pid=$($l.OwningProcess | Select-Object -First 1))"
    $verdict.clean = $false
  } else {
    $verdict.listeners += "port ${p}: no listener"
  }

  # 2) مفتاح سجل GuestCommunicationKeys المؤقت للمنفذ؟
  $serviceGuid = ('{0:x8}-facb-11e6-bd58-64006a7986d3' -f $p)
  $keyPath = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Virtualization\GuestCommunicationServices\$serviceGuid"
  if (Test-Path $keyPath) {
    $verdict.registry_keys += "$serviceGuid : STILL PRESENT"
    $verdict.clean = $false
  } else {
    $verdict.registry_keys += "$serviceGuid : absent"
  }
}

# 3) عمليات أدوات PoC متبقية؟
$procs = Get-CimInstance Win32_Process -Filter "Name like 'powershell%' or Name like 'pwsh%'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'xuux|tcp_responder|win_responder|win_hvsock|vsock_' -and $_.CommandLine -notmatch 'win_cleanup_verify' }
if ($procs) {
  foreach ($pr in $procs) { $verdict.poc_processes += "pid $($pr.ProcessId): $($pr.CommandLine.Substring(0, [Math]::Min(120, $pr.CommandLine.Length)))" }
  $verdict.clean = $false
} else {
  $verdict.poc_processes += 'none'
}

# 4) قواعد جدار حماية باسم PoC؟
$rules = Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'xuux|poc' }
if ($rules) {
  foreach ($r in $rules) { $verdict.firewall_rules += "$($r.DisplayName) ($($r.Enabled))" }
  $verdict.clean = $false
} else {
  $verdict.firewall_rules += 'none'
}

Write-Output ('CLEANUP_VERIFY ' + ($verdict | ConvertTo-Json -Depth 4))
if ($verdict.clean) { Write-Output 'CLEAN: لا مستمع ولا عملية ولا مفتاح سجل ولا قاعدة جدار حماية متبقية.' ; exit 0 }
else { Write-Output 'NOT CLEAN: انظر الأعلى.' ; exit 1 }
