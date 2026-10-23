import { existsSync, renameSync, statSync } from 'node:fs';
let ordinal = 0;
export function retainRemoval(path, options) {
  if (!existsSync(path)) {
    if (options?.force) return;
    const error = new Error('ENOENT');
    error.code = 'ENOENT';
    throw error;
  }
  if (statSync(path).isDirectory()) return;
  renameSync(path, `${path}.retained-r4-${ordinal++}`);
}
