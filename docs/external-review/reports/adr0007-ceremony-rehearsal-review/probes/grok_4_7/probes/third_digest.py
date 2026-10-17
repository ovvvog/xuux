#!/usr/bin/env python3
"""حسابٌ ثالثٌ لبصمةِ السياسةِ من معادلاتِ Part 3 r1.38 §23.2.3 و§23.3 و§23.11، بلا استيرادٍ لـ policy_digest.mjs ولا لنواةِ C#."""
import hashlib
import json
import sys

REHEARSAL = "/home/user/workspace/council-ceremony/grok_4_7/rehearsal.json"

def sha256(*parts):
    h = hashlib.sha256()
    for p in parts:
        h.update(p)
    return h.digest()

def u32(v):
    return int(v).to_bytes(4, "big")

CC_POLICY_SIGNED = 0x00000160
CC_POLICY_COMMAND_CODE = 0x0000016C
CC_NV_INCREMENT = 0x00000134

def policy_update(digest, command_code, name, ref):
    # Part 3 r1.38 §23.2.3 eq (10) then (11). arg2.size / arg3.size are not hashed.
    # No exception when ref is empty: the second hash is still applied.
    first = sha256(digest, u32(command_code), name)
    return sha256(first, ref)

def policy_command_code(digest, code):
    # Part 3 r1.38 §23.11 eq (26): single hash, no policyRef.
    return sha256(digest, u32(CC_POLICY_COMMAND_CODE), u32(code))

def anchor_policy(name, policy_ref=b""):
    d0 = bytes(32)
    d1 = policy_update(d0, CC_POLICY_SIGNED, name, policy_ref)
    return policy_command_code(d1, CC_NV_INCREMENT)

def skipped_second_hash(name):
    # صيغةٌ خاطئةٌ عمداً: إغفالُ التجزئةِ الثانيةِ حينَ يكونُ policyRef فارغاً.
    d0 = bytes(32)
    first = sha256(d0, u32(CC_POLICY_SIGNED), name)
    return policy_command_code(first, CC_NV_INCREMENT)

def single_concat(name):
    # صيغةٌ خاطئةٌ عمداً: تجزئةٌ واحدةٌ تضمُّ policyRef (فارغ) في التسلسلِ نفسِه.
    d0 = bytes(32)
    first = sha256(d0, u32(CC_POLICY_SIGNED), name, b"")
    return policy_command_code(first, CC_NV_INCREMENT)

def ahash(nonce, expiration=0, cphash=b"", policy_ref=b""):
    # Part 3 r1.38 §23.3 eq (13): buffer contents, not TPM2B size octets.
    return sha256(nonce, u32(expiration & 0xFFFFFFFF), cphash, policy_ref)

def name_of(public_area):
    return bytes([0x00, 0x0B]) + sha256(public_area)

def decode_nv(pub):
    o = 0
    index = int.from_bytes(pub[o:o+4], "big"); o += 4
    name_alg = int.from_bytes(pub[o:o+2], "big"); o += 2
    attributes = int.from_bytes(pub[o:o+4], "big"); o += 4
    plen = int.from_bytes(pub[o:o+2], "big"); o += 2
    policy = pub[o:o+plen]; o += plen
    data_size = int.from_bytes(pub[o:o+2], "big"); o += 2
    return {
        "index": index,
        "nameAlg": name_alg,
        "attributes": attributes,
        "authPolicy": policy.hex(),
        "dataSize": data_size,
        "trailing": len(pub) - o,
    }

BITS = {
    "PPWRITE": 0, "OWNERWRITE": 1, "AUTHWRITE": 2, "POLICYWRITE": 3,
    "POLICY_DELETE": 10, "WRITELOCKED": 11, "WRITEALL": 12, "WRITEDEFINE": 13,
    "WRITE_STCLEAR": 14, "GLOBALLOCK": 15, "PPREAD": 16, "OWNERREAD": 17,
    "AUTHREAD": 18, "POLICYREAD": 19, "NO_DA": 25, "ORDERLY": 26,
    "CLEAR_STCLEAR": 27, "READLOCKED": 28, "WRITTEN": 29, "PLATFORMCREATE": 30,
    "READ_STCLEAR": 31,
}

