# Cutline — 에이전트가 편집하는 영상 IDE

## 포터블 앱 다운로드·실행 (Windows x64)

배포 파일은 `app/dist/Cutline-win-x64.zip`입니다. 이 작업은 로컬 빌드만 제공하며 공개 다운로드 서버에는 업로드하지 않습니다. 제작자가 전달한 ZIP을 다운로드하고 **모두 압축 풀기**로 쓰기 가능한 폴더에 풀어 `Cutline/Cutline.exe`를 실행하세요. ZIP 안에서 직접 실행하지 마세요.

Cutline은 VSCodium(MIT) + Cutline 확장(MIT)입니다. 실행 파일 아이콘·앱 이름·Windows 앱 식별자를 Cutline으로 변경하며, VSCodium LICENSE/ThirdPartyNotices는 보존합니다. 서명되지 않은 해커톤 데모입니다. Windows x64와 PATH의 `ffmpeg`, `ffprobe`가 필요합니다. CLI 검증·버전 커밋에는 Node.js와 git도 필요합니다. 이 외부 도구와 Claude Code/Codex, 인증정보/API 키는 번들에 넣지 않습니다.

첫 실행 시 샘플을 Windows 문서 폴더의 `Cutline/sample-project`로 복사해 열며 기존 샘플은 덮어쓰지 않습니다. CLI도 옆의 `Cutline/tools`, `Cutline/out`에 복사합니다. 탐색기 옆에 **에이전트 채팅 | 영상·타임라인** 패널이 자동으로 열립니다. 터미널은 기본으로 숨깁니다. 첫 프록시 생성 중에는 읽기·변환 진행률을 표시합니다. 설정·확장·프록시 캐시는 번들의 `data/`에 저장합니다. 기존 에디터 프로필과 분리됩니다. 번들을 이동할 때는 `data/`도 함께 옮기세요. 자동 열기를 끄려면 `cutline.autoOpenPanel`, 터미널도 열려면 `cutline.openTerminal`을 true로 바꾸세요. 수동 **Open Video Panel**, 상태 표시줄 **Ask agent**는 계속 사용할 수 있습니다.

다른 프로젝트는 **File → Open Folder…** 또는 `Cutline.exe "D:\\my-video-project"`로 여세요. 번들에는 샘플의 초기 로컬 git 이력과 `tools/vidcli.js`도 포함되어 있습니다. 커밋할 때는 사용자의 git 이름·이메일 설정이 필요합니다.

**다운로드 앱 데모 순서:**

1. 압축을 풀고 `Cutline.exe`를 실행해 채팅과 첫 프레임을 보여 줍니다. 탐색기는 `Ctrl+B`로 접을 수 있습니다.
2. 채팅 상단에서 이미 구독 로그인한 **Claude / Codex**를 선택합니다. 선택은 기억됩니다. API 키를 입력하지 않습니다.
3. **웃긴 장면 위주 3분 하이라이트** 칩 또는 아래 촬영용 프롬프트를 보냅니다. 자료 확인·저장·검증 진행과 경과 시간이 채팅에 표시됩니다.
4. 저장 직후 길이 변화, 트림 색상, 자동 생성된 **agent: …** 버전을 보여 줍니다.
5. 같은 채팅에서 후속 편집을 요청합니다. **＋**는 새 대화, **중단**은 실행 중인 CLI 프로세스 트리 중단입니다. 저장된 편집은 유지합니다.
6. 클립을 선택하고 **S**로 분할, **Delete**로 삭제, 양 끝을 드래그하여 트림합니다. **Ctrl+Z / Ctrl+Shift+Z**로 수동 편집을 되돌리고 다시 실행합니다.
7. **대본 · 버전 기록**을 펼쳐 과거 버전을 확인하고, **Export MP4**로 내보냅니다. 샘플은 합성 영상·가상 대본입니다.

