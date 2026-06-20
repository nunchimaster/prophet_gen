# Prophet 모델 명세서 생성기 (배포용)

보험약관 PDF를 올리면 AI가 상품 구조를 추출해 **FIS Prophet 모델 명세서 초안**(영역·변수·포뮬라·약관근거 + 체크리스트)을 만들어 주는 웹 도구입니다.
Claude가 없는 사람도 **URL만으로** 접속해 쓸 수 있습니다. (공개 약관 검증·데모용)

---

## 동작 구조

업로드한 PDF → ① 상품 핵심 사실 추출(약관 조항 포함) → ② 모델링 영역 설계 → ③ 영역별 변수·포뮬라 생성 → 명세서 출력.
브라우저가 서버(`/api/claude`)를 호출하고, **API 키는 서버에만** 있습니다(클라이언트 노출 없음).

---

## 1. 로컬 실행

```bash
npm install
cp .env.example .env.local      # ANTHROPIC_API_KEY 입력
npm run dev                     # http://localhost:3000
```

`.env.local` 항목:
- `ANTHROPIC_API_KEY` (필수) — console.anthropic.com 에서 발급
- `DEMO_PASSWORD` (선택) — 설정 시 이 암호를 입력한 사람만 분석 실행 가능
- `CLAUDE_MODEL` (선택) — 기본 `claude-sonnet-4-6`. 품질↑ 원하면 `claude-opus-4-8`

## 2. 배포 (Vercel)

1. 이 폴더를 GitHub 저장소로 push
2. vercel.com → New Project → 저장소 import
3. Settings → Environment Variables 에 `ANTHROPIC_API_KEY` (그리고 선택적으로 `DEMO_PASSWORD`, `CLAUDE_MODEL`) 등록
4. Deploy → 나온 URL을 동료에게 공유

> ⚠️ **Vercel 본문 크기 제한**: 서버리스 함수 요청 본문이 약 4.5MB로 제한됩니다.
> PDF base64는 원본보다 ~33% 커지므로, 대략 **3MB 이상 PDF나 스캔본 약관은 실패**할 수 있습니다.
> 큰 약관을 다뤄야 하면 (a) 핵심 장만 추린 PDF를 쓰거나, (b) 본문 제한이 없는 **Node 호스트(Render·Railway·자체 서버)** 에 배포하세요(`npm run build && npm start`).

## 3. 비용 · 보안

- **비용**: 분석 1회 = 영역 수만큼 API 호출(보통 10~13회)이 당신의 키로 과금됩니다. 데모라면 부담은 작지만, 공개 URL을 방치하면 누적될 수 있으니 `DEMO_PASSWORD` 설정을 권장합니다.
- **키 보안**: 키는 서버 환경변수에만 두세요. 절대 클라이언트 코드/저장소에 넣지 마세요.
- **데이터**: 업로드 문서는 분석을 위해 Anthropic API로 전송됩니다. **공개 약관 전용**으로 쓰고, 산출방법서 등 사내 기밀은 넣지 마세요(필요 시 사내망 LLM 버전으로 포팅).

## 4. 한계

- 산출물은 **초안**입니다. Prophet 문법 변환·회사 경험가정 교체·계리 검증·선임계리사 사인오프는 사람이 수행합니다.
- 가정값(요율·수익률·사업비)은 전부 **샘플**입니다.
- 결과 품질은 업로드 약관의 충실도와 모델(sonnet/opus)에 따라 달라집니다.

## 5. 사내망(폐쇄망) 포팅

핵심 엔진은 `app/page.jsx` 상단의 세 시스템 프롬프트(`FACTS_SYS`/`STRUCT_SYS`/`VAR_SYS`)입니다.
이 셋과 3단계 파이프라인(사실추출→영역설계→변수생성)을 사내 FastAPI + 승인된 LLM 엔드포인트로 옮기면, 폐쇄망에서 기밀 문서까지 동일하게 처리할 수 있습니다.
