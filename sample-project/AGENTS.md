# Video project instructions

This folder is a video project. Read style.md before editing. No paid APIs or uploads.

- sources/: original footage, never overwrite originals.
- timeline.json: {"version":1,"clips":[{"id":"intro","source":"sources/camera-1.mp4","in":0,"out":20,"reason":"짧은 편집 이유"}]}
- in/out: seconds on the source; out is exclusive. Require 0 <= in < out <= source duration.
- id: unique stable letters/digits/underscore/hyphen, at most 80 chars. Preserve ids on trims/moves; use new ids for new selections so the panel highlights changes correctly.
- source: forward-slash relative path beneath sources/, no .. or absolute paths.
- transcripts/<source filename including extension>.json: [{"start":0,"end":20,"text":"..."}]. Nested directories mirror sources/. These sample transcripts are fictional.
- An empty clips array is valid. No transitions, overlays, speed changes, volume mixing, or separate audio tracks in schema v1.
- timeline.json saves reload the VS Code panel automatically. Write complete valid JSON atomically when possible. Do not modify the extension.

From this sample folder, CLI: node ../tools/vidcli.js COMMAND (run npm run build in repository root first).
From another working directory: node "D:/orca/projects/video-ide/tools/vidcli.js" --project "PROJECT_PATH" COMMAND.

Recommended workflow: `signals` → `candidates --target SEC` → read transcripts around candidates → keep whole scenes (setup → action → reaction), add needed dialogue context → `check` → save. `candidates --apply` replaces the timeline with whole scenes that fit the target, in source order; refine this starting point using style.md. Loudness is a cue, not editorial quality.

Commands:
```
signals
candidates --target 180 --win 20
summary
search 핵심
add hook sources/camera-1.mp4 0 10 "핵심 질문"
remove intro
trim idea 65 100
move result 0
validate
proxies
commit "3분 하이라이트"
export
```
move uses a zero-based destination index. Edits validate source existence and duration before writing.
Read transcripts and style, edit timeline.json or use the CLI, run validate, then commit a version if requested. Git is local. Do not push. You may keep an independent git repository when copying this folder elsewhere.
For a 3-minute highlight, target 180 seconds across the two 120-second sources; avoid repeated content. Original starter duration is 240 seconds. Reason explains editorial intent, not implementation details.

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
