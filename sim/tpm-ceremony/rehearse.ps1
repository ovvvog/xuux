#Requires -Version 5.1
# sim/tpm-ceremony/rehearse.ps1
#
# بروفةُ المراسمِ S1/S2 على المحاكي وحدَه (WL-412؛ WL-413). يتّصلُ بـswtpm على loopback فقط، ويتحقّقُ من
# هويّةِ المحاكي (خصائصُ المصنّعِ وسلاسلِ البائعِ الأربعُ كاملةً) قبلَ أيِّ أمرٍ مُغيِّر، ويطبعُ تقريرَ JSON
# (بصماتُ الأوامرِ لا بايتاتُها). لا TBS، ولا TPM حقيقيّ، ولا سقوطَ إلى بديل: أيُّ فشلٍ ⇒ توقّفٌ مغلق
# ثمّ جردُ مصالحةٍ قرائيٌّ للنتائجِ المجهولةِ وحذفُ ما أنشأَته البروفةُ وحدَه.
#
# عزلُ النقلِ (WL-413، الدفعة الثانية / R2-05): قبلَ أيِّ أمرٍ وبعدَ البروفةِ يُحدَّدُ مالكُ مقبسِ الاستماعِ
# على المنفذِ من جدولِ مقابسِ النظامِ نفسِهِ (Linux: ‏/proc/net/tcp{,6} ثمّ /proc/<pid>/fd؛ Windows:
# Get-NetTCPConnection)، ويُشترَطُ: كلُّ مستمعٍ على المنفذِ مربوطٌ بـloopback، ومالكٌ واحدٌ، اسمُ عمليّتِهِ
# ‏`swtpm` تمامًا، وسطرُ أوامرِهِ `swtpm socket --tpm2 ... --server type=tcp,port=<المنفذ>,bindaddr=<loopback>`،
# ويطابقُ ‏-SimPidFile إن مُرِّر. وسيطٌ (proxy) على المنفذِ — حتّى مع ملفِّ PID لـswtpm حقيقيٍّ — يُرفَضُ.
# تعذُّرُ تحديدِ المالكِ ⇒ رفضٌ (لا افتراضَ). وهذا تحقّقُ سياقِ عمليّةٍ لا مصادقةٌ تشفيريّة؛ حدودُ الثقةِ
# في المضيفِ المحليِّ موثّقةٌ في نموذجِ التهديدِ (§7 البند 11).
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

$expectedPid = 0
if ($SimPidFile) {
  if (-not (Test-Path -LiteralPath $SimPidFile)) { Write-ToolError 'simulator pid file absent' }
  $simPidText = (Get-Content -LiteralPath $SimPidFile -ErrorAction Stop | Select-Object -First 1).Trim()
  if (-not [int]::TryParse($simPidText, [ref]$expectedPid) -or $expectedPid -le 0) { Write-ToolError 'simulator pid file unreadable' }
}

