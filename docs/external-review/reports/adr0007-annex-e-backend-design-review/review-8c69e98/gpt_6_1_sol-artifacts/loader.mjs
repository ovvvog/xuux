import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Only redirect root-of-trust imports to this head's out-of-tree TS build.
const sourcePrefix = 'file:///tmp/wt-8c69e98-gpt/src/root-of-trust/';
const buildPrefix = 'file:///tmp/council-wl437-r3/gpt_6_1_sol/build/src/root-of-trust/';
const testURL = pathToFileURL('/tmp/wt-8c69e98-gpt/tests/root-of-trust/wl-434-fnv-manifest-binding.test.mjs').href;
const helperURL = pathToFileURL('/tmp/wt-8c69e98-gpt/tests/helpers/tmp-roots.mjs').href;

export async function resolve(specifier, context, nextResolve) {
  const absolute = context.parentURL ? new URL(specifier, context.parentURL).href : specifier;
  if (absolute.startsWith(sourcePrefix)) {
    return { url: absolute.replace(sourcePrefix, buildPrefix), shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === helperURL) {
    return {
      format: 'module',
      shortCircuit: true,
      source: 'const roots=[]; export function registerTmpRoot(p){roots.push(String(p));return String(p)} export function registeredTmpRoots(){return [...roots]}',
    };
  }
  if (url === testURL) {
    let source = await readFile(new URL(url), 'utf8');
    // Retain test-root directories and all their evidence. File deletion that
    // constitutes a test stimulus is redirected to rename, preserving evidence.
    source = source.replace(
      'readFileSync, rmSync, writeFileSync',
      'readFileSync, renameSync as evidenceRenameSync, writeFileSync',
    );
    source += '\nfunction rmSync(p, options) { if(options?.recursive) return; evidenceRenameSync(p, `${p}.removed-for-test-${Date.now()}`); }\n';
    return { format: 'module', shortCircuit: true, source };
  }
  return nextLoad(url, context);
}
