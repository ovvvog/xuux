#!/bin/bash
# probe_C2 — NV_Certify على swtpm بمفتاحِ توقيعٍ ECDSA-P256 (غيرِ مقيَّدٍ) و size=8/offset=0 ثم size=0/offset=0؛ وتصحيحُ مثالِ دقةِ uint64.
set -u
NV=0x01800778; W=$(mktemp -d)
tpm2_nvundefine -C o $NV 2>/dev/null
tpm2_nvdefine -C o -s 8 -a 'ownerread|ownerwrite|nt=counter|no_da' $NV >/dev/null; echo "nvdefine rc=$?"
tpm2_nvincrement -C o $NV; echo "nvincrement rc=$?"
tpm2_createprimary -C o -G ecc256:ecdsa-sha256 -a 'fixedtpm|fixedparent|sensitivedataorigin|userwithauth|sign' -c $W/sign.ctx >/dev/null 2>&1; echo "createprimary(ecdsa signing) rc=$?"
printf 'QD-probe-claude_fable_5_1' > $W/qd.bin
echo "## size=8 offset=0"
tpm2_nvcertify -C $W/sign.ctx -c o -g sha256 -s ecdsa -f plain --size 8 --offset 0 -q $W/qd.bin -o $W/sig.bin --attestation $W/attest.bin $NV 2>&1 | tail -2; echo "nvcertify rc=${PIPESTATUS[0]}"
tpm2_print -t TPMS_ATTEST $W/attest.bin 2>&1 | grep -E 'type|extraData|qualifiedSigner|nvContents|offset|size|indexName|nvDigest' | head -8
echo "## size=0 offset=0 (digest form — TPMS_NV_DIGEST_CERTIFY_INFO since rev 1.53)"
tpm2_nvcertify -C $W/sign.ctx -c o -g sha256 -s ecdsa -f plain --size 0 --offset 0 -q $W/qd.bin -o $W/sig0.bin --attestation $W/attest0.bin $NV 2>&1 | tail -2; echo "nvcertify(size=0) rc=${PIPESTATUS[0]}"
tpm2_print -t TPMS_ATTEST $W/attest0.bin 2>&1 | grep -E 'type|nvDigest|nvContents|extraData' | head -4
echo "## uint64 precision (corrected example): 2^53 vs 2^53+1"
node -e 'const a=2n**53n, b=2n**53n+1n; console.log("Number(2^53)===Number(2^53+1):", Number(a)===Number(b), "| bigint equal:", a===b)'
tpm2_nvundefine -C o $NV >/dev/null; echo "cleanup rc=$?"; rm -rf $W
