const old = new URL('file:///tmp/wt-339f5934/tests/helpers/ceremony-swtpm.mjs').href;
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '../helpers/ceremony-swtpm.mjs'
      && context.parentURL?.endsWith('/tests/sim/tpm-ceremony-wl416.test.mjs')) {
    return {url:old,shortCircuit:true};
  }
  return nextResolve(specifier,context);
}
