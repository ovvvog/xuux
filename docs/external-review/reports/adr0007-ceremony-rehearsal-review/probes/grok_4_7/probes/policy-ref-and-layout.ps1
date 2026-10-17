#Requires -Version 5.1
param([Parameter(Mandatory=$true)][int]$SimPort)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$core = '/home/user/workspace/xuux-review-50518cf6/sim/tpm-ceremony/TpmCeremonyCore.cs'
Add-Type -Path $core -IgnoreWarnings

function CcOf([byte[]]$b) { return ($b[6]*16777216 + $b[7]*65536 + $b[8]*256 + $b[9]) }
function ReadBuf([byte[]]$b) { return [Xuux.TpmCeremony.Rd]::new((,$b)) }
function Layout([string]$name, [byte[]]$b) {
  $tag = ($b[0]*256 + $b[1])
  $size = ($b[2]*16777216 + $b[3]*65536 + $b[4]*256 + $b[5])
  $cc = CcOf $b
  [ordered]@{ name=$name; len=$b.Length; declaredSize=$size; sizeMatch=($size -eq $b.Length); tag=('0x{0:x4}' -f $tag); cc=('0x{0:x8}' -f $cc) }
}

$layouts = @()
$z = New-Object byte[] 32
$empty = New-Object byte[] 0
$pub = [Xuux.TpmCeremony.Cmd]::NvPublic(0x01A00011, [Xuux.TpmCeremony.Tpm]::ANCHOR_ATTRIBUTES, $z, 8)
$layouts += Layout 'NV_DefineSpace' ([Xuux.TpmCeremony.Cmd]::NvDefineSpace($empty, $empty, $pub))
$layouts += Layout 'NV_Increment' ([Xuux.TpmCeremony.Cmd]::NvIncrement(0x01A00011, [Xuux.TpmCeremony.Cmd]::PasswordAuth($empty)))
$layouts += Layout 'NV_Read' ([Xuux.TpmCeremony.Cmd]::NvRead(0x01A00011, [Xuux.TpmCeremony.Cmd]::PasswordAuth($empty), 8, 0))
$layouts += Layout 'NV_ReadPublic' ([Xuux.TpmCeremony.Cmd]::NvReadPublic(0x01A00011))
$layouts += Layout 'NV_UndefineSpace' ([Xuux.TpmCeremony.Cmd]::NvUndefineSpace($empty, 0x01A00011))
$layouts += Layout 'CreatePrimary' ([Xuux.TpmCeremony.Cmd]::CreatePrimary($empty, [Xuux.TpmCeremony.Templates]::StoragePrimary()))
$h80000000 = [Convert]::ToUInt32('80000000', 16)
$h80000001 = [Convert]::ToUInt32('80000001', 16)
$h03000000 = [Convert]::ToUInt32('03000000', 16)
$layouts += Layout 'Create' ([Xuux.TpmCeremony.Cmd]::Create($h80000000, $empty, [Xuux.TpmCeremony.Templates]::ServiceSigningKey()))
$layouts += Layout 'Load' ([Xuux.TpmCeremony.Cmd]::Load($h80000000, $empty, $z, $z))
$layouts += Layout 'Sign' ([Xuux.TpmCeremony.Cmd]::Sign($h80000001, $empty, $z))
$layouts += Layout 'StartAuthSession' ([Xuux.TpmCeremony.Cmd]::StartAuthSession([Xuux.TpmCeremony.Tpm]::SE_TRIAL, $z))
$layouts += Layout 'PolicySigned' ([Xuux.TpmCeremony.Cmd]::PolicySigned($h80000001, $h03000000, $z, 0, $z, $z))
$layouts += Layout 'PolicyCommandCode' ([Xuux.TpmCeremony.Cmd]::PolicyCommandCode($h03000000, [Xuux.TpmCeremony.Tpm]::CC_NV_Increment))
$layouts += Layout 'PolicyGetDigest' ([Xuux.TpmCeremony.Cmd]::PolicyGetDigest($h03000000))
$layouts += Layout 'FlushContext' ([Xuux.TpmCeremony.Cmd]::FlushContext($h80000000))
$layouts += Layout 'GetCapability' ([Xuux.TpmCeremony.Cmd]::GetCapability(6, 0x105, 5))