def bitset(a):
    on = [n for n, b in BITS.items() if a & (1 << b)]
    nt = (a >> 4) & 0xF
    reserved = []
    for b in list(range(8, 10)) + list(range(20, 25)):
        if a & (1 << b):
            reserved.append(b)
    return {"nt": nt, "on": on, "reserved_set": reserved}

def main():
    facts = json.load(open(REHEARSAL))["facts"]
    name = bytes.fromhex(facts["s2.serviceKey.name"])
    pub = bytes.fromhex(facts["s2.serviceKey.publicAreaHex"])
    computed_name = name_of(pub)
    digest = anchor_policy(name)
    tpm = facts["s2.policy.tpmTrialDigest"]
    core = facts["s2.policy.coreFormulaDigest"]
    out = {
        "serviceKey.name_matches_publicArea": computed_name.hex() == name.hex(),
        "third_digest": digest.hex(),
        "tpmTrialDigest": tpm,
        "coreFormulaDigest": core,
        "third_equals_tpm": digest.hex() == tpm,
        "third_equals_core": digest.hex() == core,
        "wrong_skip_second_hash": skipped_second_hash(name).hex(),
        "wrong_skip_equals_tpm": skipped_second_hash(name).hex() == tpm,
        "wrong_single_concat": single_concat(name).hex(),
        "wrong_single_equals_tpm": single_concat(name).hex() == tpm,
        "ahash_empty_qualifiers": ahash(b"").hex(),
        "ahash_spec_example_expiration_zero": hashlib.sha256(b"\x00\x00\x00\x00").hexdigest(),
        "nv": {},
    }
    for key in (
        "s1.probe.nvPublicHex(after-define)",
        "s1.probe.nvPublicHex(after-write)",
        "s2v.anchorShape.nvPublicHex(after-define)",
        "s2v.anchorShape.nvPublicHex(after-write)",
    ):
        raw = bytes.fromhex(facts[key])
        dec = decode_nv(raw)
        dec["bits"] = bitset(dec["attributes"])
        dec["name_recomputed"] = name_of(raw).hex()
        label = key.split(".")[0] + "." + key.split("(")[0].split(".")[-1]
        name_key = key.replace("nvPublicHex", "nvName")
        dec["name_in_report"] = facts.get(name_key)
        dec["name_match"] = dec["name_recomputed"] == facts.get(name_key)
        out["nv"][key] = dec
    # anchor expected mask: NT=1 | POLICYWRITE | AUTHREAD | NO_DA = 0x02040018
    anchor = out["nv"]["s2v.anchorShape.nvPublicHex(after-define)"]
    out["anchor_attributes_hex"] = f"0x{anchor['attributes']:08x}"
    out["anchor_expected_hex"] = "0x02040018"
    out["anchor_attributes_equal_expected"] = anchor["attributes"] == 0x02040018
    written = out["nv"]["s2v.anchorShape.nvPublicHex(after-write)"]
    out["anchor_written_hex"] = f"0x{written['attributes']:08x}"
    out["anchor_written_equal_expected_plus_written"] = written["attributes"] == (0x02040018 | (1 << 29))
    probe = out["nv"]["s1.probe.nvPublicHex(after-define)"]
    out["s1_probe_attributes_hex"] = f"0x{probe['attributes']:08x}"
    out["s1_probe_expected_hex"] = "0x02040014"  # COUNTER|AUTHWRITE|AUTHREAD|NO_DA
    out["s1_probe_equal"] = probe["attributes"] == 0x02040014
    json.dump(out, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0 if out["third_equals_tpm"] and out["third_equals_core"] and out["anchor_attributes_equal_expected"] else 1

if __name__ == "__main__":
    sys.exit(main())