**앱 제작:** 저장소에서 `npm ci` 후 아래 명령을 실행합니다. Windows PowerShell, .NET Framework C# 컴파일러, Node.js/npm, git과 GitHub 다운로드 연결이 필요합니다. 빌드는 확장 변경 사항을 반영해 `dist/cutline.vsix`를 재생성하고 설치합니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File app/build.ps1 -Clean
powershell -NoProfile -ExecutionPolicy Bypass -File app/verify-launch.ps1
```

`-Clean`은 `app/build/Cutline` 전체(실행 후 생긴 샘플 변경·프로필 포함)를 교체합니다. 다운로드 캐시는 `app/downloads`에 두며 매번 SHA-256을 검증합니다. [공식 VSCodium 1.100.33714 릴리스](https://github.com/VSCodium/vscodium/releases/tag/1.100.33714)의 ZIP·게시된 `.sha256`·스크립트의 고정 해시가 모두 일치해야 빌드됩니다. 원본 LICENSE/ThirdPartyNotices, `ABOUT.md`, 확장 LICENSE를 포함합니다. 검증 스크립트는 실제 창과 `canplay` 로그를 확인하고 데스크톱 화면을 `app/screenshots/cutline-launch-2.png`에 저장한 뒤 자신이 연 번들 프로세스만 닫습니다. 빌드 ZIP에는 검증 과정에서 생성한 사용자 상태가 들어가지 않습니다.

VS Code에서 `timeline.json`을 저장하면 옆의 영상 패널이 바로 반응합니다. Claude Code 또는 Codex가 JSON을 편집하며, 확장은 로컬 영상 재생·변경 표시·git 버전 탐색·내보내기를 담당합니다. 확장은 API를 직접 호출하지 않습니다. 채팅에서 실행한 구독 CLI는 해당 서비스에 연결합니다.

## 설치와 첫 실행

필요 환경: Windows, VS Code 1.100 이상, Node.js 24, PATH에 `ffmpeg`, `ffprobe`, `git`. 개발·패키징 의존성 설치에는 npm 네트워크가 필요하며 실행 중 확장에는 필요하지 않습니다.

1. VS Code 확장 뷰의 `…` → **Install from VSIX…** → 이 저장소의 `dist/cutline.vsix` 선택.
2. **Open Folder…**로 `D:\orca\projects\video-ide\sample-project` 열기.
3. 채팅·영상 패널이 자동으로 열립니다. 수동으로는 `Ctrl+Shift+P` → **Open Video Panel**, 상태 표시줄 **Ask agent**를 사용하세요.
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

먼저 패널을 열고 첫 프레임을 확인합니다. 터미널을 닫고 왼쪽 채팅과 오른쪽 영상을 함께 촬영합니다. 채팅 상단에서 백엔드를 선택한 뒤 아래 요청을 보냅니다. 별도 API 키는 사용하지 않습니다.

**Claude Code에 그대로 입력:**

```text
AGENTS.md와 style.md를 읽고 transcripts의 가상 대본을 참고해서 3분 하이라이트를 만들어 줘. timeline.json을 직접 편집해. 기존 id는 같은 장면을 트림하거나 이동할 때 유지하고, 새로운 장면은 새 id를 써. 최소 한 클립을 제거하고, 한 클립을 추가하고, 한 클립을 트림해서 편집 변화가 보이게 해 줘. 최종 길이는 정확히 180초로 맞추고 reason은 한국어로 써 줘. 원본 파일은 변경하지 마. node ../tools/vidcli.js validate로 확인해. 버전 커밋은 Cutline이 자동으로 저장해. push하지 마.
```

**Codex에 그대로 입력:**

```text
이 폴더는 영상 프로젝트야. AGENTS.md와 style.md를 먼저 읽고 transcripts에서 중요한 부분을 찾아 3분 하이라이트를 timeline.json에 작성해 줘. 기존 장면을 트림·이동할 때 id를 유지하고 새 장면에는 새 id를 사용해. 최소 1개 삭제, 1개 추가, 1개 트림을 포함하고 최종 길이는 정확히 180초로 맞춰 줘. 각 클립에 한국어 reason을 작성해. sources는 수정하지 말고 node ../tools/vidcli.js validate를 실행해. 버전 커밋은 Cutline이 자동으로 저장해. push하지 마.
```

시청자가 보는 장면:

1. 처음에는 4개 클립, `04:00`입니다. 에이전트가 대본과 스타일을 읽습니다.
2. JSON 저장 직후 초록 배너가 반짝이며 `Timeline changed: +… / −… clips … 04:00 → 03:00`을 표시합니다. 추가는 초록, 삭제는 빨간 잔상, 트림은 주황, 순서 변경은 파랑입니다. 강조는 다음 변경까지 유지됩니다.
3. 클립 위에 마우스를 올려 reason을 보여 줍니다. 재생 중이면 가능한 같은 클립·원본 시점을 유지하며 변경 내용을 적용합니다.
4. 대본 줄을 클릭하면 현재 클립 범위 안의 해당 시각으로 이동합니다.
5. **대본 · 버전 기록**을 펼치면 자동 갱신된 Versions가 보입니다. 과거 커밋 클릭 → **Diff vs current** → **Current**로 돌아옵니다. **Restore**는 확인창 후 현재 JSON을 바꿉니다. 복원 자체는 자동 커밋하지 않습니다.
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

`files.exclude` 기본값으로 `.cutline-cache`, `.git`, `node_modules`, 임시 timeline 파일을 숨깁니다. 사용자 설정으로 덮어쓸 수 있습니다. `cutline.openTerminal`의 기본값은 false입니다. 채팅에서 요청을 보낼 때만 CLI를 실행합니다.

런처의 첫 폴더 인수는 공백·한글 경로도 지원하며 존재하지 않으면 오류로 표시합니다. 인수 없이 실행할 때만 샘플을 복사합니다. `CUTLINE_DOCUMENTS`로 문서 폴더, `CUTLINE_CACHE_ROOT`로 프록시 루트를 지정할 수 있습니다. 번들 기본 캐시는 `data/cache`이며 프로젝트별로 분리합니다. 독립 VSIX/CLI는 환경변수가 없으면 프로젝트의 `.cutline-cache`를 사용합니다.

같은 프로젝트·원본·형식의 동시 프록시 요청은 진행 중 작업을 공유합니다. 프로세스 간 파일 잠금 후 캐시를 다시 확인하므로 중복 변환하지 않습니다. 실제 코덱 재생 실패로 다른 형식이 필요한 경우에는 호환 변환을 수행합니다.

촬영 검증은 `app/verify-launch.ps1`로 실행하며 기본 결과는 `app/screenshots/cutline-launch-2.png`입니다. 검증용 문서·캐시 위치를 저장소 안으로 지정해 다른 디렉터리를 변경하지 않습니다. `-Project "D:\path\project" -Screenshot cutline-chim.png -AllowPreparing`으로 긴 프로젝트의 변환 중 비교 트랙도 확인할 수 있습니다. 이 모드의 화면은 재생 완료 증거가 아니며 JSON 보고서의 canplay를 따로 확인하세요.

## 채팅 백엔드와 권한

Claude Code / Codex CLI를 설치하고 각 CLI의 구독 계정으로 미리 로그인하세요. 없거나 로그인 만료·비정상 종료가 발생하면 채팅에 오류가 표시되고 영상은 계속 사용할 수 있습니다. API 키 및 외부 제공자 환경변수(`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `OPENAI_API_KEY`, `CODEX_API_KEY`, AWS/Azure 등)를 자식 환경에서 제거합니다. 사용자 환경은 변경하지 않습니다. Codex는 `forced_login_method="chatgpt"`, `model_provider="openai"`로 실행합니다.

