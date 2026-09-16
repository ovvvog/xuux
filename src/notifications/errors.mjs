// رموزُ رفضِ الإشعارات — مُقابَلةٌ في الاتجاهين مع الوثيقة.
export const NOTIFICATION_ERRORS = Object.freeze({
  CHANNEL_NOT_CONFIGURED: 'NOTIFICATION_CHANNEL_NOT_CONFIGURED',
  CHANNEL_UNSUPPORTED: 'NOTIFICATION_CHANNEL_UNSUPPORTED',
  DISPATCHER_AUDIT_REQUIRED: 'NOTIFICATION_DISPATCHER_AUDIT_REQUIRED',
  DISPATCHER_CHANNEL_REQUIRED: 'NOTIFICATION_DISPATCHER_CHANNEL_REQUIRED',
  IDENTITY_NOT_DELIVERABLE: 'NOTIFICATION_IDENTITY_NOT_DELIVERABLE',
  NO_CHANNEL_FOR_OWNER: 'NOTIFICATION_NO_CHANNEL_FOR_OWNER',
  LOOPBACK_FORBIDDEN: 'NOTIFICATION_LOOPBACK_FORBIDDEN',
});

export class NotificationError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} detail
   */
  constructor(code, message, detail) {
    super(message);
    this.name = 'NotificationError';
    this.code = code;
    this.detail = detail;
  }
}