# يُعيدُ وصفَ المستمعِ المتحقَّقِ منه أو يرمي استثناءً باسمِ السبب. لا مسارَ يقبلُ مستمعًا مجهولَ المالك.
function Assert-SimulatorListener {
  param([int]$Port, [int]$ExpectedPid)
  $owners = @{}
  $isLinuxHost = $false
  if (Test-Path variable:IsLinux) { $isLinuxHost = [bool]$IsLinux }
  if ($isLinuxHost) {
    $inodes = @{}
    foreach ($table in @('/proc/net/tcp', '/proc/net/tcp6')) {
      if (-not (Test-Path -LiteralPath $table)) { continue }
      foreach ($line in (Get-Content -LiteralPath $table | Select-Object -Skip 1)) {
        $c = @($line.Trim() -split '\s+')
        if ($c.Count -lt 10 -or $c[3] -ne '0A') { continue }
        $parts = $c[1].Split(':')
        if ([Convert]::ToInt32($parts[1], 16) -ne $Port) { continue }
        $loop = ($parts[0] -eq '0100007F') -or ($parts[0] -eq '00000000000000000000000001000000')
        if (-not $loop) { throw ('SIMULATOR_LISTENER_NOT_LOOPBACK: ' + $parts[0]) }
        $inodes[$c[9]] = $true
      }
    }
    if ($inodes.Count -eq 0) { throw 'SIMULATOR_LISTENER_ABSENT' }
    foreach ($procDir in [System.IO.Directory]::GetDirectories('/proc')) {
      $leaf = [System.IO.Path]::GetFileName($procDir)
      $procId = 0
      if (-not [int]::TryParse($leaf, [ref]$procId)) { continue }
      try { $fds = [System.IO.Directory]::GetFiles($procDir + '/fd') } catch { continue }
      foreach ($fd in $fds) {
        $target = $null
        try { $target = (New-Object System.IO.FileInfo($fd)).LinkTarget } catch { continue }
        if ($target -and $target -match '^socket:\[(\d+)\]$' -and $inodes.ContainsKey($Matches[1])) { $owners[$procId] = $true }
      }
    }
    if ($owners.Count -eq 0) { throw 'SIMULATOR_LISTENER_OWNER_UNVERIFIABLE' }
    if ($owners.Count -ne 1) { throw ('SIMULATOR_LISTENER_MULTIPLE_OWNERS: ' + (($owners.Keys | Sort-Object) -join ',')) }
    $ownerPid = @($owners.Keys)[0]
    $comm = ([System.IO.File]::ReadAllText('/proc/' + $ownerPid + '/comm')).Trim()
    $argv = @(([System.IO.File]::ReadAllText('/proc/' + $ownerPid + '/cmdline')).Split([char]0) | Where-Object { $_ -ne '' })
  } elseif (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    # Windows — لم يُقَسْ في هذه البروفة (المحاكي يعمل على Linux)؛ المنطقُ نفسُه: لا مالكَ مؤكَّدٌ ⇒ رفض.
    $conns = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if ($conns.Count -eq 0) { throw 'SIMULATOR_LISTENER_ABSENT' }
    foreach ($cn in $conns) {
      if ($cn.LocalAddress -ne '127.0.0.1' -and $cn.LocalAddress -ne '::1') { throw ('SIMULATOR_LISTENER_NOT_LOOPBACK: ' + $cn.LocalAddress) }
      $owners[[int]$cn.OwningProcess] = $true
    }
    if ($owners.Count -ne 1) { throw 'SIMULATOR_LISTENER_MULTIPLE_OWNERS' }
    $ownerPid = @($owners.Keys)[0]
    $comm = (Get-Process -Id $ownerPid -ErrorAction Stop).ProcessName
    $cl = (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $ownerPid) -ErrorAction Stop).CommandLine
    if (-not $cl) { throw 'SIMULATOR_LISTENER_CMDLINE_UNREADABLE' }
    $argv = @($cl -split '\s+' | Where-Object { $_ -ne '' })
  } else {
    throw 'SIMULATOR_LISTENER_OWNER_UNVERIFIABLE: no socket table available'
  }
  if ($comm -ne 'swtpm') { throw ('SIMULATOR_LISTENER_NOT_SWTPM: ' + $comm) }
  if ($ExpectedPid -gt 0 -and $ownerPid -ne $ExpectedPid) { throw ('SIMULATOR_LISTENER_PID_MISMATCH: listener=' + $ownerPid + ' pidfile=' + $ExpectedPid) }
  if ($argv.Count -lt 3 -or $argv[1] -ne 'socket' -or ($argv -notcontains '--tpm2')) { throw 'SIMULATOR_LISTENER_CMDLINE_UNEXPECTED' }
  # الملفُ التنفيذيُّ للمالكِ (WL-413 الدفعة الثالثة / G47-413-7): انتحالُ comm وcmdline مُقاسٌ ومُتجاوَزٌ؛
  # فحصُ exe يرفعُ الكلفةَ — يجبُ أن يكونَ ملفَّ swtpm نفسَهُ الذي يحلُّهُ المسارُ. حدُّهُ (ملفٌّ مُستبدَلٌ بذاتِ
  # الاسمِ عبرَ bind-mount من ذاتِ المستخدمِ) موثّقٌ في نموذجِ التهديدِ.
  if ($IsLinux) {
    $exe = $null
    try { $exe = (New-Object System.IO.FileInfo('/proc/' + $ownerPid + '/exe')).LinkTarget } catch { }
    if (-not $exe) { throw 'SIMULATOR_LISTENER_EXE_UNREADABLE' }
    $swtpmPath = (Get-Command swtpm -ErrorAction Stop).Source
    $exeResolved = $exe; $swtpmResolved = $swtpmPath
    try { $exeResolved = (Resolve-Path -LiteralPath $exe -ErrorAction Stop).Path } catch { }
    try { $swtpmResolved = (Resolve-Path -LiteralPath $swtpmPath -ErrorAction Stop).Path } catch { }
    if ($exeResolved -ne $swtpmResolved) { throw ('SIMULATOR_LISTENER_EXE_MISMATCH: exe=' + $exe + ' path-swtpm=' + $swtpmPath) }
  }
  $serverOk = $false
  for ($i = 0; $i -lt $argv.Count - 1; $i++) {
    if ($argv[$i] -eq '--server') {
      $opts = @($argv[$i + 1].Split(','))
      if (($opts -contains 'type=tcp') -and ($opts -contains ('port=' + $Port)) -and (($opts -contains 'bindaddr=127.0.0.1') -or ($opts -contains 'bindaddr=::1'))) { $serverOk = $true }
    }
  }
  if (-not $serverOk) { throw 'SIMULATOR_LISTENER_CMDLINE_PORT_OR_BIND_MISMATCH' }
  # منفذُ التحكّمِ (WL-413 الدفعة الثالثة / G47-413-8): إن كانَ TCP فلا بدَّ أن يكونَ على loopback —
  # منفذُ تحكّمٍ مكشوفٌ قناةُ تحكّمٍ بالحالةِ بلا مصادقةٍ. ctrl من نوعٍ آخر أو غيابُهُ مقبولٌ.
  for ($i = 0; $i -lt $argv.Count - 1; $i++) {
    if ($argv[$i] -eq '--ctrl') {
      $opts = @($argv[$i + 1].Split(','))
      if ($opts -contains 'type=tcp') {
        if (-not (($opts -contains 'bindaddr=127.0.0.1') -or ($opts -contains 'bindaddr=::1'))) {
          throw 'SIMULATOR_LISTENER_CTRL_PORT_NOT_LOOPBACK'
        }
      }
    }
  }
  return ('pid=' + $ownerPid + ' comm=' + $comm)
}

