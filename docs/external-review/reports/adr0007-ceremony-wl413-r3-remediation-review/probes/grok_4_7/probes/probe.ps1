#Requires -Version 5.1
# Independent probes for WL-414 R3. Does not modify the review tree.
# Usage: pwsh -NoProfile -File probe.ps1 -Kind direct
#        pwsh -NoProfile -File probe.ps1 -Kind ceremony -Probe <name> -SimPort 5800
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('direct', 'ceremony', 'enum')][string]$Kind,
  [string]$Probe = 'log',
  [int]$SimPort = 5800
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$dll = '/home/user/workspace/council-wl413-r3/grok_4_7/probes/TpmCeremonyCore.dll'
Add-Type -Path $dll

function Emit($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Depth 8 -Compress))
}

# ── direct: call Resp.Parse / ResponseSchema.Check without a simulator ──
if ($Kind -eq 'direct') {
  $rows = New-Object System.Collections.Generic.List[object]

  function Note($name, $script) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $err = $null
    try { & $script } catch { $err = $_.Exception.InnerException; if (-not $err) { $err = $_.Exception } }
    $sw.Stop()
    $msg = $null; $typ = $null
    if ($err) { $typ = $err.GetType().Name; $msg = $err.Message }
    $rows.Add([ordered]@{ name = $name; threw = [bool]$err; type = $typ; message = $msg; ms = $sw.ElapsedMilliseconds })
  }

  # password-shaped auth on a sessions success header: empty nonce, attrs 0x01, empty hmac
  $pwAuth = [byte[]](0x00, 0x00, 0x01, 0x00, 0x00)
  # policy-shaped: nonce 32, attrs 0x00, hmac empty
  $pol = New-Object System.Collections.Generic.List[byte]
  $pol.Add(0x00); $pol.Add(0x20)
  for ($i = 0; $i -lt 32; $i++) { $pol.Add(0x11) }
  $pol.Add(0x00); $pol.Add(0x00); $pol.Add(0x00)
  $polAuth = $pol.ToArray()

  function SessionsResponse($params, $auth) {
    $body = New-Object Xuux.TpmCeremony.Wr
    [void]$body.U32([uint32]$params.Length).Raw($params).Raw($auth)
    $b = $body.Bytes()
    return (New-Object Xuux.TpmCeremony.Wr).U16(0x8002).U32([uint32](10 + $b.Length)).U32(0).Raw($b).Bytes()
  }
  function NoSessResponse($handles, $params) {
    $body = New-Object Xuux.TpmCeremony.Wr
    foreach ($h in $handles) { [void]$body.U32($h) }
    [void]$body.Raw($params)
    $b = $body.Bytes()
    return (New-Object Xuux.TpmCeremony.Wr).U16(0x8001).U32([uint32](10 + $b.Length)).U32(0).Raw($b).Bytes()
  }

  Note 'parse-password-auth' { [void][Xuux.TpmCeremony.Resp]::Parse((SessionsResponse (New-Object byte[] 0) $pwAuth), 0, 0x8002, 1) }
  Note 'parse-policy-shape-on-any-auth' { [void][Xuux.TpmCeremony.Resp]::Parse((SessionsResponse (New-Object byte[] 0) $polAuth), 0, 0x8002, 1) }
  # nonce 16, attrs 0x08 (reserved bit 3 per Part 2 r01.59 Table 32)
  $a08 = New-Object System.Collections.Generic.List[byte]
  $a08.Add(0x00); $a08.Add(0x10)
  for ($i = 0; $i -lt 16; $i++) { $a08.Add(0x22) }
  $a08.Add(0x08); $a08.Add(0x00); $a08.Add(0x00)
  Note 'parse-policy-nonce16-attrs08' { [void][Xuux.TpmCeremony.Resp]::Parse((SessionsResponse (New-Object byte[] 0) $a08.ToArray()), 0, 0x8002, 1) }
  # attrs 0x02 auditExclusive
  $a02 = New-Object System.Collections.Generic.List[byte]
  $a02.Add(0x00); $a02.Add(0x20)
  for ($i = 0; $i -lt 32; $i++) { $a02.Add(0x33) }
  $a02.Add(0x02); $a02.Add(0x00); $a02.Add(0x00)
  Note 'parse-policy-attrs02' { [void][Xuux.TpmCeremony.Resp]::Parse((SessionsResponse (New-Object byte[] 0) $a02.ToArray()), 0, 0x8002, 1) }
  # hmac one byte — original G47-413-2 shape
  $hmac = [byte[]](0x00, 0x00, 0x01, 0x00, 0x01, 0xFF)
  Note 'parse-hmac-nonzero' { [void][Xuux.TpmCeremony.Resp]::Parse((SessionsResponse (New-Object byte[] 0) $hmac), 0, 0x8002, 1) }
  # parameterSize far above remaining
  $huge = (SessionsResponse (New-Object byte[] 0) $pwAuth)
  $huge[10] = 0x7F; $huge[11] = 0xFF; $huge[12] = 0xFF; $huge[13] = 0xF0
  Note 'parse-paramsize-huge' { [void][Xuux.TpmCeremony.Resp]::Parse($huge, 0, 0x8002, 1) }
  # error 0x18B with bad tag
  $bad = (New-Object Xuux.TpmCeremony.Wr).U16(0x1234).U32(10).U32(0x18B).Bytes()
  Note 'parse-18b-bad-tag' { [void][Xuux.TpmCeremony.Resp]::Parse($bad, 0, 0x8001, 0) }
  # error 0x18B well-formed
  $good = (New-Object Xuux.TpmCeremony.Wr).U16(0x8001).U32(10).U32(0x18B).Bytes()
  Note 'parse-18b-wellformed' { $p = [Xuux.TpmCeremony.Resp]::Parse($good, 0, 0x8001, 0); if ($p.Rc -ne 0x18B) { throw 'rc' } }

  $psCmd = [Xuux.TpmCeremony.Cmd]::PolicySigned([uint32]2147483649, [uint32]0x03000000, (New-Object byte[] 32), 0, (New-Object byte[] 32), (New-Object byte[] 32))
  $timeout8 = (New-Object Xuux.TpmCeremony.Wr).B2B((New-Object byte[] 8)).U16(0x8025).U32(0x40000007).B2B((New-Object byte[] 0)).Bytes()
  Note 'schema-policysigned-timeout8' { [Xuux.TpmCeremony.ResponseSchema]::Check(0x160, $psCmd, $timeout8) }
  $hierBad = (New-Object Xuux.TpmCeremony.Wr).B2B((New-Object byte[] 0)).U16(0x8025).U32(0x40000002).B2B((New-Object byte[] 0)).Bytes()
  Note 'schema-policysigned-hier-40000002' { [Xuux.TpmCeremony.ResponseSchema]::Check(0x160, $psCmd, $hierBad) }
  $tagHash = (New-Object Xuux.TpmCeremony.Wr).B2B((New-Object byte[] 0)).U16(0x8024).U32(0x40000007).B2B((New-Object byte[] 0)).Bytes()
  Note 'schema-policysigned-tag-8024' { [Xuux.TpmCeremony.ResponseSchema]::Check(0x160, $psCmd, $tagHash) }
  $digest65 = (New-Object Xuux.TpmCeremony.Wr).B2B((New-Object byte[] 0)).U16(0x8025).U32(0x40000007).B2B((New-Object byte[] 65)).Bytes()
  Note 'schema-policysigned-digest65' { [Xuux.TpmCeremony.ResponseSchema]::Check(0x160, $psCmd, $digest65) }
  $timeout9 = (New-Object Xuux.TpmCeremony.Wr).B2B((New-Object byte[] 9)).U16(0x8025).U32(0x40000007).B2B((New-Object byte[] 0)).Bytes()
  Note 'schema-policysigned-timeout9' { [Xuux.TpmCeremony.ResponseSchema]::Check(0x160, $psCmd, $timeout9) }

  # Create with a 100-byte ticket digest and a public that matches the template formula
  $tmpl = [Xuux.TpmCeremony.Templates]::ServiceSigningKey()
  $headLen = $tmpl.Length - 4
  $pub = New-Object byte[] ($headLen + 68)
  [Array]::Copy($tmpl, 0, $pub, 0, $headLen)
  $pub[$headLen] = 0; $pub[$headLen + 1] = 32
  for ($i = 0; $i -lt 32; $i++) { $pub[$headLen + 2 + $i] = 0x41 }
  $pub[$headLen + 34] = 0; $pub[$headLen + 35] = 32
  for ($i = 0; $i -lt 32; $i++) { $pub[$headLen + 36 + $i] = 0x42 }
  $cd = (New-Object Xuux.TpmCeremony.Wr).U32(0).U16(32).Raw((New-Object byte[] 32)).U8(0).U16(0x000B).B2B((New-Object byte[] 34)).B2B((New-Object byte[] 34)).B2B((New-Object byte[] 0)).Bytes()
  $digest100 = New-Object byte[] 100
  $createParams = (New-Object Xuux.TpmCeremony.Wr).B2B((New-Object byte[] 4)).B2B($pub).B2B($cd).B2B((New-Object byte[] 32)).U16(0x8021).U32(0x40000001).B2B($digest100).Bytes()
  $createCmd = [Xuux.TpmCeremony.Cmd]::Create([uint32]2147483649, (New-Object byte[] 0), $tmpl)
  Note 'schema-create-ticket-digest100' { [Xuux.TpmCeremony.ResponseSchema]::Check(0x153, $createCmd, $createParams) }
  $hier2 = (New-Object Xuux.TpmCeremony.Wr).B2B((New-Object byte[] 4)).B2B($pub).B2B($cd).B2B((New-Object byte[] 32)).U16(0x8021).U32(0x40000002).B2B((New-Object byte[] 32)).Bytes()
  Note 'schema-create-hier-40000002' { [Xuux.TpmCeremony.ResponseSchema]::Check(0x153, $createCmd, $hier2) }
  # spec-shaped creationData: empty PCR select => pcrDigest size 0 (Part 2 r01.59 Table 222)
  $cd0 = (New-Object Xuux.TpmCeremony.Wr).U32(0).U16(0).U8(0).U16(0x000B).B2B((New-Object byte[] 34)).B2B((New-Object byte[] 34)).B2B((New-Object byte[] 0)).Bytes()
  $cd0p = (New-Object Xuux.TpmCeremony.Wr).B2B((New-Object byte[] 4)).B2B($pub).B2B($cd0).B2B((New-Object byte[] 32)).U16(0x8021).U32(0x40000001).B2B((New-Object byte[] 32)).Bytes()
  Note 'schema-create-pcrdigest-size0' { [Xuux.TpmCeremony.ResponseSchema]::Check(0x153, $createCmd, $cd0p) }

  # GetCapability more=1 count=0
  $gcCmd = [Xuux.TpmCeremony.Cmd]::GetCapability(1, 0x01000000, 64)
  $gcPrm = (New-Object Xuux.TpmCeremony.Wr).U8(1).U32(1).U32(0).Bytes()
  Note 'schema-getcap-no-progress' { [Xuux.TpmCeremony.ResponseSchema]::Check(0x17A, $gcCmd, $gcPrm) }
  # handle class wrong
  $gcBad = (New-Object Xuux.TpmCeremony.Wr).U8(0).U32(1).U32(1).U32([uint32]2147483649).Bytes()
  Note 'schema-getcap-wrong-class' { [Xuux.TpmCeremony.ResponseSchema]::Check(0x17A, $gcCmd, $gcBad) }

  Emit ([ordered]@{ kind = 'direct'; rows = $rows })
  exit 0
}

