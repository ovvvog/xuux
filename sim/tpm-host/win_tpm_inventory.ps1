#Requires -Version 5.1
# sim/tpm-host/win_tpm_inventory.ps1
#
# جردُ TPM على مضيفِ Windows — للقراءةِ فقط (WL-410؛ ADR 0007 §9 البند 5).
# أداةُ مضيفٍ مستقلّةٌ عن sim/tpm (أداةِ المحاكاةِ المقيّدةِ بـassertSimulatorTcti التي لم تُمَسّ).
#
# ما يقرؤه:
#   1. Get-Tpm — حقولٌ مسمّاةٌ صراحةً فقط (لا OwnerAuth). يتطلّبُ عادةً جلسةً مرفوعةً؛ وإن لم
#      تكن فالفشلُ يُسجَّلُ ولا يُستعاضُ عنه.
#   2. Tbsi_GetDeviceInfo — إصدارُ TPM ونوعُ الواجهةِ كما تراهما TBS.
#   3. عبرَ TBS وحدَها، أمرانِ للقراءةِ فقط تبنيهما الأداةُ داخليّاً (TpmInventoryCore.cs):
#      TPM2_GetCapability (الخصائص، مقابضُ فهارسِ NV، الأوامرُ المنفَّذةُ في الشريحة، الخوارزميات،
#      منحنيات ECC) و TPM2_NV_ReadPublic (المنطقةُ العامّةُ لكلِّ فهرسٍ موجود — لا محتواه).
#
# ما لا يفعلُه أبداً: لا يمسحُ TPM ولا يُعرِّفُ فهرساً ولا يزيدُ عدّاداً ولا يحذفُ، ولا يقرأُ
# محتوى فهرسٍ (NV_Read)، ولا يلمسُ التفويضاتِ أو السجلَّ أو BIOS أو .wslconfig أو جدارَ الحمايةِ
# أو الخدماتِ، ولا يطلبُ سرّاً، ولا يُنزِّلُ شيئاً، ولا يُغيِّرُ سياسةَ التنفيذ. الأثرُ الوحيدُ
# على القرصِ: ملفُّ JSON واحدٌ في -OutDir (افتراضيّاً المجلَّدُ الحالي).
#
# التشغيل (من جذرِ نسخةِ المستودعِ على المضيف):
#   powershell -NoProfile -File .\sim\tpm-host\win_tpm_inventory.ps1
#
# رموزُ الخروج:
#   0 كلُّ الاستعلاماتِ وصلَت وأجابَ عنها TPM بنجاح ⇒ جردٌ مكتمل.
#   1 جردٌ جزئيّ: استعلامٌ أو أكثرُ رُفِضَ من TBS أو من TPM أو انقطعَ ترقيمُه — الأسبابُ في الملف.
#   2 ليس Windows — لا جردَ ولا بديل.
#   3 تعذّرَ فتحُ سياقِ TBS — لا استعلامَ أُرسِل.
#   4 عطلٌ داخليٌّ في الأداة (تحميلُ النواةِ أو الكتابة).

