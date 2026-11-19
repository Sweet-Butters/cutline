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

Commands:
```
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
