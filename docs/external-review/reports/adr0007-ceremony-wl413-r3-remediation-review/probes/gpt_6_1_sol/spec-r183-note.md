# مقتطف المواصفة المقروء في هذه الجولة

الوثيقة: TCG TPM Library, Family 2.0, Level 00, Revision 01.83, 25 January 2024، Part 2: Structures، §15.1 وTPMA_SESSION.

الرابط الذي أعادت أداة قراءة الويب محتواه:
https://trustedcomputinggroup.org/wp-content/uploads/TPM-2.0-1.83-Part-2-Structures.pdf

النص المستخرج لـpcrDigest:

> Digest of the selected PCRs using the nameAlg of the object for which this structure is being created. pcrDigest.size shall be zero if the pcrSelect list is empty.

النص المستخرج لبقية TPMS_CREATION_DATA:

> pcrSelect; pcrDigest; locality; parentNameAlg; parentName; parentQualifiedName; outsideInfo.

النص المستخرج للبتات:

> TPMA_SESSION bits 4:3: Reserved; shall be CLEAR.

هذا مقتطف من خرج أداة القراءة، لا نسخة PDF محلية للنسخة 1.83؛ ملفات PDF والنصوص المحلية في المجلد تخص النسخة 1.38.
