# Codex Session Observatory

[![최신 릴리스](https://img.shields.io/github/v/release/revertable/codex-session-observatory?display_name=tag&label=release)](https://github.com/revertable/codex-session-observatory/releases/latest)

**언어:** [English](README.md) | 한국어

Codex Session Observatory는 로컬 Codex 세션 기록을 탐색하고 읽는 Windows 데스크톱 도구입니다. 대화를 살펴보고, 필요한 메시지를 모으고, 현재 표현을 복사하거나 전체 세션을 구조화된 Worklog로 내보냅니다. 일반 `.jsonl`과 압축 `.jsonl.zst`를 로컬에서 처리하며 원본을 다시 쓰지 않습니다.

## 개발 철학

저는 이 도구를 독립적으로 개발하고 유지보수하는 1인 개발자입니다. 개인 프로젝트이자 제가 실제 Codex 작업에서 지속적으로 사용하는 도구이기도 합니다. 개발은 **Validation-first** 원칙을 따릅니다. 실사용에서 필요성이 확인된 기능을 반영하고, 발견한 문제는 조사와 검증을 거쳐 개선합니다.

기능의 수보다 실제 사용 가치, 정확성, 원본 기록의 보존을 중요하게 생각합니다. 메시지의 순서와 맥락을 유지하면서 사용자가 읽고 수집하고 활용할 기록을 직접 선택하도록 돕고자 합니다.

## 시작하기

1. [GitHub Releases](https://github.com/revertable/codex-session-observatory/releases/latest)에서 Windows x64 포터블 ZIP을 내려받습니다.
2. 압축을 풀고 `codex-session-observatory.exe`를 실행합니다.
3. **Sessions**에서 세션을 선택해 **Transcript**에 불러옵니다. 다시 활용할 메시지는 **Collection**에 담습니다.

`CODEX_HOME/sessions`에서 세션을 조회하며, `CODEX_HOME`이 없으면 `%USERPROFILE%\.codex\sessions`를 사용합니다. ZIP에는 EXE, `LICENSE`, 영문·한국어 `README.txt`가 포함됩니다. Windows에 설치된 Microsoft Edge WebView2 런타임을 사용하며, 설치 프로그램이나 자동 업데이트 기능은 포함하지 않습니다.

## 세션 탐색과 대화 읽기

작업 공간은 **Sessions / Transcript / Collection**으로 구성됩니다. Sessions와 Collection은 각각 숨기거나 열 수 있고, 경계를 조절해 너비를 바꿀 수 있습니다. 세 패널은 독립적으로 스크롤하며 각자의 Top/Bottom 컨트롤을 제공합니다.

- **Flat**: 세션의 최초 생성 시각이 최신인 순서로 표시하며, 스크롤하면 다음 항목을 불러옵니다.
- **Hierarchical**: 실제 연도·월·날짜 폴더 구조를 따릅니다. 해당 폴더 밖의 세션도 별도 그룹에서 찾을 수 있습니다.

두 모드는 같은 일반·ChatGPT Handoff 세션 목록을 사용합니다. Archived 세션과 Guardian review 세션은 이 목록에서 제외합니다. 제목은 현재 기기에서 확인할 수 있는 메타데이터를 사용합니다. 제목 정보가 없으면 **Untitled Session**과 정보 툴팁으로 표시합니다. 최근 대화 활동은 제목 강조에만 사용하며 목록 순서를 바꾸지 않습니다.

세션을 선택하면 Transcript에 불러옵니다. 항목을 우클릭하면 **Open**, **Open Containing Folder**, **Export Worklog**를 사용할 수 있습니다. 폴더 열기와 선택하지 않은 세션의 내보내기는 현재 Transcript와 Collection을 유지합니다.

**Style**에서 **Terminal Style**, **Markdown Style**, **DM Style**, **DM Style (Dark)**를 선택하고, **Filters**로 표시할 역할을 정합니다. 사용자·Codex 메시지는 Markdown 강조, 목록, 링크, 코드와 표를 공통으로 표현하고 도구 활동·메타데이터는 일반 텍스트로 표시합니다. 메시지 헤더를 클릭하면 본문을 접거나 펼칩니다. 시간이 있으면 로컬 시간으로 표시합니다.

**Text**와 **Code**는 Windows에 설치된 글꼴을 각각 독립적으로 선택합니다. Default는 기존 앱의 글꼴 규칙을 유지합니다. 선택은 현재 기기에 저장되며, 지원하지 않는 문자의 대체 표시는 글꼴과 시스템에 따라 달라집니다. Code에 가변폭 글꼴을 선택하면 공백 기반 정렬이 달라질 수 있습니다.

## 수집·복사·내보내기

작업 중 다음 방향을 판단하기 위해 기존 대화의 맥락을 다른 AI에도 전달할 때가 있습니다. 제가 제시한 목표와 참고 자료, 지시사항부터 AI의 답변과 지금까지의 진행 상황까지, 필요한 내용을 다시 전달하려면 메시지를 하나씩 찾아 복사해야 했습니다.

Collection은 제가 실제 작업에서 겪은 이 번거로움을 줄이기 위해 만들었습니다. 필요한 메시지를 골라 **Copy All**을 누르면 한 번에 복사해 새 프롬프트의 참고 자료로 활용할 수 있습니다.

| 작업 | 결과 |
| --- | --- |
| Transcript 헤더의 **Capture Transcript** | 현재 필터·테마·접기 상태에 따른 대화의 텍스트 표현을 복사합니다 |
| 메시지 **+ / ✓**와 Collection **Copy All** | 선택 당시 메시지를 모아 원본 출현 순서로 복사합니다 |
| **Resume command** 복사 컨트롤 | 세션 ID가 있으면 Codex에서 사용할 `codex resume <session-id>` 명령을 복사합니다 |
| 툴바 또는 세션 우클릭 메뉴의 **Export Worklog** | 필터·접기 상태·Collection과 관계없이 원본 세션 전체를 내보냅니다 |

수집한 메시지는 원본 대화 순서로 정렬되며, 역할 헤더와 제공되는 로컬 시간, Markdown 기호·코드 fence·줄바꿈·들여쓰기를 보존합니다. **Copy All**은 선택을 유지하고, **Clear**는 비웁니다.

Worklog는 각 사용자 요청부터 다음 요청 전까지의 Codex 응답·도구 활동을 하나의 작업 단위로 묶습니다. `codex-worklog/YYYY-MM-DD/HHMMSS_<source-id>/`에 `000_index.md`, 번호가 붙은 Markdown 작업 단위, `manifest.json`을 생성한 뒤 파일 탐색기에서 폴더를 엽니다. 기존 번들의 갱신은 호환성 및 덮어쓰기 보호 규칙을 따릅니다.

## Refresh와 세션 상태

**Reload Sessions**는 Navigator 목록 스냅샷을 갱신하며 현재 Transcript와 Collection은 유지합니다. Flat/Hierarchical 모드를 바꿔도 현재 세션은 바뀌지 않습니다.

앱 상단과 Transcript 헤더의 **Refresh**는 현재 세션을 다시 읽습니다. 로딩 중이나 새로고침 실패 후에도 마지막으로 성공한 대화를 유지합니다. Collection의 수집 당시 원문·출현 순서·패널 상태는 Refresh, 필터, 테마 변경 후에도 남습니다. 패널을 숨겨도 상태를 유지합니다.

**Loaded** 배지는 상태를 표시하며, 옆의 **X**가 불러온 세션을 초기화합니다. 다른 세션 선택 또는 초기화 시 Collection이 비워지고 패널이 닫힙니다. 앱 종료 시에도 Collection은 초기화됩니다. 공통 **Status** 행은 작업 결과·진행·경고·오류를 표시합니다.

## 로컬 처리와 프로젝트 정보

세션 내용은 로컬에서 처리합니다. 시작 시 선택적인 GitHub Releases 확인으로 최신 공개 버전이나 미공개 개발 버전을 안내할 수 있으며, 세션 내용·선택 경로·세션 ID를 전송하지 않습니다. 업데이트를 내려받거나 설치하지 않습니다. 외부 링크는 사용자가 직접 선택할 때 엽니다.

관련 관측 접근 방식은 [Cosmic Horizon Archive](https://riu-salze-studio.gitbook.io/cosmic-horizon)에서 볼 수 있습니다. 이 프로젝트는 [Codex Chat Viewer](https://github.com/revertable/codex-chat-viewer)를 이어 Rust, Svelte, Tauri로 다시 구축했습니다.

소스 빌드와 구조는 [개발 안내](frontend/README.md), 검증은 [테스트 매트릭스](docs/test-matrix.md)를 참조하세요. 버전별 변경 사항은 [GitHub Releases](https://github.com/revertable/codex-session-observatory/releases)에 정리합니다.
