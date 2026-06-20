# 예시 명세서 (형식·품질 기준)

아래는 암보험(갱신형) 명세서의 일부 발췌다. 출력의 **형식·디테일 수준·약관 인용 방식**을 이 예시에 맞춘다. (실제 출력은 모든 영역을 포함해야 함.)

---

## 추출된 상품 사실 (약관 검증용)

삼성 New올인원 암보험(2404) · 30년 갱신형 · 무배당 · 순수보장성 · 전기납·월납. 주계약: 일반암 진단급부금(가입금액 기준). 의무부가 특약: 암사망, 소액질병보장(갑상선·제자리·경계성). 선택 특약: 암수술비(수술 1회당 정액), 암입원일당(입원 1일당). 암 보장개시 90일 면책, 부활 시 부활일로부터 90일 경과 후 익일 보장(사업방법서 §13.가.(4)). 가입나이 30년갱신 남 15~59세, 여 15~60세. 갱신형이므로 최초계약만 투사.

## 1. 입력

| 변수명 | 타입 | 의미 | 포뮬라 |
|---|---|---|---|
| `SEX` | Status | 성별. 사망률·위험률 테이블 차원. | `Input {M, F}` |
| `AGE_AT_ENTRY` | Input | 가입나이(세). 만 나이. | `Input Integer` |
| `SA_BASE_CANCER` | Input | 주보험 일반암 진단비 가입금액. 샘플 1,000만원. | `Input Numeric` |
| `GROSS_PREMIUM_MONTHLY` | Input | 월 영업보험료(솔브값 입력). Equivalence+로딩으로 사전 솔브. | `Input Numeric` |

## 3. 감소율 (유지·사망·해약)

| 변수명 | 타입 | 의미 | 포뮬라 |
|---|---|---|---|
| `MORTALITY_MONTHLY_T` | MS (시점) | 월 사망률. 연→월 정확식. | `1 - (1 - MORTALITY_ANNUAL_T)^(1/12)` |
| `INFORCE_AVG_T` | MS (시점) | 월중 평균 유지율. 급부 스케일링 기준. | `INFORCE_START_T * (1 - (MORTALITY_MONTHLY_T + LAPSE_MONTHLY_T) / 2)` |
| `INFORCE_END_T` | MS (시점) | 월말 유지율. 다음 월초로 이월. | `INFORCE_START_T * (1 - MORTALITY_MONTHLY_T - LAPSE_MONTHLY_T)` |

## 4. 급부 지급

| 변수명 | 타입 | 의미 | 포뮬라 |
|---|---|---|---|
| `WAITING_PASSED_T` | MS (시점) | 면책 경과 플래그. 90일≈3개월. 모든 암담보에 공통 곱. | `IF(t > WAITING_MONTHS, 1, 0)` |
| `BENEFIT_BASE_CANCER_T` | MS (시점) | 주보험 암진단비 월 기대지급. | `WAITING_PASSED_T * INCIDENCE_CANCER_MONTHLY_T * SA_BASE_CANCER * INFORCE_AVG_T` |
| `BENEFIT_TOTAL_T` | MS (시점) | 총 지급보험금. 선택특약 없으면 해당 항 0으로 자동 배제. | `BENEFIT_BASE_CANCER_T + BENEFIT_CANCER_DEATH_T + BENEFIT_SMALL_CANCER_T + BENEFIT_CANCER_SURGERY_T + BENEFIT_CANCER_HOSP_T` |

## (마지막) K-IFRS 17 (BEL · RA · CSM)

| 변수명 | 타입 | 의미 | 포뮬라 |
|---|---|---|---|
| `BEL_AT_ISSUE` | Numeric (집계) | BEL 초기인식. 음수면 이익 방향. | `PV_BENEFIT + PV_EXPENSE + PV_SURRENDER - PV_PREMIUM` |
| `RA_AT_ISSUE` | Numeric (집계) | RA 초기인식. 위험률+20%, 해약률-20% BEL 증가분 평균. 75% 신뢰수준 가정. | `(MAX(0, BEL_SHOCK_INCIDENCE_UP - BEL_AT_ISSUE) + MAX(0, BEL_SHOCK_LAPSE_DOWN - BEL_AT_ISSUE)) / 2` |
| `CSM_AT_ISSUE` | Numeric (집계) | CSM 초기인식. 음수 FCF를 양수 CSM으로. | `MAX(0, -FCF_AT_ISSUE)` |
| `CSM_RELEASE_T` | MS (시점) | CSM 당월 릴리스. Accretion 후 CU 비율 안분. | `IF(CU_REMAINING_T > 0, (CSM_START_T + CSM_ACCRETION_T) * CU_T / CU_REMAINING_T, 0)` |

---

**포뮬라 컨벤션** · PREVIOUS(var), TABLE("id", key…), SUM(expr), SUM_FROM_T(expr), IF(cond, a, b), MAX/MIN, FLOOR. t = 월 인덱스(0-based).

※ 가정 테이블·요율 값은 샘플입니다. 회사 경험자료·산출방법서로 교체 후 검증 필수. AI 초안이며 선임계리사 검증·거버넌스를 대체하지 않습니다.