try { $listenerBefore = Assert-SimulatorListener -Port $SimPort -ExpectedPid $expectedPid }
catch { Write-ToolError ('simulator context mismatch: ' + $_.Exception.Message) }

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
# إعادةُ التحقّقِ بعدَ البروفة: تبدُّلُ المالكِ أثناءَ التشغيلِ يُبطِلُ ادّعاءَ أنّ الأوامرَ ذهبت إلى المحاكي.
$listenerAfter = $null
try { $listenerAfter = Assert-SimulatorListener -Port $SimPort -ExpectedPid $expectedPid } catch { $listenerAfter = 'unverifiable: ' + $_.Exception.Message }
$report.Fact('transport.listener.before', $listenerBefore)
$report.Fact('transport.listener.after', $listenerAfter)
if ($listenerAfter -ne $listenerBefore) {
  $report.CleanupLeftovers.Add('transport context changed or unverifiable after run: before=' + $listenerBefore + ' after=' + $listenerAfter)
  if ($report.Status -eq 'COMPLETE') { $report.Status = 'FAILED_CLOSED' }
}
[Console]::Out.WriteLine($report.ToJson())
if ($report.Status -eq 'COMPLETE') { exit 0 }
if ($report.Status -eq 'TOOL_ERROR') { exit 4 }
exit 1
