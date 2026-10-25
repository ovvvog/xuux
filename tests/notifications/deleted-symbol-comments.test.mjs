// فحصُ انحدارِ الدينِ LIVE-57: منعُ عودةِ التعليقاتِ المعلَّقةِ على رموزٍ محذوفةٍ.
//
// أثبتَ WL-426 أنّ مصنعَ نقلِ SMTP على سطحِ وحدةِ قناةِ البريدِ كانَ مسارًا خامًا،
// فحُذفَ من الوحدةِ. بقيَ بعدَ الحذفِ تعليقانِ يوجّهانِ القارئَ إلى المصنعِ
// المحذوفِ كأنّهُ آليّةٌ قائمةٌ — عولجا في WL-467. هذا الفحصُ يمنعُ عودتَها:
// أيُّ ذكرٍ لرمزٍ محذوفٍ داخلَ تعليقٍ في وحدةِ الإشعاراتِ (المصدرُ والاختباراتُ)
// يجبُ أن يحملَ على السطرِ نفسِهِ علامةً تاريخيةً تبيّنُ أنّهُ محذوفٌ لا إرشادٌ
// حاضرٌ. الذكرُ في الكودِ نفسِهِ (كاستيرادٍ متوقَّعِ الفشلِ لإثباتِ غيابِ التصدير)
// مسموحٌ — الفحصُ يقرأُ التعليقاتِ وحدَها.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// الرموزُ التي حذفها WL-426 من سطحِ وحدةِ قناةِ البريدِ (للإطلاعِ: أمرُ
// الاستيرادِ المسمّى لكلٍّ منها يفشلُ عندَ الربطِ — انظر r5-b-04-email-egress):
const DELETED_SYMBOLS = ['createSmtpEgressTransport', 'sendSmtp', 'buildEmailBody'];

// علاماتٌ تاريخيةٌ تسمحُ بذكرِ الرمزِ المحذوفِ بوصفِهِ ماضيًا معالجًا لا حاضرًا:
const HISTORICAL_MARKERS = [
  'محذوف',
  'حذفه',
  'حذفت',
  'أزيل',
  'لم تعد',
  'لم يعد',
  'كان',
  'السابق',
  'deleted',
  'removed',
  'no longer',
];

const UNIT_DIRS = ['src/notifications', 'tests/notifications'];

/** @param {string} dir @returns {string[]} */
function listMjsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listMjsFiles(full));
    } else if (entry.endsWith('.mjs')) {
      out.push(full);
    }
  }
  return out;
}

// استخراجُ الجزءِ التعليقيِّ من سطرٍ: تعليقُ سطرٍ كاملٍ، أو سطرُ كتلةِ تعليقٍ،
// أو ذيلُ تعليقٍ بعدَ `//`. السطورُ البرمجيةُ الصرفةُ تُهملُ (الذكرُ فيها مسموحٌ
// لأنّ الاستيرادَ المتوقَّعَ الفشلِ دليلُ الغيابِ).
/** @param {string} line @returns {string | null} */
function commentPortion(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
    return trimmed;
  }
  const idx = line.indexOf('//');
  if (idx !== -1) return line.slice(idx);
  return null;
}

test('تعليقاتُ وحدةِ الإشعاراتِ لا تُعلِّقُ عملًا حاضرًا على رمزٍ محذوفٍ (LIVE-57)', () => {
  /** @type {string[]} */
  const violations = [];
  for (const dir of UNIT_DIRS) {
    for (const file of listMjsFiles(dir)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const comment = commentPortion(line);
        if (!comment) return;
        for (const symbol of DELETED_SYMBOLS) {
          if (!comment.includes(symbol)) continue;
          const hasMarker = HISTORICAL_MARKERS.some((marker) => comment.includes(marker));
          if (!hasMarker) {
            violations.push(`${file}:${i + 1}: ذكرُ «${symbol}» في تعليقٍ بلا علامةٍ تاريخيةٍ`);
          }
        }
      });
    }
  }
  assert.deepEqual(
    violations,
    [],
    `تعليقاتٌ تُعلِّقُ على رموزٍ محذوفةٍ كأنّها آليّاتٌ قائمةٌ (أصلُ الدينِ LIVE-57):\n${violations.join('\n')}`,
  );
});
