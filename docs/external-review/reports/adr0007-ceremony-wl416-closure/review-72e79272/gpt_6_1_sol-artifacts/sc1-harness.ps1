param(
  [int]$SimPort,
  [string]$Mode,
  [string]$Fault
)
$ErrorActionPreference = 'Stop'
$tree = '/tmp/wt-72e79272-gpt_6_1_sol'
$original = Join-Path $tree 'tests/helpers/tpm-ceremony-harness.ps1'
$text = [System.IO.File]::ReadAllText($original)
$text = $text.Replace(
  '$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)',
  "`$root = '$tree'")
$text = $text.Replace(
  '$core = Join-Path $root ''sim/tpm-ceremony/TpmCeremonyCore.cs''',
  '$core = ''/tmp/council-wl422-gpt_6_1_sol/mutant-core.cs''')
$text = $text.Replace(
  '$helper = Join-Path $PSScriptRoot ''TpmCeremonyFaultTransport.cs''',
  "`$helper = '$tree/tests/helpers/TpmCeremonyFaultTransport.cs'")
$sb = [scriptblock]::Create($text)
& $sb -Mode $Mode -Fault $Fault -SimPort $SimPort
