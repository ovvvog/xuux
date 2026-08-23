import { generateKeyPairSync, sign, verify, randomUUID, createHash } from 'node:crypto';

export function fingerprint(publicKey) {
  return createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex');
}

export class KingIdentity {
  constructor() {
    const keys = generateKeyPairSync('ed25519');
    this.id = 'king:' + fingerprint(keys.publicKey).slice(0, 24);
    this.privateKey = keys.privateKey;
    this.publicKey = keys.publicKey;
  }
  sign(payload) {
    return sign(null, Buffer.from(JSON.stringify(payload)), this.privateKey).toString('base64url');
  }
  verify(payload, signature) {
    return verify(
      null,
      Buffer.from(JSON.stringify(payload)),
      this.publicKey,
      Buffer.from(signature, 'base64url'),
    );
  }
  certificate() {
    return {
      subject: this.id,
      issuer: 'crown-root',
      publicKey: this.publicKey.export({ type: 'spki', format: 'pem' }),
      purpose: 'sovereign-authority',
    };
  }
}

export class CertificateAuthority {
  constructor(king) {
    this.king = king;
    this.revoked = new Set();
  }
  issue(subject, role, capabilities = []) {
    const body = {
      id: randomUUID(),
      subject,
      issuer: this.king.id,
      role,
      capabilities,
      issuedAt: new Date().toISOString(),
    };
    return { ...body, signature: this.king.sign(body) };
  }
  revoke(certificateId, reason) {
    this.revoked.add(certificateId);
    return { certificateId, reason, revokedAt: new Date().toISOString() };
  }
  isValid(cert) {
    return (
      !this.revoked.has(cert.id) &&
      this.king.verify(
        {
          id: cert.id,
          subject: cert.subject,
          issuer: cert.issuer,
          role: cert.role,
          capabilities: cert.capabilities,
          issuedAt: cert.issuedAt,
        },
        cert.signature,
      )
    );
  }
}

export class AgentIdentity {
  constructor(ca, name, role, capabilities = []) {
    this.name = name;
    this.certificate = ca.issue('agent:' + name, role, capabilities);
  }
}
