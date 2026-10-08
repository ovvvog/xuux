import fs from 'node:fs';
import path from 'node:path';

// Let's test if any mutation in docs/AGENT_CONTAINMENT.md is caught
const CONTAINMENT = '/home/user/workspace/xuux-review-284f74d0/docs/AGENT_CONTAINMENT.md';
const content = fs.readFileSync(CONTAINMENT, 'utf8');

// If we test with the old text that claimed budget-exceeded has no producer:
const mutated = content.replace('وإشارةُ `budget-exceeded` تُنتَجُ فعلاً', 'وإشارةُ `budget-exceeded` بلا مُنتِجٍ');

// Write to a temp file and test the claims function from the test file
import('../../tests/docs/agent-containment-claims.test.mjs').then(() => {
  console.log('Module loaded');
}).catch(e => console.log('Loaded test'));
