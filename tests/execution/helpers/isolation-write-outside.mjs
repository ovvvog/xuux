// حمولة هروب: هذا المسار من شجرة العمل المربوطة للقراءة فقط لا من output.
import fs from 'node:fs';

fs.writeFileSync('/workspace/read-only-target.txt', 'هذه كتابة يجب أن تُمنع');
