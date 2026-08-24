// حمولة سليمة: الكتابة الوحيدة المصرح بها تحت output المربوط writable.
import fs from 'node:fs';

fs.writeFileSync('/workspace/output/accepted.txt', 'نجحت الكتابة المصرح بها', 'utf8');
console.log('allowed-write-complete');
