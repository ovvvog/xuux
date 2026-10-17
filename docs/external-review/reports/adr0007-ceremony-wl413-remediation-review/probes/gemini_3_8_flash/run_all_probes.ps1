# run_all_probes.ps1
# Comprehensive test probes runner for WL-413 review
# Reviewer: gemini_3_8_flash

$ErrorActionPreference = 'Stop'
$tree = '/home/user/workspace/xuux-review-dbaf6104'
$priv = '/home/user/workspace/council-wl413/gemini_3_8_flash'
$pidFile = "$priv/pid"
$stateDir = "$priv/st"
$port = 2111
$ctrlPort = 2112

function Reset-Simulator {
    if (Test-Path $pidFile) {
        $p = (Get-Content $pidFile -ErrorAction SilentlyContinue).Trim()
        if ($p -and [int]::TryParse($p, [ref]$null)) {
            try { Stop-Process -Id ([int]$p) -Force -ErrorAction SilentlyContinue } catch {}
        }
    }
    Remove-Item -Path "$stateDir/*" -Recurse -Force -ErrorAction SilentlyContinue
    $null = New-Item -Path $stateDir -ItemType Directory -Force
    Start-Process -FilePath "swtpm" -ArgumentList @(
        "socket", "--tpm2", "--tpmstate", "dir=$stateDir",
        "--server", "type=tcp,port=$port,bindaddr=127.0.0.1",
        "--ctrl", "type=tcp,port=$ctrlPort,bindaddr=127.0.0.1",
        "--flags", "not-need-init,startup-clear",
        "--pid", "file=$pidFile", "--daemon"
    ) -NoNewWindow
    Start-Sleep -Milliseconds 800
}

Write-Host "=== Compiling C# Probe ==="
$corePath = Join-Path $tree 'sim/tpm-ceremony/TpmCeremonyCore.cs'
$probePath = Join-Path $priv 'ProbeWl413.cs'
Add-Type -Path @($corePath, $probePath) -IgnoreWarnings

$results = [System.Collections.Generic.List[PSCustomObject]]::new()

function Record-ProbeResult {
    param($Id, $Desc, $Outcome, $Detail)
    $results.Add([PSCustomObject]@{
        Id = $Id
        Description = $Desc
        Outcome = $Outcome
        Detail = $Detail
    })
    Write-Host "[$Id] $Outcome - ${Desc}: $Detail"
}

Write-Host "`n=== 1. Testing Original WL-412 Defects & Remediation ==="

# SOL-01: Invalid Tag
Reset-Simulator
try {
    $json = [Xuux.TpmCeremony.Probes.ProbeRunner]::RunScenario("127.0.0.1", $port, "sol01-invalid-tag", "ALL")
    $rep = $json | ConvertFrom-Json
    if ($rep.status -eq 'FAILED_CLOSED' -and $rep.failure -like '*RESPONSE_TAG_MISMATCH*') {
        Record-ProbeResult 'SOL-01(tag)' 'Invalid tag rejected before state change' 'REMEDIED' $rep.failure
    } else {
        Record-ProbeResult 'SOL-01(tag)' 'Invalid tag unexpected outcome' 'STILL_OPEN' "status=$($rep.status), fail=$($rep.failure)"
    }
} catch {
    Record-ProbeResult 'SOL-01(tag)' 'Exception during probe' 'ERROR' $_.Exception.Message
}

# SOL-01: Missing response auth area
Reset-Simulator
try {
    $json = [Xuux.TpmCeremony.Probes.ProbeRunner]::RunScenario("127.0.0.1", $port, "sol01-missing-auth", "ALL")
    $rep = $json | ConvertFrom-Json
    if ($rep.status -eq 'FAILED_CLOSED' -and ($rep.failure -like '*RESPONSE_AUTH_AREA_MALFORMED*' -or $rep.failure -like '*OUTCOME_UNKNOWN*')) {
        Record-ProbeResult 'SOL-01(auth)' 'Missing response auth area rejected' 'REMEDIED' $rep.failure
    } else {
        Record-ProbeResult 'SOL-01(auth)' 'Missing response auth area unexpected outcome' 'STILL_OPEN' "status=$($rep.status), fail=$($rep.failure)"
    }
} catch {
    Record-ProbeResult 'SOL-01(auth)' 'Exception during probe' 'ERROR' $_.Exception.Message
}

