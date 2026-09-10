# sim/channel/win_hvsock_listener.ps1
#
# PoC تشخيصي مؤقت غير إنتاجي (transient, non-production, no-TPM-write diagnostic PoC).
# EXPERIMENTAL — مستجيب وهمي عبر AF_HYPERV (hvsocket) على Windows يستقبل اتصال AF_VSOCK
# واحداً من WSL عبر المنفذ <port> (الخدمة = GUID قالب vsock: <port>-facb-11e6-bd58-64006a7986d3
# وفق وثائق Microsoft وتنفيذ hv_sock في نواة لينكس).
#
# الضمانات: timeout إلزامي (افتراضي 30 ث، حد أقصى 300)، kill switch، تنظيف تلقائي
# (يحذف مفتاح السجل إن أنشأه)، حد أقصى للحجم، رفض malformed، لا TPM ولا خدمة دائمة
# ولا Scheduled Task ولا قاعدة Firewall.
#
# مفتاح السجل (اختياري -RegisterServiceKey): اتصالات guest->host عبر hvsocket
# تتطلب عادةً تسجيل الخدمة تحت GuestCommunicationServices — إنشاء مؤقت فقط،
# يُحذف تلقائياً عند الخروج. يتطلب PowerShell كمسؤول. غيابه غالباً يعني
# ECONNRESET/ETIMEDOUT من جهة WSL — وهي نتيجة تشخيصية مقبولة تُسجَّل كما هي.
#
# الاستخدام:
#   powershell -ExecutionPolicy Bypass -File sim\channel\win_hvsock_listener.ps1 -Port 60601
#   powershell ... -Port 60601 -RegisterServiceKey          (كمسؤول)
#   powershell ... -Port 60601 -VmId <guid من hcsdiag list>  (إن لم يعمل البدل ANY)

param(
  [Parameter(Mandatory = $true)][int]$Port,
  [string]$VmId = '00000000-0000-0000-0000-000000000000',   # HV_GUID_ANY
  [int]$LifetimeSec = 30,
  [string]$KillFile = '',
  [switch]$RegisterServiceKey
)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8   # خرجٌ عربيٌّ سليمٌ في وحدة التحكم

$ErrorActionPreference = 'Stop'
if ($LifetimeSec -le 0 -or $LifetimeSec -gt 300) { Write-Output 'LIFETIME: 1..300'; exit 2 }
if (-not $KillFile) { $KillFile = Join-Path $env:TEMP "xuux-poc-hvsock-kill-$Port" }

# ServiceId = قالب vsock: <port-hex8>-facb-11e6-bd58-64006a7986d3
$ServiceId = ('{0:x8}-facb-11e6-bd58-64006a7986d3' -f $Port)

# ------------------------------ C#: نقطة نهاية AF_HYPERV ------------------------------
$src = @'
using System;
using System.Net;
using System.Net.Sockets;

namespace XuuxPoc {
    // SOCKADDR_HV: Family(2) + Reserved(2) + VmId(16) + ServiceId(16) = 36 بايتاً
    public class HvSockEndPoint : EndPoint {
        public Guid VmId;
        public Guid ServiceId;
        public const int HvAddressFamily = 34;   // AF_HYPERV
        public const int HvProtocolRaw = 1;      // HV_PROTOCOL_RAW

        public HvSockEndPoint(Guid vmId, Guid serviceId) {
            VmId = vmId; ServiceId = serviceId;
        }
        public override AddressFamily AddressFamily {
            get { return (AddressFamily)HvAddressFamily; }
        }
        public override SocketAddress Serialize() {
            var s = new SocketAddress((AddressFamily)HvAddressFamily, 36);
            byte[] vm = VmId.ToByteArray();
            byte[] sv = ServiceId.ToByteArray();
            for (int i = 0; i < 16; i++) { s[4 + i] = vm[i]; s[20 + i] = sv[i]; }
            return s;
        }
        public override EndPoint Create(SocketAddress socketAddress) {
            if (socketAddress.Size != 36) throw new ArgumentException("bad SOCKADDR_HV size");
            byte[] vm = new byte[16]; byte[] sv = new byte[16];
            for (int i = 0; i < 16; i++) { vm[i] = sbyteToByte(socketAddress[4 + i]); sv[i] = sbyteToByte(socketAddress[20 + i]); }
            return new HvSockEndPoint(new Guid(vm), new Guid(sv));
        }
        private static byte sbyteToByte(object v) { return (byte)v; }
    }
}
'@
Add-Type -TypeDefinition $src -ErrorAction Stop

