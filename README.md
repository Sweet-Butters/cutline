# Cutline — 에이전트가 편집하는 영상 IDE

## 포터블 앱 다운로드·실행 (Windows x64)

배포 파일은 `app/dist/Cutline-win-x64.zip`입니다. 이 작업은 로컬 빌드만 제공하며 공개 다운로드 서버에는 업로드하지 않습니다. 제작자가 전달한 ZIP을 다운로드하고 **모두 압축 풀기**로 쓰기 가능한 폴더에 풀어 `Cutline/Cutline.exe`를 실행하세요. ZIP 안에서 직접 실행하지 마세요.

Cutline은 VSCodium(MIT) + Cutline 확장(MIT)입니다. 실행 파일 아이콘·앱 이름·Windows 앱 식별자를 Cutline으로 변경하며, VSCodium LICENSE/ThirdPartyNotices는 보존합니다. 서명되지 않은 해커톤 데모입니다. Windows x64와 PATH의 `ffmpeg`, `ffprobe`가 필요합니다. CLI 검증·버전 커밋에는 Node.js와 git도 필요합니다. 이 외부 도구와 Claude Code/Codex, 인증정보/API 키는 번들에 넣지 않습니다.

첫 실행 시 샘플을 Windows 문서 폴더의 `Cutline/sample-project`로 복사해 열며 기존 샘플은 덮어쓰지 않습니다. CLI도 옆의 `Cutline/tools`, `Cutline/out`에 복사합니다. `timeline.json`, 오른쪽 영상 패널, 프로젝트 루트를 cwd로 하는 하단 터미널이 자동으로 열립니다. 첫 프록시 생성 중에는 읽기·변환 진행률을 표시합니다. 설정·확장·프록시 캐시는 번들의 `data/`에 저장합니다. 기존 에디터 프로필과 분리됩니다. 번들을 이동할 때는 `data/`도 함께 옮기세요. 자동 열기를 끄려면 `cutline.autoOpenPanel`, 터미널만 끄려면 `cutline.openTerminal`을 false로 바꾸세요. 수동 **Open Video Panel**, 상태 표시줄 **Ask agent**는 계속 사용할 수 있습니다.

다른 프로젝트는 **File → Open Folder…** 또는 `Cutline.exe "D:\\my-video-project"`로 여세요. 번들에는 샘플의 초기 로컬 git 이력과 `tools/vidcli.js`도 포함되어 있습니다. 커밋할 때는 사용자의 git 이름·이메일 설정이 필요합니다.

**다운로드 앱 데모 순서:**

1. 압축을 풀고 `Cutline.exe`를 실행해 JSON·영상 패널·첫 프레임을 보여 줍니다.
2. 자동으로 열린 하단 **Ask agent** 터미널에서 시작합니다. cwd는 현재 프로젝트 루트이며 터미널은 JSON 편집기 아래에 열립니다.
3. 사용자 컴퓨터에 이미 설치·인증한 `claude` 또는 `codex`를 실행합니다. 앱이 에이전트를 자동 실행하거나 키를 요구하지 않습니다.
4. 아래 촬영용 프롬프트를 입력합니다. 에이전트가 `timeline.json`을 저장하면 4분 → 3분 변화와 클립별 색상 표시를 보여 줍니다.
5. **Play**, 대본 탐색, **Versions**, **Export MP4**를 차례로 보여 줍니다. 샘플 영상과 대본은 합성 데모 자료입니다.

