# sim/channel/win_responder.ps1
#
# PoC تشخيصي مؤقت غير إنتاجي (transient, non-production, no-TPM-write diagnostic PoC).
# مستجيب وهمي TCP على Windows ببروتوكول XU-frame (مطابق لـtcp_responder.mjs في WSL).
# يستخدم لاختبار الاتجاه WSL -> Windows عبر NAT.
#
# الضمانات: timeout إلزامي (افتراضي 30 ث، حد أقصى 300 ث)، kill switch (ملف)،
# تنظيف تلقائي في finally، حد أقصى للحجم (65536)، رفض malformed وBAD_CRC وOversize،
# rate limiting لكل اتصال، رفض الإعادة (رتابة counter)، منع 0.0.0.0/:: وعناوين LAN
# (loopback فقط افتراضياً؛ 172.16.0.0/12 لشبكة WSL الافتراضية يتطلب -AllowWslNat
# explicit)، لا خدمة دائمة ولا Scheduled Task ولا قاعدة Firewall ولا TPM.
#
# الاستخدام:
#   powershell -ExecutionPolicy Bypass -File sim\channel\win_responder.ps1 -Port 47849 `
#     -Bind 172.20.0.1 -AllowWslNat -LifetimeSec 30

param(
  [Parameter(Mandatory = $true)][int]$Port,
  [string]$Bind = '127.0.0.1',
  [int]$LifetimeSec = 30,
  [int]$RateLimit = 100,
  [string]$KillFile = '',
  [switch]$AllowWslNat
)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8   # خرجٌ عربيٌّ سليمٌ في وحدة التحكم

$ErrorActionPreference = 'Stop'

# ------------------------------ سياسة الربط ------------------------------
function Test-BindPolicy([string]$addr, [bool]$allowWslNat) {
  if ([string]::IsNullOrWhiteSpace($addr)) { return 'REFUSED_EMPTY_BIND' }
  if ($addr -eq '0.0.0.0' -or $addr -eq '::' -or $addr -eq '::0') { return 'REFUSED_WILDCARD_BIND' }
  if ($addr -like '127.*') { return $null }   # loopback مسموح دائماً
  $m = $addr -match '^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$'   # 172.16.0.0/12 (شبكة WSL الافتراضية)
  if ($m) {
    if (-not $allowWslNat) { return 'REFUSED_WSL_NAT_WITHOUT_FLAG: pass -AllowWslNat explicitly' }
    return $null
  }
  return 'REFUSED_NON_LOOPBACK_NON_WSL_NAT'
}

$policyViolation = Test-BindPolicy $Bind ([bool]$AllowWslNat)
if ($policyViolation) {
  Write-Output "BIND_POLICY: $policyViolation : $Bind"
  exit 4
}
if ($LifetimeSec -le 0 -or $LifetimeSec -gt 300) {
  Write-Output 'LIFETIME: يجب أن يكون بين 1 و300 ثانية (timeout إلزامي)'
  exit 2
}
if (-not $KillFile) { $KillFile = Join-Path $env:TEMP "xuux-poc-win-kill-$Port" }

# ------------------------------ بروتوكول XU ------------------------------
$Script:XU_MAGIC = 0x5855
$Script:XU_HEADER = 14
$Script:XU_CRC = 2
$Script:XU_MAX_PAYLOAD = 65536

function Get-Crc16([byte[]]$data) {
  [int]$crc = 0xFFFF
  foreach ($b in $data) {
    $crc = $crc -bxor ($b -shl 8)
    for ($i = 0; $i -lt 8; $i++) {
      if ($crc -band 0x8000) { $crc = (($crc -shl 1) -bxor 0x1021) -band 0xFFFF }
      else { $crc = ($crc -shl 1) -band 0xFFFF }
    }
  }
  return $crc -band 0xFFFF
}

function New-XuFrame([byte[]]$payload, [uint64]$counter) {
  if ($payload.Length -gt $Script:XU_MAX_PAYLOAD) { throw 'PAYLOAD_TOO_LARGE' }
  $buf = New-Object byte[] ($Script:XU_HEADER + $payload.Length + $Script:XU_CRC)
  $buf[0] = 0x58; $buf[1] = 0x55
  $c = [BitConverter]::GetBytes([uint64]$counter); [Array]::Reverse($c); [Array]::Copy($c, 0, $buf, 2, 8)
  $l = [BitConverter]::GetBytes([uint32]$payload.Length); [Array]::Reverse($l); [Array]::Copy($l, 0, $buf, 10, 4)
  [Array]::Copy($payload, 0, $buf, 14, $payload.Length)
  $crc = Get-Crc16 $buf[0..(13 + $payload.Length)]
  $c2 = [BitConverter]::GetBytes([uint16]$crc); [Array]::Reverse($c2); [Array]::Copy($c2, 0, $buf, 14 + $payload.Length, 2)
  return ,$buf
}

