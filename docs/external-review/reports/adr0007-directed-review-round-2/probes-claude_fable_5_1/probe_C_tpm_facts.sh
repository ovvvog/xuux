#!/bin/bash
# probe_C — قياساتٌ على swtpm (محاكٍ لا عتادٌ): رتابةُ العدّادِ بعدَ الحذفِ وإعادةِ التعريفِ؛ NV_Certify بـ size=8 offset=0؛ MAX_ORDERLY_COUNT؛ دقةُ uint64 في Number.
set -u
NV=0x01800777
W=$(mktemp -d)
echo "## ORDERLY count / revision"
tpm2_getcap properties-fixed | grep -A1 -E 'TPM2_PT_ORDERLY_COUNT|TPM2_PT_REVISION'
echo "## define counter (policywrite-less, owner auth) + increment x3 + read"
tpm2_nvundefine -C o $NV 2>/dev/null
tpm2_nvdefine -C o -s 8 -a 'ownerread|ownerwrite|nt=counter|no_da' $NV >/dev/null; echo "nvdefine rc=$?"
for i in 1 2 3; do tpm2_nvincrement -C o $NV; done; echo "nvincrement rc=$?"
tpm2_nvread -C o -s 8 $NV -o $W/c1.bin; V1=$(xxd -p $W/c1.bin); echo "counter after 3 inc = 0x$V1 ($((16#$V1)))"
echo "## nvreadpublic name (WRITTEN set):"; tpm2_nvreadpublic $NV | grep -E 'name|attributes' | head -3
echo "## undefine + redefine + 1 increment + read"
tpm2_nvundefine -C o $NV; echo "nvundefine rc=$?"
tpm2_nvdefine -C o -s 8 -a 'ownerread|ownerwrite|nt=counter|no_da' $NV >/dev/null; echo "nvdefine rc=$?"
echo "## name BEFORE first write (WRITTEN clear):"; tpm2_nvreadpublic $NV | grep -E 'name' | head -1
tpm2_nvincrement -C o $NV; echo "nvincrement rc=$?"
echo "## name AFTER first write:"; tpm2_nvreadpublic $NV | grep -E 'name' | head -1
tpm2_nvread -C o -s 8 $NV -o $W/c2.bin; V2=$(xxd -p $W/c2.bin); echo "counter after redefine+1 inc = 0x$V2 ($((16#$V2)))  monotonic_over_redefine=$([ $((16#$V2)) -gt $((16#$V1)) ] && echo yes || echo NO)"
echo "## NV_Certify size=8 offset=0 with ECDSA-P256 signing key (owner hierarchy)"
tpm2_createprimary -C o -g sha256 -G ecc256:ecdsa -c $W/sign.ctx >/dev/null; echo "createprimary rc=$?"
printf 'QD-probe-claude_fable_5_1' > $W/qd.bin
tpm2_nvcertify -C o -g sha256 -f plain -s ecdsa --size 8 --offset 0 -o $W/sig.bin --attestation $W/attest.bin -q $W/qd.bin $NV -c $W/sign.ctx 2>&1 | head -3; echo "nvcertify rc=${PIPESTATUS[0]}"
ls -l $W/attest.bin $W/sig.bin 2>/dev/null | awk '{print $5, $9}'
echo "## attestation decode (tpm2_print):"; tpm2_print -t TPMS_ATTEST $W/attest.bin 2>&1 | grep -E 'type|extraData|qualifiedSigner|nvContents|offset|size|indexName' | head -8
echo "## NV_Certify size=0 offset=0 (digest form, rev>=1.53) on swtpm:"
tpm2_nvcertify -C o -g sha256 -f plain -s ecdsa --size 0 --offset 0 -o $W/sig0.bin --attestation $W/attest0.bin -q $W/qd.bin $NV -c $W/sign.ctx >/dev/null 2>&1; echo "nvcertify(size=0) rc=$?"
tpm2_print -t TPMS_ATTEST $W/attest0.bin 2>&1 | grep -E 'type|nvDigest|nvContents' | head -3
echo "## uint64 precision in JS Number:"
node -e 'const a=2n**53n+1n, b=2n**53n+2n; console.log("Number(2^53+1)==Number(2^53+2):", Number(a)===Number(b), "| bigint equal:", a===b)'
tpm2_nvundefine -C o $NV >/dev/null; echo "cleanup nvundefine rc=$?"
rm -rf $W