# SOL-02: Lost define response after execution
Reset-Simulator
try {
    $json = [Xuux.TpmCeremony.Probes.ProbeRunner]::RunScenario("127.0.0.1", $port, "sol02-lost-define-executed", "S1")
    $rep = $json | ConvertFrom-Json
    $recStr = ($rep.reconciliation -join '; ')
    if ($rep.status -eq 'FAILED_CLOSED' -and $recStr -like '*executed; ownership proven by publicArea match*') {
        Record-ProbeResult 'SOL-02(exec)' 'Lost define response after execution reconciled and cleaned up' 'REMEDIED' $recStr
    } else {
        Record-ProbeResult 'SOL-02(exec)' 'Lost define response after execution unexpected outcome' 'STILL_OPEN' "status=$($rep.status), rec=$recStr"
    }
} catch {
    Record-ProbeResult 'SOL-02(exec)' 'Exception during probe' 'ERROR' $_.Exception.Message
}

# SOL-02: Lost define response before execution
Reset-Simulator
try {
    $json = [Xuux.TpmCeremony.Probes.ProbeRunner]::RunScenario("127.0.0.1", $port, "sol02-lost-define-not-executed", "S1")
    $rep = $json | ConvertFrom-Json
    $recStr = ($rep.reconciliation -join '; ')
    if ($rep.status -eq 'FAILED_CLOSED' -and $recStr -like '*not-executed (verified absent*') {
        Record-ProbeResult 'SOL-02(not-exec)' 'Lost define response before execution verified absent' 'REMEDIED' $recStr
    } else {
        Record-ProbeResult 'SOL-02(not-exec)' 'Lost define response before execution unexpected outcome' 'STILL_OPEN' "status=$($rep.status), rec=$recStr"
    }
} catch {
    Record-ProbeResult 'SOL-02(not-exec)' 'Exception during probe' 'ERROR' $_.Exception.Message
}

# SOL-03: FlushContext refusal
Reset-Simulator
try {
    $json = [Xuux.TpmCeremony.Probes.ProbeRunner]::RunScenario("127.0.0.1", $port, "sol03-flush-refusal", "S2")
    $rep = $json | ConvertFrom-Json
    $leftovers = ($rep.cleanupLeftovers -join '; ')
    if ($rep.status -eq 'BLOCKED_FAIL_CLOSED' -and ($leftovers -like '*transient 0x03000000*' -or $leftovers -like '*transient 0x*')) {
        Record-ProbeResult 'SOL-03' 'Flush refusal keeps session handle declared in leftovers' 'REMEDIED' $leftovers
    } else {
        Record-ProbeResult 'SOL-03' 'Flush refusal unexpected outcome' 'STILL_OPEN' "status=$($rep.status), leftovers=$leftovers"
    }
} catch {
    Record-ProbeResult 'SOL-03' 'Exception during probe' 'ERROR' $_.Exception.Message
}

