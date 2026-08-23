# جرد ملفات المستودع

> ⚠️ ملف مولّد آلياً بـ `node scripts/inventory.mjs --summary <ملف>`. لا تحرّره يدوياً.

التصنيف بالمحتوى لا بالاسم: تُحذف التعليقات والأسطر الفارغة، فما بقي هو المحتوى الجوهري.

| الفئة | العدد | النسبة |
| --- | --- | --- |
| `real` | 30 | 0.09% |
| `data` | 11 | 0.03% |
| `doc` | 35 | 0.10% |
| `template` | 33380 | 99.77% |
| **المجموع** | **33456** | 100% |

## التوزيع حسب الامتداد

| الامتداد | المجموع | real | data | doc | template |
| --- | --- | --- | --- | --- | --- |
| `.yaml` | 13278 | 0 | 1 | 0 | 13277 |
| `.md` | 12838 | 0 | 0 | 33 | 12805 |
| `.ts` | 6891 | 0 | 0 | 0 | 6891 |
| `.sql` | 262 | 0 | 0 | 0 | 262 |
| `.txt` | 125 | 0 | 0 | 0 | 125 |
| `.mjs` | 28 | 28 | 0 | 0 | 0 |
| `.tsx` | 15 | 0 | 0 | 0 | 15 |
| `(بلا امتداد)` | 7 | 0 | 5 | 2 | 0 |
| `.json` | 4 | 0 | 4 | 0 | 0 |
| `.sh` | 4 | 0 | 0 | 0 | 4 |
| `.yml` | 2 | 0 | 1 | 0 | 1 |
| `.js` | 1 | 1 | 0 | 0 | 0 |
| `.py` | 1 | 1 | 0 | 0 | 0 |

## التوزيع حسب مجلد الجذر

| المجلد | المجموع | real | data | doc | template |
| --- | --- | --- | --- | --- | --- |
| `federation` | 18098 | 0 | 0 | 2 | 18096 |
| `civilization` | 8501 | 0 | 0 | 0 | 8501 |
| `data-platform` | 1602 | 0 | 0 | 1 | 1601 |
| `institutions` | 1593 | 0 | 0 | 2 | 1591 |
| `infrastructure` | 1171 | 0 | 0 | 1 | 1170 |
| `engines` | 641 | 0 | 0 | 1 | 640 |
| `facilities` | 640 | 0 | 0 | 0 | 640 |
| `operations` | 495 | 0 | 0 | 1 | 494 |
| `contracts` | 169 | 0 | 0 | 1 | 168 |
| `interfaces` | 151 | 0 | 0 | 1 | 150 |
| `src` | 133 | 18 | 0 | 0 | 115 |
| `tests` | 58 | 9 | 0 | 0 | 49 |
| `platform` | 31 | 0 | 0 | 0 | 31 |
| `(الجذر)` | 25 | 1 | 9 | 8 | 7 |
| `science` | 25 | 0 | 0 | 0 | 25 |
| `agents` | 21 | 0 | 0 | 0 | 21 |
| `security` | 21 | 0 | 0 | 0 | 21 |
| `docs` | 19 | 0 | 1 | 17 | 1 |
| `communications` | 16 | 0 | 0 | 0 | 16 |
| `resources` | 14 | 0 | 0 | 0 | 14 |
| `config` | 12 | 0 | 0 | 0 | 12 |
| `knowledge` | 12 | 0 | 0 | 0 | 12 |
| `scripts` | 7 | 2 | 0 | 0 | 5 |
| `.github` | 1 | 0 | 1 | 0 | 0 |

## الملفات الجوهرية كاملة (غير القالبية)

