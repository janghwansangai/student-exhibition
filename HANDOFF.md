# HANDOFF — HOWHY 교육 프로그램 전시관
> 업데이트: 2026-07-18

## 프로젝트
학생 웹 앱 전시 사이트. 구글 시트를 실시간으로 읽어 갤러리(글래스모피즘) 렌더링.
배포: https://janghwansangai.github.io/student-exhibition/ (main 푸시 = 자동 배포)
로컬 확인: `.claude/launch.json`의 `exhibition` 프리뷰(포트 8787, python http.server)

## 현재 상태
- ✅ 완료: 사이트 배포·Firebase 실시간 좋아요/댓글(0부터, 중복방지)·전시 20개 중 15개 실제 스크린샷·시트 I열(문제상황)/J열(작업완료 ○) 표시
- 🔨 대기: 시트 I열의 문제 5건을 학생이 해결하면 재캡쳐 필요

## 다음 할 일 (우선순위순)
1. 시트에서 I열 문제 해결 여부 확인 → 새 링크 캡쳐 → `images/앱제목.png` 추가 → push
   (문제 5건: 찰칵풀이·트랜드캐처·STEAM융합과학=공유권한, 업스닥=링크만료, 자리배치=주소없음. 완벽한 자리 배치는 링크에 다른 앱이 나옴)
2. (장기) 학생들이 Canvas "공개 링크"로 재공유하면 로그인 없는 방문자도 앱 열람 가능해짐

## 핵심 파일
- `js/config.js` — 시트 ID·제목·Firebase 설정·소개글/URL 보정(모든 설정은 여기)
- `js/app.js` — 시트 CSV 파싱·렌더·Firestore 연동
- `firestore.rules` — 좋아요 조작/도배 방지 규칙 (수정 시 `firebase deploy --only firestore:rules`)

## 주의사항 (코드만 봐서는 모르는 것)
- **시트 셀의 하이퍼링크는 CSV로 안 나옴**(표시 텍스트만). 숨은 링크는 xlsx로 export해서 추출 → `config.js`의 URL_OVERRIDES에 보정. 뽑기 시뮬레이션·ai편집기가 이 케이스.
- **학생 Gemini 링크(`/share/d/…`)는 구글 로그인 필요.** 헤드리스 캡쳐 불가 → 선생님 크롬에서 AppleScript로 전용 창 띄워 `screencapture`(화면 기록 권한 승인됨)로 캡쳐 후 `sips -c 1510 2933 --cropOffset 307 38` + `-Z 1024` 크롭. 스크립트 예시는 삭제된 scratchpad에 있었음 — 흐름만 재현하면 됨.
- **구글 시트에 특수문자(○) 타이핑은 확장으로 입력 안 됨**(글자 씹힘). osascript로 클립보드에 싣고 범위 선택 후 Cmd+V가 유일하게 확실. `pbcopy`는 멀티라인이 실패하니 osascript `set the clipboard` 사용.
- Firebase 프로젝트 `student-gallery-2026`(서울). CLI 로그인돼 있음. apiKey는 공개돼도 안전(규칙이 방어).
- 시트 구조: I열=문제상황, J열=작업완료(○), K열부터 학생 상호평가 별점 — **K열 이후 절대 수정 금지**.
- 별점 = 방문자 좋아요 환산(2개당 별1, config LIKES_PER_STAR). 선생님평가는 정렬에만 사용, 별0=전시 제외.
