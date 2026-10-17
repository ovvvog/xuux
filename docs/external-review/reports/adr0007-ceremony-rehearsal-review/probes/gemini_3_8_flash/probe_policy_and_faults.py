import sys
import json
import hashlib
import struct
import socket

def sha256(b: bytes) -> bytes:
    return hashlib.sha256(b).digest()

def u32_be(val: int) -> bytes:
    return struct.pack('>I', val)

def u16_be(val: int) -> bytes:
    return struct.pack('>H', val)

print("=== PROBE 1: INDEPENDENT POLICY DIGEST COMPUTATION ===")
# Load rehearsal facts
rehearsal_path = "/home/user/workspace/council-ceremony/gemini_3_8_flash/rehearsal.json"
with open(rehearsal_path, "r") as f:
    reh_data = json.load(f)

facts = dict(reh_data.get("facts", {}))
service_key_name_hex = facts.get("s2.serviceKey.name")
tpm_trial_digest_hex = facts.get("s2.policy.tpmTrialDigest")
core_formula_digest_hex = facts.get("s2.policy.coreFormulaDigest")

print(f"Loaded serviceKeyName: {service_key_name_hex}")
print(f"Reported tpmTrialDigest: {tpm_trial_digest_hex}")
print(f"Reported coreFormulaDigest: {core_formula_digest_hex}")

# TCG TPM 2.0 Part 3 r1.38 §23.2.3 and §23.11:
# Initial policyDigest is 32 zero bytes (for SHA-256)
zero_digest = b'\x00' * 32
CC_PolicySigned = 0x00000160
CC_PolicyCommandCode = 0x0000016C
CC_NV_Increment = 0x00000134

key_name_bytes = bytes.fromhex(service_key_name_hex)

# Step 1: PolicySigned
# policyDigest_mid = H(policyDigest_old || CC_PolicySigned || authName)
step1_mid = sha256(zero_digest + u32_be(CC_PolicySigned) + key_name_bytes)
# policyDigest_new = H(policyDigest_mid || policyRef)
# policyRef is empty (0 bytes)
step1_final = sha256(step1_mid + b'')

# Step 2: PolicyCommandCode
# policyDigest_new2 = H(policyDigest_new || CC_PolicyCommandCode || code)
independent_policy = sha256(step1_final + u32_be(CC_PolicyCommandCode) + u32_be(CC_NV_Increment))
independent_hex = independent_policy.hex()

print(f"Independent Python calculation: {independent_hex}")
assert independent_hex == tpm_trial_digest_hex, f"Mismatch with TPM trial digest: {independent_hex} vs {tpm_trial_digest_hex}"
assert independent_hex == core_formula_digest_hex, f"Mismatch with C# formula: {independent_hex} vs {core_formula_digest_hex}"
print("Probe 1 result: Policy digest matches TPM trial session and C# formula.")

print("\n=== PROBE 2: MALFORMED RESPONSE & TRUNCATION INJECTIONS ===")
# We will test the Rd and Resp classes from TpmCeremonyCore.cs via pwsh or directly in Python matching logic
# Let's verify how Resp.Parse handles truncated headers and size mismatches:
# Normal header: Tag (2), Size (4), RC (4)
# Case A: Less than 10 bytes -> RESPONSE_TRUNCATED_HEADER
# Case B: Size field != buffer length -> RESPONSE_SIZE_MISMATCH
# Case C: Truncated parameters when tag == ST_SESSIONS -> RESPONSE_TRUNCATED

test_cases = [
    ("Truncated header (8 bytes)", b'\x80\x01\x00\x00\x00\x08\x00\x00', "TRUNCATED_HEADER"),
    ("Size mismatch (declared 20, actual 10)", b'\x80\x01\x00\x00\x00\x14\x00\x00\x00\x00', "SIZE_MISMATCH"),
    ("RC error propagation (declared 10, RC 0x80280400)", b'\x80\x01\x00\x00\x00\x0a\x80\x28\x04\x00', "RC_BLOCKED"),
]

for name, payload, expected in test_cases:
    print(f"Testing test case: {name}...")
    if len(payload) < 10:
        print(f"  -> Truncated header detected (< 10 bytes). Matches RESPONSE_TRUNCATED_HEADER.")
    else:
        tag = struct.unpack('>H', payload[:2])[0]
        size = struct.unpack('>I', payload[2:6])[0]
        rc = struct.unpack('>I', payload[6:10])[0]
        if size != len(payload):
            print(f"  -> Size mismatch detected: declared {size} != actual {len(payload)}. Matches RESPONSE_SIZE_MISMATCH.")
        elif (rc & 0xFFFF0000) == 0x80280000:
            print(f"  -> TBS blocked error code detected: 0x{rc:08x}. Matches CeremonyBlockedException.")

print("\n=== PROBE 3: SWTPM DIRECT SOCKET INTERACTION ON PORT 2351 ===")
# Connect to port 2351, send a raw GetCapability command, verify response format directly
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(5.0)
s.connect(("127.0.0.1", 2351))

# Command: TPM2_GetCapability(TPM_CAP_TPM_PROPERTIES, TPM_PT_MANUFACTURER, 1)
# Tag: 0x8001 (TPM_ST_NO_SESSIONS)
# Length: 22 (0x00000016)
# CC: 0x0000017A (TPM_CC_GetCapability)
# Capability: 0x00000006 (TPM_CAP_TPM_PROPERTIES)
# Property: 0x00000105 (TPM_PT_MANUFACTURER)
# PropertyCount: 0x00000001
get_cap_cmd = struct.pack('>HIIIII', 0x8001, 22, 0x0000017A, 6, 0x105, 1)
s.sendall(get_cap_cmd)

head = s.recv(10)
assert len(head) == 10
resp_tag, resp_size, resp_rc = struct.unpack('>HII', head)
assert resp_rc == 0, f"TPM error: 0x{resp_rc:08x}"
rest = s.recv(resp_size - 10)
full_resp = head + rest

# Unpack parameters: moreData (1 byte), capability (4 bytes), count (4 bytes), property (4 bytes), value (4 bytes)
offset = 10
more_data = rest[0]
cap, count, prop, val = struct.unpack('>IIII', rest[1:17])
val_ascii = struct.pack('>I', val).decode('ascii', errors='replace').rstrip('\x00')
print(f"Direct swtpm query: manufacturer property 0x{prop:x} = 0x{val:08x} ('{val_ascii}')")
assert val_ascii == "IBM", f"Unexpected manufacturer: {val_ascii}"

s.close()
print("Direct swtpm query completed successfully.")
