/* scripts/lib/live-39-mutate-dir-fsync.c — حائلُ طفرةِ `fsync` المجلّدِ (‏`WL-502`/`LIVE-39`).
 *
 * **لماذا حائلُ `LD_PRELOAD` لا ترقيعُ `node:fs`:** الاستيرادُ المسمّى من `node:fs`
 * (‏`import { fsyncSync } from 'node:fs'`) يُحلُّ وقتَ ربطِ الوحدةِ إلى القيمةِ الأصليةِ
 * نفسِها — ترقيعُ خاصيةِ الوحدةِ بعدَ الربطِ لا يصيبُ نداءاتِ شفرةِ الإنتاجِ (مقيسٌ
 * بتجربةٍ معزولةٍ: عدّادُ الترقيعِ بقيَ صفراً رغمَ معاملةٍ مكتملةٍ). هذا الحائلُ يعترضُ
 * نداءَ `fsync(2)` نفسَهُ في النواةِ: مقبضُ مجلّدٍ ⇐ يُحسَبُ ويُرجَعُ نجاحٌ بلا مزامنةٍ،
 * ومقبضُ ملفٍّ ⇐ المزامنةُ الحقيقيةُ كما هي. فتُقاسُ شفرةُ الإنتاجِ **بلا مسٍّ لها** تحتَ
 * غيابِ `fsync` المجلداتِ وحدَهُ.
 *
 * الإثباتُ الذاتيُّ: عندَ الخروجِ يُطبعُ في `stderr` سطرُ
 * `MUTATION_DIR_FSYNC_SKIPPED count=N` — وسكربتُ القياسِ يُسقِطُ إن كانَ `0`
 * (طفرةٌ لم تُطبَّقْ لا حكمَ عمىً).
 *
 * الترجمةُ في السكربتِ: `gcc -shared -fPIC -o <mut.so> هذا_الملف.c`
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <sys/stat.h>
#include <stdio.h>
#include <unistd.h>

static unsigned long skipped = 0;

int fsync(int fd) {
  struct stat st;
  if (fstat(fd, &st) == 0 && S_ISDIR(st.st_mode)) {
    skipped += 1;
    return 0;
  }
  static int (*real_fsync)(int);
  if (!real_fsync) real_fsync = dlsym(RTLD_NEXT, "fsync");
  return real_fsync(fd);
}

__attribute__((destructor)) static void report(void) {
  fprintf(stderr, "MUTATION_DIR_FSYNC_SKIPPED count=%lu\n", skipped);
}