# ------------------------------ التسجيل المؤقت في السجل (اختياري) ------------------------------
$gcsPath = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Virtualization\GuestCommunicationServices'
$regKeyCreated = $false
if ($RegisterServiceKey) {
  $full = Join-Path $gcsPath $ServiceId
  if (Test-Path $full) {
    Write-Output "REGISTRY: المفتاح موجود مسبقاً — لن يُحذف عند الخروج: $ServiceId"
  } else {
    try {
      New-Item -Path $gcsPath -Name $ServiceId -Force | Out-Null
      Set-ItemProperty -Path $full -Name 'DisplayName' -Value 'xuux PoC (transient diagnostic — auto-removed)'
      $regKeyCreated = $true
      Write-Output "REGISTRY: أُنشئ مفتاح مؤقت $ServiceId (سيُحذف تلقائياً عند الخروج)"
    } catch {
      Write-Output "REGISTRY: فشل الإنشاء (مسؤول؟) — $($_.Exception.Message) — نتابع بدونه"
    }
  }
}

# ------------------------------ بروتوكول XU ------------------------------
$XU_HEADER = 14; $XU_CRC = 2; $XU_MAX_PAYLOAD = 65536

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

# ------------------------------ التشغيل ------------------------------
$stats = [ordered]@{
  tool = 'win_hvsock_listener'; port = $Port; vm_id = $VmId; service_id = $ServiceId
  lifetime_s = $LifetimeSec; connections = 0; messages_ok = 0
  rejected = [ordered]@{ MALFORMED = 0; OVERSIZE = 0; REPLAY = 0 }
  last_reject = $null; bytes_received = 0; first_bytes_hex = $null
  exit_reason = $null
}

$listener = $null

# إنشاء السوكيت بعائلة AF_HYPERV مباشرة (34 / Stream / HV_PROTOCOL_RAW)
$listener = New-Object System.Net.Sockets.Socket(
  [System.Net.Sockets.AddressFamily]34,
  [System.Net.Sockets.SocketType]::Stream,
  [System.Net.Sockets.ProtocolType]1)

