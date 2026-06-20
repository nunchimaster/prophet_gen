# prophet_gen — Prophet 모델 명세서 생성기

보험약관 PDF를 읽어 **FIS Prophet 계리모델링용 모델 명세서 초안**(모델링 영역, 변수명·타입·의미·Prophet pseudo-code 포뮬라, 약관 조항 근거, 체크리스트, K-IFRS17 BEL·RA·CSM)을 만드는 도구입니다.

> 산출물은 *계산*이 아니라 *설계도*입니다. Prophet 문법 변환·회사 경험가정 교체·계리 검증·선임계리사 사인오프는 사람이 수행합니다. 공개 약관 검증·데모 용도입니다.

## 구성

| 경로 | 설명 |
|---|---|
| `prophet-model-spec.skill` | **설치용 스킬 파일.** Claude에 설치하면 약관 PDF로 명세서를 생성. (references 포함, 단독으로 완전) |
| `prophet-model-spec/` | 스킬 소스 — 읽기·수정용 (`SKILL.md` + `references/`) |
| `prophet-spec-app/` | Claude 없이 **URL로** 쓰는 웹앱 (선택). 배포·실행법은 폴더 안 README 참고 |

## 빠른 시작

### A. 스킬로 쓰기 (Claude 사용자)
1. `prophet-model-spec.skill` 다운로드
2. Claude에 스킬로 설치 (제품별 메뉴: Claude Code/Cowork는 스킬 디렉터리, claude.ai Team/Enterprise는 설정의 Skills)
3. 약관 PDF를 올리고 "이 약관으로 Prophet 모델 명세서 만들어줘" 라고 요청

### B. 웹앱으로 쓰기 (Claude 없는 사람도)
`prophet-spec-app/README.md` 참고 — Anthropic API 키를 서버에 넣고 배포하면 URL로 누구나 접속.

## 산출물

- **md/화면 전문**: 추출된 상품 사실 → 영역별 변수표 → 컨벤션 → **가정 사항 명세(Assumptions Log)** → 경고. 요약·생략 없이 전부 출력.
- **docx**: `prophet-model-spec/scripts/docx_builder.py`(데이터 주도형 빌더)로 생성. `spec.json`만 만들면 한글 폰트·표지·샘플 자동 강조가 들어간 docx를 만듭니다. 사용법은 스크립트 상단 docstring 참조. (`pip install python-docx`)
- **가정 사항 명세**: 가정한 모든 항목을 ⓐ 샘플 가정값 / ⓑ 구조 근사 / ⓒ 문서·데이터 부재 3분류로 추적 기록 — 변수표의 샘플 주석과 1:1 대응.

## 주의

- 가정값(요율·수익률·사업비)은 전부 **샘플**입니다. 회사 경험자료로 교체 후 검증하세요.
- 입력 문서는 분석을 위해 Anthropic API로 전송됩니다 → **공개 약관 전용**. 산출방법서 등 기밀은 사내망 버전으로 처리하세요.
