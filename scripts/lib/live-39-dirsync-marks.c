/* scripts/lib/live-39-dirsync-marks.c — حائلُ علاماتِ مزامنةِ المجلّدِ (‏`WL-505`/`LIVE-39` ع١).
 *
 * **الغرض:** قياسُ «حينَ يعودُ `fsync` المجلّدِ يكونُ الاسمُ دائماً» **في نظامِ الملفّاتِ نفسِه**،
 * لا عبرَ نتيجةِ بروتوكولِ الاستعادة (‏تحليلُ `WL-503` §4.1). يعترضُ `fsync(2)` على واصفِ مجلّدٍ
 * داخلَ نطاقٍ مُعلَنٍ، ويضعُ بعدَهُ علامةً `dirsync-<n>` في سجلِّ `dm-log-writes` عبرَ مُعلِّمٍ
 * خارجيٍّ **متزامنٍ** (‏يُنتظَرُ خروجُه قبلَ العودةِ إلى الكاتب)، ويُسجِّلُ قبلَها كلَّ اسمٍ مَسَّتهُ
 * `rename`/`link`/`unlink` في ذلكَ المجلّدِ منذُ آخرِ مزامنةٍ له، بحالِه الحيّةِ (‏موجودٌ ونسخةُ
 * محتواهُ، أو غائب). فإعادةُ السجلِّ حتّى `dirsync-<n>` تُقارَنُ بهذه الحالِ اسماً اسماً.
 *
 * **الأوضاعُ (‏`LIVE39_DIRSYNC_MODE`) — ولا وضعَ ضمنيّاً:**
 *   witness  الشاهدُ الموجب: `fsync` الحقيقيُّ ⇐ لقطةُ الحالِ ⇐ العلامة.
 *   mutate   الطفرةُ السلبيّة: **يُسقَطُ** `fsync` (‏يُرجَعُ نجاحٌ) ⇐ لقطةٌ ⇐ العلامة.
 *   early    الطفرةُ المضادّةُ لأداةِ القياس: لقطةٌ ⇐ العلامةُ **قبلَ** النداءِ ⇐ `fsync` الحقيقيّ.
 *            الكاتبُ يرى سلوكاً سليماً تامّاً؛ والمُغيَّرُ موضعُ العلامةِ وحدَه — فإن بقيَ الاسمُ
 *            «دائماً» عندَها فالأداةُ لا تقيسُ الترتيبَ وكلُّ نتيجةٍ خضراءَ منها مشكوكٌ فيها.
 *
 * **ما لا يفعلُه:** لا يمسُّ كودَ الإنتاج (‏يُحمَّلُ بـ`LD_PRELOAD` على عمليّةِ القياسِ الفرعيّةِ
 * وحدَها)، ولا يُسقِطُ `fsync` ملفٍّ أبداً، ولا يعملُ خارجَ `LIVE39_DIRSYNC_SCOPE` (‏مزامنةُ مجلّدٍ
 * خارجَه تمرُّ حقيقيّةً بلا علامةٍ وتُسجَّلُ `DIRSYNC_OUT_OF_SCOPE`). وأيُّ عطبٍ في الحزامِ
 * (‏متغيّرٌ ناقصٌ، مُعلِّمٌ فشلَ، سجلٌّ لا يُكتَب) ⇐ `abort()` صاخبٌ لا استمرارٌ صامت.
 *
 * **المتغيّرات:** `LIVE39_DIRSYNC_MODE` · `LIVE39_DIRSYNC_LOG` (‏سجلُّ السطورِ، إلحاقاً) ·
 * `LIVE39_DIRSYNC_SNAPS` (‏مجلّدُ نُسَخِ المحتوى) · `LIVE39_DIRSYNC_MARKER` (‏تنفيذيٌّ يُنادى
 * `<marker> dirsync-<n>` ويجبُ أن يخرجَ `0`) · `LIVE39_DIRSYNC_SCOPE` (‏بادئةُ المسارِ المقيس) ·
 * `LIVE39_DIRSYNC_SOCKET` (‏اختياريٌّ: ملفُّ المرجعِ الخارجيِّ يُنسَخُ عندَ كلِّ علامةٍ ليُقاسَ
 * البروتوكولُ عندَها **منفصلاً** عن دوامِ الاسم).
 *
 * **صيغةُ السجلّ** (‏سطرٌ لكلِّ حدثٍ، حقولٌ بـ`|`):
 *   DIRSYNC|n=<n>|mode=<m>|dir=<D>|primary=<path|->|op=<rename|link|unlink|none>|names=<k>
 *   NAME|n=<n>|k=<k>|path=<p>|state=<present|absent>|snap=<file|->|primary=<0|1>
 *   FSYNC_REAL|n=<n>|rc=<rc>   ·   FSYNC_SKIPPED|n=<n>   ·   MARK_REQ|n=<n>
 *   (‏والمُعلِّمُ يُلحِقُ `MARK_ACK|dirsync-<n>` بعدَ عودةِ `dmsetup`، والعمليّةُ الفرعيّةُ `STAGE|<s>`.)
 *
 * الترجمة: `gcc -shared -fPIC -O1 -Wall -Werror -Wno-bidi-chars -Wno-format-truncation -o <so> هذا_الملف.c -ldl -lpthread`
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <pthread.h>
#include <spawn.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;

#define MAX_PENDING 256

typedef struct {
  char path[PATH_MAX];
  char parent[PATH_MAX];
  char op[8];
} pending_t;

static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
static pending_t pending[MAX_PENDING];
static int pending_count = 0;
static unsigned long marks = 0;
static unsigned long out_of_scope = 0;

static void die(const char *why) {
  fprintf(stderr, "LIVE39_DIRSYNC_HARNESS_FAULT %s errno=%d\n", why, errno);
  abort();
}

static const char *env_required(const char *name) {
  const char *value = getenv(name);
  if (value == NULL || value[0] == '\0') {
    fprintf(stderr, "LIVE39_DIRSYNC_HARNESS_FAULT missing %s\n", name);
    abort();
  }
  return value;
}

static void log_line(const char *fmt, ...) {
  const char *file = env_required("LIVE39_DIRSYNC_LOG");
  char buffer[PATH_MAX * 3];
  va_list args;
  va_start(args, fmt);
  int length = vsnprintf(buffer, sizeof buffer - 1, fmt, args);
  va_end(args);
  if (length < 0 || length >= (int)sizeof buffer - 1) die("log line too long");
  buffer[length] = '\n';
  int fd = open(file, O_WRONLY | O_APPEND | O_CREAT | O_CLOEXEC, 0644);
  if (fd < 0) die("open log");
  if (write(fd, buffer, (size_t)length + 1) != length + 1) die("write log");
  close(fd);
}

/* مسارٌ مطلقٌ بلا حلِّ روابطَ (‏كودُ الإنتاجِ يُمرِّرُ مطلقاً؛ النسبيُّ يُلصَقُ بـ`cwd`). */
static void absolute(const char *in, char *out) {
  if (in[0] == '/') {
    snprintf(out, PATH_MAX, "%s", in);
    return;
  }
  char cwd[PATH_MAX];
  if (getcwd(cwd, sizeof cwd) == NULL) die("getcwd");
  snprintf(out, PATH_MAX, "%s/%s", cwd, in);
}