| الملف | الفئة | بايت | أسطر جوهرية |
| --- | --- | --- | --- |
| `.gitattributes` | data | 204 | 10 |
| `.github/workflows/ci.yml` | data | 2587 | 63 |
| `.gitignore` | data | 631 | 32 |
| `.nvmrc` | data | 3 | 1 |
| `.prettierignore` | data | 849 | 23 |
| `.prettierrc` | data | 137 | 8 |
| `CODEOWNERS` | doc | 931 | 11 |
| `GOVERNANCE_RULE.md` | doc | 6695 | 34 |
| `LICENSE` | doc | 875 | 11 |
| `PROJECT_STATUS.md` | doc | 4055 | 39 |
| `README.md` | doc | 5616 | 36 |
| `contracts/README.md` | doc | 241 | 2 |
| `data-platform/README.md` | doc | 432 | 3 |
| `docs/DOMAIN_REGISTRY.yaml` | data | 85821 | 627 |
| `docs/FUTURE_SCIENCE_REGISTRY.md` | doc | 6812 | 51 |
| `docs/INSTITUTIONAL_OPERATING_MODEL.md` | doc | 864 | 8 |
| `docs/README.md` | doc | 340 | 2 |
| `docs/REMAINING_WORK.md` | doc | 3880 | 38 |
| `docs/ROOT_OF_TRUST.md` | doc | 1458 | 9 |
| `docs/WORK_LEDGER.md` | doc | 5212 | 54 |
| `docs/roadmap/01-project-definition.md` | doc | 13601 | 82 |
| `docs/roadmap/02-baseline-audit.md` | doc | 15837 | 109 |
| `docs/roadmap/03-roadmap-to-100.md` | doc | 48641 | 222 |
| `docs/roadmap/04-execution-playbook.md` | doc | 9708 | 93 |
| `docs/roadmap/05-work-log.md` | doc | 13958 | 41 |
| `docs/roadmap/README.md` | doc | 3919 | 21 |
| `docs/stages/002-execution-kernel.md` | doc | 1057 | 13 |
| `docs/stages/003-agent-identity.md` | doc | 1300 | 14 |
| `docs/stages/004-model-layer.md` | doc | 1393 | 16 |
| `docs/stages/005-data-memory.md` | doc | 1270 | 16 |
| `docs/stages/006-law-and-court.md` | doc | 1307 | 17 |
| `document-1-state-definition-5000-lines.md` | doc | 1198591 | 5000 |
| `document-2-build-map-5000-lines.md` | doc | 966092 | 5000 |
| `document-3-launch-phases-5000-lines.md` | doc | 1221446 | 5000 |
| `engines/README.md` | doc | 273 | 2 |
| `eslint.config.js` | real | 3644 | 62 |
| `federation/MUNICIPALITY_MODEL.md` | doc | 571 | 4 |
| `federation/README.md` | doc | 358 | 3 |
| `infrastructure/README.md` | doc | 420 | 3 |
| `institutions/INSTITUTION_INDEX.md` | doc | 12287 | 144 |
| `institutions/INSTITUTION_LIFECYCLE.md` | doc | 521 | 8 |
| `interfaces/README.md` | doc | 317 | 2 |
| `operations/README.md` | doc | 304 | 2 |
| `package-lock.json` | data | 45493 | 1287 |
| `package.json` | data | 993 | 31 |
| `scripts/scan-secrets.mjs` | real | 7621 | 198 |
| `scripts/validate-tree.py` | real | 657 | 9 |
| `src/core/execution-kernel.mjs` | real | 2517 | 83 |
| `src/core/index.mjs` | real | 40 | 1 |
| `src/data/data-catalog.mjs` | real | 1559 | 9 |
| `src/data/index.mjs` | real | 72 | 2 |
| `src/data/memory-store.mjs` | real | 1199 | 7 |
| `src/governance/index.mjs` | real | 34 | 1 |
| `src/governance/law-system.mjs` | real | 3627 | 107 |
| `src/identity/agent-registry.mjs` | real | 2183 | 59 |
| `src/models/index.mjs` | real | 38 | 1 |
| `src/models/model-registry.mjs` | real | 3176 | 89 |
| `src/root-of-trust/command-ledger.mjs` | real | 719 | 23 |
| `src/root-of-trust/crown.mjs` | real | 2645 | 75 |
| `src/root-of-trust/event-log.mjs` | real | 936 | 34 |
| `src/root-of-trust/identity.mjs` | real | 2064 | 76 |
| `src/root-of-trust/index.mjs` | real | 234 | 7 |
| `src/root-of-trust/key-store.mjs` | real | 1657 | 40 |
| `src/root-of-trust/persistent-log.mjs` | real | 856 | 26 |
| `src/root-of-trust/policy.mjs` | real | 814 | 25 |
| `tests/core/execution-kernel.test.mjs` | real | 1782 | 47 |
| `tests/data/data-memory.test.mjs` | real | 1273 | 4 |
| `tests/governance/law-system.test.mjs` | real | 1872 | 44 |
| `tests/identity/agent-registry.test.mjs` | real | 1686 | 39 |
| `tests/models/model-registry.test.mjs` | real | 2213 | 63 |
| `tests/root-of-trust/p0-hardening.test.mjs` | real | 1772 | 50 |
| `tests/root-of-trust/p0-persistence.test.mjs` | real | 1969 | 48 |
| `tests/root-of-trust/root-of-trust.test.mjs` | real | 1701 | 43 |
| `tests/tooling/scan-secrets.test.mjs` | real | 4868 | 102 |
| `tsconfig.json` | data | 763 | 28 |
| `version.json` | data | 859 | 19 |