- Claude: `claude -p PROMPT --output-format stream-json --verbose --permission-mode acceptEdits --permission-prompts none`. 읽기·파일 편집과 `node tools/vidcli.js …`, `node tools/compare.js …`(샘플의 `../tools/`도 포함)만 도구 목록/allowlist에 둡니다. 광범위한 Bash 허용이나 `--dangerously-skip-permissions`는 사용하지 않습니다. `--setting-sources "" --strict-mcp-config`로 사용자/프로젝트 훅과 MCP 자동 실행을 배제합니다. `--resume SESSION_ID`로 후속 대화를 이어 갑니다. 이 allowlist는 OS 파일시스템 샌드박스가 아닙니다.
- Codex: `codex exec --json`과 `approval_policy="never"`, `sandbox_mode`를 사용합니다. 후속 요청은 `codex exec … resume THREAD_ID --json PROMPT`입니다. 이 Windows 머신의 `workspace-write` 실제 실행은 “현재 작업 공간이 읽기 전용” 응답으로 파일을 수정하지 못했습니다. 따라서 이 빌드의 `cutline.codexSandbox` 기본값은 실제 수정에 성공한 **danger-full-access**입니다. **프로젝트 밖 쓰기를 기술적으로 차단하지 않습니다.** 프로젝트 안에서만 편집하라는 지시를 전달하며, 지원되는 환경에서는 설정을 `workspace-write`로 낮추세요. 자동 권한 확대·자동 재시도는 하지 않습니다.
- cwd는 열린 영상 프로젝트입니다. 프롬프트는 셸에 삽입하지 않고 인수 배열로 전달합니다. Windows npm Codex는 cmd 셸을 거치지 않고 Node 진입점을 직접 실행합니다.
- 실행 중 저장한 정상 타임라인은 기존 diff 감시와 연결됩니다. `cutline.autoCommitAgentEdits=true`(기본값)이면 `agent: <요청 첫 줄>`로 timeline.json만 커밋합니다. git 저장소/작성자 설정이 없으면 편집은 유지하고 오류를 표시합니다. CLI가 직접 커밋하지 않도록 안내합니다.
- 각 백엔드 세션 ID는 프로젝트별로 기억합니다. 채팅 표시 내용과 수동 undo 스택은 현재 패널 세션에만 유지됩니다. 에이전트 편집 후에는 수동 undo 이력을 초기화합니다. 외부 파일 변경 후 오래된 undo는 충돌 메시지로 거절합니다.