static void parent_of(const char *path, char *out) {
  snprintf(out, PATH_MAX, "%s", path);
  char *slash = strrchr(out, '/');
  if (slash == NULL) die("parent of relative path");
  if (slash == out) slash[1] = '\0';
  else *slash = '\0';
}

static int in_scope(const char *path) {
  const char *scope = env_required("LIVE39_DIRSYNC_SCOPE");
  size_t n = strlen(scope);
  return strncmp(path, scope, n) == 0 && (path[n] == '/' || path[n] == '\0');
}

static void remember(const char *raw, const char *op) {
  char path[PATH_MAX];
  absolute(raw, path);
  if (!in_scope(path)) return;
  pthread_mutex_lock(&lock);
  /* مسارٌ واحدٌ مُدخلةٌ واحدة: آخرُ عمليّةٍ عليه هيَ الأوّليّةُ المرشَّحة. */
  for (int i = 0; i < pending_count; i++) {
    if (strcmp(pending[i].path, path) == 0) {
      memmove(&pending[i], &pending[i + 1], sizeof(pending_t) * (size_t)(pending_count - i - 1));
      pending_count -= 1;
      break;
    }
  }
  if (pending_count == MAX_PENDING) die("pending overflow");
  snprintf(pending[pending_count].path, PATH_MAX, "%s", path);
  parent_of(path, pending[pending_count].parent);
  snprintf(pending[pending_count].op, sizeof pending[0].op, "%s", op);
  pending_count += 1;
  pthread_mutex_unlock(&lock);
}