# ── ceremony transport (compiled beside this script) ──
Add-Type -Path '/home/user/workspace/council-wl413-r3/grok_4_7/probes/ProbeTransport.dll'

if ($Kind -eq 'enum') {
  $inner = New-Object Xuux.TpmCeremony.SwtpmLoopbackTransport('127.0.0.1', $SimPort)
  try {
    $nonce = New-Object byte[] 32
    $raw = $inner.Transmit([Xuux.TpmCeremony.Cmd]::StartAuthSession(0x01, $nonce))
    $p = [Xuux.TpmCeremony.Resp]::Parse($raw, 1, 0x8001, 0)
    $h = $p.Handles[0]
    function Cap($start) {
      $r = $inner.Transmit([Xuux.TpmCeremony.Cmd]::GetCapability(1, $start, 64))
      $rp = [Xuux.TpmCeremony.Resp]::Parse($r, 0, 0x8001, 0)
      $rd = New-Object Xuux.TpmCeremony.Rd -ArgumentList (,$rp.Params)
      $more = $rd.U8(); $cap = $rd.U32(); $n = $rd.U32()
      $hs = @()
      for ($i = 0; $i -lt $n; $i++) { $hs += ('0x{0:x8}' -f $rd.U32()) }
      return [ordered]@{ start = ('0x{0:x8}' -f $start); more = $more; cap = $cap; count = $n; handles = $hs; tag = ('0x{0:x4}' -f $p.Tag); respLen = $raw.Length }
    }
    $from02 = Cap 0x02000000
    $from03 = Cap 0x03000000
    # flush the session so the sim is not left holding it if the caller restarts anyway
    try { [void]$inner.Transmit([Xuux.TpmCeremony.Cmd]::FlushContext($h)) } catch {}
    Emit ([ordered]@{ kind = 'enum'; session = ('0x{0:x8}' -f $h); tag = ('0x{0:x4}' -f $p.Tag); respLen = $raw.Length; from02 = $from02; from03 = $from03 })
  } finally { $inner.Dispose() }
  exit 0
}