$t = New-Object Xuux.TpmCeremony.SwtpmLoopbackTransport('127.0.0.1', $SimPort)
try {
  function SendOk([byte[]]$cmd, [int]$handles) {
    $raw = $t.Transmit($cmd)
    return [Xuux.TpmCeremony.Resp]::Parse($raw, $handles)
  }
  $id = SendOk ([Xuux.TpmCeremony.Cmd]::GetCapability(6, 0x105, 1)) 0
  if ($id.Rc -ne 0) { throw "identity rc $($id.Rc)" }
  $pp = SendOk ([Xuux.TpmCeremony.Cmd]::CreatePrimary($empty, [Xuux.TpmCeremony.Templates]::StoragePrimary())) 1
  $primary = $pp.Handles[0]
  $cr = SendOk ([Xuux.TpmCeremony.Cmd]::Create($primary, $empty, [Xuux.TpmCeremony.Templates]::ServiceSigningKey())) 0
  $q = ReadBuf $cr.Params
  $priv = $q.B2B(); $opub = $q.B2B()
  $ld = SendOk ([Xuux.TpmCeremony.Cmd]::Load($primary, $empty, $priv, $opub)) 1
  $key = $ld.Handles[0]
  $nq = ReadBuf $ld.Params
  $name = $nq.B2B()
  $nonceCaller = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($nonceCaller)
  $ss = SendOk ([Xuux.TpmCeremony.Cmd]::StartAuthSession([Xuux.TpmCeremony.Tpm]::SE_TRIAL, $nonceCaller)) 1
  $sess = $ss.Handles[0]
  $nonceTpm = (ReadBuf $ss.Params).B2B()
  $ref = [byte[]](0x01, 0x02, 0x03, 0x04)
  $exp = New-Object byte[] 4
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $ms = New-Object System.IO.MemoryStream
  $ms.Write($nonceTpm, 0, $nonceTpm.Length)
  $ms.Write($exp, 0, 4)
  $ms.Write($ref, 0, $ref.Length)
  $aHash = $sha.ComputeHash($ms.ToArray())
  $sig = SendOk ([Xuux.TpmCeremony.Cmd]::Sign($key, $empty, $aHash)) 0
  $sq = ReadBuf $sig.Params
  if ($sq.U16() -ne 0x0018 -or $sq.U16() -ne 0x000B) { throw 'scheme' }
  $sr = $sq.B2B(); $ssig = $sq.B2B()
  $p = (New-Object Xuux.TpmCeremony.Wr).B2B($nonceTpm).B2B($empty).B2B($ref).U32(0).U16(0x0018).U16(0x000B).B2B($sr).B2B($ssig).Bytes()
  $cmd = [Xuux.TpmCeremony.Cmd]::Build(0x00000160, [uint32[]]@($key, $sess), $null, $p)
  $pr = SendOk $cmd 0
  if ($pr.Rc -ne 0) { throw "PolicySigned rc $($pr.Rc)" }
  $pc = SendOk ([Xuux.TpmCeremony.Cmd]::PolicyCommandCode($sess, 0x00000134)) 0
  if ($pc.Rc -ne 0) { throw "PolicyCommandCode rc $($pc.Rc)" }
  $dg = SendOk ([Xuux.TpmCeremony.Cmd]::PolicyGetDigest($sess)) 0
  $digest = (ReadBuf $dg.Params).B2B()
  [void](SendOk ([Xuux.TpmCeremony.Cmd]::FlushContext($sess)) 0)
  [void](SendOk ([Xuux.TpmCeremony.Cmd]::FlushContext($key)) 0)
  [void](SendOk ([Xuux.TpmCeremony.Cmd]::FlushContext($primary)) 0)
  $res = [ordered]@{
    layouts = $layouts
    name = [Xuux.TpmCeremony.Hex]::Of($name)
    policyRef = '01020304'
    tpmDigest = [Xuux.TpmCeremony.Hex]::Of($digest)
    policySignedRc = $pr.Rc
  }
  $res | ConvertTo-Json -Depth 6 -Compress
} finally { $t.Dispose() }
