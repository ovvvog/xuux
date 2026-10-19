export async function resolve(specifier, context, next) {
  if (specifier.endsWith('/helpers/ceremony-swtpm.mjs') && process.env.XUUX_OLD_HELPER) {
    return { url: 'file://' + process.env.XUUX_OLD_HELPER, shortCircuit: true };
  }
  return next(specifier, context);
}
