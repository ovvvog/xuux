// حمولة تستنزف كومة V8 حتى ترفضها حدود الذاكرة الافتراضية المفروضة من prlimit.
const allocations = [];
for (;;) allocations.push(new Array(2_000_000).fill(allocations.length));
