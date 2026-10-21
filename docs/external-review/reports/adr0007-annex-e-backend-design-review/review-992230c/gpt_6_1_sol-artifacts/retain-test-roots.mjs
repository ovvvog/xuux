// Preserve the test fixtures for this review; no assertion or production code change.
const roots = [];
export function registerTmpRoot(path) { roots.push(String(path)); return String(path); }
export function registeredTmpRoots() { return [...roots]; }
