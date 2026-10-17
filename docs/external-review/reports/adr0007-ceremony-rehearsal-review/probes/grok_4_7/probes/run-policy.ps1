#Requires -Version 5.1
param([Parameter(Mandatory=$true)][int]$SimPort)
$ErrorActionPreference = 'Stop'
$core = '/home/user/workspace/xuux-review-50518cf6/sim/tpm-ceremony/TpmCeremonyCore.cs'
$probe = '/home/user/workspace/council-ceremony/grok_4_7/probes/ProbePolicy.cs'
Add-Type -Path @($core, $probe) -IgnoreWarnings
$layouts = [Xuux.TpmCeremony.Probes.PolicyRefProbe]::Layouts()
$run = [Xuux.TpmCeremony.Probes.PolicyRefProbe]::Run('127.0.0.1', $SimPort)
'{"layouts":' + $layouts + ',"run":' + $run + '}'
