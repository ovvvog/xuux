/**
 * مشهدُ الدولةِ — واجهةٌ تستهلكُ طبقةَ النقلِ. سدادُ الشطرِ الثالثِ من `D-1`.
 *
 * وأربعةُ عهودٍ في هذا الملفِّ، كلُّها مقيسةٌ في `tests/transport/web.test.mjs`:
 *
 * 1. **لا `innerHTML` بحالٍ.** كلُّ نصٍّ يُكتَبُ بـ`textContent` وكلُّ عنصرٍ
 *    بـ`createElement`. والبياناتُ آتيةٌ من قاعدةٍ يكتبُ فيها غيرُ من يقرأُ، فصفٌّ
 *    فيه `<img onerror=...>` يُكتَبُ بـ`innerHTML` يصيرُ شفرةً تعملُ بجلسةِ
 *    القارئِ — وهذا حَقْنُ نصوصٍ مُخزَّنٌ لا خطأُ عرضٍ.
 * 2. **الرمزُ في الترويسةِ لا في العنوانِ**، ولا يُكتَبُ في `localStorage` ولا
 *    `sessionStorage`: العناوينُ تُكتَبُ في سجلّاتِ الوسائطِ وتاريخِ المتصفِّحِ،
 *    والذاكرةُ الدائمةُ تُقرأُ بأيِّ شفرةٍ تعملُ في هذا الأصلِ لاحقاً.
 * 3. **الرفضُ يُرى رفضاً باسمِه.** لا «حدثَ خطأٌ»: يُعرَضُ الرمزُ المُعلَنُ ورسالتُه
 *    والحالةُ. فواجهةٌ تُخفي `403` تجعلُ القارئَ يظنُّ أنّ الجدولَ فارغٌ وقد
 *    مُنِعَ من قراءتِه — وذاك أخطرُ من رسالةِ منعٍ صريحةٍ.
 * 4. **لا كتابةَ:** لا فعلَ غيرَ `GET` في هذا الملفِّ، ولا زرَّ يُعدِّلُ حالَ
 *    الدولةِ. الكتابةُ أمرٌ ملكيٌّ موقَّعٌ (`M9.03`) ولا يَحملُ متصفِّحٌ مفاتيحَه.
 */

const tokenField = /** @type {HTMLInputElement} */ (document.getElementById('token'));
const pathField = /** @type {HTMLInputElement} */ (document.getElementById('path'));
const limitField = /** @type {HTMLInputElement} */ (document.getElementById('limit'));
const filterField = /** @type {HTMLInputElement} */ (document.getElementById('filter'));
const form = /** @type {HTMLFormElement} */ (document.getElementById('read-form'));
const submit = /** @type {HTMLButtonElement} */ (document.getElementById('submit'));
const statusLine = /** @type {HTMLParagraphElement} */ (document.getElementById('status'));
const tableWrap = /** @type {HTMLDivElement} */ (document.getElementById('table-wrap'));
const headRow = /** @type {HTMLTableRowElement} */ (document.getElementById('head-row'));
const bodyRows = /** @type {HTMLTableSectionElement} */ (document.getElementById('body-rows'));
const rawWrap = /** @type {HTMLDetailsElement} */ (document.getElementById('raw-wrap'));
const raw = /** @type {HTMLPreElement} */ (document.getElementById('raw'));

/**
 * @param {string} text
 * @param {'plain' | 'allow' | 'deny'} kind
 */
function say(text, kind) {
  statusLine.textContent = text;
  if (kind === 'plain') statusLine.removeAttribute('data-kind');
  else statusLine.dataset.kind = kind;
}

/** يُفرِّغُ الجدولَ. */
function clearTable() {
  headRow.replaceChildren();
  bodyRows.replaceChildren();
  tableWrap.hidden = true;
}

/**
 * يُصيِّرُ قيمةً خَلَوِيّةً نصّاً مقروءاً بلا تخمينٍ.
 * @param {unknown} value
 * @returns {string}
 */