프로젝트의 `.cutline/prompts.json`에 문자열 배열을 두면 칩을 바꿀 수 있습니다(패널을 다시 열면 적용). 없으면 기본 3개를 사용합니다.

```json
["style.md대로 20분 편집본 만들어줘", "웃긴 장면 위주 3분 하이라이트", "방금 편집에서 앞부분 30초 줄여줘"]
```

`.cutline/edit-log.jsonl`에는 `who: human|agent`, `action`, `clipIds`, `before`, `after`, `at`을 한 편집당 한 줄 기록합니다. 수동 분할·삭제·트림·undo·redo는 즉시 timeline.json에 저장됩니다. 원본 길이를 벗어난 트림은 거부합니다. 에이전트 실행 중이나 과거 버전 프리뷰에서는 수동 편집을 잠급니다. 대본 입력 중에는 편집 단축키를 가로채지 않습니다. 분할은 원본 기준 재생 위치를 사용하며 프레임 단위 NLE 정밀도를 보장하지 않습니다.

`npm run test:agents`는 샘플 **복사본**에서 실제 구독 CLI를 채팅 폼 → webview 메시지 → 확장 경로로 실행합니다. 인증 파일을 `.test-data/real-agent` 아래에 잠시 복사하고 종료 시 지웁니다. 프로젝트, 로그, 세션은 git-ignored `.test-data/`에만 남습니다. `CUTLINE_TEST_SANDBOX=workspace-write`로 제한 모드 재검증이 가능합니다. 실측 결과는 [VERIFICATION.md](VERIFICATION.md)를 참고하세요. Codex 비대화형 JSON/재개 인터페이스는 [공식 문서](https://developers.openai.com/codex/noninteractive)와 설치된 CLI 도움말을 확인했습니다.


## 내보내기 전 편집 검증표

패널 위의 접이식 검증표는 타임라인 저장·수동 편집·되돌리기, `edit-spec.json`, `style.md`, 대본·원본 변경에 맞춰 갱신됩니다. PASS / WARN / FAIL / 미평가를 구분하고 **미평가를 통과 수나 평가 분모에 넣지 않습니다**. 항목의 기대값·실측값과 클립/원본 초 구간을 표시하며 구간 버튼으로 해당 클립을 선택하고 이동합니다. 버전 프리뷰에서는 표시 중인 타임라인을 현재 사양으로 검사합니다. 에이전트 턴이 끝나면 현재 저장본의 검증 요약도 채팅에 추가됩니다.

```powershell
node tools/vidcli.js --project sample-project check
node tools/vidcli.js --project sample-project check --json
```

CLI와 패널, 내보내기는 같은 검증 엔진을 사용합니다. `check`는 hard FAIL이면 종료 코드 1, 그 외에는 0입니다. WARN/미평가는 완벽한 편집을 의미하지 않습니다. `sample-project/AGENTS.md`와 `CLAUDE.md`에 두 입력의 JSON Schema와 에이전트 작업 지침이 있습니다.

- `edit-spec.json`(선택): `version`, `targetDuration: [최소초, 최대초]`, `minClipLength`, `maxClipLength`, `requiredKeywords`, `forbiddenKeywords`.
- `style.md`의 `cutline-style` JSON 블록(선택): `version`, `targetDuration`, `clipLengthMedian`, `clipLengthIQR`, `maxOutsideIQRShare`, `keepRatio`. 샘플 수치는 수동 데모 기준이며 자동 학습 결과가 아닙니다. 사양의 목표 길이가 스타일 목표보다 우선합니다.
- 원본 범위를 벗어나거나 파일이 없으면 hard FAIL(컨테이너 길이 오차 0.025초 허용). 같은 원본의 `(총 재생 초 − 구간 합집합 초) / 총 재생 초`가 **50% 초과**면 WARN입니다. 50% 이하는 PASS이며 중복이 전혀 없다는 뜻은 아닙니다.
- 목표 길이·개별 클립 길이·키워드는 hard 규칙입니다. 범위 양끝을 포함합니다. 대본과 겹치는 구간의 텍스트를 대소문자 구분 없이 부분 문자열로 검사합니다. 단어별 타임코드가 없으므로 클립이 문장 일부만 포함해도 그 문장의 키워드가 포함된 것으로 봅니다.
- 분포는 중앙값과 채널 IQR 밖 클립 비율을 검사합니다. 기본 이탈 비율 상한은 0.5이며 하나라도 벗어나면 WARN입니다. 두 범위가 모두 있어야 평가합니다.
- 컷이 대본 구간 양끝에서 각각 0.5초보다 깊게 들어가면 WARN입니다. 누락/빈 대본은 미평가(이미 확인된 중간 컷이 있으면 WARN과 불완전 여부 표시)입니다.
- 유지율은 **고유 유지 초 / 프로젝트 sources 아래 전체 원본 초**입니다. 참조되지 않은 원본도 분모에 포함합니다. 지원 확장자는 mp4/mov/mkv/webm/avi/m4v이며 타임라인이 참조한 다른 확장자도 검사합니다. 원본 길이 확보 실패 시 미평가입니다.
- 유머 타이밍/채널다움은 항상 미평가 · 창작자 확인 필요입니다. 잘못된 사양은 입력 오류로 노출하며 edit-spec은 FAIL, style은 WARN입니다. JSON 구조가 잘못된 timeline은 검증 미완료로 표시합니다.

내보내기 직전에 다시 검사하며 hard FAIL이 있으면 확인창을 띄웁니다. CLI는 기본적으로 중단하고, 사용자가 결과를 확인한 뒤 `export --allow-hard-fail`로 명시적으로 승인할 수 있습니다. 승인해도 원본 범위 오류처럼 렌더링 불가능한 타임라인은 기존 미디어 검사가 차단합니다. 성공한 MP4 옆에 같은 이름의 `.report.json`을 기록합니다. 보고서에는 검사한 타임라인의 SHA-256(JSON.stringify 직렬화), spec/style 원문 SHA-256 및 명시 버전, 엔진 버전, 전체 결과, 요약, FAIL 승인 여부가 담깁니다. 렌더 중 timeline/spec 파일이 바뀌어도 보고서는 내보내기에 전달한 스냅샷을 설명합니다. 원본 미디어 자체의 동시 변경까지 고정하는 기능은 없습니다.

샘플 초기 검증은 `검증 8/9 통과 · 경고 1 · 실패 0 · 미평가 1`입니다. 실제 번들 화면: [검증표 스크린샷](app/screenshots/cutline-check.png).


## 소리 신호로 편집 뼈대 만들기

대본에 잘 드러나지 않는 공연·함성·반응 구간은 소리 후보부터 확인할 수 있습니다. 코드는 후보를 제안하고, 에이전트가 style.md와 실제 장면을 보고 선택·순서·이유를 결정합니다. 음량 순위는 편집 품질 점수가 아닙니다.

저장소 루트에서:

```powershell
node tools/vidcli.js --project sample-project signals
node tools/vidcli.js --project sample-project candidates --target 180 --win 20
# 현재 timeline.json을 후보 장면으로 교체하려면:
node tools/vidcli.js --project sample-project candidates --target 180 --win 20 --apply
node tools/vidcli.js --project sample-project check
```

- `signals [--source sources/x.mp4]`: sources 아래 영상을 순회합니다. ffmpeg로 모노 8 kHz PCM을 스트리밍 디코드하고 초당 RMS 에너지를 계산합니다. 원본 내용 SHA-256과 분석 프로필로 `.cutline-cache`를 재사용합니다. `signals/x.mp4.json`에는 초별 에너지와 5초 창의 `start`, `end`, `db`(RMS dBFS), `percentile`(해당 원본 내 동률 중간순위)이 저장됩니다. 마지막 부분 창도 포함하며 무음은 -120 dBFS로 표시합니다. LUFS 분석은 아닙니다.
- `candidates --target 초 [--win 10|20|30] [--source sources/x.mp4]`: 기본 창은 20초입니다. 1초 간격 창을 에너지순으로 고르고 겹치는 창은 제외합니다. 총 후보 길이는 목표의 약 두 배이며 마지막 창만큼 넘을 수 있습니다. 인접 창을 긴 장면으로 합친 뒤 장면 평균 dBFS순으로 출력합니다. 각 장면에는 겹치거나 가장 가까운 대본 최대 8줄이 포함됩니다. 전체 맥락은 대본 파일에서 추가로 읽으세요.
- `--apply`: 순위순으로 목표 길이에 들어가는 **온전한 장면**을 골라 파일명·원본 시각 순서로 저장합니다. 목표를 맞추려고 장면을 쪼개지 않으므로 결과가 짧을 수 있습니다. 들어갈 장면이 하나도 없으면 타임라인을 유지하고 오류로 알립니다. 목표를 늘리거나 장면 경계를 직접 검토하세요. 생성된 편집은 검토용 시작점입니다.

권장 순서: `signals` → `candidates --target` → 후보 주변 대본 읽기 → 준비·행동·반응을 한 장면으로 유지하고 필요한 대화 맥락 추가 → `check` → 최종 저장. 채팅 프리셋 **“소리 신호로 뼈대 잡고 style.md대로 20분 편집”**으로 시작할 수도 있습니다.

패널의 사람/AI 원본 시간축 아래에 얇은 소리 트랙이 표시됩니다. 높이는 dBFS, 밝기는 백분위이며 마우스를 올리면 시각과 수치를 볼 수 있습니다. `signals` 저장 시 자동 갱신됩니다. 사람 편집본이 없어도 원본 시간축과 소리 트랙은 표시됩니다. 검증표는 기본 한 줄로 접혀 있으며 클릭하면 펼쳐집니다. 약 1440×900 창에서 채팅, 영상, 편집 순서, 비교 트랙을 함께 볼 수 있도록 배치했습니다.

샘플 영상·대본·사람 편집 트랙은 UI 시연용 합성 예제입니다. 일정한 테스트 톤을 사용하므로 실제 하이라이트 탐지 성능을 평가하는 자료가 아닙니다. 합성 오디오의 알려진 큰 소리 구간, 캐시 재사용·무효화, 후보 병합·적용은 `npm test`, 실제 패널의 소리 트랙과 기본 접힘은 `npm run test:integration`으로 검증합니다.

촬영 검증 스크립트는 명시한 프로젝트를 배포 앱에서 열고 화면 배율을 1:1로 고정합니다.