# SOL-04: Unexpected generic rejection code (0x101)
Reset-Simulator
try {
    # Run via repo harness fault mode 'unexpected-negative'
    $harness = Join-Path $tree 'tests/helpers/tpm-ceremony-harness.ps1'
    $hOut = & pwsh -NoProfile -File $harness -Mode fault -SimPort $port -Fault 'unexpected-negative' | ConvertFrom-Json
    $rep = $hOut.report
    if ($rep.status -eq 'FAILED_CLOSED' -and $rep.failure -like '*NEGATIVE_WRONG_RC*expected=0x000005db*got=0x00000101*') {
        Record-ProbeResult 'SOL-04' 'Generic RC (0x101) rejected as NEGATIVE_WRONG_RC' 'REMEDIED' $rep.failure
    } else {
        Record-ProbeResult 'SOL-04' 'Generic RC unexpected outcome' 'STILL_OPEN' "status=$($rep.status), failure=$($rep.failure)"
    }
} catch {
    Record-ProbeResult 'SOL-04' 'Exception during probe' 'ERROR' $_.Exception.Message
}

# G47-1: Identity spacefold
Reset-Simulator
try {
    $json = [Xuux.TpmCeremony.Probes.ProbeRunner]::RunScenario("127.0.0.1", $port, "g47-1-spacefold", "ALL")
    $rep = $json | ConvertFrom-Json
    if ($rep.status -eq 'FAILED_CLOSED' -and $rep.failure -like '*SIMULATOR_IDENTITY_REQUIRED*') {
        Record-ProbeResult 'G47-1(spacefold)' 'Spacefold vendor strings rejected raw' 'REMEDIED' $rep.failure
    } else {
        Record-ProbeResult 'G47-1(spacefold)' 'Spacefold unexpected outcome' 'STILL_OPEN' "status=$($rep.status), failure=$($rep.failure)"
    }
} catch {
    Record-ProbeResult 'G47-1(spacefold)' 'Exception during probe' 'ERROR' $_.Exception.Message
}

# G47-1: Extra vendor strings
Reset-Simulator
try {
    $json = [Xuux.TpmCeremony.Probes.ProbeRunner]::RunScenario("127.0.0.1", $port, "g47-1-extra-vendor", "ALL")
    $rep = $json | ConvertFrom-Json
    if ($rep.status -eq 'FAILED_CLOSED' -and $rep.failure -like '*SIMULATOR_IDENTITY_REQUIRED*') {
        Record-ProbeResult 'G47-1(extra)' 'Extra vendor strings (EVIL/XXXX) rejected' 'REMEDIED' $rep.failure
    } else {
        Record-ProbeResult 'G47-1(extra)' 'Extra vendor strings unexpected outcome' 'STILL_OPEN' "status=$($rep.status), failure=$($rep.failure)"
    }
} catch {
    Record-ProbeResult 'G47-1(extra)' 'Exception during probe' 'ERROR' $_.Exception.Message
}

# G47-2: Persistent undefine blocking
Reset-Simulator
try {
    $harness = Join-Path $tree 'tests/helpers/tpm-ceremony-harness.ps1'
    $hOut = & pwsh -NoProfile -File $harness -Mode fault -SimPort $port -Fault 'blocked-forever-undefine' -Stages 'S1' | ConvertFrom-Json
    $rep = $hOut.report
    $leftovers = ($rep.cleanupLeftovers -join '; ')
    if ($rep.status -eq 'BLOCKED_FAIL_CLOSED' -and $leftovers -like '*nv 0x*') {
        Record-ProbeResult 'G47-2' 'Persistent undefine blocking declares residual NV handle in leftovers' 'REMEDIED' $leftovers
    } else {
        Record-ProbeResult 'G47-2' 'Persistent undefine blocking unexpected outcome' 'STILL_OPEN' "status=$($rep.status), leftovers=$leftovers"
    }
} catch {
    Record-ProbeResult 'G47-2' 'Exception during probe' 'ERROR' $_.Exception.Message
}

Write-Host "`n=== 2. Testing Batch 2 Claims (R2-01...R2-05) ==="

