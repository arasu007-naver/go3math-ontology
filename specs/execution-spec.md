# 실행 가이드: NotebookLM 단원 콘텐츠 자동화 작업 지시 방법

- 문서 버전: v1.1 (2026-10-18, 작업 스펙 v1.7 반영: JSON 다운로드·DB 등록 제외)
- 대상 독자: 작업을 지시하는 사용자 (운영자)
- 작업 정의: [notebooklm-chapter-content-automation-spec.md](notebooklm-chapter-content-automation-spec.md) (이하 "작업 스펙")

이 문서는 사용자가 Claude에게 작업을 맡기기 전·중·후에 **직접 해야 하는 행동**을 순서대로 정리한다. Claude가 수행하는 세부 절차는 작업 스펙을 따른다.

Claude는 프롬프트를 순서대로 NotebookLM에 입력하고 응답을 기다리는 일까지만 한다. NotebookLM이 만든 JSON 파일의 다운로드와 앱(knowledge graph DB) 등록은 이 작업에 포함되지 않는다.

---

## 1단계. 실행 환경 준비 (작업 전 1회)

| # | 사용자 액션 | 확인 방법 |
|---|---|---|
| 1-1 | 콘텐츠 관리 앱을 실행한다. 저장소 루트에서 `npm --prefix web run dev` | 브라우저에서 `http://localhost:3310`이 열린다 |
| 1-2 | Chrome에서 앱에 로그인한다 | 로그인 화면(`/login`) 대신 도서 목록이 보인다 |
| 1-3 | 같은 Chrome에서 NotebookLM(`https://notebooklm.google.com`)에 로그인한다 | 노트북 목록이 보인다 |
| 1-4 | Claude in Chrome 확장을 설치·연결한다 | Claude 세션에서 브라우저 연결이 확인된다 |
| 1-5 | `localhost:3310`과 `notebooklm.google.com`에 클립보드 권한을 허용한다 (주소창 왼쪽 사이트 설정) | 권한 요청 팝업이 다시 뜨지 않는다 |

> 로그인은 Claude가 대신하지 않는다. 비밀번호 입력과 캡차는 항상 사용자가 처리한다.

## 2단계. 실행 값 확인 (작업마다)

| # | 사용자 액션 | 얻는 값 |
|---|---|---|
| 2-1 | 앱 도서 목록에서 작업할 도서의 **정확한 이름**을 확인한다 | `BOOK_TITLE` |
| 2-2 | NotebookLM에서 그 도서 전용 노트북을 열고 주소창 URL을 복사한다 (`https://notebooklm.google.com/notebook/<노트북ID>`) | `NOTEBOOKLM_URL` |
| 2-3 | 노트북에 해당 도서의 소스(PDF 등)가 들어 있는지 확인한다 | — |
| 2-4 | 앱에서 도서를 클릭해 Chapters 영역을 열고, 처리할 범위의 **첫 항목과 마지막 항목의 순번(index)**을 센다 (위에서부터 1, 2, 3…) | `START_INDEX`, `END_INDEX` |
| 2-5 | 앱 주소가 기본값(`http://localhost:3310`)과 다르면 그 주소를 적어 둔다 | `APP_URL` (선택) |

- `START_INDEX`·`END_INDEX`를 생략하면 첫 항목부터 마지막 항목까지 전체를 처리한다.
- 한 번에 너무 넓은 범위를 맡기면 NotebookLM 사용량 한도에 걸릴 수 있다. 처음에는 1~2개 chapter로 시험 실행을 권장한다.

## 3단계. 작업 지시 메시지 보내기

Claude 세션(Claude in Chrome이 연결된 세션)에 아래 템플릿을 채워 보낸다.

```
specs/notebooklm-chapter-content-automation-spec.md 스펙대로 작업을 실행하시오.

BOOK_TITLE: <도서명>
NOTEBOOKLM_URL: <노트북 URL>
START_INDEX: <시작 index>
END_INDEX: <종료 index>
APP_URL: http://localhost:3310
```

예시:
```
specs/notebooklm-chapter-content-automation-spec.md 스펙대로 작업을 실행하시오.

BOOK_TITLE: 수학Ⅰ 개념서
NOTEBOOKLM_URL: https://notebooklm.google.com/notebook/abcd1234
START_INDEX: 1
END_INDEX: 2
APP_URL: http://localhost:3310
```

