import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Local encrypted keystore abstraction; production must replace this with HSM/KMS.
export class EncryptedKeyStore {
  constructor(file, masterKey) { if (!masterKey || masterKey.length < 16) throw new Error('MASTER_KEY_TOO_SHORT'); this.file=file; this.masterKey=Buffer.from(masterKey); }
  save(name, value) { const salt=randomBytes(16), iv=randomBytes(12), key=scryptSync(this.masterKey,salt,32); const cipher=createCipheriv('aes-256-gcm',key,iv); const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]); const tag=cipher.getAuthTag(); mkdirSync(dirname(this.file),{recursive:true}); writeFileSync(this.file,JSON.stringify({name,salt:salt.toString('base64url'),iv:iv.toString('base64url'),tag:tag.toString('base64url'),data:ciphertext.toString('base64url')})); }
  load(expectedName) { const x=JSON.parse(readFileSync(this.file,'utf8')); if(x.name!==expectedName) throw new Error('KEY_NAME_MISMATCH'); const key=scryptSync(this.masterKey,Buffer.from(x.salt,'base64url'),32); const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(x.iv,'base64url')); decipher.setAuthTag(Buffer.from(x.tag,'base64url')); return Buffer.concat([decipher.update(Buffer.from(x.data,'base64url')),decipher.final()]).toString('utf8'); }
}