**앱 제작:** 저장소에서 `npm ci` 후 아래 명령을 실행합니다. Windows PowerShell, .NET Framework C# 컴파일러, Node.js/npm, git과 GitHub 다운로드 연결이 필요합니다. 빌드는 확장 변경 사항을 반영해 `dist/cutline.vsix`를 재생성하고 설치합니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File app/build.ps1 -Clean
powershell -NoProfile -ExecutionPolicy Bypass -File app/verify-launch.ps1
```

`-Clean`은 `app/build/Cutline` 전체(실행 후 생긴 샘플 변경·프로필 포함)를 교체합니다. 다운로드 캐시는 `app/downloads`에 두며 매번 SHA-256을 검증합니다. [공식 VSCodium 1.100.33714 릴리스](https://github.com/VSCodium/vscodium/releases/tag/1.100.33714)의 ZIP·게시된 `.sha256`·스크립트의 고정 해시가 모두 일치해야 빌드됩니다. 원본 LICENSE/ThirdPartyNotices, `ABOUT.md`, 확장 LICENSE를 포함합니다. 검증 스크립트는 실제 창과 `canplay` 로그를 확인하고 데스크톱 화면을 `app/screenshots/cutline-launch-2.png`에 저장한 뒤 자신이 연 번들 프로세스만 닫습니다. 빌드 ZIP에는 검증 과정에서 생성한 사용자 상태가 들어가지 않습니다.

VS Code에서 `timeline.json`을 저장하면 옆의 영상 패널이 바로 반응합니다. Claude Code 또는 Codex가 JSON을 편집하며, 확장은 로컬 영상 재생·변경 표시·git 버전 탐색·내보내기를 담당합니다. 확장에서 AI 서비스 호출, 네트워크 요청, 텔레메트리를 하지 않습니다.

## 설치와 첫 실행

필요 환경: Windows, VS Code 1.100 이상, Node.js 24, PATH에 `ffmpeg`, `ffprobe`, `git`. 개발·패키징 의존성 설치에는 npm 네트워크가 필요하며 실행 중 확장에는 필요하지 않습니다.

1. VS Code 확장 뷰의 `…` → **Install from VSIX…** → 이 저장소의 `dist/cutline.vsix` 선택.
2. **Open Folder…**로 `D:\orca\projects\video-ide\sample-project` 열기.
3. `timeline.json`을 편집기에 열고 `Ctrl+Shift+P` → **Open Video Panel** 실행. 패널은 옆 열에 열립니다.
4. 최초 실행은 두 원본의 프록시 생성을 기다립니다. WebM 재생이 실패하는 VS Code에서는 H.264/MP3 호환 프록시로 자동 전환합니다. 성공한 형식은 해당 작업공간에 기억합니다. 이후 같은 원본은 캐시를 재사용합니다. 촬영 전에 아래 명령으로 두 형식을 미리 생성하는 것을 권장합니다.
5. **Play**를 누르면 4분짜리 테스트 패턴 영상이 재생됩니다. 테스트 영상은 각각 120초이며 화면에 카메라 번호·시간, 오디오에 서로 다른 사인 톤이 들어 있습니다. 대본은 가상이며 실제 말소리는 없습니다.

저장소 루트 PowerShell:

```powershell
cd D:\orca\projects\video-ide
npm run build
node tools/vidcli.js --project sample-project proxies
node tools/vidcli.js --project sample-project proxies mp4
```

표시 이름은 `package.json`의 `displayName` 한 곳에서 읽습니다. 이름을 바꾸어도 기존 `cutline.*` 명령 ID와 캐시 경로는 유지됩니다.

## 촬영용 데모 스크립트

먼저 패널을 열고 첫 프레임이 나타나는지 확인합니다. 에디터의 JSON과 패널을 동시에 보이게 배치합니다. `sample-project`에서 터미널을 열고 이미 설치한 에이전트를 실행합니다. 별도 API 키는 이 확장에서 사용하지 않습니다.

**Claude Code에 그대로 입력:**

```text
AGENTS.md와 style.md를 읽고 transcripts의 가상 대본을 참고해서 3분 하이라이트를 만들어 줘. timeline.json을 직접 편집해. 기존 id는 같은 장면을 트림하거나 이동할 때 유지하고, 새로운 장면은 새 id를 써. 최소 한 클립을 제거하고, 한 클립을 추가하고, 한 클립을 트림해서 편집 변화가 보이게 해 줘. 최종 길이는 정확히 180초로 맞추고 reason은 한국어로 써 줘. 원본 파일은 변경하지 마. node ../tools/vidcli.js validate로 확인한 다음 node ../tools/vidcli.js commit "3분 하이라이트"로 로컬 커밋해. push하지 마.
```

**Codex에 그대로 입력:**

```text
이 폴더는 영상 프로젝트야. AGENTS.md와 style.md를 먼저 읽고 transcripts에서 중요한 부분을 찾아 3분 하이라이트를 timeline.json에 작성해 줘. 기존 장면을 트림·이동할 때 id를 유지하고 새 장면에는 새 id를 사용해. 최소 1개 삭제, 1개 추가, 1개 트림을 포함하고 최종 길이는 정확히 180초로 맞춰 줘. 각 클립에 한국어 reason을 작성해. sources는 수정하지 말고 node ../tools/vidcli.js validate를 실행한 뒤 node ../tools/vidcli.js commit "3분 하이라이트"로 로컬 커밋해. push하지 마.
```

시청자가 보는 장면:

1. 처음에는 4개 클립, `04:00`입니다. 에이전트가 대본과 스타일을 읽습니다.
2. JSON 저장 직후 초록 배너가 반짝이며 `Timeline changed: +… / −… clips … 04:00 → 03:00`을 표시합니다. 추가는 초록, 삭제는 빨간 잔상, 트림은 주황, 순서 변경은 파랑입니다. 강조는 다음 변경까지 유지됩니다.
3. 클립 위에 마우스를 올려 reason을 보여 줍니다. 재생 중이면 가능한 같은 클립·원본 시점을 유지하며 변경 내용을 적용합니다.
4. 대본 줄을 클릭하면 현재 클립 범위 안의 해당 시각으로 이동합니다.
5. 커밋 후 Versions의 `↻`을 누릅니다. 과거 커밋 클릭 → **Diff vs current** → **Current**로 돌아옵니다. **Restore**는 확인창 후 현재 JSON을 바꿉니다. 복원 자체는 자동 커밋하지 않습니다.
6. **Export MP4**를 누르면 원본을 사용한 H.264/AAC 파일이 `exports/`에 만들어집니다. 알림에서 완료 경로를 확인합니다.

에이전트 출력은 매번 다를 수 있습니다. 네트워크/구독 에이전트 없이 같은 변경을 재현하려면 다음을 실행합니다. 시작 상태가 필요하면 `npm run sample`이 타임라인과 가상 대본을 초기화합니다(기존 샘플 동영상은 재생성하지 않음).

```powershell
node ../tools/vidcli.js remove idea
node ../tools/vidcli.js trim intro 0 30
node ../tools/vidcli.js add hook sources/camera-1.mp4 60 90 "핵심 설명을 다시 배치"
node ../tools/vidcli.js move hook 1
node ../tools/vidcli.js validate
node ../tools/vidcli.js commit "3분 데모 편집"
```

이 예제의 최종 길이는 `30 + 30 + 60 + 60 = 180`초입니다. 각각의 CLI 실행은 개별 저장이므로 각 단계의 diff가 표시됩니다. 한 번에 큰 변화를 보여 주려면 에이전트가 완성 JSON을 한 번 저장하게 합니다.

## 파일 규약과 스키마

```text
project/
  sources/camera-1.mp4           원본; 하위 폴더도 가능
  timeline.json                 편집 결과
  transcripts/camera-1.mp4.json 선택 사항; 원본 확장자 포함
  style.md                      자유 형식 편집 스타일
  AGENTS.md / CLAUDE.md          에이전트 작업 안내
  .cutline-cache/                자동 생성 프록시, 작업 잠금, 임시 export 조각
  exports/                      최종 MP4