| # | 사용자 액션 |
|---|---|
| 3-1 | 템플릿의 `< >` 부분을 2단계 값으로 바꾼다 |
| 3-2 | 메시지를 보낸다 |
| 3-3 | Claude가 시작 전에 보여 주는 **처리 범위(index와 chapter 제목 목록)**와 노트북 제목을 확인하고, 맞으면 진행을 승인한다 |

## 4단계. 작업 중 대응

작업 중에는 Claude가 앱 탭과 NotebookLM 탭을 오가며 진행한다. 사용자는 아래 상황에서만 개입한다.

| 상황 | Claude의 동작 | 사용자 액션 |
|---|---|---|
| 사이트 접근·도구 사용 권한 요청 | 승인을 기다린다 | 내용을 확인하고 허용한다 |
| 로그인이 풀림 / 캡차 표시 | 즉시 멈추고 알린다 | 직접 로그인하거나 캡차를 풀고 "계속"이라고 보낸다 |
| NotebookLM 사용량 한도 | 즉시 중단하고 진행 상황을 보고한다 | 한도가 풀린 뒤 6단계로 재개한다 |
| 노트북 접속 불가 (권한 없음 등) | 즉시 중단하고 보고한다 | `NOTEBOOKLM_URL`과 계정 권한을 확인하고 다시 지시한다 |

- 작업 중에는 앱 탭과 NotebookLM 탭을 **직접 클릭하거나 닫지 않는다**. 화면이 바뀌면 Claude의 확인 단계가 실패한다.
- 클립보드를 다른 용도로 쓰지 않는다 (Claude가 프롬프트를 클립보드로 옮긴다).
- 중간에 멈추게 하려면 Claude 세션에 "중단"이라고 보낸다. Claude는 멈추고 작업 스펙 §8 형식으로 진행 상황을 보고한다.

## 5단계. 완료 확인

| # | 사용자 액션 | 확인 내용 |
|---|---|---|
| 5-1 | Claude의 최종 보고를 읽는다 | 처리 범위, 유형별 성공·실패 수 |
| 5-2 | NotebookLM 노트북의 Studio 패널에서 범위 안 chapter의 결과 파일(`${bookId}-${index}-indices.json` 등)이 생겼는지 본다 | chapter마다 4개 유형의 파일이 있다 (같은 파일이 여러 개 생길 수 있다) |
| 5-3 | 응답 몇 개를 열어 내용과 페이지 번호가 교재와 맞는지 표본 검토한다 | 지어낸 내용·잘못된 페이지가 없다 |
| 5-4 | 보고서의 **실패 항목**과 원인을 확인한다 | 원인별로 6단계 재실행 여부를 정한다 |
| 5-5 | 필요하면 Studio의 결과 파일을 직접 내려받아 앱에 등록한다 (이 작업 범위 밖) | — |

## 6단계. 재개·재실행

중단되었거나 실패 항목이 있으면 Claude의 보고서에 적힌 `START_INDEX`·`END_INDEX`로 다시 지시한다.

```
specs/notebooklm-chapter-content-automation-spec.md 스펙대로 작업을 이어서 실행하시오.

BOOK_TITLE: <도서명>
NOTEBOOKLM_URL: <노트북 URL>
START_INDEX: <보고서의 재개 index>
END_INDEX: <처음 실행 때와 같은 값>
```

| # | 사용자 액션 |
|---|---|
| 6-1 | 보고서의 재개 위치를 템플릿에 넣는다 |
| 6-2 | 실패 원인이 사용량 한도면 한도가 풀린 뒤, 노트북 소스 문제면 소스를 고친 뒤 보낸다 |
| 6-3 | 재개 위치는 4개 유형을 모두 마치지 못한 첫 chapter다. 그 chapter는 개념색인부터 다시 처리된다 |

## 부록. 지시 전 체크리스트

- [ ] `http://localhost:3310` 앱 실행 및 로그인
- [ ] NotebookLM 로그인, 대상 노트북에 도서 소스 있음
- [ ] Claude in Chrome 연결
- [ ] 클립보드 권한 허용
- [ ] `BOOK_TITLE`, `NOTEBOOKLM_URL`, `START_INDEX`, `END_INDEX` 확인
