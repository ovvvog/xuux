#!/usr/bin/env node
// حذفُ فرعِ الطلبِ المدموجِ والتحقّقُ من زوالِه — يُشغِّلُه `.github/workflows/delete-merged-branch.yml`
// (‏`WL-329`). القرارُ في `scripts/lib/merged-branch.mjs`؛ وهذا الملفُّ عميلُ REST وحدَه.
//
// المُدخلاتُ من البيئةِ: `GITHUB_TOKEN` · `GITHUB_REPOSITORY` · `GITHUB_EVENT_PATH` (‏حمولةُ
// `pull_request` بنوعِ `closed`). الخروجُ `0` إن حُذِفَ وتُحقِّقَ أو أُبقيَ بسببٍ مُعلَن،
// و`1` إن فشلَ الحذفُ أو بقيَ الفرعُ بعدَه — **فلا يُدّعى إتمامٌ لم يقع**.

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { cleanupMergedBranch } from './lib/merged-branch.mjs';

const token = process.env['GITHUB_TOKEN'] ?? '';
const repo = process.env['GITHUB_REPOSITORY'] ?? '';
const eventPath = process.env['GITHUB_EVENT_PATH'] ?? '';
if (token === '' || repo === '' || eventPath === '') {
  console.error('⛔ GITHUB_TOKEN/GITHUB_REPOSITORY/GITHUB_EVENT_PATH غائبة.');
  process.exit(1);
}

/** @type {any} */
const payload = JSON.parse(readFileSync(eventPath, 'utf8'));
const pr = payload.pull_request;
const api = `https://api.github.com/repos/${repo}`;
/** @type {Record<string, string>} */
const headers = {
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
};

/**
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
async function call(url, init) {
  return fetch(url, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
}

/**
 * @param {string} ref
 * @returns {string}
 */
const enc = (ref) => ref.split('/').map(encodeURIComponent).join('/');

const result = await cleanupMergedBranch(
  {
    pr: Number(pr.number),
    headRef: String(pr.head?.ref ?? ''),
    prHeadSha: String(pr.head?.sha ?? ''),
    sameRepo: pr.head?.repo?.full_name === repo,
    defaultBranch: String(payload.repository?.default_branch ?? 'main'),
  },
  {
    async isMerged(n) {
      const res = await call(`${api}/pulls/${n}/merge`);
      return res.status === 204;
    },
    async getRefSha(ref) {
      const res = await call(`${api}/git/ref/heads/${enc(ref)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GET ref ${ref}: HTTP ${res.status}`);
      /** @type {any} */
      const body = await res.json();
      return String(body.object?.sha ?? '');
    },
    async isProtected(ref) {
      const res = await call(`${api}/branches/${enc(ref)}`);
      if (!res.ok) throw new Error(`GET branch ${ref}: HTTP ${res.status}`);
      /** @type {any} */
      const body = await res.json();
      return body.protected === true;
    },
    async countOpenPrsWithHead(ref, except) {
      const owner = repo.split('/')[0];
      const res = await call(`${api}/pulls?state=open&head=${owner}:${encodeURIComponent(ref)}`);
      if (!res.ok) throw new Error(`GET pulls: HTTP ${res.status}`);
      const list = /** @type {any[]} */ (await res.json());
      return list.filter((p) => p.number !== except).length;
    },
    async deleteRef(ref) {
      const res = await call(`${api}/git/refs/heads/${enc(ref)}`, { method: 'DELETE' });
      // 422 «Reference does not exist» = حذفَه إعدادُ المستودعِ قبلَنا؛ والتحقّقُ بعدَه يحكم.
      if (!res.ok && res.status !== 422) throw new Error(`DELETE ${ref}: HTTP ${res.status}`);
    },
  },
);

const line = `#${pr.number} \`${pr.head?.ref}\` → ${result.decision.action} · ${result.decision.reason} · التحقّقُ: ${result.verified}`;
if (!result.ok) {
  console.error(`⛔ ${line}`);
  process.exit(1);
}
console.log(`✅ ${line}`);