/* نسخُ ملفٍّ بلا تحديثِ `atime` ما أمكن — القراءةُ لا تُدخِلُ كتابةً في معاملةِ اليوميّات. */
static void copy_file(const char *from, const char *to) {
  int in = open(from, O_RDONLY | O_CLOEXEC | O_NOATIME);
  if (in < 0 && errno == EPERM) in = open(from, O_RDONLY | O_CLOEXEC);
  if (in < 0) die("open snapshot source");
  int out = open(to, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0644);
  if (out < 0) die("open snapshot target");
  char buffer[65536];
  for (;;) {
    ssize_t r = read(in, buffer, sizeof buffer);
    if (r < 0) die("read snapshot");
    if (r == 0) break;
    if (write(out, buffer, (size_t)r) != r) die("write snapshot");
  }
  close(in);
  close(out);
}

/* يلتقطُ حالَ كلِّ اسمٍ معلَّقٍ في المجلّدِ `dir` ويُفرِغُها — يُنادى والقفلُ ممسوك. */
static void snapshot(unsigned long n, const char *dir, const char *mode) {
  const char *snaps = env_required("LIVE39_DIRSYNC_SNAPS");
  int selected[MAX_PENDING];
  int count = 0;
  int primary = -1;
  for (int i = 0; i < pending_count; i++) {
    if (strcmp(pending[i].parent, dir) != 0) continue;
    selected[count++] = i;
  }
  /* الأوّليُّ: آخرُ ما أُظهِرَ (‏rename/link)، وإلّا آخرُ ما حُذِف. */
  for (int j = count - 1; j >= 0 && primary < 0; j--) {
    if (strcmp(pending[selected[j]].op, "unlink") != 0) primary = selected[j];
  }
  if (primary < 0 && count > 0) primary = selected[count - 1];
  log_line("DIRSYNC|n=%lu|mode=%s|dir=%s|primary=%s|op=%s|names=%d", n, mode, dir,
           primary < 0 ? "-" : pending[primary].path, primary < 0 ? "none" : pending[primary].op,
           count);
  for (int j = 0; j < count; j++) {
    pending_t *entry = &pending[selected[j]];
    struct stat st;
    char snap[PATH_MAX] = "-";
    const char *state = "absent";
    if (lstat(entry->path, &st) == 0) {
      state = "present";
      if (S_ISREG(st.st_mode)) {
        snprintf(snap, sizeof snap, "%s/%lu-%d.bin", snaps, n, j);
        copy_file(entry->path, snap);
      }
    } else if (errno != ENOENT) {
      die("lstat pending name");
    }
    log_line("NAME|n=%lu|k=%d|path=%s|state=%s|snap=%s|primary=%d", n, j, entry->path, state,
             snap, selected[j] == primary ? 1 : 0);
  }
  /* إفراغُ ما التُقِط (‏بترتيبٍ عكسيٍّ ليصحَّ الحذفُ بالإزاحة). */
  for (int j = count - 1; j >= 0; j--) {
    int i = selected[j];
    memmove(&pending[i], &pending[i + 1], sizeof(pending_t) * (size_t)(pending_count - i - 1));
    pending_count -= 1;
  }
  const char *socket = getenv("LIVE39_DIRSYNC_SOCKET");
  if (socket != NULL && socket[0] != '\0' && access(socket, F_OK) == 0) {
    char target[PATH_MAX];
    snprintf(target, sizeof target, "%s/%lu.socket.json", snaps, n);
    copy_file(socket, target);
  }
}

/* المُعلِّمُ متزامنٌ: لا عودةَ إلى الكاتبِ قبلَ خروجِه `0`. بيئتُه بلا `LD_PRELOAD`. */
static void mark(unsigned long n) {
  const char *marker = env_required("LIVE39_DIRSYNC_MARKER");
  char name[64];
  snprintf(name, sizeof name, "dirsync-%lu", n);
  log_line("MARK_REQ|n=%lu", n);
  size_t envc = 0;
  while (environ[envc] != NULL) envc++;
  char **env = calloc(envc + 1, sizeof(char *));
  if (env == NULL) die("calloc env");
  size_t k = 0;
  for (size_t i = 0; i < envc; i++) {
    if (strncmp(environ[i], "LD_PRELOAD=", 11) != 0) env[k++] = environ[i];
  }
  char *argv[] = {(char *)marker, name, NULL};
  pid_t pid;
  int rc = posix_spawn(&pid, marker, NULL, NULL, argv, env);
  free(env);
  if (rc != 0) {
    errno = rc;
    die("spawn marker");
  }
  int status = 0;
  while (waitpid(pid, &status, 0) < 0) {
    if (errno != EINTR) die("waitpid marker");
  }
  if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) die("marker failed");
}