$inner = New-Object Xuux.TpmCeremony.SwtpmLoopbackTransport('127.0.0.1', $SimPort)
try {
  $t = New-Object G47Probe.T($inner, $Probe)
  if ($Probe -eq 'session-alias') {
    $z = New-Object byte[] 32
    $pre = [Xuux.TpmCeremony.Resp]::Parse($inner.Transmit([Xuux.TpmCeremony.Cmd]::StartAuthSession(0x01, $z)), 1, 0x8001, 0)
    $t.Decoy = $pre.Handles[0]
  }
  $report = (New-Object Xuux.TpmCeremony.CeremonyRehearsal($t)).Run('ALL')
  $j = $report.ToJson() | ConvertFrom-Json
  $undef = @($j.steps | Where-Object { $_.commandCode -eq '0x00000122' } | ForEach-Object { $_.name })
  $after = @()
  Emit ([ordered]@{
    probe = $Probe
    changes = $t.Changes
    decoy = ('0x{0:x8}' -f $t.Decoy)
    primary = ('0x{0:x8}' -f $t.Primary)
    status = $j.status
    failure = $j.failure
    leftovers = @($j.cleanupLeftovers)
    reconciliation = @($j.reconciliation)
    inventory = $j.postRunInventory
    undefineSteps = $undef
    baselineNv = $j.facts.'baseline.nvHandles'
    baselineSessions = $j.facts.'baseline.sessions'
    baselineTransients = $j.facts.'baseline.transients'
    logTail = @($t.Log | Select-Object -Last 6)
    full = @($t.Log | Where-Object { $_ -like 'FULL *' })
  })
} finally { $inner.Dispose() }
exit 0
