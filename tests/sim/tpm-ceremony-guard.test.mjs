// @ts-nocheck
// tests/sim/tpm-ceremony-guard.test.mjs
//
// WL-412 — حارسُ بروفةِ المراسم (sim/tpm-ceremony/): إثباتُ أنّ مسارَ TBS الخاصَّ بالمضيفِ غيرُ قابلٍ
// للوصولِ من أداةِ المحاكاة، وأنّ أيَّ نقلٍ غيرِ محاكٍ يُرفَضُ بفشلٍ مغلق.
//   1) static: لا DllImport ولا tbs ولا Tbsi ولا TbsTransport ولا OwnerAuth ولا Clear-Tpm في الأداة؛ النقلُ
//      الوحيدُ loopback؛ C# 5؛ والتقريرُ لا يُسلسِلُ بايتاتِ الأوامر.
//   2) pwsh: المُشغِّلُ يرفضُ مضيفاً غيرَ loopback (ValidateSet)، والنقلُ يرفضُه بـSIMULATOR_TRANSPORT_LOOPBACK_ONLY.
//   3) pwsh: نقلٌ يدّعي شريحةً غيرَ المحاكي (IFX) ⇒ FAILED_CLOSED بعدَ استعلامِ الهويّةِ وحدَه.
//   4) pwsh: كلُّ أمرٍ تبنيه البروفةُ يُعرَضُ على حارسِ أداةِ المضيف (TpmGuard) ⇒ يُرفَضُ كلُّه ولا يبلغُ النقل.
//   5) static: حارسُ نطاقِ الإقلاعِ الإنتاجيِّ (WL-429): الملفاتُ المسمّاةُ وإغلاقُ تبعياتِ scripts/
//      production-entry.mjs وsrc/production وsrc/root-of-trust ومدخلةُ R3-A-01 وحدها في العقدِ لم تُمَسّ.
//      لا تجميدَ لكلِّ src/ ولا للعقدِ بأكملِهِ (قرارُ المالكِ: تضييقُ النطاقِ لا تعطيلُ الحارسِ).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import ts from 'typescript';
import { parse as parseYaml } from 'yaml';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dir = join(root, 'sim/tpm-ceremony');
const core = join(dir, 'TpmCeremonyCore.cs');
const runner = join(dir, 'rehearse.ps1');
const harness = join(root, 'tests/helpers/tpm-ceremony-harness.ps1');
const read = (p) => readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
const stripPsComments = (s) => s.split('\n').map((l) => l.replace(/(^|\s)#.*$/, '')).join('\n');
const stripCsComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

const pwshAvailable = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0;
const pwshTest = (name, fn) => test(name, { skip: pwshAvailable ? false : 'pwsh unavailable' }, fn);

test('static: لا مسارَ إلى TBS أو جهازٍ أو أسرارِ المالكِ في أداةِ البروفة', () => {
  const files = readdirSync(dir).filter((f) => /\.(cs|ps1|mjs)$/.test(f));
  assert.deepEqual(files.sort(), ['TpmCeremonyCore.cs', 'policy_digest.mjs', 'rehearse.ps1']);
  const forbidden = [
    /DllImport/, /tbs\.dll/i, /\bTbsi?_/, /TbsTransport/, /Xuux\.TpmHost/, /OwnerAuth/, /LockoutAuth/i,
    /Clear-Tpm/i, /Initialize-Tpm/i, /Set-Tpm/i, /Get-Tpm/i, /Win32_Tpm/i, /\/dev\/tpm/, /tpmrm/i,
    /device:/, /NV_Certify/i, /CC_NV_Certify/, /0x00000184/i, /HierarchyChangeAuth/i, /\bClear\b\s*\(/,
    /ExecutionPolicy/i, /Invoke-WebRequest/i, /Install-Module/i, /Start-Process/i, /Invoke-Expression/i,
    /xuux-tpmd/, /SUPPORTED_FRESHNESS_BACKENDS/,
  ];
  for (const f of files) {
    const p = join(dir, f);
    const body = f.endsWith('.cs') ? stripCsComments(read(p)) : f.endsWith('.ps1') ? stripPsComments(read(p)) : read(p).replace(/^\s*\/\/.*$/gm, '');
    for (const re of forbidden) assert.equal(re.test(body), false, `${f} contains ${re}`);
  }
});

test('static: النقلُ الوحيدُ swtpm على loopback، والنواةُ C# 5، والتقريرُ بلا بايتاتِ أوامر', () => {
  const cs = stripCsComments(read(core));
  const transports = [...cs.matchAll(/class\s+(\w+)\s*:\s*ICeremonyTransport/g)].map((m) => m[1]);
  assert.deepEqual(transports, ['SwtpmLoopbackTransport']);
  assert.match(cs, /host != "127\.0\.0\.1" && host != "::1"\) throw new CeremonyFailedException\("SIMULATOR_TRANSPORT_LOOPBACK_ONLY"/);
  // الهويّةُ الكاملةُ ثمّ خطُّ الأساسِ ثمّ حاجزُ ملكيّةِ فهارسِ NV ثمّ المراحلُ — لا أمرٍ مُغيّرٍ قبلَ الهويّةِ والجردِ (WL-413؛ WL-416).
  assert.match(cs, /AssertSimulatorIdentity\(\);\s*\n\s*SnapshotBaseline\(\);\s*\n\s*AssertNvRangeOwnership\(\);\s*\n\s*if \(stages == "S1"/);
  for (const re of [/\$"/, /\?\./, /\bnameof\b/, /out var\b/, /\)\s*=>/]) assert.equal(re.test(cs), false, `C# 5 violation ${re}`);
  // المُسلسِلُ: بصمةُ الأمرِ لا بايتاتُه.
  const toJson = cs.slice(cs.indexOf('public string ToJson()'));
  assert.equal(/Hex\.Of\(\s*s\.Command\b|"command"\s*:/.test(toJson), false);
  assert.match(toJson, /commandSha256/);
  // لا قوالبَ بايتٍ ثابتةٍ للأوامر: كلُّ أمرٍ يمرُّ عبرَ Cmd.Build.
  assert.equal(/new byte\[\]\s*\{\s*0x80,\s*0x0[12]/.test(cs), false);
  const ps = stripPsComments(read(runner));
  assert.match(ps, /\[ValidateSet\('127\.0\.0\.1', '::1'\)\]\[string\]\$SimHost/);
  assert.equal(/TpmInventoryCore|sim\/tpm-host|tpm-host/.test(ps), false);
});

test('static: سماتُ المرساةِ في النواةِ تطابقُ §4.1 (ORDERLY=0، NO_DA، بلا POLICY_DELETE ولا AUTHWRITE)', () => {
  const cs = stripCsComments(read(core));
  assert.match(cs, /ANCHOR_ATTRIBUTES = NV_TPM_NT_COUNTER \| NV_POLICYWRITE \| NV_AUTHREAD \| NV_NO_DA;/);
  assert.match(cs, /NV_ORDERLY = 1u << 26;/);
  assert.match(cs, /NV_POLICY_DELETE = 1u << 10;/);
  assert.match(cs, /NV_NO_DA = 1u << 25;/);
});

pwshTest('pwsh: المُشغِّلُ يرفضُ أيَّ مضيفٍ غيرِ loopback قبلَ الاتصال', () => {
  for (const h of ['192.168.1.10', 'localhost', 'tpm.local', '0.0.0.0']) {
    const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', runner, '-SimHost', h, '-SimPort', '2321'], { encoding: 'utf8' });
    assert.notEqual(r.status, 0, h);
    assert.match(r.stderr + r.stdout, /ValidateSet|does not belong to the set/i, h);
  }
});

pwshTest('pwsh: نقلُ المحاكي نفسُه يرفضُ غيرَ loopback بـSIMULATOR_TRANSPORT_LOOPBACK_ONLY', () => {
  const cmd = `Add-Type -Path '${core}' -IgnoreWarnings; try { New-Object Xuux.TpmCeremony.SwtpmLoopbackTransport('10.0.0.1', 2321) | Out-Null; 'NO-THROW' } catch { $_.Exception.InnerException.Message }`;
  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8' });
  assert.match(r.stdout, /SIMULATOR_TRANSPORT_LOOPBACK_ONLY/);
});

pwshTest('pwsh: شريحةٌ غيرُ المحاكي (IFX) ⇒ FAILED_CLOSED بعدَ استعلامِ الهويّةِ وحدَه، بلا أيِّ أمرٍ مُغيِّر', () => {
  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', harness, '-Mode', 'foreign-identity'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  assert.equal(res.report.status, 'FAILED_CLOSED');
  assert.match(res.report.failure, /^SIMULATOR_IDENTITY_REQUIRED: manufacturer=IFX/);
  assert.deepEqual(res.received, ['0x0000017a']);
  assert.equal(res.report.steps.length, 1);
  assert.deepEqual(res.report.cleanupLeftovers, []);
});

pwshTest('pwsh: حارسُ أداةِ المضيفِ يرفضُ أوامرَ التغييرِ والسياساتِ ويسمحُ باستعلامَيِ الجردِ فقط', () => {
  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', harness, '-Mode', 'host-guard'], { encoding: 'utf8', maxBuffer: 16 << 20 });
  assert.equal(r.status, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  assert.ok(res.cases.length >= 17);
  // الاستثناءانِ المقصودانِ (WL-413/SOL-06): استعلامُ القدراتِ وقراءةُ المنطقةِ العامّةِ — قرائيّانِ مسموحانِ في
  // حارسِ أداةِ الجردِ؛ وكلُّ أوامرِ التغييرِ والسياساتِ والتوقيعِ تُرفضُ ولا تبلغُ النقلَ.
  for (const c of res.cases) {
    if (c.name === 'GetCapability' || c.name === 'NV_ReadPublic') {
      assert.equal(c.rejected, false, c.name);
    } else {
      assert.equal(c.rejected, true, c.name);
      assert.match(c.message, /^XUUX_TPM_COMMAND_NOT_ALLOWED/, c.name);
    }
  }
  assert.equal(res.reached.length, 2);
  assert.ok(res.reached.every((h) => h.startsWith('8001')));
  assert.ok(res.reached.some((h) => h.includes('0000017a')));
  assert.ok(res.reached.some((h) => h.includes('00000169')));
  assert.equal(res.submittedCount, 2);
  const ccs = new Set(res.cases.map((c) => c.commandCode));
  for (const cc of ['0x0000012a', '0x00000134', '0x00000122', '0x00000160', '0x00000131']) assert.ok(ccs.has(cc), cc);
});

test('static: حارسُ نطاقِ الإقلاعِ الإنتاجيِّ (WL-412 مضيّقًا بقرارِ WL-429): الملفاتُ المسمّاةُ وإغلاقُ تبعياتِ الإقلاعِ وsrc/production وsrc/root-of-trust ومدخلةُ R3-A-01 وحدها لم تُمَسّ في هذه الدفعة', () => {
  // قرارُ المالكِ في WL-429: الخيارُ 1 — تضييقُ نطاقِ الحارسِ لا تعطيلُه ولا إبقاءُ تجميدِ src/ بأكملِه.
  // النطاقُ المحميُّ: (أ) ملفاتٌ مسمّاةٌ، (ب) الإغلاقُ الانتقاليُّ للتبعياتِ المحليّةِ لمسارِ scripts/
  // production-entry.mjs (اتحادُ إغلاقِ الأساسِ والمرشَّحِ)، (ج) المجلّدانِ src/production وsrc/root-of-trust
  // بأكملِهما، (د) مدخلةُ R3-A-01 وحدها في config/external-review.yaml — فتُقبَلُ مثلاً تحديثاتُ
  // CO55-M11.05-R3-01 ولا يُقبَلُ مسُّ R3-A-01، ويبقى تغييرُ src/notifications/channels/email.mjs خارجَ
  // النطاقِ ما دامَ لا يصلُ إلى مسارِ الإقلاعِ المحميِّ. حمايةُ SUPPORTED_FRESHNESS_BACKENDS ومسارِ
  // الإقلاعِ وسياساتِ الإنتاجِ قائمةٌ عبرَ الملفِ المسمّى والإغلاقِ والمجلّدين.
  const GUARD_FREEZE_BASE = '8b9fca7ac2541e28e1c840b6e171b00cc8580adf'; // نقطةُ ولادةِ الحارسِ (رأسُ PR #376).
  const base = process.env.GUARD_BASE || GUARD_FREEZE_BASE;
  // غيابُ أساسِ المقارنةِ يُفشِلُ الحارسَ بوضوحٍ — لا return يتجاوزُ المقارنةَ إذا غابَ الالتزامُ.
  const baseExists = spawnSync('git', ['cat-file', '-e', base + '^{commit}'], { cwd: root }).status === 0;
  assert.ok(baseExists, `GUARD_BASE غير متاحٍ في تاريخِ هذه النسخةِ (${base}) — الحارسُ يفشلُ مغلقًا ولا يتخطى الصمتَ`);

  const git = (args, opts = {}) => {
    try {
      return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 << 20, ...opts });
    } catch (e) {
      assert.fail(`تعذّر تنفيذُ git ${args.join(' ')} داخلَ الحارسِ — فشلٌ مغلقٌ: ${e.message}`);
    }
  };

  // قارئٌ للشجرةِ العاملةِ (متعقَّبةً وغيرَ متعقَّبةٍ) وقارئٌ لشجرةِ الأساسِ — كلاهما يفشلُ مغلقًا عندَ
  // خطأِ القراءةِ، فلا يُتجاهَلُ استثناءٌ ويُتابَع.
  const worktreeReader = {
    exists: (f) => { try { return statSync(join(root, f)).isFile(); } catch { return false; } },
    read: (f) => { try { return readFileSync(join(root, f), 'utf8').replace(/^\uFEFF/, ''); } catch (e) { throw new Error(`تعذّرت قراءةُ ${f} من الشجرةِ العاملةِ — الحارسُ مغلقٌ: ${e.message}`, { cause: e }); } },
    tracked: null, // يُضبطُ بعدَه
  };
  const trackedSet = new Set(git(['ls-files']).split('\n').filter(Boolean));
  worktreeReader.tracked = (f) => trackedSet.has(f);
  const baseReader = {
    exists: (f) => spawnSync('git', ['cat-file', '-e', `${base}:${f}`], { cwd: root }).status === 0,
    read: (f) => { try { return git(['show', `${base}:${f}`]); } catch (e) { throw new Error(`تعذّرت قراءةُ ${f} من شجرةِ الأساسِ ${base.slice(0, 8)} — الحارسُ مغلقٌ: ${e.message}`, { cause: e }); } },
    tracked: (f) => spawnSync('git', ['cat-file', '-e', `${base}:${f}`], { cwd: root }).status === 0,
  };

  // استخراجُ الاستيراداتِ المحليّةِ من AST بمحلِّلِ TypeScript (المتاحُ في اعتمادياتِ البناءِ) —
  // فيُلتقطُ الاقتباسُ المفردُ والمزدوجُ والاستيرادُ الثابتُ متعددُ الأسطرِ وإعادةُ التصديرِ
  // والاستيرادُ الديناميكيُّ ذو المسارِ الحرفيِّ، ولا يُحسَبُ ما في التعليقاتِ والسلاسلِ شيفرةً.
  const localImportSpecifiers = (source) => {
    const sf = ts.createSourceFile('entry.mjs', source, ts.ScriptTarget.Latest, true);
    const specs = [];
    const visit = (node) => {
      const isImportExport = ts.isImportDeclaration(node) || ts.isExportDeclaration(node);
      if (isImportExport && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) specs.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) specs.push(node.arguments[0].text);
      node.forEachChild(visit);
    };
    visit(sf);
    return specs.filter((x) => x.startsWith('./') || x.startsWith('../'));
  };

  // الامتداداتُ وتحويلاتُ المصدرِ المدعومةُ معلَنةً — لا تجربةُ امتداداتٍ بالتبادلِ. التحويلُ الوحيدُ
  // للمصدرِ: ناتجُ البناءِ .mjs يُحلُّ إلى مصدرِهِ المتعقَّبِ .mts (وكذلك .js إلى .ts) فلا يحميَ الحارسُ
  // ناتجَ بناءٍ متجاهَلًا بدلَ مصدرِهِ.
  const EXTENSIONS = ['.mjs', '.js', '.mts', '.ts', '.cjs', '.json'];
  const SOURCE_SWAP = { '.mjs': '.mts', '.js': '.ts' };
  const resolveLocalImport = (fromFile, spec, reader) => {
    const target = posix.normalize(posix.join(posix.dirname(fromFile), spec));
    const candidates = [];
    if (/\.[A-Za-z]+$/.test(spec)) {
      candidates.push(target);
      const dot = target.lastIndexOf('.');
      const ext = target.slice(dot);
      if (SOURCE_SWAP[ext]) candidates.push(target.slice(0, dot) + SOURCE_SWAP[ext]);
    } else {
      for (const e of EXTENSIONS) candidates.push(target + e);
    }
    const existing = candidates.filter(reader.exists);
    const tracked = existing.filter((c) => reader.tracked(c));
    if (tracked.length > 0) return tracked[0]; // المصدرُ المتعقَّبُ مقدَّمٌ على ناتجِ البناءِ.
    if (existing.length > 0) return existing[0];
    return null; // استيرادٌ محليٌّ غيرُ محسومٍ — يُفشِلُ الحارسَ مغلقًا عندَ المستدعي.
  };

  const ENTRY_ROOT = 'scripts/production-entry.mjs';
  const bootClosure = (reader) => {
    const closure = new Set();
    const queue = [ENTRY_ROOT];
    while (queue.length) {
      const f = queue.pop();
      if (closure.has(f)) continue;
      closure.add(f);
      let source;
      try {
        source = reader.read(f);
      } catch (e) {
        assert.fail(`إغلاقُ تبعياتِ الإقلاعِ: ${e.message}`);
      }
      for (const spec of localImportSpecifiers(source)) {
        const resolved = resolveLocalImport(f, spec, reader);
        if (resolved === null) assert.fail(`إغلاقُ تبعياتِ الإقلاعِ: استيرادٌ محليٌّ غيرُ محسومٍ في ${f} («${spec}») — الحارسُ يفشلُ مغلقًا ولا يتجاهلُه`);
        if (!closure.has(resolved)) queue.push(resolved);
      }
    }
    return closure;
  };
  // اتحادُ إغلاقِ الأساسِ والمرشَّحِ: لا تسقُطَ حمايةُ تبعيةٍ بمجرّدِ تغييرِ مسارِ الوصولِ إليها.
  const closure = new Set([...bootClosure(worktreeReader), ...bootClosure(baseReader)]);

  const NAMED_PROTECTED = ['sim/tpm/tcti_guard.mjs', 'version.json', ENTRY_ROOT, 'scripts/tpm-sim-ci.sh'];
  // قرارُ المالكِ (‏2026-10-20، دورةُ تفويضِ 20 أكتوبر، خيارُ «أذن بتعديلٍ محدودٍ
  // للحارس»): استثناءٌ **مسمّى ومؤرَّخ ومحدود** لملفاتِ WL-434 الأربعةِ وحدَها — تنفيذُ
  // «الربطُ المختومُ داخلَ متنِ البيانِ» (الخيارُ أ من الملحقِ ج §5.1) يستلزمُ حتمًا
  // تعديلَها، فالتجميدُ المطلقُ كانَ سيحجبَ تنفيذَ التكليفِ نفسِه. **هذا الاستثناءُ لا
  // يُضعِفُ شيئًا آخرَ:** بقيةُ `src/root-of-trust` و`src/production` والملفاتُ المسماةُ
  // وإغلاقُ تبعياتِ الإقلاعِ ومدخلةُ `R3-A-01` من العقدِ محميةٌ كما كانتْ، وأيُّ ملفٍّ
  // خامسٍ في هذهِ المجلداتِ يُرفَضُ كما كانَ. وتغييرُ هذهِ الملفاتِ الأربعةِ يبقى خاضعًا
  // لكلِّ ما عداه: مدخلةُ سجلِ عملٍ تُسمّيه (المادة 6 — يحرسُها project-state)، ومراجعةُ
  // PR، وCI. وسطرُ الاستثناءِ هذا جزءٌ من الأثرِ المعلنِ في مدخلةِ WL-434 وPR الخاصِّ بها.
  // **والاستثناءُ مربوطٌ بالمحتوى المعتمدِ لا بالمسارِ وحدَه:** بصمةُ كلِّ ملفٍّ من
  // الأربعةِ كما هو في دفعةِ WL-434 المعتمدةِ (تسلسلُ الختومِ واختباراتُ التكاملِ
  // والبصماتُ في مدخلةِ السجلِّ). أيُّ تعديلٍ لاحقٍ على أحدِها — ولو سطرًا — يُخرجُ
  // بصمتَه عن المعتمدةِ فيعودُ الملفُ محميًّا كما كانَ كلُّ ما عداه. فالإذنُ إذنٌ
  // **بفرقٍ معروضٍ بعينِهِ** لا إذنٌ مفتوحًا لملفاتِها إلى الأبد.
  const WL434_OWNER_AUTHORIZED = new Map(Object.entries({
    'src/root-of-trust/fnv-binding.mts': '87aac0e89b3b82d29df4d92bb17d1e6f06b10c5b',
    'src/root-of-trust/state-manifest.mts': 'babf1f59c1c51fff4bb20d93878020953ae21046',
    'src/root-of-trust/production-runtime.mts': '3f0f2772ff45fd2d42cd23f6322792ad2b2ce289',
    'src/root-of-trust/index.mts': '226210d855749cdf816515f5ce2b5428dadab68b',
  }));
  // قرارُ المالكِ (‏2026-10-24، جلسةُ WL-461): استثناءٌ مسمّى مؤرّخٌ محدودٌ بالملفِ الواحدِ
  // `scripts/tpm-sim-ci.sh` وحدَه — إصلاحُ فجوةِ قابليةِ التحققِ المعلنةِ في WL-461: ملفُّ TAP
  // كانَ يُكتبُ داخلَ مجلدِ الحالةِ الذي يحذفُهُ الفخُّ عندَ الخروجِ، فكانَ رفعُهُ أثرًا (WL-434)
  // يقعُ على ملفِّ محذوفٖ دائمًا ولا يُنجَزُ إلا عندَ الفشلِ أصلًا؛ والسكربتُ لا يطبعُ تفاصيلَ الاختباراتِ
  // إلا عندَ الفشلِ. التعديلُ المعتمدُ: كتابةُ TAP في `RUNNER_TEMP/xuux-sim-tap`
  // يبقى بعدَ الفخِّ، وطباعتُهُ عبرَ `tee` في سجلِ الخطوةِ (نجاحًا وفشلًا)، ورفعُهُ أثرًا دائمًا من سيرِ
  // العملِ. **هذا الاستثناءُ لا يُضعِفُ شيئًا آخرَ:** كلُّ مسارِ الحمايةِ في السكربتِ باقٍ كما هو (‏الإسقاطُ عندَ أيِّ تخطّٖ غيرَ
  // `XUUX_CHANNEL_POC`، قتلُ المحاكي وتنطيفُ الحالةِ في الفخِّ، وحدودُ «محاكٍ لا عتاد»)؛ وسائرُ الملفاتِ المحميةِ كما كانتْ،
  // ومدخلةُ WL-461 في سجلِ الأعمالِ تُسمّي الملفَ، وتغييرُهُ خاضعٌ لكلِ ما عداه (‏مراجعةُ PR وCI). **والاستثناءُ مربوطٌ بالبصمةِ المعتمدةِ
  // لا بالمسارِ وحدَه:** أيُّ تعديلٍ لاحقٖ على الملفِ — ولو سطرًا — يُخرجُ بصمتَهُ عن هذه فيعودُ محميًا كما كانَ. فالإذنُ إذنٌ بفرقِ معروضٖ بعينِهِ لا إذنٌ مفتوحًا للأبدِ.
  const WL461_OWNER_AUTHORIZED = new Map(Object.entries({
    'scripts/tpm-sim-ci.sh': '32ae60ff3f3fa5150fa188b9265bb219ab9decff',
  }));
  // WL-465: استثناءٌ مسمًّى مؤرّخٌ ثانٍ من المالكِ (2026-10-25) على الملفِ المحميِّ نفسِهِ — سطرُ `rm -f`
  // واحدٌ لمحوِ أثرِ TAP متقادمٍ **قبلَ أيِّ مسارِ تشغيلٍ** (فرقٌ معروضٌ بعينِهِ في المحادثةِ وفي مدخلةِ
  // WL-465)، والسلوكُ مقياسٌ في `tests/tooling/tpm-sim-ci-tap.test.mjs` (3 اختباراتٍ تشغّل السكربتَ الفعليَّ
  // بمحاكياتٍ مُعوّضةٍ، وسقوطُ الاختبارِ الحاسمِ بلا إصلاحٍ قِيسَ قبلَ التنفيذِ). وسائرُ ما قِيلَ في استثناءِ WL-461
  // ينطبقُ هنا كما هو: **الإذنُ إذنٌ بفرقٍ معروضٍ بعينِهِ لا إذنٌ مفتوحًا للأبدِ** — أيُّ تعديلٍ لاحقٍ
  // يُخرجُ بصمتَهُ عن هذه فيعودُ محميًا كما كانَ، وكلُّ مسارِ الحمايةِ الآخرِ في السكربتِ باقٍ كما هو.
  const WL465_OWNER_AUTHORIZED = new Map(Object.entries({
    'scripts/tpm-sim-ci.sh': '1bab96691990f79b7d9185c0143871855ce799c1',
  }));
  // قرارُ المالكِ (‏2026-10-27، دورةُ تفويضِ 27 أكتوبر — إصلاحُ نتائجِ جولتَي
  // المجلسِ 7 و8 من `M11.06`): استثناءٌ مسمّى مؤرّخٌ محدودٌ **بثلاثةِ ملفاتٍ**
  // وحدَها — تنفيذُ إصلاحِ `R6-A-07` (المحرّكُ لا يُصدِرُ إذنًا سياديًّا بفحصِ
  // الصورةِ؛ الإذنَ تُصدِرُهُ ترقيةُ نقطةِ الإنفاذِ بعدَ تحقُّقِ الديوانِ) و`R6-A-08`
  // (خصوصيّةُ `#safeMode` و`#production` في النواةِ، وإنتاجيّةُ العمليةِ الحقيقيةِ
  // تُقرأُ ولا يُخفيها حقنُ `env: {}`). الإصلاحُ مستحيلٌ خارجَ هذهِ الملفاتِ —
  // العيبُ نفسُهُ في المحرّكِ والنواةِ. **هذا الاستثناءُ لا يُضعِفُ شيئًا آخرَ:**
  // بقيةُ الملفاتِ المحميةِ والملفاتِ المسماةِ وإغلاقِ تبعياتِ الإقلاعِ ومدخلةِ
  // `R3-A-01` من العقدِ محميةٌ كما كانتْ. وتغييرُ هذهِ الملفاتِ خاضعٌ لكلِّ ما عداه:
  // مدخلةُ سجلِ عملٍ تُسمّيها (المادة 6 — يحرسُها project-state)، ومراجعةُ PR، وCI،
  // وحكمُ المجلسِ في الجولةِ القادمةِ. **والاستثناءُ مربوطٌ بالبصمةِ المعتمدةِ لا
  // بالمسارِ وحدَه:** بصمةُ كلِّ ملفٍّ منَ الثلاثةِ كما هو في دفعةِ WL-478 المعتمدةِ.
  // أيُّ تعديلٍ لاحقٍ على أحدِها — ولو سطرًا — يُخرجُ بصمتَهُ عن المعتمدةِ فيعودُ
  // الملفُ محميًّا كما كانَ كلُّ ما عداه. فالإذنُ إذنٌ **بفرقٍ معروضٍ بعينِهِ** لا
  // إذنٌ مفتوحًا لملفاتِها إلى الأبد.
  const WL478_OWNER_AUTHORIZED = new Map(Object.entries({
    'src/policy/engine.mjs': 'aacf01570a3c4f6c8e86584fedea206c11e0c209',
    'src/policy/enforcement-point.mjs': '55110061b60598399c3bb1efc816d35ed5f31430',
    'src/core/execution-kernel.mjs': 'b41297048c6cdd9510cadcc8b5e513bee1b2b0d4',
  }));
  // قرارُ المالكِ (‏2026-10-28، تكليفُ الاستردادِ — إذنٌ صريحٌ في المحادثةِ بعدَ أن رفضَ
  // هذا الحارسُ دفعَ إصلاحِ المقترحِ `R8-01`): استثناءٌ مسمّى مؤرّخٌ محدودٌ **بملفٍّ واحدٍ**
  // `src/root-of-trust/persistent-log.mts` — قفلُ الكاتبِ الواحدِ يُحسَبُ على المسارِ القانونيِّ
  // (‏`canonicalLogPath`، والرابطُ المعلَّقُ يُرفَضُ `LOG_PATH_UNRESOLVABLE`). الإصلاحُ مستحيلٌ خارجَ
  // هذا الملفِّ لأنَّ القفلَ فيه. **هذا الاستثناءُ لا يُضعِفُ شيئًا آخرَ:** بقيةُ `src/root-of-trust`
  // و`src/production` والملفاتُ المسماةُ وإغلاقُ تبعياتِ الإقلاعِ ومدخلةُ `R3-A-01` محميةٌ كما كانتْ،
  // ولا مساسَ لـ`SUPPORTED_FRESHNESS_BACKENDS`. وتغييرُهُ خاضعٌ لكلِّ ما عداه (مدخلةُ WL-488، ومراجعةُ
  // PR، وCI). **والاستثناءُ مربوطٌ بالبصمةِ المعتمدةِ لا بالمسارِ وحدَه:** أيُّ تعديلٍ لاحقٍ — ولو
  // سطرًا — يُخرجُ بصمتَهُ عن هذه فيعودُ محميًّا. فالإذنُ إذنٌ **بفرقٍ معروضٍ بعينِهِ**.
  const WL488_OWNER_AUTHORIZED = new Map(Object.entries({
    'src/root-of-trust/persistent-log.mts': '2d3f8c83188c6b00f1222c75400450082fc21a0f',
  }));
  // قرارُ المالكِ (‏2026-10-29، تكليفُ الاستردادِ — إذنٌ صريحٌ في المحادثةِ بعدَ أن رفضَ هذا الحارسُ
  // دفعَ دفعةِ WL-491): تجديدٌ للاستثناءِ المسمّى المؤرَّخِ نفسِهِ **بملفٍّ واحدٍ** ‏`src/root-of-trust/persistent-log.mts`
  // — إكمالُ إصلاحِ `R8-01`: سباقا القفلِ المتبقيّانِ (نافذةُ القفلِ الفارغِ + انتزاعٌ بلا إعادةِ فحصٍ) اللذانِ
  // ظهرا في CI طلبِ القياسِ `#471` (كاتبانِ من ستّةِ متسابقينَ) واللذانِ لم يعالجهما إصلاحُ WL-488 (هويةُ المسارِ).
  // **هذا التجديدُ لا يُضعِفُ شيئًا آخرَ:** بقيةُ `src/root-of-trust` و`src/production` والملفاتُ المسماةُ وإغلاقُ
  // تبعياتِ الإقلاعِ ومدخلةُ `R3-A-01` محميةٌ كما كانتْ، ولا مساسَ لـ`SUPPORTED_FRESHNESS_BACKENDS`. وتغييرُهُ خاضعٌ
  // لكلِّ ما عداه (مدخلةُ WL-491، ومراجعةُ PR، وCI). **والاستثناءُ مربوطٌ بالبصمةِ المعتمدةِ لا بالمسارِ وحدَه:**
  // أيُّ تعديلٍ لاحقٍ — ولو سطرًا — يُخرجُ بصمتَهُ عن هذه فيعودُ محميًّا. فالإذنُ إذنٌ **بفرقٍ معروضٍ بعينِهِ**.
  const WL491_OWNER_AUTHORIZED = new Map(Object.entries({
    'src/root-of-trust/persistent-log.mts': '30fc6b43da33e96e5be8d8a1cde1b7afd2376ded',
  }));
  // قرارُ المالكِ (‏2026-10-29، تكليفُ الاستردادِ — إذنٌ صريحٌ في المحادثةِ لدفعةِ WL-492 بعدَ عرضِ
  // البصمتينِ، ثمّ تصحيحٌ ثانٍ للبصمتينِ بعدَ تنسيقِ prettier — بإذنٍ صريحٍ ثانٍ: الفرقُ لفُّ أسطرٍ فقط): تجديدٌ للاستثناءِ المسمّى المؤرَّخِ نفسِهِ **بملفّينِ** — `persistent-log.mts`
  // و`state-manifest.mts` — إصلاحُ الدينِ `LIVE-62` (نافذةُ «افحصْ ثمَّ احذفْ» في انتزاعِ قفلِ
  // دفترِ الرفعِ): ثلاثُ طبقاتٍ لا كاتبينِ (تحريرٌ بمطالبةٍ فريدةٍ، سرقةٌ بمطالبةٍ ذرّيّةٍ بتحقّقِ
  // محتوى، حارسُ ملكيةٍ برمزِ اقتناءٍ قبلَ كلِّ كتابةٍ) في الملفينِ معًا؛ مقيسٌ بإجهادٍ (80 تشغيلةً
  // نظيفةً بعدَ فشلٍ ~1 من 20–40 قبلهُ). **هذا التجديدُ لا يُضعِفُ شيئًا آخرَ:** بقيةُ `src/root-of-trust`
  // و`src/production` والملفاتُ المسماةُ وإغلاقُ تبعياتِ الإقلاعِ ومدخلةُ `R3-A-01` محميةٌ كما كانتْ،
  // ولا مساسَ لـ`SUPPORTED_FRESHNESS_BACKENDS`. وتغييرُهُ خاضعٌ لكلِّ ما عداه (مدخلةُ WL-492، ومراجعةُ
  // PR، وCI). **والاستثناءُ مربوطٌ بالبصمةِ المعتمدةِ لا بالمسارِ وحدَه:** أيُّ تعديلٍ لاحقٍ — ولو سطرًا —
  // يُخرجُ بصمتَهُ عن هذه فيعودُ محميًّا. فالإذنُ إذنٌ **بفرقٍ معروضٍ بعينِهِ**.
  const WL492_OWNER_AUTHORIZED = new Map(Object.entries({
    'src/root-of-trust/persistent-log.mts': '9dd35f3d090a4b6e7502ef6854f0ad2a781e7b69',
    'src/root-of-trust/state-manifest.mts': 'b9ac02df108a7f7ed8a778cf37babd18e85a23ab',
  }));
  const currentBlob = (f) => spawnSync('git', ['hash-object', '--', f], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const PROTECTED_DIRS = ['src/production/', 'src/root-of-trust/'];
  const isProtected = (f) => NAMED_PROTECTED.includes(f) || PROTECTED_DIRS.some((d) => f.startsWith(d)) || closure.has(f);

  // المقارنةُ بالشجرةِ العاملةِ (تُدرِكُ غيرَ الملتزَمِ أيضًا) مع جردِ غيرِ المتعقَّبِ.
  const changed = git(['diff', '--name-only', base]).split('\n').filter(Boolean);
  const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean);
  const touched = [...new Set([...changed, ...untracked])];

  // مدخلةُ R3-A-01 وحدها من العقدِ: تُحدَّدُ بمحلِّلِ YAML مع اشتراطِ وجودِها مرةً واحدةً فقط، ثم
  // يُقارَنُ مقطعُها الخامُّ دونَ إعادةِ تسلسلِ — فتبقى تحديثاتُ المدخلاتِ الأخرى (مثلَ
  // CO55-M11.05-R3-01) مقبولةً ورفضُ أيِّ تعديلٍ أو حذفٍ أو تكرارٍ لـR3-A-01.
  const CONTRACT_PATH = 'config/external-review.yaml';
  const CONTRACT_ENTRY = 'R3-A-01';
  const extractEntrySegment = (text, where) => {
    let doc;
    try {
      doc = parseYaml(text);
    } catch (e) {
      assert.fail(`عقدُ المراجعةِ لا يُعرَبُ في ${where} — الحارسُ مغلقٌ: ${e.message}`);
    }
    const entries = Array.isArray(doc?.findings) ? doc.findings : null;
    assert.ok(entries, `بنيةُ العقدِ غيرُ متوقَّعةٍ في ${where} (لا قائمةَ findings) — الحارسُ مغلقٌ`);
    const matches = entries.filter((r) => r && r.id === CONTRACT_ENTRY);
    assert.equal(matches.length, 1, `مدخلةُ ${CONTRACT_ENTRY} يجبُ أن توجدَ مرةً واحدةً فقط في ${where} (وُجدتْ ${matches.length})`);
    const lines = text.split('\n');
    const start = lines.findIndex((l) => /^ {2}- id: R3-A-01\s*$/.test(l));
    assert.ok(start !== -1, `لم يُعثَرْ على مقطعِ ${CONTRACT_ENTRY} الخامِّ في ${where}`);
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^ {2}- /.test(lines[i]) || /^[^\s]/.test(lines[i])) { end = i; break; }
    }
    return lines.slice(start, end).join('\n').trim();
  };
  if (touched.includes(CONTRACT_PATH)) {
    const before = extractEntrySegment(baseReader.read(CONTRACT_PATH), `الأساسِ ${base.slice(0, 8)}`);
    const after = extractEntrySegment(worktreeReader.read(CONTRACT_PATH), 'الشجرةِ العاملةِ');
    assert.equal(after, before, `مدخلةُ ${CONTRACT_ENTRY} في ${CONTRACT_PATH} عُدِّلَتْ في هذه الدفعةِ — هذا خارجَ نطاقِ الدفعةِ (يجوزُ تحديثُ غيرِها من المدخلاتِ)`);
  }

  // القبولُ بالبصمةِ من **أحدثِ إذنٍ مسمّى لكلِّ مسارٍ** (WL-492 ثمّ WL-491 ثمّ WL-488 ثمّ WL-478 ثمّ WL-465 ثمّ WL-461 ثمّ WL-434): الإذنُ
  // اللاحقُ يُثبّتُ بصمةً جديدةً فيُلغي حُكمَ البصمةِ الأقدمِ على المسارِ نفسِهِ (إرجاعُ الملفِ
  // إلى بصمةٍ سابقةٍ رفضٌ لا قبولٌ)، والملفاتُ التي لأحدها وحدَه إذنٌ تبقى على بصمتِه.
  const ownerAuthorizedBlob = (f) => {
    const expected =
      WL492_OWNER_AUTHORIZED.get(f) ??
      WL491_OWNER_AUTHORIZED.get(f) ??
      WL488_OWNER_AUTHORIZED.get(f) ??
      WL478_OWNER_AUTHORIZED.get(f) ??
      WL465_OWNER_AUTHORIZED.get(f) ??
      WL461_OWNER_AUTHORIZED.get(f) ??
      WL434_OWNER_AUTHORIZED.get(f);
    return expected !== undefined && currentBlob(f) === expected ? expected : undefined;
  };

  const violations = touched.filter(
    (f) => isProtected(f) && ownerAuthorizedBlob(f) === undefined,
  );
  assert.equal(violations.length, 0, 'ملفاتٌ محميةٌ عُدِّلَتْ في هذه الدفعةِ (النطاقُ المضيَّقُ بقرارِ WL-429): ' + violations.join(', '));
});
