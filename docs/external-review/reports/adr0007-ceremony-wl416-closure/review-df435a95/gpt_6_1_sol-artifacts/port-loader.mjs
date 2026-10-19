// Review-only ESM loader: preserve repository bytes, constrain simulator allocation.
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.endsWith('/tests/helpers/ceremony-swtpm.mjs')) {
    const source = String(result.source);
    const from = 'const port = portBase + 2 * Math.floor(Math.random() * 150);';
    if (!source.includes(from)) throw new Error('port allocation expression changed');
    return { ...result, source: source.replace(from, 'const port = 7600 + 2 * Math.floor(Math.random() * 40);') };
  }
  return result;
}