# R2-01: Third party write after lost define response
Reset-Simulator
try {
    $json = [Xuux.TpmCeremony.Probes.ProbeRunner]::RunScenario("127.0.0.1", $port, "r2-01-third-party-write", "S1")
    $rep = $json | ConvertFrom-Json
    $recStr = ($rep.reconciliation -join '; ')
    $leftovers = ($rep.cleanupLeftovers -join '; ')
    if ($rep.status -eq 'FAILED_CLOSED' -and $recStr -like '*TPMA_NV_WRITTEN is set although this run never wrote it*' -and $leftovers -like '*ownership-undetermined*') {
        Record-ProbeResult 'R2-01' 'Third party write after lost define detected: ownership undetermined, not deleted' 'REMEDIED' $recStr
    } else {
        Record-ProbeResult 'R2-01' 'R2-01 unexpected outcome' 'STILL_OPEN' "status=$($rep.status), rec=$recStr, leftovers=$leftovers"
    }
} catch {
    Record-ProbeResult 'R2-01' 'Exception during probe' 'ERROR' $_.Exception.Message
}

# R2-02: Negative increment response loss
Reset-Simulator
try {
    $harness = Join-Path $tree 'tests/helpers/tpm-ceremony-harness.ps1'
    $hOut = & pwsh -NoProfile -File $harness -Mode fault -SimPort $port -Fault 'neg-increment-loss' -Stages 'ALL' | ConvertFrom-Json
    $rep = $hOut.report
    $recStr = ($rep.reconciliation -join '; ')
    if ($rep.status -eq 'FAILED_CLOSED' -and $recStr -like '*nv-increment 0x*: not-executed (counter still uninitialized)*') {
        Record-ProbeResult 'R2-02' 'Negative increment response loss reconciled and counter state observed' 'REMEDIED' $recStr
    } else {
        Record-ProbeResult 'R2-02' 'R2-02 unexpected outcome' 'STILL_OPEN' "status=$($rep.status), rec=$recStr"
    }
} catch {
    Record-ProbeResult 'R2-02' 'Exception during probe' 'ERROR' $_.Exception.Message
}

# R2-03: ResponseSchema checks: Trailing bytes in parameters
Reset-Simulator
try {
    $json = [Xuux.TpmCeremony.Probes.ProbeRunner]::RunScenario("127.0.0.1", $port, "r2-03-trailing-readpublic", "ALL")
    $rep = $json | ConvertFrom-Json
    if ($rep.status -eq 'FAILED_CLOSED' -and $rep.failure -like '*RESPONSE_PARAMS_TRAILING_BYTES*') {
        Record-ProbeResult 'R2-03(trailing)' 'ResponseSchema caught trailing bytes in NV_ReadPublic response' 'REMEDIED' $rep.failure
    } else {
        Record-ProbeResult 'R2-03(trailing)' 'ResponseSchema trailing bytes unexpected outcome' 'STILL_OPEN' "status=$($rep.status), failure=$($rep.failure)"
    }
} catch {
    Record-ProbeResult 'R2-03(trailing)' 'Exception during probe' 'ERROR' $_.Exception.Message
}

# R2-03: ResponseSchema checks: Bad signature alg
Reset-Simulator
try {
    $json = [Xuux.TpmCeremony.Probes.ProbeRunner]::RunScenario("127.0.0.1", $port, "r2-03-bad-sig-alg", "S2")
    $rep = $json | ConvertFrom-Json
    if ($rep.status -eq 'FAILED_CLOSED' -and $rep.failure -like '*RESPONSE_SIGNATURE_ALG_UNEXPECTED*') {
        Record-ProbeResult 'R2-03(sig-alg)' 'ResponseSchema caught unexpected signature algorithm in Sign response' 'REMEDIED' $rep.failure
    } else {
        Record-ProbeResult 'R2-03(sig-alg)' 'ResponseSchema bad sig alg unexpected outcome' 'STILL_OPEN' "status=$($rep.status), failure=$($rep.failure)"
    }
} catch {
    Record-ProbeResult 'R2-03(sig-alg)' 'Exception during probe' 'ERROR' $_.Exception.Message
}

