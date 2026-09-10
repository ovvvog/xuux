# sim/channel/win_tcp_probe.ps1
#
# PoC تشخيصي مؤقت غير إنتاجي (transient, non-production, no-TPM-write diagnostic PoC).
# عميل Windows يرسل رسائل XU-frame إلى مستجيب قناة (tcp_responder.mjs داخل WSL)
# ويقيس أزمنة الذهاب والعودة عبر حد Windows/WSL2. لا يستمع ولا يغيّر شيئاً ولا يلمس TPM.
#
# الاستخدام:
#   powershell -ExecutionPolicy Bypass -File sim\channel\win_tcp_probe.ps1 -Host 172.20.0.5 -Port 47849
#   (عنوان WSL يُستخرج داخل WSL بالأمر: hostname -I)

param(
  [Parameter(Mandatory = $true)][string]$TargetHost,
  [Parameter(Mandatory = $true)][int]$Port,
  [int]$Count = 5,
  [int]$PayloadSize = 64,
  [int]$TimeoutMs = 10000
)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8   # خرجٌ عربيٌّ سليمٌ في وحدة التحكم

$ErrorActionPreference = 'Stop'
if ($Count -lt 1 -or $Count -gt 100) { Write-Output 'COUNT: 1..100'; exit 2 }
if ($PayloadSize -lt 1 -or $PayloadSize -gt 65536) { Write-Output 'PAYLOAD: 1..65536'; exit 2 }
if ($TimeoutMs -lt 1 -or $TimeoutMs -gt 60000) { Write-Output 'TIMEOUT: 1..60000'; exit 2 }

$XU_MAGIC = 0x5855; $XU_HEADER = 14; $XU_CRC = 2; $XU_MAX_PAYLOAD = 65536

function Get-Crc16([byte[]]$data) {
  [int]$crc = 0xFFFF
  foreach ($b in $data) {
    # ملاحظة حرجة: [byte] -shl 8 في PowerShell يبقى بعرض بايت ويُقصّ إلى صفر ⇒ حشو صريح إلى [int]
    $crc = $crc -bxor ([int]$b -shl 8)
    for ($i = 0; $i -lt 8; $i++) {
      if ($crc -band 0x8000) { $crc = (($crc -shl 1) -bxor 0x1021) -band 0xFFFF }
      else { $crc = ($crc -shl 1) -band 0xFFFF }
    }
  }
  return $crc -band 0xFFFF
}

function New-XuFrame([byte[]]$payload, [uint64]$counter) {
  $buf = New-Object byte[] ($XU_HEADER + $payload.Length + $XU_CRC)
  $buf[0] = 0x58; $buf[1] = 0x55
  $c = [BitConverter]::GetBytes([uint64]$counter); [Array]::Reverse($c); [Array]::Copy($c, 0, $buf, 2, 8)
  $l = [BitConverter]::GetBytes([uint32]$payload.Length); [Array]::Reverse($l); [Array]::Copy($l, 0, $buf, 10, 4)
  [Array]::Copy($payload, 0, $buf, 14, $payload.Length)
  $crc = Get-Crc16 $buf[0..(13 + $payload.Length)]
  $c2 = [BitConverter]::GetBytes([uint16]$crc); [Array]::Reverse($c2); [Array]::Copy($c2, 0, $buf, 14 + $payload.Length, 2)
  return ,$buf
}

$report = [ordered]@{
  tool = 'win_tcp_probe'; host = $TargetHost; port = $Port
  count = $Count; payload_size = $PayloadSize
  ok = 0; failed = 0; rtts_ms = @(); error = $null
}

try {
  $client = New-Object System.Net.Sockets.TcpClient
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $client.Connect($TargetHost, $Port)
  $stream = $client.GetStream()
  $stream.ReadTimeout = $TimeoutMs
  $stream.WriteTimeout = $TimeoutMs

  $recvBuf = New-Object byte[] 131072
  $acc = New-Object System.Collections.Generic.List[byte]

  for ($i = 1; $i -le $Count; $i++) {
    $payload = New-Object byte[] $PayloadSize
    for ($j = 0; $j -lt $PayloadSize; $j++) { $payload[$j] = (65 + ($i % 26)) }
    $frame = New-XuFrame $payload ([uint64]$i)
    $t0 = [Diagnostics.Stopwatch]::StartNew()
    $stream.Write($frame, 0, $frame.Length)

    # قراءة الرد المؤطر كاملاً
    $reply = $null
    while ($true) {
      if ($acc.Count -ge ($XU_HEADER + $XU_CRC)) {
        $lenBytes = @($acc[10..13]); [Array]::Reverse($lenBytes)
        $fl = [BitConverter]::ToUInt32($lenBytes, 0)
        if ($fl -gt $XU_MAX_PAYLOAD) { throw 'BAD_RESPONSE:PAYLOAD_TOO_LARGE' }
        $total = $XU_HEADER + $fl + $XU_CRC
        if ($acc.Count -ge $total) {
          $reply = $acc.GetRange(0, $total).ToArray()
          $acc.RemoveRange(0, $total)
          break
        }
      }
      $n = $stream.Read($recvBuf, 0, $recvBuf.Length)
      if ($n -le 0) { throw 'BAD_RESPONSE:DISCONNECT' }
      for ($k = 0; $k -lt $n; $k++) { $acc.Add($recvBuf[$k]) }
    }
    $t0.Stop()
    # تحقق: magic + counter
    if ($reply[0] -ne 0x58 -or $reply[1] -ne 0x55) { throw 'BAD_RESPONSE:BAD_MAGIC' }
    $cntBytes = @($reply[2..9]); [Array]::Reverse($cntBytes)
    $rc = [BitConverter]::ToUInt64($cntBytes, 0)
    if ($rc -ne [uint64]$i) { throw "BAD_RESPONSE:COUNTER $rc != $i" }
    $report.rtts_ms += $t0.ElapsedMilliseconds
    $report.ok++
  }
} catch {
  $report.error = $_.Exception.Message
  $report.failed = $Count - $report.ok
} finally {
  if ($client) { try { $client.Close() } catch {} }
}

if ($report.rtts_ms.Count -gt 0) {
  $sorted = $report.rtts_ms | Sort-Object
  $report.rtt_min_ms = $sorted[0]
  $report.rtt_median_ms = $sorted[[int][Math]::Floor($sorted.Count / 2)]
  $report.rtt_max_ms = $sorted[-1]
}
Write-Output ('PROBE_RESULT ' + ($report | ConvertTo-Json -Compress))
if ($report.ok -eq $Count -and $report.failed -eq 0) { exit 0 } else { exit 1 }