static int real_fsync_call(int fd) {
  static int (*real)(int);
  if (!real) real = dlsym(RTLD_NEXT, "fsync");
  return real(fd);
}

int fsync(int fd) {
  struct stat st;
  if (fstat(fd, &st) != 0 || !S_ISDIR(st.st_mode)) return real_fsync_call(fd);
  char link[64];
  char dir[PATH_MAX];
  snprintf(link, sizeof link, "/proc/self/fd/%d", fd);
  ssize_t length = readlink(link, dir, sizeof dir - 1);
  if (length < 0) die("readlink dir fd");
  dir[length] = '\0';
  if (!in_scope(dir)) {
    pthread_mutex_lock(&lock);
    out_of_scope += 1;
    pthread_mutex_unlock(&lock);
    log_line("DIRSYNC_OUT_OF_SCOPE|dir=%s", dir);
    return real_fsync_call(fd);
  }
  const char *mode = env_required("LIVE39_DIRSYNC_MODE");
  pthread_mutex_lock(&lock);
  unsigned long n = ++marks;
  int rc = 0;
  if (strcmp(mode, "witness") == 0) {
    rc = real_fsync_call(fd);
    int saved = errno;
    log_line("FSYNC_REAL|n=%lu|rc=%d", n, rc);
    snapshot(n, dir, mode);
    mark(n);
    errno = saved;
  } else if (strcmp(mode, "mutate") == 0) {
    log_line("FSYNC_SKIPPED|n=%lu", n);
    snapshot(n, dir, mode);
    mark(n);
  } else if (strcmp(mode, "early") == 0) {
    snapshot(n, dir, mode);
    mark(n);
    rc = real_fsync_call(fd);
    int saved = errno;
    log_line("FSYNC_REAL|n=%lu|rc=%d", n, rc);
    errno = saved;
  } else {
    die("unknown LIVE39_DIRSYNC_MODE");
  }
  pthread_mutex_unlock(&lock);
  return rc;
}

int rename(const char *from, const char *to) {
  static int (*real)(const char *, const char *);
  if (!real) real = dlsym(RTLD_NEXT, "rename");
  int rc = real(from, to);
  if (rc == 0) {
    remember(from, "unlink");
    remember(to, "rename");
  }
  return rc;
}

int link(const char *from, const char *to) {
  static int (*real)(const char *, const char *);
  if (!real) real = dlsym(RTLD_NEXT, "link");
  int rc = real(from, to);
  if (rc == 0) remember(to, "link");
  return rc;
}

int unlink(const char *path) {
  static int (*real)(const char *);
  if (!real) real = dlsym(RTLD_NEXT, "unlink");
  int rc = real(path);
  if (rc == 0) remember(path, "unlink");
  return rc;
}

/* `renameat`/`linkat`/`unlinkat` بواصفٍ غيرِ `AT_FDCWD` لا تُتعقَّبُ — تُسجَّلُ ليُرى إن وقعت. */
int renameat(int ofd, const char *from, int nfd, const char *to) {
  static int (*real)(int, const char *, int, const char *);
  if (!real) real = dlsym(RTLD_NEXT, "renameat");
  int rc = real(ofd, from, nfd, to);
  if (rc == 0) {
    if (ofd == AT_FDCWD && nfd == AT_FDCWD) {
      remember(from, "unlink");
      remember(to, "rename");
    } else {
      log_line("UNTRACKED|op=renameat|to=%s", to);
    }
  }
  return rc;
}

int unlinkat(int dfd, const char *path, int flags) {
  static int (*real)(int, const char *, int);
  if (!real) real = dlsym(RTLD_NEXT, "unlinkat");
  int rc = real(dfd, path, flags);
  if (rc == 0) {
    if (dfd == AT_FDCWD) remember(path, "unlink");
    else log_line("UNTRACKED|op=unlinkat|path=%s", path);
  }
  return rc;
}

__attribute__((destructor)) static void report(void) {
  const char *mode = getenv("LIVE39_DIRSYNC_MODE");
  fprintf(stderr, "LIVE39_DIRSYNC_SUMMARY mode=%s marks=%lu out_of_scope=%lu\n",
          mode ? mode : "-", marks, out_of_scope);
}
