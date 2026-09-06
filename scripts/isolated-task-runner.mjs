#!/usr/bin/env node
/**
 * منفّذ مهمة داخل العزل الحقيقي.
 *
 * لا يعتمد على IPC لأن `unshare/chroot` يقلع عمليةً مستقلة. يستقبل action وpayload
 * كوسيطين نصيين، ويكتب نتيجة JSON واحدة إلى stdout؛ لا يقرأ أوامر من shell.
 */
import { loadHandler } from '../src/execution/handlers.mjs';

const action = process.argv[2] ?? '';
let payload;
try {
  payload = JSON.parse(process.argv[3] ?? '{}');
} catch (error) {
  process.stderr.write(JSON.stringify({ code: 'TASK_PAYLOAD_INVALID', message: String(error) }));
  process.exit(2);
}

try {
  const handler = await loadHandler(action);
  const result = await handler(payload);
  process.stdout.write(JSON.stringify({ ok: true, result: result ?? {} }));
} catch (error) {
  process.stderr.write(
    JSON.stringify({
      code: error instanceof Error && 'code' in error ? String(error.code) : 'TASK_HANDLER_FAILED',
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
}