function cellText(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * يعرضُ بياناتَ الردِّ: صفوفاً إن كانت مصفوفةً، وقيمةً واحدةً إن كانت عَدّاً.
 * @param {unknown} data
 */
function render(data) {
  clearTable();
  if (Array.isArray(data)) {
    if (data.length === 0) {
      // «صفرُ صفوفٍ» ليس «مُنِعتَ»: يُقالُ صريحاً كي لا يُقرأَ الفراغُ منعاً.
      say('قراءةٌ مسموحةٌ، وصفرُ صفوفٍ في المشهدِ.', 'allow');
      return;
    }
    /** @type {string[]} */
    const columns = [];
    for (const row of data) {
      if (row === null || typeof row !== 'object') continue;
      for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
    }
    if (columns.length === 0) columns.push('قيمةٌ');
    for (const column of columns) {
      const th = document.createElement('th');
      th.textContent = column;
      th.scope = 'col';
      headRow.append(th);
    }
    for (const row of data) {
      const tr = document.createElement('tr');
      for (const column of columns) {
        const td = document.createElement('td');
        const value =
          row !== null && typeof row === 'object'
            ? /** @type {Record<string, unknown>} */ (row)[column]
            : row;
        td.textContent = cellText(value);
        tr.append(td);
      }
      bodyRows.append(tr);
    }
    tableWrap.hidden = false;
    return;
  }
  if (data !== null && typeof data === 'object') {
    const entries = Object.entries(/** @type {Record<string, unknown>} */ (data));
    for (const label of ['الحقلُ', 'القيمةُ']) {
      const th = document.createElement('th');
      th.textContent = label;
      th.scope = 'col';
      headRow.append(th);
    }
    for (const [key, value] of entries) {
      const tr = document.createElement('tr');
      const keyCell = document.createElement('td');
      keyCell.textContent = key;
      const valueCell = document.createElement('td');
      valueCell.textContent = cellText(value);
      tr.append(keyCell, valueCell);
      bodyRows.append(tr);
    }
    tableWrap.hidden = false;
    return;
  }
  const th = document.createElement('th');
  th.textContent = 'القيمةُ';
  th.scope = 'col';
  headRow.append(th);
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.textContent = cellText(data);
  tr.append(td);
  bodyRows.append(tr);
  tableWrap.hidden = false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submit.disabled = true;
  clearTable();
  rawWrap.hidden = true;
  say('تُقرأُ…', 'plain');

  const declared = pathField.value.trim();
  const target = new URL(declared, window.location.origin);
  const limit = limitField.value.trim();
  const filter = filterField.value.trim();
  if (limit !== '') target.searchParams.set('limit', limit);
  if (filter !== '') target.searchParams.set('filter', filter);

  /** @type {Record<string, string>} */
  const headers = { accept: 'application/json' };
  const token = tokenField.value.trim();
  // ولا يُرسَلُ رمزٌ فارغٌ: ترويسةٌ فارغةٌ تُنتِجُ رفضاً بسببٍ مُشوَّشٍ، والأوضحُ
  // أن يُرَدَّ بغيابِ الرمزِ كلِّه — وهو ما تقولُه البوابةُ باسمِها.
  if (token !== '') headers['authorization'] = `Bearer ${token}`;

  try {
    const response = await fetch(target, { method: 'GET', headers, cache: 'no-store' });
    const body = await response.json().catch(() => null);
    raw.textContent = JSON.stringify(body, null, 2);
    rawWrap.hidden = false;
    if (response.ok && body !== null && typeof body === 'object' && 'data' in body) {
      const payload = /** @type {{ route?: unknown, data?: unknown }} */ (body);
      say(`قراءةٌ مسموحةٌ عبرَ المسارِ ${String(payload.route ?? declared)}.`, 'allow');
      render(payload.data);
    } else {
      const refusal = /** @type {{ code?: unknown, message?: unknown }} */ (body ?? {});
      const code = typeof refusal.code === 'string' ? refusal.code : 'بلا رمزٍ';
      const message = typeof refusal.message === 'string' ? refusal.message : '';
      say(
        `رُدَّتِ القراءةُ — ${response.status} · ${code}${message === '' ? '' : ` · ${message}`}`,
        'deny',
      );
    }
  } catch (error) {
    // انقطاعُ الشبكةِ لا يُلبَسُ لباسَ الرفضِ: الأوّلُ لا جوابَ، والثاني جوابٌ
    // بالمنعِ — وخلطُهما يُضيِّعُ على القارئِ معرفةَ أيِّهما وقعَ.
    say(`لم يُبلَغِ الخادمُ: ${error instanceof Error ? error.message : 'سببٌ مجهولٌ'}`, 'deny');
  } finally {
    submit.disabled = false;
  }
});
