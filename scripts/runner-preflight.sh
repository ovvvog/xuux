#!/usr/bin/env bash
# فحصُ العدّاءِ المُسبَقُ (`LIVE-18` / `WL-261`).
#
# العدّاءُ `xuux-ci-linux` مقيمٌ ذاتيُّ الاستضافةِ، وتجهيزُه يقعُ خارجَ المستودعِ.
# فلمّا أُعيدَ تسجيلُه على آلةٍ بلا تجهيزٍ (`WL-253`) سقطَت أوّلُ وظيفةٍ في
# «Set up job» بـ`docker: command not found` — سببٌ لا يُسمّي المتطلَّبَ ولا علاجَه.
# هذا النصُّ يَفحصُ **كلَّ** متطلَّبٍ تحتاجُه وظائفُ CI على الآلةِ نفسِها، ويُسمّي
# كلَّ غائبٍ برمزِه وعلاجِه، ولا يقفُ عندَ أوّلِ غيابٍ؛ ويَخرجُ بـ1 إن غابَ شيءٌ.
#
# ويُشغَّلُ في وظيفةٍ **بلا `services:`**، لأنّ غيابَ Docker يُسقِطُ الوظيفةَ ذاتَ
# الحاوياتِ قبلَ أوّلِ خطوةٍ فيها، فلا يَبلُغُها أيُّ فحصٍ.
#
# المرجعُ المكتوبُ لكلِّ متطلَّبٍ: `docs/RUNNER_PROVISIONING.md`.
#
# **حدٌّ مُعلَنٌ:** إصدارُ نظامِ التشغيلِ يُطبَعُ ولا يُفرَضُ؛ فقبولُ Ubuntu 24.04
# أو الترقيةُ إلى 26.04 قرارُ المالكِ في `LIVE-18`، لا قرارُ هذا النصِّ.

set -u

failures=0
report=""

ok() {
  report+="✓ $1"$'\n'
  echo "✓ $1"
}

missing() {
  failures=$((failures + 1))
  report+="✗ $1: $2"$'\n'
  echo "::error::$1: $2" >&2
  echo "✗ $1: $2"
}

has() {
  command -v "$1" >/dev/null 2>&1
}

# ── P1 — Docker: وظيفةُ الفحصِ تُشغِّلُ PostgreSQL حاويةً (`services:`) ──
if ! has docker; then
  missing 'RUNNER_DOCKER_MISSING' 'أمرُ docker غائبٌ، ووظيفةُ الفحصِ تُشغِّلُ PostgreSQL حاويةً. ثبِّتْ Docker Engine وأضِفْ مستخدمَ العدّاءِ إلى مجموعةِ docker.'
elif ! timeout 30 docker info >/dev/null 2>&1; then
  missing 'RUNNER_DOCKER_UNREACHABLE' 'docker حاضرٌ والخادمُ لا يُجيبُ لمستخدمِ العدّاءِ (docker info). شغِّلِ الخدمةَ أو أضِفِ المستخدمَ إلى مجموعةِ docker ثمَّ أعِدْ تشغيلَ خدمةِ العدّاءِ.'
else
  ok "Docker — $(timeout 30 docker version --format '{{.Server.Version}}' 2>/dev/null || echo 'يُجيبُ')"
fi

# ── P2 — عميلُ PostgreSQL 18: الخادمُ 18.6 و`pg_dump` يرفضُ خادماً أحدثَ منه ──
pg_version=""
if has pg_dump; then
  pg_version="$(pg_dump --version 2>/dev/null || true)"
fi
if [[ "$pg_version" == *" 18."* ]]; then
  ok "عميلُ PostgreSQL — ${pg_version}"
elif has sudo && sudo -n true 2>/dev/null; then
  ok 'عميلُ PostgreSQL 18 غائبٌ و sudo بلا كلمةِ مرورٍ متاحٌ — تُثبِّتُه خطوةُ «تثبيت عميل PostgreSQL 18» في وظيفةِ الفحصِ'