[CmdletBinding()]
param(
  [string]$OutDir = (Get-Location).Path
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$schema = 'xuux.tpm-host-inventory/1'
$script:inventoryJson = $null
$started = [DateTime]::UtcNow

# حقولُ Get-Tpm المسموحُ بنقلِها — قائمةٌ مغلقة. OwnerAuth ليس منها ولا يُنقَلُ أبداً.
$GetTpmSafeFields = @(
  'TpmPresent', 'TpmReady', 'TpmEnabled', 'TpmActivated', 'TpmOwned', 'RestartPending',
  'ManufacturerId', 'ManufacturerIdTxt', 'ManufacturerVersion', 'ManufacturerVersionFull20',
  'ManagedAuthLevel', 'OwnerClearDisabled', 'AutoProvisioning', 'LockedOut',
  'LockoutHealTime', 'LockoutCount', 'LockoutMax'
)

function Write-Line([string]$text) { [Console]::Out.WriteLine($text) }

function Get-Sha256([string]$path) {
  try { return (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant() } catch { return $null }
}

function ConvertTo-Hex32($v) { return ('0x{0:x8}' -f [uint32]$v) }

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  Write-Line 'XUUX_TPM_INVENTORY status=NOT_WINDOWS exit=2 (no inventory, no simulator fallback)'
  exit 2
}

$corePath = Join-Path $PSScriptRoot 'TpmInventoryCore.cs'
$report = [ordered]@{
  schema   = $schema
  tool     = [ordered]@{
    scriptSha256 = Get-Sha256 $PSCommandPath
    coreSha256   = Get-Sha256 $corePath
    gitCommit    = $null
    gitToolDirty = $null
  }
  host     = [ordered]@{
    osVersion    = [Environment]::OSVersion.VersionString
    psVersion    = $PSVersionTable.PSVersion.ToString()
    psEdition    = $(if ($PSVersionTable.ContainsKey('PSEdition')) { [string]$PSVersionTable.PSEdition } else { 'Desktop' })
    process64Bit = [Environment]::Is64BitProcess
    elevated     = $null
  }
  startedUtc  = $started.ToString('o')
  finishedUtc = $null
  status      = $null
  exitCode    = $null
  getTpm      = [ordered]@{ available = $false; ok = $false; error = $null; fields = $null }
  tbs         = [ordered]@{ deviceInfo = $null; contextCreateCode = $null; contextCloseCode = $null }
  inventory   = $null
  readOnlyContract = [ordered]@{
    allowedCommandCodes = @()
    submittedCommands   = 0
    note = 'Only TPM2_GetCapability and TPM2_NV_ReadPublic can reach TBS; every other command is rejected by TpmGuard before the native call.'
  }
  limitations = @(
    'GetCapability(TPM_CAP_COMMANDS) lists commands implemented by the TPM; it does not show the Windows TBS allow list.',
    'Successful queries prove TBS permits GetCapability and NV_ReadPublic for this account only; NV_DefineSpace/NV_Increment/NV_Certify were not sent and remain unmeasured.',
    'TPM 2.0 exposes no free-NV-bytes property; capacity for a new index is only proven by a define attempt, which this tool never makes.'
  )
}

# git للقراءةِ فقط: الكوميتُ وهل عُدِّلَت ملفّاتُ الأداةِ محلّيّاً.
try {
  $git = Get-Command git -ErrorAction Stop
  $c = & $git.Source -C $PSScriptRoot rev-parse HEAD 2>$null
  if ($LASTEXITCODE -eq 0) { $report.tool.gitCommit = [string]$c }
  $d = & $git.Source -C $PSScriptRoot status --porcelain -- . 2>$null
  if ($LASTEXITCODE -eq 0) { $report.tool.gitToolDirty = [bool]($d) }
} catch { $report.tool.gitCommit = $null }

try {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $report.host.elevated = ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
} catch { $report.host.elevated = $null }

function Save-Report([int]$code, [string]$status) {
  $report.exitCode = $code
  $report.status = $status
  $report.finishedUtc = [DateTime]::UtcNow.ToString('o')
  $name = 'xuux-tpm-inventory-' + $started.ToString('yyyyMMddTHHmmssZ') + '.json'
  $path = Join-Path $OutDir $name
  $json = $report | ConvertTo-Json -Depth 10
  if ($null -ne $script:inventoryJson) {
    $marker = '"__XUUX_INVENTORY_JSON__"'
    $at = $json.IndexOf($marker)
    if ($at -lt 0) { throw 'inventory placeholder missing' }
    $json = $json.Substring(0, $at) + $script:inventoryJson + $json.Substring($at + $marker.Length)
  }
  [IO.File]::WriteAllText($path, $json, (New-Object Text.UTF8Encoding($false)))
  Write-Line ('XUUX_TPM_INVENTORY status=' + $status + ' exit=' + $code)
  Write-Line ('XUUX_TPM_INVENTORY file=' + $path)
  Write-Line ('XUUX_TPM_INVENTORY fileSha256=' + (Get-Sha256 $path))
  Write-Line ('XUUX_TPM_INVENTORY submittedCommands=' + $report.readOnlyContract.submittedCommands + ' (GetCapability/NV_ReadPublic only)')
  Write-Line 'XUUX_TPM_INVENTORY note=read-only run; nothing in the TPM or system settings was changed. Send the file above unmodified.'
  exit $code
}

# 1) Get-Tpm — حقولٌ مسمّاةٌ فقط.
$cmd = Get-Command Get-Tpm -ErrorAction SilentlyContinue
if ($null -ne $cmd) {
  $report.getTpm.available = $true
  try {
    $t = Get-Tpm
    $f = [ordered]@{}
    foreach ($n in $GetTpmSafeFields) {
      $p = $t.PSObject.Properties[$n]
      if ($null -ne $p) { $f[$n] = $(if ($null -eq $p.Value) { $null } else { [string]$p.Value }) } else { $f[$n] = '<absent>' }
    }
    $report.getTpm.fields = $f
    $report.getTpm.ok = $true
  } catch {
    $report.getTpm.error = $_.Exception.GetType().FullName + ': ' + $_.Exception.Message
  }
}

# 2) تحميلُ النواة.
try {
  Add-Type -Path $corePath -IgnoreWarnings
} catch {
  $report.inventory = [ordered]@{ error = 'core load failed: ' + $_.Exception.Message }
  Save-Report 4 'TOOL_ERROR'
}
$report.readOnlyContract.allowedCommandCodes = @([Xuux.TpmHost.TpmGuard]::AllowedCommandCodes() | ForEach-Object { ConvertTo-Hex32 $_ })

# 3) Tbsi_GetDeviceInfo.
try {
  $vals = $null
  $rc = [Xuux.TpmHost.TbsTransport]::GetDeviceInfo([ref]$vals)
  $report.tbs.deviceInfo = [ordered]@{
    code = ConvertTo-Hex32 $rc
    structVersion = $vals[0]; tpmVersion = $vals[1]; tpmInterfaceType = $vals[2]; tpmImpRevision = $vals[3]
  }
} catch {
  $report.tbs.deviceInfo = [ordered]@{ error = $_.Exception.GetType().FullName + ': ' + $_.Exception.Message }
}

# 4) سياقُ TBS ثمَّ الجرد — والإغلاقُ في finally.
$transport = New-Object Xuux.TpmHost.TbsTransport
$exitCode = 0
$status = 'COMPLETE'
try {
  $open = $transport.Open()
  $report.tbs.contextCreateCode = ConvertTo-Hex32 $open
  if ($open -ne 0) {
    $exitCode = 3
    $status = 'TBS_CONTEXT_UNAVAILABLE'
  } else {
    $inv = [Xuux.TpmHost.Inventory]::Collect($transport)
    # الجردُ يُسلسَلُ في النواةِ (InventoryJson) ويُدرَجُ حرفيّاً — الشكلُ نفسُه المقيسُ على المحاكي.
    $script:inventoryJson = [Xuux.TpmHost.InventoryJson]::Serialize($inv)
    $report.inventory = '__XUUX_INVENTORY_JSON__'
    $bad = @($inv.Queries | Where-Object { $_.Error -or $_.TransportCode -ne 0 -or $_.TpmResponseCode -ne 0 })
    $incomplete = @($inv.Capabilities | Where-Object { -not $_.Complete })
    if ($bad.Count -gt 0 -or $incomplete.Count -gt 0 -or $inv.NvReadPublicTruncated) {
      $exitCode = 1
      $status = 'PARTIAL'
    }
  }
} catch {
  $script:inventoryJson = $null
  $report.inventory = [ordered]@{ error = $_.Exception.GetType().FullName + ': ' + $_.Exception.Message }
  $exitCode = 4
  $status = 'TOOL_ERROR'
} finally {
  $report.readOnlyContract.submittedCommands = $transport.SubmittedCount
  $transport.Dispose()
  if ($transport.Closed) { $report.tbs.contextCloseCode = ConvertTo-Hex32 $transport.CloseCode }
}

Save-Report $exitCode $status
