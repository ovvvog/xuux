$ErrorActionPreference = 'Stop'
$core = '/home/user/workspace/xuux-review-dbaf6104/sim/tpm-ceremony/TpmCeremonyCore.cs'
Add-Type -Path $core -IgnoreWarnings
$raw = [byte[]](0x80,0x02,0,0,0,14,0,0,0,0,0xFF,0xFF,0xFF,0xFF)
try {
  $p = [Xuux.TpmCeremony.Resp]::Parse($raw, 0, 0x8002, 1)
  Write-Output "parsed rc=$($p.Rc)"
} catch {
  $ex = $_.Exception
  while ($ex.InnerException) { $ex = $ex.InnerException }
  Write-Output ("caught " + $ex.GetType().FullName + ": " + $ex.Message)
}
Write-Output 'pwsh-parse-done'
