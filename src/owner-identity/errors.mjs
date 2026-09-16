// رموزُ رفضِ هويةِ المالك — مُقابَلةٌ في الاتجاهين مع الوثيقة.
export const OWNER_IDENTITY_ERRORS = Object.freeze({
  OWNER_ID_INVALID: 'OWNER_IDENTITY_OWNER_ID_INVALID',
  IDENTITY_VALUE_INVALID: 'OWNER_IDENTITY_VALUE_INVALID',
  PROVIDER_REQUIRED: 'OWNER_IDENTITY_PROVIDER_REQUIRED',
  DEVICE_FINGERPRINT_INVALID: 'OWNER_IDENTITY_DEVICE_FINGERPRINT_INVALID',
  DEVICE_OWNER_REQUIRED: 'OWNER_IDENTITY_DEVICE_OWNER_REQUIRED',
});

export class OwnerIdentityError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} detail
   */
  constructor(code, message, detail) {
    super(message);
    this.name = 'OwnerIdentityError';
    this.code = code;
    this.detail = detail;
  }
}
