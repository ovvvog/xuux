const source = 'file:///tmp/wt-992230c-gpt/';
const compiled = 'file:///tmp/council-wl437-r2/gpt_6_1_sol/build/';

export async function resolve(specifier, context, nextResolve) {
  let url;
  try { url = new URL(specifier, context.parentURL).href; } catch {}
  if (url?.startsWith(`${source}src/root-of-trust/`) && url.endsWith('.mjs')) {
    return nextResolve(url.replace(source, compiled), context);
  }
  if (url === `${source}tests/helpers/tmp-roots.mjs`) {
    return nextResolve(new URL('./retain-test-roots.mjs', import.meta.url).href, context);
  }
  return nextResolve(specifier, context);
}
