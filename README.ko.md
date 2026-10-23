# Codex Session Observatory

[![최신 릴리스](https://img.shields.io/github/v/release/revertable/codex-session-observatory?display_name=tag&label=release)](https://github.com/revertable/codex-session-observatory/releases/latest)

**언어:** [English](README.md) | 한국어

Codex Session Observatory는 Codex CLI와 Codex Windows 앱의 세션 JSONL 파일을 읽는 Windows 데스크톱 앱입니다. 대화 기록을 열람하고, 현재 화면의 텍스트를 캡처하고, 선택한 메시지를 모으거나 전체 세션을 구조화된 작업 로그로 내보낼 수 있습니다. 세션 파일은 로컬에서 처리하며 원본을 변경하지 않습니다.

## 시작하기

1. [GitHub Releases](https://github.com/revertable/codex-session-observatory/releases/latest)에서 Windows 포터블 ZIP을 내려받습니다.
2. 압축을 풀고 `codex-session-observatory.exe`를 실행합니다.
3. **Select JSONL**을 클릭해 세션 파일을 선택합니다.

압축 파일에는 앱, `LICENSE`, 영문·한글 안내를 담은 `README.txt`가 포함됩니다.

## 주요 기능

| 기능 | 동작 | 결과 |
| --- | --- | --- |
| Transcript | 테마, 역할 필터, 메시지 접기·펼치기로 세션을 읽습니다 | 화면의 대화 기록 |
| Capture Transcript | 현재 필터·테마·접기 상태를 반영한 대화 내용을 복사합니다 | 클립보드 텍스트 |
| Collection | 선택한 메시지를 원본 대화의 출현 순서대로 모읍니다 | **Copy All**로 클립보드 복사 |
| Export Worklog | 필터나 Collection 선택과 관계없이 전체 세션을 내보냅니다 | 구조화된 로컬 파일 |

네 기능은 서로 독립적으로 동작합니다. 메시지를 수집해도 대화 기록이나 Capture Transcript·Export Worklog에 사용되는 내용은 바뀌지 않습니다.

## 대화 기록 읽기

**Theme**에서 **Terminal Style**, **Markdown Style**, **DM Style**, **DM Style (Dark)** 중 원하는 테마를 선택합니다. 네 테마는 모두 사용자와 Codex 메시지에 강조, 목록, 링크, 코드 블록, 표 등의 공통 Markdown 표현을 적용합니다. 도구 호출·도구 결과·메타데이터는 일반 텍스트로 표시합니다.

**You**, **Codex**, **Tool calls**, **Tool results**, **Meta**로 표시할 역할을 선택합니다. 메시지 헤더를 클릭하면 본문을 접거나 펼칩니다. 메시지의 시간이 있으면 `YYYY-MM-DD HH:mm:ss` 형식의 로컬 시간으로 표시합니다.

- **Refresh**는 선택한 파일을 다시 읽습니다. 불러오는 동안 현재 대화가 유지되며, 새로고침에 실패해도 기존 대화를 볼 수 있습니다.
- Collection 토글 오른쪽의 아래쪽 화살표는 **Scroll to Bottom**입니다. 대화 아래의 **Top**은 화면 상단으로 이동합니다.
- 세션 ID가 있으면 **Copy Resume Command**로 `codex resume <session-id>`를 복사합니다.
- **loaded** 상태를 클릭하면 불러온 세션을 비우고 초기 화면으로 돌아갑니다.

참조한 ChatGPT 대화는 제목과 conversation ID로 표시합니다. 식별된 자동 제공 문맥은 사람이 작성한 요청과 구분합니다. Guardian review 세션은 전용 화면으로 표시하며, 부모 세션을 로컬에서 찾으면 **Open Parent Session**을 제공합니다. 이 검토 세션에서는 재개 명령과 Worklog 내보내기를 제공하지 않습니다.

## Capture Transcript

대화 아래의 **Capture Transcript**를 클릭하면 대화의 텍스트 표현을 클립보드에 복사합니다. 현재 역할 필터, 테마, 메시지 접기 상태를 반영하며, 접힌 메시지는 헤더만 포함합니다. Markdown 내용은 읽을 수 있는 텍스트로 복사합니다.

Collection에서 선택한 메시지는 캡처에 영향을 주지 않습니다.

## 메시지 수집하기

1. 메시지 시간 옆의 **+**를 클릭해 Collection에 담습니다. 아이콘이 **✓**로 바뀌며, 다시 클릭하면 해당 메시지를 제외합니다.
2. Collection Panel에서 선택한 메시지를 확인합니다. 첫 메시지를 담으면 패널이 자동으로 펼쳐집니다.
3. **Copy All**로 수집한 메시지를 복사합니다. **Clear**는 모든 선택을 비웁니다.

패널은 처음에 접혀 있습니다. **Theme** 바로 오른쪽의 Collection 아이콘으로 패널을 펼치거나 접습니다. 툴팁은 **Show Collection** 또는 **Hide Collection**입니다.

Collection은 필터 적용 전 원본 대화에서 메시지가 출현한 순서를 유지합니다. 선택한 시점이나 타임스탬프로 정렬하지 않습니다. 같은 메시지는 한 번만 담기며, 제외했다가 다시 담아도 원래 위치로 돌아옵니다. 패널과 **Copy All**의 순서는 같습니다.

패널은 읽기 전용입니다. Markdown을 시각적으로 렌더링하는 대신, 파싱된 메시지의 Markdown 기호·코드 fence·줄바꿈·들여쓰기를 보존한 원문 텍스트를 표시합니다. `[YOU]`, `[CODEX]`, `[TOOL]` 같은 역할 헤더와 로컬 시간은 패널과 복사 결과에 함께 포함됩니다.

필터나 테마를 바꿔도 수집 상태를 유지합니다. **Refresh**는 수집 내용·순서·선택 표시·패널 접기 상태를 유지합니다. 패널을 접거나 **Copy All**을 사용해도 선택은 남습니다. 다른 JSONL을 불러오거나 불러온 세션을 초기화하면 수집 내용이 초기화되고 패널이 접힙니다. 앱을 닫아도 수집 내용이 초기화됩니다. 수집 내용은 앱의 현재 세션 동안 유지됩니다.

## Export Worklog

**Export Worklog**를 클릭하고 상위 폴더를 선택합니다. 현재 역할 필터, 메시지 접기 상태, Collection 선택과 관계없이 전체 세션을 내보냅니다.

각 사용자 요청이 하나의 작업 단위를 시작하며, 다음 요청 전까지의 Codex 응답과 도구 활동을 함께 묶습니다. 생성되는 번들의 구조는 다음과 같습니다.

```text
<selected-parent>/
└─ codex-worklog/
   └─ YYYY-MM-DD/
      └─ HHMMSS_<source-id>/
         ├─ 000_index.md
         ├─ 001_HHMMSS.md
         ├─ 002_HHMMSS.md
         ├─ ...
         └─ manifest.json
```

`000_index.md`에는 세션 색인과 참조 대화 정보를, 번호가 붙은 Markdown 파일에는 작업 단위를 담습니다. `manifest.json`은 생성 파일을 기록하며, 같은 호환 번들을 다시 내보내면 해당 파일을 갱신합니다. 디렉터리와 파일 이름에는 로컬 시간을 사용하고, 원본 타임스탬프가 있으면 생성된 내용과 메타데이터에 유지합니다.

내보내기가 끝나면 파일 탐색기에서 번들 폴더를 엽니다.

## 앱 정보

앱은 시작할 때 GitHub Releases를 확인하고 실행 버전이 최신인지, 새 공개 릴리스가 있는지, 미공개 개발 버전인지 안내합니다.

**Visit Cosmic Horizon**은 관련 [Cosmic Horizon Archive](https://riu-salze-studio.gitbook.io/cosmic-horizon)를 엽니다.

Codex Session Observatory는 [Codex Chat Viewer](https://github.com/revertable/codex-chat-viewer)를 이어 Rust, Svelte, Tauri로 다시 구축한 데스크톱 앱입니다. 소스 빌드 방법은 [개발 안내](frontend/README.md), 자동 검증 절차는 [검증 매트릭스](docs/test-matrix.md)에 정리되어 있습니다.
