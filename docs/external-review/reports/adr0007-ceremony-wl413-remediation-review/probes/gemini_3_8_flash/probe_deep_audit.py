# probe_deep_audit.py
# Deep audit probe by reviewer gemini_3_8_flash for WL-413
import hashlib
import json
import struct
import subprocess
import sys

def sha256(b: bytes) -> bytes:
    return hashlib.sha256(b).digest()

def u32_be(v: int) -> bytes:
    return struct.pack('>I', v)

print("=== 1. AUDITING POLICY DIGEST CALCULATION (TCG Part 3 §23.2.3, §23.11) ===")
# Load rehearsal report facts from rehearsal.json
with open("/home/user/workspace/council-wl413/gemini_3_8_flash/rehearsal.json", "r") as f:
    rep = json.load(f)

facts = rep.get("facts", {})
service_key_name = facts.get("s2.serviceKey.name")
tpm_trial_digest = facts.get("s2.policy.tpmTrialDigest")
core_formula_digest = facts.get("s2.policy.coreFormulaDigest")

print(f"serviceKeyName from rehearsal: {service_key_name}")
print(f"tpmTrialDigest from rehearsal: {tpm_trial_digest}")
print(f"coreFormulaDigest from rehearsal: {core_formula_digest}")

# Formula:
# policyDigest_0 = 32 zero bytes
# PolicySigned:
# policyDigest_mid = H(policyDigest_0 || CC_PolicySigned || authName)
# policyDigest_1 = H(policyDigest_mid || policyRef) where policyRef is empty
# PolicyCommandCode:
# policyDigest_2 = H(policyDigest_1 || CC_PolicyCommandCode || CC_NV_Increment)
CC_PolicySigned = 0x00000160
CC_PolicyCommandCode = 0x0000016C
CC_NV_Increment = 0x00000134

authName = bytes.fromhex(service_key_name)
d0 = b'\x00' * 32
d_mid = sha256(d0 + u32_be(CC_PolicySigned) + authName)
d1 = sha256(d_mid + b'')
d2 = sha256(d1 + u32_be(CC_PolicyCommandCode) + u32_be(CC_NV_Increment))

py_digest = d2.hex()
print(f"Python independent calculation: {py_digest}")
assert py_digest == tpm_trial_digest, f"Mismatch with TPM trial digest: {py_digest} vs {tpm_trial_digest}"
assert py_digest == core_formula_digest, f"Mismatch with C# formula digest: {py_digest} vs {core_formula_digest}"
print("-> Audit 1 PASS: Policy digest formula matches TPM trial and C# core formula.\n")

print("=== 2. AUDITING ANCHOR ATTRIBUTES & RESERVED BITS (TCG Part 2 Table 204) ===")
# Reserved bits in TPMA_NV: bits 8, 9, 20, 21, 22, 23, 24
# Let's run node against policy_digest.mjs anchorAttributeViolations
test_script = """
import { anchorAttributeViolations } from '/home/user/workspace/xuux-review-dbaf6104/sim/tpm-ceremony/policy_digest.mjs';

const baseAttr = 0x02040018; // TPM_NT_COUNTER | POLICYWRITE | AUTHREAD | NO_DA
const v0 = anchorAttributeViolations(baseAttr, { written: false });
if (v0.length !== 0) throw new Error('Expected 0 violations for base attributes: ' + JSON.stringify(v0));

// Test each reserved bit
const resBits = [8, 9, 20, 21, 22, 23, 24];
for (const b of resBits) {
    const attr = (baseAttr | (1 << b)) >>> 0;
    const v = anchorAttributeViolations(attr, { written: false });
    if (!v.includes('RESERVED_BIT_' + b + '=1')) {
        throw new Error('Reserved bit ' + b + ' was not flagged! Violations: ' + JSON.stringify(v));
    }
}

// Test unwritten vs written
const vWritten0 = anchorAttributeViolations(baseAttr | (1 << 29), { written: false });
if (!vWritten0.includes('WRITTEN=1')) throw new Error('Expected WRITTEN=1 violation');

const vWritten1 = anchorAttributeViolations(baseAttr | (1 << 29), { written: true });
if (vWritten1.length !== 0) throw new Error('Expected 0 violations for written attributes when written=true');

console.log('RESERVED_BITS_TEST_OK');
"""
proc = subprocess.run(["node", "--input-type=module", "-e", test_script], capture_output=True, text=True)
print(proc.stdout)
if proc.returncode != 0:
    print(proc.stderr)
    raise RuntimeError("Node attribute violations test failed")
print("-> Audit 2 PASS: Reserved bits 8, 9, 20-24 and WRITTEN bit verified.\n")

print("=== 3. AUDITING COMMAND EMITTER (17 SHAPES) AGAINST HOST GUARD ===")
harness_cmd = [
    "pwsh", "-NoProfile", "-File",
    "/home/user/workspace/xuux-review-dbaf6104/tests/helpers/tpm-ceremony-harness.ps1",
    "-Mode", "host-guard"
]
proc_guard = subprocess.run(harness_cmd, capture_output=True, text=True)
if proc_guard.returncode != 0:
    print(proc_guard.stderr)
    raise RuntimeError("Host guard harness failed")

guard_out = json.loads(proc_guard.stdout)
cases = guard_out.get("cases", [])
reached = guard_out.get("reached", [])
print(f"Total shapes submitted to TpmGuard: {len(cases)}")
print(f"Commands reached backend (allowed by guard): {reached}")

allowed_names = [c["name"] for c in cases if not c["rejected"]]
rejected_names = [c["name"] for c in cases if c["rejected"]]
print(f"Allowed commands ({len(allowed_names)}): {allowed_names}")
print(f"Rejected commands ({len(rejected_names)}): {rejected_names}")

assert len(cases) == 17, f"Expected 17 shapes, got {len(cases)}"
assert set(allowed_names) == {"GetCapability", "NV_ReadPublic"}, f"Unexpected allowed commands: {allowed_names}"
assert len(rejected_names) == 15, f"Expected 15 rejected shapes, got {len(rejected_names)}"
print("-> Audit 3 PASS: Host guard correctly allows only the 2 read-only inventory queries and blocks all 15 ceremony mutation commands.\n")

print("=== 4. REHEARSAL JSON CONTENT VERIFICATION ===")
# Verify schema, steps count, commandSha256 present, no raw command byte arrays
steps = rep.get("steps", [])
print(f"Rehearsal steps count: {len(steps)}")
print(f"Rehearsal status: {rep.get('status')}")
print(f"Rehearsal failure: {rep.get('failure')}")
print(f"Cleanup leftovers: {rep.get('cleanupLeftovers')}")
print(f"Reconciliation: {rep.get('reconciliation')}")
print(f"Post-run inventory: {rep.get('postRunInventory')}")

# Verify no command bytes leaked into JSON
json_text = json.dumps(rep)
assert "rawCommand" not in json_text
assert "commandBytes" not in json_text
for s in steps:
    assert len(s.get("commandSha256", "")) == 64, f"Invalid SHA-256 for step {s.get('name')}"

print("-> Audit 4 PASS: Rehearsal JSON structure verified.\n")
print("ALL DEEP AUDITS PASSED!")