# يرجع hashtable: ok / error / counter / payload / totalLen
function ConvertFrom-XuFrame([byte[]]$buf) {
  if ($buf.Length -lt ($Script:XU_HEADER + $Script:XU_CRC)) { return @{ ok = $false; error = 'TOO_SHORT' } }
  if ($buf[0] -ne 0x58 -or $buf[1] -ne 0x55) { return @{ ok = $false; error = 'BAD_MAGIC' } }
  $lenBytes = $buf[10..13]; [Array]::Reverse($lenBytes)
  $len = [BitConverter]::ToUInt32($lenBytes, 0)
  if ($len -gt $Script:XU_MAX_PAYLOAD) { return @{ ok = $false; error = 'PAYLOAD_TOO_LARGE' } }
  $total = $Script:XU_HEADER + $len + $Script:XU_CRC
  if ($buf.Length -lt $total) { return @{ ok = $false; error = 'INCOMPLETE' } }
  $crcBytes = $buf[($total - 2)..($total - 1)]; [Array]::Reverse($crcBytes)
  $crc = [BitConverter]::ToUInt16($crcBytes, 0)
  $expected = Get-Crc16 $buf[0..($total - 3)]
  if ($crc -ne $expected) { return @{ ok = $false; error = 'BAD_CRC' } }
  $cntBytes = $buf[2..9]; [Array]::Reverse($cntBytes)
  $counter = [BitConverter]::ToUInt64($cntBytes, 0)
  return @{ ok = $true; counter = $counter; len = $len; totalLen = $total }
}

# ------------------------------ التشغيل ------------------------------
$stats = [ordered]@{
  tool = 'win_responder'; bind = $Bind; port = $Port
  lifetime_s = $LifetimeSec; connections = 0; messages_ok = 0
  rejected = [ordered]@{ RATE_LIMITED = 0; REPLAY = 0; MALFORMED = 0; OVERSIZE = 0 }
  exit_reason = $null
}

$listener = $null
try {
  $listener = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Parse($Bind), $Port)
  $listener.Start()
  Write-Output ('POC_READY ' + (@{
    tool = 'win_responder'; bind = $Bind; port = $Port
    lifetime_s = $LifetimeSec; kill_file = $KillFile
    protocol = 'XU-frame/tcp'; max_payload = $Script:XU_MAX_PAYLOAD
    tpm = 'none (no-TPM-write diagnostic PoC)'
  } | ConvertTo-Json -Compress))

  $deadline = (Get-Date).AddSeconds($LifetimeSec)
  $pendingAccept = $null
  while ($true) {
    if ((Get-Date) -ge $deadline) { $stats.exit_reason = 'lifetime'; break }
    if (Test-Path $KillFile) { $stats.exit_reason = 'kill-file'; break }

    # قبول بمهلة 250 ملّي ثانية دون تكديس مهام معلّقة
    if (-not $pendingAccept) { $pendingAccept = $listener.AcceptTcpClientAsync() }
    $accepted = $false
    try { $accepted = $pendingAccept.Wait(250) } catch { $stats.exit_reason = 'accept-error'; break }
    if (-not $accepted) { continue }
    $client = $pendingAccept.Result
    $pendingAccept = $null

    $stats.connections++
    $stream = $client.GetStream()
    $stream.ReadTimeout = 10000   # مهلة خمول 10 ث
    $recvBuf = New-Object byte[] 65536
    $acc = New-Object System.Collections.Generic.List[byte]
    $lastCounter = [uint64]0
    $rateWindow = [Diagnostics.Stopwatch]::StartNew()
    $rateCount = 0
    $destroyed = $false

    while (-not $destroyed) {
      try {
        $n = $stream.Read($recvBuf, 0, $recvBuf.Length)
        if ($n -le 0) { break }
      } catch { break }   # مهلة/انقطاع -> إغلاق الاتصال
      for ($i = 0; $i -lt $n; $i++) { $acc.Add($recvBuf[$i]) }

      # معالجة كل الرسائل الكاملة في الصوان
      while ($acc.Count -ge ($Script:XU_HEADER + $Script:XU_CRC)) {
        $lenBytes = @($acc[10..13]); [Array]::Reverse($lenBytes)
        $frameLen = [BitConverter]::ToUInt32($lenBytes, 0)
        if ($frameLen -gt $Script:XU_MAX_PAYLOAD) {
          $stats.rejected.OVERSIZE++; $destroyed = $true; break
        }
        $total = $Script:XU_HEADER + $frameLen + $Script:XU_CRC
        if ($acc.Count -lt $total) { break }   # انتظار البقية
        $frame = $acc.GetRange(0, $total).ToArray()
        $m = ConvertFrom-XuFrame $frame
        if (-not $m.ok) {
          $key = if ($m.error -eq 'PAYLOAD_TOO_LARGE') { 'OVERSIZE' } else { 'MALFORMED' }
          $stats.rejected.$key++; $destroyed = $true; break
        }
        if ($rateWindow.ElapsedMilliseconds -ge 1000) { $rateWindow.Restart(); $rateCount = 0 }
        if ($rateCount -ge $RateLimit) { $stats.rejected.RATE_LIMITED++; $destroyed = $true; break }
        if ($m.counter -le $lastCounter) { $stats.rejected.REPLAY++; $destroyed = $true; break }
        $rateCount++; $lastCounter = $m.counter
        $stats.messages_ok++
        $reply = [Text.Encoding]::ASCII.GetBytes("diag:ok:counter=$($m.counter):len=$($m.len):no-tpm")
        try { $stream.Write((New-XuFrame $reply $m.counter), 0, ($Script:XU_HEADER + $reply.Length + $Script:XU_CRC)) }
        catch { $destroyed = $true; break }
        $acc.RemoveRange(0, $total)
      }
    }
    try { $client.Close() } catch {}
  }
  if (-not $stats.exit_reason) { $stats.exit_reason = 'lifetime' }
}
finally {
  # تنظيف تلقائي كامل
  if ($listener) { try { $listener.Stop() } catch {} }
  if ($stats.exit_reason -eq 'kill-file' -and (Test-Path $KillFile)) {
    try { Remove-Item $KillFile -Force } catch {}
  }
  Write-Output ('POC_EXIT ' + ($stats | ConvertTo-Json -Compress))
}
