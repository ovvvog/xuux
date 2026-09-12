// مادّةُ TLS للاختباراتِ: جهةُ إصدارٍ وشهادةُ خادمٍ موقَّعةٌ منها.
//
// **موضعٌ واحدٌ لا موضعانِ:** كان هذا التوليدُ مكتوباً في
// `tests/transport/tls.test.mjs` وحدَه، فلمّا احتاجَه اختبارُ مُوائمِ `https`
// كان نسخُه سيُنشئُ **مقياسينِ للشهادةِ** — واحدٌ يحمِلُ `subjectAltName` وآخرُ
// يُنسى فيه، فيُقرأُ فشلُ تحقُّقٍ خطأَ مُوائمٍ. فصارَ ما يُولِّدُ الشهادةَ هنا.
//
// **حدٌّ مُعلَنٌ:** يحتاجُ `openssl` في المسارِ؛ وهو موجودٌ في بيئةِ التكاملِ
// المستمرِّ وفي صورةِ العملِ، ومن لم يجدْه سقطَ الاختبارُ صراحةً ولم يُتخطَّ
// صامتاً — فتخطّي اختبارِ تعميةٍ صامتاً هو أخطرُ من فشلِه.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * يُولِّدُ جهةَ إصدارٍ وشهادةَ خادمٍ موقَّعةً منها في مجلَّدٍ مؤقَّتٍ.
 * @param {string} dir
 * @param {string} name بادئةُ الملفّاتِ — تُميِّزُ جهةَ إصدارٍ عن أخرى.
 * @returns {{ caFile: string, certFile: string, keyFile: string }}
 */
export function issueMaterial(dir, name) {
  const caKey = path.join(dir, `${name}-ca.key`);
  const caFile = path.join(dir, `${name}-ca.crt`);
  const keyFile = path.join(dir, `${name}-server.key`);
  const csr = path.join(dir, `${name}-server.csr`);
  const certFile = path.join(dir, `${name}-server.crt`);
  const extFile = path.join(dir, `${name}-server.ext`);
  const ec = ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes'];
  /** @param {string[]} args */
  const openssl = (args) => execFileSync('openssl', args, { stdio: 'pipe' });

  openssl([
    'req',
    '-x509',
    ...ec,
    '-keyout',
    caKey,
    '-out',
    caFile,
    '-days',
    '1',
    '-subj',
    `/CN=${name}-ca`,
  ]);
  openssl(['req', '-new', ...ec, '-keyout', keyFile, '-out', csr, '-subj', '/CN=localhost']);
  // الاسمُ البديلُ مُعلَنٌ: شهادةٌ بلا `subjectAltName` تُرَدُّ في العملاءِ
  // الحديثينِ، فاختبارُ نجاحٍ بلا اسمٍ بديلٍ كان سيَقيسُ فشلاً ويُسمّيه نجاحاً.
  fs.writeFileSync(extFile, 'subjectAltName=DNS:localhost,IP:127.0.0.1\n');
  openssl([
    'x509',
    '-req',
    '-in',
    csr,
    '-CA',
    caFile,
    '-CAkey',
    caKey,
    '-out',
    certFile,
    '-days',
    '1',
    '-extfile',
    extFile,
  ]);
  return { caFile, certFile, keyFile };
}
