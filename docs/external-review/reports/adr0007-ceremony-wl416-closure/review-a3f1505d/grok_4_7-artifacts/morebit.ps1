# Independent observation: more/count on a fresh swtpm NV inventory, before and after one owner-range define.
# Does not modify the review tree.
$ErrorActionPreference = 'Stop'
Add-Type -Path '/home/user/workspace/xuux-review-a3f1505d/sim/tpm-ceremony/TpmCeremonyCore.cs' -IgnoreWarnings
function Dump([string]$label, $t, [uint32]$start) {
  $raw = $t.Transmit([Xuux.TpmCeremony.Cmd]::GetCapability(1, $start, 64))
  $rc = ([uint32]$raw[6] -shl 24) -bor ([uint32]$raw[7] -shl 16) -bor ([uint32]$raw[8] -shl 8) -bor $raw[9]
  $more = $raw[10]
  $cap = ([uint32]$raw[11] -shl 24) -bor ([uint32]$raw[12] -shl 16) -bor ([uint32]$raw[13] -shl 8) -bor $raw[14]
  $n = ([uint32]$raw[15] -shl 24) -bor ([uint32]$raw[16] -shl 16) -bor ([uint32]$raw[17] -shl 8) -bor $raw[18]
  $hs = @()
  for ($i = 0; $i -lt $n; $i++) {
    $o = 19 + 4 * $i
    $h = ([uint32]$raw[$o] -shl 24) -bor ([uint32]$raw[$o+1] -shl 16) -bor ([uint32]$raw[$o+2] -shl 8) -bor $raw[$o+3]
    $hs += ('0x{0:x8}' -f $h)
  }
  Write-Output ("{0}: rc=0x{1:x8} more={2} cap={3} count={4} handles={5}" -f $label, $rc, $more, $cap, $n, ($hs -join ','))
}
$port = 7746
$t = New-Object Xuux.TpmCeremony.SwtpmLoopbackTransport('127.0.0.1', $port)
try {
  Dump 'nv-empty' $t 0x01000000
  $pub = New-Object Xuux.TpmCeremony.Wr
  [void]$pub.U32(0x01000001).U16(0x000B).U32(0x00040004).B2B([byte[]]@()).U16(0)
  $def = $t.Transmit([Xuux.TpmCeremony.Cmd]::NvDefineSpace([byte[]]@(), [byte[]]@(), $pub.Bytes()))
  $drc = ([uint32]$def[6] -shl 24) -bor ([uint32]$def[7] -shl 16) -bor ([uint32]$def[8] -shl 8) -bor $def[9]
  Write-Output ("define-0x01000001 rc=0x{0:x8}" -f $drc)
  Dump 'nv-after-one' $t 0x01000000
  $pub2 = New-Object Xuux.TpmCeremony.Wr
  [void]$pub2.U32(0x01807777).U16(0x000B).U32(0x00040004).B2B([byte[]]@()).U16(0)
  $def2 = $t.Transmit([Xuux.TpmCeremony.Cmd]::NvDefineSpace([byte[]]@(), [byte[]]@(), $pub2.Bytes()))
  $drc2 = ([uint32]$def2[6] -shl 24) -bor ([uint32]$def2[7] -shl 16) -bor ([uint32]$def2[8] -shl 8) -bor $def2[9]
  Write-Output ("define-0x01807777 rc=0x{0:x8}" -f $drc2)
  Dump 'nv-after-two' $t 0x01000000
} finally { $t.Dispose() }
