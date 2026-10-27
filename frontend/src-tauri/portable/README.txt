Codex Session Observatory 2.1.0 - Portable Windows Build
=====================================================

English
-------

Extract the ZIP, then run codex-session-observatory.exe on Windows x64.
The app uses the Microsoft Edge WebView2 runtime installed on Windows.
Choose a local Codex session in Sessions to open its Transcript.
Sessions reads CODEX_HOME/sessions, or %USERPROFILE%\.codex\sessions by default.

- Sessions: browse Flat or Hierarchical; Reload Sessions refreshes the list.
  Your view choice is saved on this device and restored when the app reopens.
  Right-click a session to open it, open its folder, or export its Worklog.
- Workspace: independently hide or resize Sessions and Collection. Each panel
  scrolls separately and has its own Top/Bottom controls.
- Style: choose a theme and installed Text/Code fonts. Default keeps existing
  font rules. Filters controls visible roles; click message headers to collapse.
- Capture Transcript: the Transcript header icon copies the current text view.
- Collection: +/check controls select messages; Copy All uses source order.
  Refresh keeps snapshots; another session, Reset, or exiting clears them.
- Resume command: copy the command for use in Codex; this app does not run it.
- Export Worklog: the toolbar or session menu exports the complete source,
  independently of filters and Collection. Select a parent output folder.
- Loaded is a status badge. The adjacent X resets the selected session.

Session records are processed locally and left unchanged. Collection is not
permanent storage or a backup. No Codex usage or remaining-limit dashboard is
provided. Startup can check GitHub for a public release; updates are not
installed automatically. This build is unsigned; Windows may show a publisher
warning. The ZIP contains the EXE, LICENSE, and this bilingual README.

Official releases:
https://github.com/revertable/codex-session-observatory/releases


한국어
------

Windows x64에서 ZIP을 풀고 codex-session-observatory.exe를 실행하세요.
Windows에 설치된 Microsoft Edge WebView2 런타임을 사용합니다.
Sessions에서 로컬 Codex 세션을 선택하면 Transcript에 불러옵니다.
CODEX_HOME/sessions 또는 기본 %USERPROFILE%\.codex\sessions를 조회합니다.

- Sessions: Flat/Hierarchical로 탐색하고 Reload Sessions로 목록을 갱신합니다.
  보기 선택은 현재 기기에 저장되며 앱을 다시 열면 복원합니다.
  세션 우클릭 메뉴에서 열기, 폴더 열기, Worklog 내보내기를 제공합니다.
- 작업 공간: Sessions와 Collection을 각각 숨기거나 너비를 조절합니다.
  각 패널은 독립적으로 스크롤하며 Top/Bottom 컨트롤을 제공합니다.
- Style: 테마와 설치된 Text/Code 글꼴을 고릅니다. Default는 기존 규칙입니다.
  Filters로 역할을 정하고 메시지 헤더를 클릭해 본문을 접습니다.
- Capture Transcript: Transcript 헤더 아이콘으로 현재 표현을 복사합니다.
- Collection: +/체크 컨트롤로 담고 Copy All로 원본 순서대로 복사합니다.
  Refresh는 수집 당시 원문을 유지합니다. 다른 세션, Reset, 앱 종료 시 비웁니다.
- Resume command: Codex에서 사용할 명령을 복사합니다. 앱이 실행하지 않습니다.
- Export Worklog: 툴바 또는 세션 메뉴에서 필터·Collection과 관계없이
  원본 세션 전체를 내보냅니다. 출력 상위 폴더를 선택하세요.
- Loaded는 상태 배지이며 옆의 X가 선택한 세션을 초기화합니다.

세션 기록은 로컬에서 처리하며 원본은 변경하지 않습니다. Collection은
영구 저장소나 백업이 아닙니다. Codex 사용량·잔여 한도 대시보드는 제공하지
않습니다. 시작 시 GitHub 공개 릴리스를 확인할 수 있으나 자동 설치하지
않습니다. 서명되지 않은 빌드이므로 Windows에서 게시자 경고가 표시될 수
있습니다. ZIP에는 EXE, LICENSE, 이 영문·한국어 README가 포함됩니다.

공식 릴리스:
https://github.com/revertable/codex-session-observatory/releases