```

```json
{
  "version": 1,
  "clips": [
    {"id": "intro", "source": "sources/camera-1.mp4", "in": 0, "out": 12.5, "reason": "핵심 질문으로 시작"}
  ]
}
```

- `version`은 1. `clips` 배열의 순서가 재생 순서입니다. 빈 배열도 유효하지만 내보내기는 불가능합니다.
- `id`는 고유한 영문/숫자/`_`/`-`, 1–80자입니다. 트림/이동 시 유지해야 변경을 정확하게 구분합니다.
- `source`는 `sources/` 아래 상대 경로이며 `/`를 사용합니다. 경로 이탈, 빠진 원본, 원본 길이 초과를 거부합니다. 한글·공백 파일명도 지원합니다.
- `in`, `out`은 원본 기준 초(소수 가능), `0 <= in < out <= 원본 길이`. `out`은 제외 경계입니다. 컨테이너 반올림을 위해 0.025초 허용 오차가 있습니다.
- `reason`은 선택 사항인 최대 1,000자 문자열입니다.
- 대본은 `[{"start":0,"end":20,"text":"소개"}]`. `sources/interview/a.mov`의 대본은 `transcripts/interview/a.mov.json`입니다.
- 구문/원본 검증에 실패한 파일은 오류를 표시하고 마지막 정상 프리뷰를 유지합니다. 저장 도중 불완전한 JSON이 노출되면 다음 정상 저장 시 복구됩니다.

새 프로젝트는 샘플의 안내 파일과 style.md를 복사하고 `timeline.json`을 `{"version":1,"clips":[]}`로 시작합니다. **Import Video Sources** 명령으로 파일을 가져오면 sources에 복사하고 프록시를 만듭니다. 같은 이름의 기존 파일은 덮어쓰지 않습니다. sources에 직접 파일을 넣어도 처음 타임라인에 사용될 때 프록시가 생성됩니다. 새 독립 폴더에서는 `git init` 후 버전을 커밋하세요. `.cutline-cache/`, `exports/`는 gitignore에 추가하세요. 원본 교체 후에는 타임라인을 저장하거나 패널을 다시 여세요.

## 에이전트 CLI

루트에서 `node tools/vidcli.js --project "프로젝트 경로" 명령`, 프로젝트 폴더에서는 CLI의 절대 경로를 사용합니다. 샘플은 `node ../tools/vidcli.js 명령`입니다.

| 명령 | 내용 |
|---|---|
| `summary` | 클립, 총 초, 전체 타임라인 JSON |
| `search "키워드"` | 대본의 원본 경로·start·end·text JSON 행 |
| `add ID sources/FILE IN OUT "이유"` | 끝에 추가 |
| `remove ID` | 삭제 |
| `trim ID IN OUT` | 원본 시작·끝 변경 |
| `move ID INDEX` | 0부터 시작하는 최종 인덱스로 이동 |
| `validate` | JSON, 원본 존재, ffprobe 영상 길이 검증 |
| `proxies [webm 또는 mp4]` | 현재 타임라인의 모든 원본 프록시 준비; 기본 webm |
| `commit "메시지"` | timeline.json만 로컬 커밋; git 사용자 설정 필요 |
| `export` | 원본을 MP4로 렌더, 출력 경로 표시 |

CLI 편집은 검증 후 임시 파일을 원자적으로 교체합니다. 버전 목록은 해당 timeline.json을 변경한 최근 40개 커밋입니다. 과거 버전도 현재 sources 파일을 참조하므로 원본을 삭제·교체하면 과거 프리뷰가 깨질 수 있습니다. 여러 에이전트가 동시에 JSON을 편집하는 병합 기능은 없습니다.

## 재생과 렌더 방식

프록시는 파일 전체 SHA-256 + 변환 프로필 버전으로 식별합니다. 기본 VP8/Vorbis WebM 또는 호환 H.264/MP3 MP4, 최대 640×360 레터박스, 24fps, CPU 스레드 2개입니다. 원본 이름이 같아도 바이트가 바뀌면 새 키가 생성됩니다. 확장 프로세스의 큐와 프로젝트별 파일 잠금으로 ffmpeg 작업을 직렬화합니다. 캐시는 자동 삭제하지 않으므로 큰 원본을 여러 번 바꾼 뒤에는 작업이 끝났을 때 `.cutline-cache`를 지워 공간을 확보할 수 있습니다.

**이 노트북에서의 코덱 실측:** 설치된 VS Code 1.145.3은 H.264 영상에 `loadedmetadata`/`canplay`를 반환했지만 WebM은 `DEMUXER_ERROR_COULD_NOT_OPEN`으로 실패했습니다. `canPlayType()`은 WebM을 `probably`라고 반환하여 실제 재생 결과와도 달랐습니다. 따라서 “VS Code에서는 H.264가 항상 안 된다”는 가정을 적용하지 않았습니다. 실제로 재생된 호환 프록시는 H.264 영상 + MP3 오디오입니다. 원본 H.264/AAC의 `canplay`만으로 AAC 소리까지 재생된다고 주장하지 않습니다. 다른 VS Code 배포판에서의 코덱 조합은 별도 검증이 필요합니다.

프리뷰는 단일 HTML video에서 원본 프록시를 seek하며 이어 재생합니다. 하드 컷 경계에 짧은 seek/버퍼링 간격이 있을 수 있어 프레임 정확한 실시간 NLE 재생은 아닙니다. 내보내기는 각 원본 컷을 순차 렌더한 뒤 연결하며, 1280×720/30fps H.264/AAC로 정규화합니다. 무음 원본에는 무음 오디오를 넣습니다. 전환, 자막 합성, 오디오 믹싱, 속도 변경은 지원하지 않습니다. 대본은 패널에만 표시됩니다.

## 개발·검증·패키징

```powershell
$env:npm_config_cache = "$PWD\.npm-cache"
npm ci --no-audit --no-fund
npm run build
npm test
npm run test:integration
npm run package
```

샘플 생성은 `npm run sample`입니다. Windows의 `C:/Windows/Fonts/consola.ttf`를 사용합니다. 생성된 동영상도 저장소에 포함되어 있으므로 일반 설치에서 재생성할 필요가 없습니다.

통합 테스트는 기존 `D:/Microsoft VS Code/Code.exe`를 사용합니다. 다른 설치 위치는 `$env:CUTLINE_VSCODE = 'C:/.../Code.exe'`로 설정하세요. 테스트 전용 사용자 데이터·확장·임시 파일은 `.test-data/` 아래에 둡니다. 실제 샘플 타임라인을 수정한 뒤 finally에서 원문을 복구하므로 테스트 중에는 샘플을 편집하지 마세요. 강제 프로세스 종료 시에는 `npm run sample`로 복구하세요.

설치한 VSIX 자체를 검사하려면 `$env:CUTLINE_EXTENSION_PATH`에 격리된 설치 디렉터리(예: `.test-data/package-extensions/cutline-local.cutline-0.1.0`의 절대 경로)를 지정한 뒤 같은 통합 테스트를 실행합니다. 재생 자동화는 사용자 제스처 정책 때문에 음소거로 실행합니다.

빌드 결과는 `out/`, VSIX는 `dist/cutline.vsix`입니다. VSIX에는 확장·CLI 실행 코드가 들어가고 테스트 영상은 용량을 줄이기 위해 포함하지 않습니다. 샘플은 이 저장소에서 여세요. 실행 검증 결과와 한계는 [검증 보고서](VERIFICATION.md)를 참고하세요.

## Human vs AI 비교 트랙

`reference/*.timeline.json`이 있으면 각 reference마다 파란 **AI edit**, 주황 **Human edit**을 같은 원본 시간축에 표시합니다. 스키마는 timeline.json과 같습니다. 여러 원본은 원본별 축을 쓰며 길이는 ffprobe의 실제 원본 길이입니다. 2시간 원본의 짧은 컷도 최소 1픽셀로 표시하고 hover로 정확한 구간을 확인합니다. 기존 편집 순서 클립 스트립도 유지합니다. 비교 트랙은 프록시가 완성되기 전부터 표시됩니다.

- Precision = 교집합 초 / AI가 남긴 고유 원본 초
- Recall = 교집합 초 / 사람이 남긴 고유 원본 초
- F1 = 2 × 교집합 초 / (AI 고유 초 + Human 고유 초)
- 겹치거나 반복되는 구간은 합집합으로 계산합니다. 총 재생 길이는 반복을 포함해 별도로 표시합니다. 양쪽 모두 비어 있으면 1, 한쪽만 비어 있으면 0입니다.

현재 timeline.json과 reference 파일의 생성·수정·삭제를 감시합니다. Versions 프리뷰 중에도 비교 트랙의 AI는 현재 timeline.json입니다. 원본 구간 선택의 일치도이며 순서·자막·음악의 품질 점수는 아닙니다.

`files.exclude` 기본값으로 `.cutline-cache`, `.git`, `node_modules`, 임시 timeline 파일을 숨깁니다. 사용자 설정으로 덮어쓸 수 있습니다. `cutline.openTerminal`의 기본값은 true이며 에이전트를 자동 실행하지 않습니다.

런처의 첫 폴더 인수는 공백·한글 경로도 지원하며 존재하지 않으면 오류로 표시합니다. 인수 없이 실행할 때만 샘플을 복사합니다. `CUTLINE_DOCUMENTS`로 문서 폴더, `CUTLINE_CACHE_ROOT`로 프록시 루트를 지정할 수 있습니다. 번들 기본 캐시는 `data/cache`이며 프로젝트별로 분리합니다. 독립 VSIX/CLI는 환경변수가 없으면 프로젝트의 `.cutline-cache`를 사용합니다.

같은 프로젝트·원본·형식의 동시 프록시 요청은 진행 중 작업을 공유합니다. 프로세스 간 파일 잠금 후 캐시를 다시 확인하므로 중복 변환하지 않습니다. 실제 코덱 재생 실패로 다른 형식이 필요한 경우에는 호환 변환을 수행합니다.

촬영 검증은 `app/verify-launch.ps1`로 실행하며 기본 결과는 `app/screenshots/cutline-launch-2.png`입니다. 검증용 문서·캐시 위치를 저장소 안으로 지정해 다른 디렉터리를 변경하지 않습니다. `-Project "D:\path\project" -Screenshot cutline-chim.png -AllowPreparing`으로 긴 프로젝트의 변환 중 비교 트랙도 확인할 수 있습니다. 이 모드의 화면은 재생 완료 증거가 아니며 JSON 보고서의 canplay를 따로 확인하세요.
