const worktreeSource = 'file:///tmp/wt-d3d5e1f9-gpt/src/';
const compiledSource = 'file:///tmp/council-wl437/gpt_6_1_sol/build/src/';
export async function resolve(specifier, context, nextResolve) {
  let candidate;
  try { candidate = new URL(specifier, context.parentURL); } catch {}
  if (candidate?.href.startsWith(worktreeSource) && candidate.pathname.endsWith('.mjs')) {
    return nextResolve(candidate.href.replace(worktreeSource, compiledSource), context);
  }
  return nextResolve(specifier, context);
}