try {
  $ep = New-Object XuuxPoc.HvSockEndPoint ([Guid]$VmId), ([Guid]$ServiceId)
  $listener.Bind($ep)
  $listener.Listen(4)
  Write-Output ('POC_READY ' + (@{
    tool = 'win_hvsock_listener'; port = $Port; vm_id = $VmId; service_id = $ServiceId
    lifetime_s = $LifetimeSec; kill_file = $KillFile
    protocol = 'XU-frame/hvsock(AF_HYPERV)'
    registry_key_created = $regKeyCreated
    experimental = $true
    tpm = 'none (no-TPM-write diagnostic PoC)'
  } | ConvertTo-Json -Compress))

  $deadline = (Get-Date).AddSeconds($LifetimeSec)
  while ($true) {
    if ((Get-Date) -ge $deadline) { $stats.exit_reason = 'lifetime'; break }
    if (Test-Path $KillFile) { $stats.exit_reason = 'kill-file'; break }
    if (-not $listener.Poll(250000, [System.Net.Sockets.SelectMode]::SelectRead)) { continue }

    $client = $listener.Accept()
    $stats.connections++
    try {
      $client.ReceiveTimeout = 10000
      $client.SendTimeout = 10000
      # اقرأ إطاراً واحداً (حد أقصى 65552 بايتاً) — بأنواع byte[] صريحة، ورفض مُعلَّل
      $recvBuf = New-Object byte[] 65552
      $acc = New-Object System.Collections.Generic.List[byte]
      [byte[]]$frame = $null
      [int]$total = 0
      [int]$fl = 0
      $rejectReason = $null
      $readDeadline = (Get-Date).AddSeconds(10)
      while ($true) {
        if ((Get-Date) -ge $readDeadline) { $rejectReason = 'READ_TIMEOUT'; break }
        $n = 0
        try { $n = $client.Receive($recvBuf) }
        catch { $rejectReason = 'RECV_ERROR:' + $_.Exception.Message; break }
        if ($n -le 0) { $rejectReason = 'PEER_CLOSED'; break }
        for ($i = 0; $i -lt $n; $i++) { $acc.Add($recvBuf[$i]) }
        if ($acc.Count -lt ($XU_HEADER + $XU_CRC)) { continue }
        [byte[]]$lenBytes = @($acc[10], $acc[11], $acc[12], $acc[13])
        [Array]::Reverse($lenBytes)
        $fl = [int][BitConverter]::ToUInt32($lenBytes, 0)
        if ($fl -gt $XU_MAX_PAYLOAD) { $rejectReason = 'OVERSIZE'; break }
        $total = $XU_HEADER + $fl + $XU_CRC
        if ($acc.Count -lt $total) { continue }
        [byte[]]$frame = $acc.GetRange(0, $total).ToArray()
        break
      }

      # بصمة تشخيصية للبايتات الواصلة فعلاً (بيانات وهمية فقط — لا أسرار)
      $stats.bytes_received = $acc.Count
      if ($acc.Count -gt 0) {
        $take = [Math]::Min(64, $acc.Count)
        $stats.first_bytes_hex = (($acc.GetRange(0, $take).ToArray() |
          ForEach-Object { $_.ToString('x2') }) -join '')
      }

      if ($frame) {
        if ($frame[0] -ne 0x58 -or $frame[1] -ne 0x55) {
          $rejectReason = ('BAD_MAGIC got=0x{0:x2}{1:x2}' -f $frame[0], $frame[1])
        }
        else {
          [byte[]]$crcBytes = @($frame[$total - 2], $frame[$total - 1])
          [Array]::Reverse($crcBytes)
          $crc = [int][BitConverter]::ToUInt16($crcBytes, 0)
          [byte[]]$covered = $frame[0..($total - 3)]
          $expected = [int](Get-Crc16 $covered)
          if ($crc -ne $expected) {
            $rejectReason = ('BAD_CRC got=0x{0:x4} want=0x{1:x4} len={2}' -f $crc, $expected, $fl)
          }
          else {
            [byte[]]$cntBytes = @($frame[2..9]); [Array]::Reverse($cntBytes)
            $counter = [BitConverter]::ToUInt64($cntBytes, 0)
            $stats.messages_ok++
            $reply = [Text.Encoding]::ASCII.GetBytes("diag:ok:counter=$counter`:len=$fl`:no-tpm")
            $out = New-XuFrame $reply $counter
            $client.Send($out) | Out-Null
            Write-Output ("CONN_OK counter=$counter len=$fl")
          }
        }
      }
      elseif (-not $rejectReason) { $rejectReason = 'INCOMPLETE' }

      if ($rejectReason) {
        $stats.last_reject = $rejectReason
        if ($rejectReason -eq 'OVERSIZE') { $stats.rejected.OVERSIZE++ }
        else { $stats.rejected.MALFORMED++ }
        Write-Output ("CONN_REJECT $rejectReason bytes=$($acc.Count) hex=$($stats.first_bytes_hex)")
      }
    } catch {
      Write-Output ("CONN_ERROR: " + $_.Exception.Message)
    } finally {
      try { $client.Close() } catch {}
    }
  }
}
finally {
  # تنظيف تلقائي كامل: السوكيت + مفتاح السجل المؤقت إن أنشأناه
  if ($listener) { try { $listener.Close() } catch {} }
  if ($regKeyCreated) {
    try {
      Remove-Item (Join-Path $gcsPath $ServiceId) -Force
      Write-Output "REGISTRY: حُذف المفتاح المؤقت $ServiceId"
    } catch { Write-Output "REGISTRY_CLEANUP_FAILED: $($_.Exception.Message)" }
  }
  if ($stats.exit_reason -eq 'kill-file' -and (Test-Path $KillFile)) {
    try { Remove-Item $KillFile -Force } catch {}
  }
  if (-not $stats.exit_reason) { $stats.exit_reason = 'lifetime' }
  Write-Output ('POC_EXIT ' + ($stats | ConvertTo-Json -Compress))
}
