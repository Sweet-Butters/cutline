# Video editing workspace

Recommended workflow: `signals` → `candidates --target SEC` → read transcripts around candidates → keep whole scenes (setup → action → reaction), add needed dialogue context → `check` → save. Use `node ../tools/vidcli.js COMMAND`; `candidates --apply` is a starting point in source order. Refine selection and reasons using style.md.

Read and follow ./AGENTS.md and ./style.md before editing. AGENTS.md documents all files, the timeline schema, and the local vidcli commands. Edit timeline.json to make cuts; preserve existing clip ids for trims/moves. Validate with `node ../tools/vidcli.js validate`. The live panel reacts when the file is saved. Use git commits for versions, and never push.

## 편집 검증 사양

저장 후 check를 실행하고 FAIL은 고칠 것

`node ../tools/vidcli.js check` 또는 `node ../tools/vidcli.js check --json`. hard FAIL은 종료 코드 1입니다. 미평가는 통과가 아닙니다.

선택 파일 `edit-spec.json` JSON Schema (초 단위, 범위 양끝 포함):
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "version": {
      "type": "string"
    },
    "targetDuration": {
      "type": "array",
      "items": {
        "type": "number",
        "minimum": 0
      },
      "minItems": 2,
      "maxItems": 2
    },
    "minClipLength": {
      "type": "number",
      "minimum": 0
    },
    "maxClipLength": {
      "type": "number",
      "minimum": 0
    },
    "requiredKeywords": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      }
    },
    "forbiddenKeywords": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      }
    }
  }
}
```

`style.md`의 선택적 `cutline-style` JSON 코드 블록 스키마:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "version": {
      "type": "string"
    },
    "targetDuration": {
      "type": "array",
      "items": {
        "type": "number",
        "minimum": 0
      },
      "minItems": 2,
      "maxItems": 2
    },
    "clipLengthMedian": {
      "type": "array",
      "items": {
        "type": "number",
        "minimum": 0
      },
      "minItems": 2,
      "maxItems": 2
    },
    "clipLengthIQR": {
      "type": "array",
      "items": {
        "type": "number",
        "minimum": 0
      },
      "minItems": 2,
      "maxItems": 2
    },
    "maxOutsideIQRShare": {
      "type": "number",
      "minimum": 0,
      "maximum": 1
    },
    "keepRatio": {
      "type": "array",
      "items": {
        "type": "number",
        "minimum": 0,
        "maximum": 1
      },
      "minItems": 2,
      "maxItems": 2
    }
  }
}
```

범위는 [최소, 최대]이고 최소 ≤ 최대여야 합니다. keepRatio는 0–1입니다. 중앙값·IQR 둘 다 있어야 분포를 평가합니다. IQR 밖 클립 비율의 기본 상한은 0.5입니다. edit-spec의 targetDuration이 style보다 우선합니다. 알려지지 않은 키와 잘못된 수치는 입력 오류로 표시합니다.
