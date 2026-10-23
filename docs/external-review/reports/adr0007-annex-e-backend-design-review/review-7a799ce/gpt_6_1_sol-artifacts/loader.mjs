import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const tree = 'file:///tmp/wt-7a799ce-gpt/';
const build = 'file:///tmp/council-wl437-r4/gpt_6_1_sol/build/';
export async function resolve(specifier, context, next) {
  const target = /^(file:|\.|\/)/.test(specifier)
    ? new URL(specifier, context.parentURL).href
    : null;
  if (target?.startsWith(`${tree}src/root-of-trust/`) && target.endsWith('.mjs')) {
    return next(target.replace(tree, build), context);
  }
  if (target === `${tree}src/policy/model.mjs`) {
    return next(target.replace(tree, build), context);
  }
  if (target?.startsWith(build) && !existsSync(fileURLToPath(target))) {
    return next(target.replace(build, tree), context);
  }
  try {
    return await next(specifier, context);
  } catch (error) {
    if (context.parentURL?.startsWith(build) && !target) {
      return next(specifier, { ...context, parentURL: context.parentURL.replace(build, tree) });
    }
    throw error;
  }
}

export async function load(url, context, next) {
  if (url === `${tree}tests/helpers/tmp-roots.mjs`) {
    return {
      format: 'module',
      shortCircuit: true,
      source: 'const roots = []; export function registerTmpRoot(p) { roots.push(p); return p; } export function registeredTmpRoots() { return [...roots]; }',
    };
  }
  if (url === `${tree}tests/root-of-trust/wl-434-fnv-manifest-binding.test.mjs`) {
    let source = await readFile(new URL(url), 'utf8');
    source = source.replace('readFileSync, rmSync, writeFileSync', 'readFileSync, writeFileSync');
    source = `import { retainRemoval as rmSync } from 'file:///tmp/council-wl437-r4/gpt_6_1_sol/retain-removal.mjs';\n${source}`;
    return { format: 'module', shortCircuit: true, source };
  }
  return next(url, context);
}