# R2-04: PostRunInventory clean run
Reset-Simulator
try {
    $json = [Xuux.TpmCeremony.Probes.ProbeRunner]::RunScenario("127.0.0.1", $port, "clean-run", "ALL")
    $rep = $json | ConvertFrom-Json
    if ($rep.status -eq 'COMPLETE' -and $rep.postRunInventory.verified -eq $true -and $rep.postRunInventory.residualNv.Count -eq 0) {
        Record-ProbeResult 'R2-04(clean)' 'Post-run inventory verified true with empty residual sets on clean run' 'REMEDIED' "verified=$($rep.postRunInventory.verified), nvCount=$($rep.postRunInventory.residualNv.Count)"
    } else {
        Record-ProbeResult 'R2-04(clean)' 'Post-run inventory clean run unexpected outcome' 'STILL_OPEN' "status=$($rep.status), verified=$($rep.postRunInventory.verified)"
    }
} catch {
    Record-ProbeResult 'R2-04(clean)' 'Exception during probe' 'ERROR' $_.Exception.Message
}

# R2-04: PostRunInventory transport dead after define
Reset-Simulator
try {
    $harness = Join-Path $tree 'tests/helpers/tpm-ceremony-harness.ps1'
    $hOut = & pwsh -NoProfile -File $harness -Mode fault -SimPort $port -Fault 'transport-dead-after-define' -Stages 'S1' | ConvertFrom-Json
    $rep = $hOut.report
    $leftovers = ($rep.cleanupLeftovers -join '; ')
    if ($rep.postRunInventory.verified -eq $false -and $rep.postRunInventory.error -like '*WL413R2_TRANSPORT_DEAD*' -and $leftovers -like '*residual state unknown*') {
        Record-ProbeResult 'R2-04(dead)' 'Dead transport marks postRunInventory unverified with residual state unknown' 'REMEDIED' $rep.postRunInventory.error
    } else {
        Record-ProbeResult 'R2-04(dead)' 'Dead transport unexpected outcome' 'STILL_OPEN' "verified=$($rep.postRunInventory.verified), error=$($rep.postRunInventory.error)"
    }
} catch {
    Record-ProbeResult 'R2-04(dead)' 'Exception during probe' 'ERROR' $_.Exception.Message
}

Write-Host "`n=== 3. Testing Transport Isolation & Listener Ownership (R2-05) ==="

# Source the Assert-SimulatorListener function from rehearse.ps1
$rehearseContent = Get-Content (Join-Path $tree 'sim/tpm-ceremony/rehearse.ps1') -Raw
$fnMatch = [regex]::Match($rehearseContent, '(?s)function Assert-SimulatorListener\s*\{.*?\n\}')
if ($fnMatch.Success) {
    Invoke-Expression $fnMatch.Value
} else {
    throw "Failed to extract Assert-SimulatorListener from rehearse.ps1"
}

# Test listener check on valid swtpm port 2111 with PID file
$actualPid = [int]((Get-Content $pidFile).Trim())
try {
    $listenerDesc = Assert-SimulatorListener -Port $port -ExpectedPid $actualPid
    Record-ProbeResult 'R2-05(valid)' "Assert-SimulatorListener passed on port $port with PID $actualPid" 'PASS' $listenerDesc
} catch {
    Record-ProbeResult 'R2-05(valid)' "Assert-SimulatorListener failed unexpectedly on port $port" 'FAIL' $_.Exception.Message
}

# Test listener check with mismatched PID
try {
    $null = Assert-SimulatorListener -Port $port -ExpectedPid ($actualPid + 9999)
    Record-ProbeResult 'R2-05(pid-mismatch)' 'PID mismatch not detected' 'FAIL' 'Did not throw'
} catch {
    if ($_.Exception.Message -like '*SIMULATOR_LISTENER_PID_MISMATCH*') {
        Record-ProbeResult 'R2-05(pid-mismatch)' 'PID mismatch rejected with SIMULATOR_LISTENER_PID_MISMATCH' 'PASS' $_.Exception.Message
    } else {
        Record-ProbeResult 'R2-05(pid-mismatch)' 'PID mismatch threw unexpected exception' 'FAIL' $_.Exception.Message
    }
}

