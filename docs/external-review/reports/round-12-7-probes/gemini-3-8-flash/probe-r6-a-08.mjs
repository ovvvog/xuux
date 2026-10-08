import { ExecutionKernel } from '/home/user/workspace/xuux-review-284f74d0/src/core/execution-kernel.mjs';

const log = { append: (ev, act, pl) => console.log('LOG:', ev, act, pl) };
const crown = { veto: { enabled: true } };
const kernel = new ExecutionKernel({ crown, log });

console.log('Initial safeMode:', kernel.safeMode.active);
kernel.stop('test stop', 'arbitrary-unauthenticated-caller');
console.log('After stop:', kernel.safeMode.active);
kernel.resume('another-unauthenticated-caller');
console.log('After resume:', kernel.safeMode.active);
