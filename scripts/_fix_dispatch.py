import re

# 1. Fix auto-measure: change publish_channel value
with open('.github/workflows/auto-measure-skip-baseline.yml', 'r', encoding='utf-8') as f:
    content = f.read()
content = content.replace("publish_channel: 'repository_dispatch'", "publish_channel: 'workflow_dispatch'")
with open('.github/workflows/auto-measure-skip-baseline.yml', 'w', encoding='utf-8') as f:
    f.write(content)
print("✅ auto-measure: publish_channel changed to workflow_dispatch")

# 2. Fix measure-skip-baseline: change repository_dispatch to workflow_dispatch
with open('.github/workflows/measure-skip-baseline.yml', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the entire dispatch-publish job
old_job = """  # ═══ ④ إطلاقُ النشرِ عبرَ repository_dispatch (LIVE-22) ═══
  # GitHub لا يُطلِقُ workflow_run للأحداثِ المُطلَقةِ بـGITHUB_TOKEN.
  # القياسُ الآلي يُطلَقُ بـworkflow_dispatch من auto-measure بـGITHUB_TOKEN،
  # فلا تُطلَقُ workflow_run للنشر. repository_dispatch استثناءٌ موثَّقٌ.
  # القياسُ اليدويّ لا يُرسِلُ repository_dispatch (publish_channel فارغٌ)،
  # فيَعتمِدُ على workflow_run القديم — فلا ازدواجَ.
  dispatch-publish:
    name: إطلاقُ النشرِ عبرَ repository_dispatch (LIVE-22)
    needs: [resolve, produce-tap, classify-and-write]
    if: |
      inputs.publish_channel == 'repository_dispatch' &&
      needs.resolve.result == 'success' &&
      needs.produce-tap.result == 'success' &&
      needs.classify-and-write.result == 'success'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: read
      actions: write
    steps:
      - name: إطلاقُ repository_dispatch للنشرِ
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          set -euo pipefail
          PAYLOAD=$(node -e "console.log(JSON.stringify({
            event_type: 'skip-baseline-measured',
            client_payload: {
              measure_run_id: '${{ github.run_id }}',
              measure_run_attempt: '${{ github.run_attempt }}',
              measured_sha: '${{ needs.resolve.outputs.measured_sha }}',
              main_head_at_measure: '${{ needs.resolve.outputs.main_head_at_measure }}',
              workflow_sha: '${{ needs.resolve.outputs.workflow_sha }}',
              artifact_name: 'baseline'
            }
          }))")
          HTTP_RESPONSE=$(curl -sS -w '\\n%{http_code}' -X POST \\
            -H 'Accept: application/vnd.github+json' \\
            -H "Authorization: Bearer $GH_TOKEN" \\
            -H 'X-GitHub-Api-Version: 2022-11-28' \\
            -H 'Content-Type: application/json' \\
            "https://api.github.com/repos/${{ github.repository }}/dispatches" \\
            -d "$PAYLOAD")
          HTTP_CODE=$(echo "$HTTP_RESPONSE" | tail -1)
          if [ "$HTTP_CODE" != '204' ]; then
            echo "::error::DISPATCH_PUBLISH_FAILED: HTTP $HTTP_CODE"
            echo "$HTTP_RESPONSE" | sed '$d'
            exit 1
          fi
          echo "✅ أُطلِقَ النشرُ عبرَ repository_dispatch"
          echo "### 🚀 أُطلِقَ النشرُ عبرَ repository_dispatch (LIVE-22)" >> "$GITHUB_STEP_SUMMARY\""""

new_job = """  # ═══ ④ إطلاقُ النشرِ عبرَ workflow_dispatch (LIVE-22) ═══
  # GitHub لا يُطلِقُ workflow_run للأحداثِ المُطلَقةِ بـGITHUB_TOKEN.
  # القياسُ الآلي يُطلَقُ بـworkflow_dispatch من auto-measure بـGITHUB_TOKEN،
  # فلا تُطلِقُ workflow_run للنشر. workflow_dispatch استثناءٌ موثَّقٌ يَعمَلُ بـGITHUB_TOKEN.
  # ويَحتاجُ actions:write فقط (لا contents:write كـrepository_dispatch).
  # القياسُ اليدويّ لا يُرسِلُ workflow_dispatch (publish_channel فارغٌ)،
  # فيَعتمِدُ على workflow_run القديم — فلا ازدواجَ.
  dispatch-publish:
    name: إطلاقُ النشرِ عبرَ workflow_dispatch (LIVE-22)
    needs: [resolve, produce-tap, classify-and-write]
    if: |
      inputs.publish_channel == 'workflow_dispatch' &&
      needs.resolve.result == 'success' &&
      needs.produce-tap.result == 'success' &&
      needs.classify-and-write.result == 'success'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: read
      actions: write
    steps:
      - name: إطلاقُ workflow_dispatch للنشرِ
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          set -euo pipefail
          PAYLOAD=$(node -e "console.log(JSON.stringify({
            ref: 'main',
            inputs: {
              measure_run_id: '${{ github.run_id }}',
              measure_run_attempt: '${{ github.run_attempt }}',
              measured_sha: '${{ needs.resolve.outputs.measured_sha }}',
              main_head_at_measure: '${{ needs.resolve.outputs.main_head_at_measure }}',
              artifact_name: 'baseline'
            }
          }))")
          HTTP_RESPONSE=$(curl -sS -w '\\n%{http_code}' -X POST \\
            -H 'Accept: application/vnd.github+json' \\
            -H "Authorization: Bearer $GH_TOKEN" \\
            -H 'X-GitHub-Api-Version: 2022-11-28' \\
            -H 'Content-Type: application/json' \\
            "https://api.github.com/repos/${{ github.repository }}/actions/workflows/publish-skip-baseline.yml/dispatches" \\
            -d "$PAYLOAD")
          HTTP_CODE=$(echo "$HTTP_RESPONSE" | tail -1)
          if [ "$HTTP_CODE" != '204' ]; then
            echo "::error::DISPATCH_PUBLISH_FAILED: HTTP $HTTP_CODE"
            echo "$HTTP_RESPONSE" | sed '$d'
            exit 1
          fi
          echo "✅ أُطلِقَ النشرُ عبرَ workflow_dispatch"
          echo "### 🚀 أُطلِقَ النشرُ عبرَ workflow_dispatch (LIVE-22)" >> "$GITHUB_STEP_SUMMARY\""""

if old_job in content:
    content = content.replace(old_job, new_job)
    print("✅ measure-skip-baseline: dispatch-publish changed to workflow_dispatch")
else:
    print("❌ ERROR: old_job not found in measure-skip-baseline.yml")
    # Try to find the start of the section
    idx = content.find("═══ ④ إطلاقُ النشرِ عبرَ repository_dispatch")
    if idx >= 0:
        print(f"Found section header at index {idx}")
        print(f"Context: {repr(content[idx:idx+100])}")
    exit(1)

with open('.github/workflows/measure-skip-baseline.yml', 'w', encoding='utf-8') as f:
    f.write(content)

# 3. Fix publish-skip-baseline: change repository_dispatch to workflow_dispatch
with open('.github/workflows/publish-skip-baseline.yml', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace repository_dispatch trigger with workflow_dispatch
old_trigger = """  repository_dispatch:
    types: [skip-baseline-measured]"""

new_trigger = """  workflow_dispatch:
    inputs:
      measure_run_id:
        description: 'معرِّفُ تشغيلةِ القياسِ'
        required: true
        type: string
      measure_run_attempt:
        description: 'محاولةُ التشغيلةِ'
        required: true
        type: string
      measured_sha:
        description: 'بصمةُ الكوميتِ المقاسِ'
        required: true
        type: string
      main_head_at_measure:
        description: 'رأسُ main عندَ القياسِ'
        required: true
        type: string
      artifact_name:
        description: 'اسمُ الأثرِ'
        required: true
        type: string"""

if old_trigger in content:
    content = content.replace(old_trigger, new_trigger)
    print("✅ publish-skip-baseline: trigger changed to workflow_dispatch")
else:
    print("❌ ERROR: old_trigger not found in publish-skip-baseline.yml")
    exit(1)

# Update the comment about repository_dispatch
content = content.replace(
    "repository_dispatch إلى جانب workflow_run (LIVE-22)",
    "workflow_dispatch إلى جانب workflow_run (LIVE-22)"
)
content = content.replace(
    "repository_dispatch استثناءٌ موثَّقٌ.\n# القياسُ اليدويّ لا يُرسِلُ repository_dispatch",
    "workflow_dispatch استثناءٌ موثَّقٌ يَعمَلُ بـGITHUB_TOKEN.\n# القياسُ اليدويّ لا يُرسِلُ workflow_dispatch"
)

# Update the resolve-run step to handle workflow_dispatch
old_resolve = """      # ── حلُّ معرِّفِ التشغيلةِ المقاسةِ (LIVE-22) ──
      # workflow_run: المعرِّفُ في الحدثِ مباشرةً.
      # repository_dispatch: المعرِّفُ في client_payload، ويجبُ التحقُّقُ عبرَ API.
      - name: حلُّ معرِّفِ التشغيلةِ المقاسةِ والتحقُّقُ منها
        id: resolve-run
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          EVENT_NAME: ${{ github.event_name }}
        run: |
          set -euo pipefail
          if [ "$EVENT_NAME" = 'workflow_run' ]; then
            RUN_ID='${{ github.event.workflow_run.id }}'
            echo "measure_run_id=$RUN_ID" >> "$GITHUB_OUTPUT"
            echo "المصدرُ: workflow_run — معرِّفُ التشغيلةِ $RUN_ID"
          else
            RUN_ID='${{ github.event.client_payload.measure_run_id }}'"""

new_resolve = """      # ── حلُّ معرِّفِ التشغيلةِ المقاسةِ (LIVE-22) ──
      # workflow_run: المعرِّفُ في الحدثِ مباشرةً.
      # workflow_dispatch: المعرِّفُ في inputs، ويجبُ التحقُّقُ عبرَ API.
      - name: حلُّ معرِّفِ التشغيلةِ المقاسةِ والتحقُّقُ منها
        id: resolve-run
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          EVENT_NAME: ${{ github.event_name }}
        run: |
          set -euo pipefail
          if [ "$EVENT_NAME" = 'workflow_run' ]; then
            RUN_ID='${{ github.event.workflow_run.id }}'
            echo "measure_run_id=$RUN_ID" >> "$GITHUB_OUTPUT"
            echo "المصدرُ: workflow_run — معرِّفُ التشغيلةِ $RUN_ID"
          else
            RUN_ID='${{ github.event.inputs.measure_run_id }}'"""

if old_resolve in content:
    content = content.replace(old_resolve, new_resolve)
    print("✅ publish-skip-baseline: resolve-run updated for workflow_dispatch")
else:
    print("❌ ERROR: old_resolve not found in publish-skip-baseline.yml")
    exit(1)

# Update the remaining client_payload references
content = content.replace(
    "github.event.client_payload.measure_run_id",
    "github.event.inputs.measure_run_id"
)
content = content.replace(
    "github.event.client_payload.measured_sha",
    "github.event.inputs.measured_sha"
)
content = content.replace(
    "github.event.client_payload.main_head_at_measure",
    "github.event.inputs.main_head_at_measure"
)

with open('.github/workflows/publish-skip-baseline.yml', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ All workflow files updated")