# Test listener check on port with no listener (e.g. 2299)
try {
    $null = Assert-SimulatorListener -Port 2299 -ExpectedPid 0
    Record-ProbeResult 'R2-05(absent)' 'Absent listener not detected' 'FAIL' 'Did not throw'
} catch {
    if ($_.Exception.Message -like '*SIMULATOR_LISTENER_ABSENT*') {
        Record-ProbeResult 'R2-05(absent)' 'Absent listener rejected with SIMULATOR_LISTENER_ABSENT' 'PASS' $_.Exception.Message
    } else {
        Record-ProbeResult 'R2-05(absent)' 'Absent listener threw unexpected exception' 'FAIL' $_.Exception.Message
    }
}

# Test proxy interception rejection: Start node proxy on port 3150
$proxyPort = 3150
$proxyScript = @"
const net = require('net');
const server = net.createServer((c) => {
    const upstream = net.connect($port, '127.0.0.1');
    c.pipe(upstream);
    upstream.pipe(c);
});
server.listen($proxyPort, '127.0.0.1', () => {
    console.log('PROXY_READY');
});
"@
$proxyPath = "$priv/proxy_test.js"
[System.IO.File]::WriteAllText($proxyPath, $proxyScript)
$proxyProc = Start-Process -FilePath "node" -ArgumentList $proxyPath -PassThru -NoNewWindow
Start-Sleep -Milliseconds 600
try {
    try {
        $null = Assert-SimulatorListener -Port $proxyPort -ExpectedPid 0
        Record-ProbeResult 'R2-05(proxy)' 'Proxy listener was not rejected' 'FAIL' 'Did not throw'
    } catch {
        if ($_.Exception.Message -like '*SIMULATOR_LISTENER_NOT_SWTPM: node*') {
            Record-ProbeResult 'R2-05(proxy)' 'Proxy on loopback rejected before connection (SIMULATOR_LISTENER_NOT_SWTPM: node)' 'PASS' $_.Exception.Message
        } else {
            Record-ProbeResult 'R2-05(proxy)' 'Proxy threw unexpected exception' 'FAIL' $_.Exception.Message
        }
    }

    # Also test rehearse.ps1 against the proxy port - verify exit code 4 (TOOL_ERROR)
    $rehearsePs1 = Join-Path $tree 'sim/tpm-ceremony/rehearse.ps1'
    $rehearseOut = & pwsh -NoProfile -File $rehearsePs1 -SimHost 127.0.0.1 -SimPort $proxyPort -Stages S1 -SimPidFile $pidFile 2>&1
    $rehearseCode = $LASTEXITCODE
    if ($rehearseCode -eq 4 -and ($rehearseOut -like '*TOOL_ERROR*' -or $rehearseOut -like '*SIMULATOR_LISTENER_NOT_SWTPM*')) {
        Record-ProbeResult 'R2-05(rehearse-proxy)' 'rehearse.ps1 rejected proxy port with exit code 4 and TOOL_ERROR' 'PASS' "exitCode=$rehearseCode"
    } else {
        Record-ProbeResult 'R2-05(rehearse-proxy)' 'rehearse.ps1 against proxy unexpected outcome' 'FAIL' "exitCode=$rehearseCode, out=$rehearseOut"
    }
} finally {
    try { Stop-Process -Id $proxyProc.Id -Force -ErrorAction SilentlyContinue } catch {}
}

# Reset simulator back to clean state on port 2111
Reset-Simulator

# Save probe summary to JSON
$results | ConvertTo-Json -Depth 5 | Out-File -FilePath "$priv/probe_results.json" -Encoding utf8
Write-Host "`nProbe results saved to $priv/probe_results.json"
