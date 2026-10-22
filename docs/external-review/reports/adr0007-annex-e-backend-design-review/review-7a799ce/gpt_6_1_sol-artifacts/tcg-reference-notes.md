# Public TCG evidence used in this review

These are specification readings, not results from a TPM in this review.

## Password authorization and integrity

Part 1 r1.59 §19.4 (printed page 101) says: “A plaintext password value may be used to authorize an action when use of an authValue is allowed.” It continues: “A plaintext password may be appropriate for cases in which the path between the caller and the TPM is trusted or when the authorization value is well known.” These passages are present in the official-domain search excerpt as well as the later native page extraction. ([TCG Part 1 r1.59](https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p59_Part1_Architecture_pub.pdf))

The locally downloaded reference implementation is more precise evidence than the inconsistent native extraction: Part 4 r1.59 §6.4.4.8, `CheckPWAuthSession`, code lines 624–630, obtains the authorized entity's `authValue` and returns success when the supplied password bytes match; its signature does not take the command or its `cpHash`. The dispatcher at lines 1187–1190 chooses this function for `TPM_RS_PW`, and chooses `CheckSessionHMAC` otherwise. ([TCG Part 4 r1.59](https://cdn.trustedcomputinggroup.org/production/TCG_TPM_2_r1p59_Part4_Supp_Routines_code_pub_b5951a79b4.pdf), [local exact excerpts](./16-tcg-password-and-response-excerpts.log))

Part 4 §6.4.5.12, `BuildResponseSession`, code lines 1804–1808, makes the password response nonce and authorization empty and sets `continueSession`; this is a structurally recognizable response, not command/response integrity. ([TCG Part 4 r1.59](https://cdn.trustedcomputinggroup.org/production/TCG_TPM_2_r1p59_Part4_Supp_Routines_code_pub_b5951a79b4.pdf), [local exact excerpts](./16-tcg-password-and-response-excerpts.log))

Part 3 r1.59 §31.4, Table 201 (printed page 310), lists `authHandle`, with `TPM_RH_OWNER` allowed for owner deletion, followed by `nvIndex`, “the NV Index to remove from NV memory.” `nvIndex` is not itself an authorizing handle for this command. ([TCG Part 3 r1.59](https://cdn.trustedcomputinggroup.org/production/TCG_TPM_2_r1p59_Part3_Commands_pub_00016d87e3.pdf), [local exact excerpts](./09-tcg-exact-excerpts.log))

## Response attributes

Part 4 r1.59 §6.4.5.7 is `UpdateAuditSessionStatus`, not `BuildResponseSession`: code lines 1588–1595 set or clear `auditExclusive` from the exclusive audit session state. `BuildResponseSession` is §6.4.5.12; lines 1780–1782 update audit state before response authorization generation, lines 1812–1814 generate the response HMAC, and lines 1825–1826 flush when `continueSession` is clear. ([TCG Part 4 r1.59](https://cdn.trustedcomputinggroup.org/production/TCG_TPM_2_r1p59_Part4_Supp_Routines_code_pub_b5951a79b4.pdf), [local exact excerpts](./16-tcg-password-and-response-excerpts.log))

## Error responses and policy tickets

Part 3 r1.59 §6.1, printed page 8, states that an error response tag is `TPM_ST_NO_SESSIONS` except for the legacy `TPM_ST_RSP_COMMAND`/`TPM_RC_BAD_TAG` case; an error response is 10 bytes. ([TCG Part 3 r1.59](https://cdn.trustedcomputinggroup.org/production/TCG_TPM_2_r1p59_Part3_Commands_pub_00016d87e3.pdf), [local exact excerpts](./09-tcg-exact-excerpts.log))

Part 3 §23.3 says a nonnegative `expiration` produces a NULL ticket; Table 125 says `timeout` is empty for a NULL ticket. Part 2 r1.59 §10.7.5 defines the NULL Auth Ticket as `<TPM_ST_AUTH_SIGNED, TPM_RH_NULL, 0x0000>`, not as a ticket with tag `TPM_ST_NULL`. ([TCG Part 3 r1.59](https://cdn.trustedcomputinggroup.org/production/TCG_TPM_2_r1p59_Part3_Commands_pub_00016d87e3.pdf), [TCG Part 2 r1.59](https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p59_Part2_Structures_pub.pdf))

## EK creation

EK Credential Profile v2.5 §2.2.1.6, printed pages 16–17, distinguishes four cases: no template/no nonce means the default template; a template without nonce is used unmodified; template plus nonce uses zero-padded nonce in the public unique area; nonce without template is “unspecified and MUST NOT be provisioned.” ([TCG EK Credential Profile v2.5](https://trustedcomputinggroup.org/wp-content/uploads/TCG-EK-Credential-Profile-V-2.5-R2_published.pdf))

Retrieval limitation: native extractions of the same Part 1 URL supplied inconsistent section numbers; fresh retrieval then returned `http_code_too_many_requests`, and the single HTTPS download attempt returned HTTP 429. The password finding therefore relies on the actual downloaded Part 4 code, actual downloaded Part 3 command schema, and the official-domain §19.4 search excerpt, not on the inconsistent section-number extraction. ([Native failure record](./tcg-part1-native-fetch.json), [download log](./15-part1-download.log), [TCG Part 1](https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p59_Part1_Architecture_pub.pdf))

All successfully downloaded PDFs and text extracts are retained in this evidence directory; no simulator was installed or run.
