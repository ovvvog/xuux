#!/usr/bin/env python3
from pathlib import Path
root=Path(__file__).parents[1]; required={"governance","operations","education","research","registry","safety"}; errors=[]
for d in sorted((root/"civilization").glob("*-domain")):
    if not (d/"README.md").exists(): errors.append(f"missing README: {d}")
    for layer in required:
        if not (d/layer).is_dir(): errors.append(f"missing layer: {d/layer}")
        if not (d/layer/"README.md").exists(): errors.append(f"missing layer README: {d/layer}")
if errors: print("FAIL\n"+"\n".join(errors)); raise SystemExit(1)
print(f"PASS: {len(list((root/'civilization').glob('*-domain')))} domains validated")