else
  missing 'RUNNER_PG_CLIENT_MISSING' "عميلُ PostgreSQL 18 غائبٌ (${pg_version:-لا pg_dump})، و sudo يطلبُ كلمةَ مرورٍ فلا تثبيتَ آليّاً. ثبِّتْ postgresql-client-18 من مستودعِ PGDG مرّةً واحدةً."
fi

# ── P3 — أدواتُ البناءِ: `pkcs11js` وحدةٌ أصليّةٌ تُبنى بـnode-gyp ──
build_missing=""
for tool in gcc g++ make python3; do
  has "$tool" || build_missing+=" ${tool}"
done
if [[ -n "$build_missing" ]]; then
  missing 'RUNNER_BUILD_TOOLS_MISSING' "غائبٌ:${build_missing}. ووحدةُ pkcs11js الأصليّةُ تُبنى بها. ثبِّتْ build-essential و python3."
else
  ok 'أدواتُ البناءِ — gcc · g++ · make · python3'
fi

# ── P4 — مساحاتُ أسماءِ المستخدمِ: اختباراتُ العزلِ تتخطّى بغيابِها فتضيعُ تغطيتُها صامتةً ──
# الأمرُ نفسُه الذي يُجريه `probeIsolation()` في `src/execution/isolation.mjs`.
if ! has unshare; then
  missing 'RUNNER_USERNS_UNAVAILABLE' 'أمرُ unshare غائبٌ (util-linux)، واختباراتُ العزلِ تتخطّى بغيابِه.'
elif ! timeout 10 unshare --map-root-user --net --mount --pid --fork --mount-proc -- true >/dev/null 2>&1; then
  missing 'RUNNER_USERNS_UNAVAILABLE' 'النواةُ تمنعُ مساحاتِ أسماءِ المستخدمِ غيرِ المميَّزِ، فاختباراتُ العزلِ تتخطّى صامتةً. اكتبْ kernel.apparmor_restrict_unprivileged_userns=0 في /etc/sysctl.d/60-xuux-userns.conf ثمَّ sudo sysctl --system.'
else
  ok 'مساحاتُ أسماءِ المستخدمِ — unshare --map-root-user --net --mount --pid يعمل'
fi

# ── P5 — أدواتٌ تستدعيها خطواتُ الوظائفِ الثلاثِ بأسمائِها ──
tools_missing=""
for tool in git curl tar sha256sum timeout; do
  has "$tool" || tools_missing+=" ${tool}"
done
if [[ -n "$tools_missing" ]]; then
  missing 'RUNNER_TOOLS_MISSING' "غائبٌ:${tools_missing}. تستدعيها خطواتُ ci.yml و measure-skip-baseline.yml و publish-skip-baseline.yml."
else
  ok 'أدواتُ الخطواتِ — git · curl · tar · sha256sum · timeout'
fi

# ── معلومةٌ لا شرطٌ: النظامُ والنواةُ (قرارُ `LIVE-18` للمالكِ) ──
os_name="غيرُ معروفٍ"
if [[ -r /etc/os-release ]]; then
  os_name="$(. /etc/os-release && echo "${PRETTY_NAME:-غيرُ معروفٍ}")"
fi
info="النظامُ: ${os_name} · النواةُ: $(uname -r) — يُطبَعُ ولا يُفرَضُ (قرارُ LIVE-18 للمالكِ)"
echo "ℹ ${info}"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo '### فحصُ العدّاءِ المُسبَقُ (LIVE-18)'
    echo ''
    echo '```'
    printf '%s' "$report"
    echo "ℹ ${info}"
    echo '```'
    echo ''
    echo 'المرجعُ: `docs/RUNNER_PROVISIONING.md`'
  } >>"$GITHUB_STEP_SUMMARY"
fi

if ((failures > 0)); then
  echo "::error::RUNNER_PREFLIGHT_FAILED: ${failures} متطلَّبٍ غائبٍ — انظرْ docs/RUNNER_PROVISIONING.md." >&2
  exit 1
fi
echo 'العدّاءُ تامُّ التجهيزِ لوظائفِ CI.'
