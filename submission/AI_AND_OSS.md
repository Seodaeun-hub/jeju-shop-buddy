# 사용 AI·외부 코드·오픈소스

## 사용 모델과 AI 활용 범위

아래는 제출 소스의 기본 설정입니다. 실제 배포 환경변수로 바꿀 수 있으며 모델의 내부 개정 버전까지 고정했다는 뜻은 아닙니다.

| 기능 | 소스에 지정한 모델 / 위치 |
|---|---|
| 전략·매출 질문·번역 등 구조화 응답 | `gpt-4.1-mini`, `STRATEGY_AI_MODEL`, `agent/strategy_agent/model.py` |
| 공개 후기·지역 소식 검색 | `gpt-4.1-mini`, `PROMOTION_SEARCH_MODEL`, `promotion_reviews.py`, `promotion_channels.py` |
| 세 채널 문구 작성 | `gpt-5.4-mini`, `PROMOTION_COPY_MODEL`, `promotion_channels.py` |
| 영수증 읽기 | `gpt-4.1-mini`, `RECEIPT_AI_MODEL`, `receipt.py` |
| 아이폰 녹음 전사 | 소스의 `gpt-transcribe`, `question_transcription.py`. 평가 계정의 모델 접근 권한 확인 필요 |
| PC 실시간 음성 입력 | 브라우저 음성 인식 API. 브라우저·서비스 지원에 의존 |
| 예시 음식 이미지 | 이 프로젝트의 image_gen 도구로 생성. 전달된 메타데이터에 정확한 이미지 모델 식별자는 없어 임의로 모델명을 단정하지 않음. 생성 프롬프트를 촬영 묶음에 포함 |
| 개발·문서 보조 | Codex/ChatGPT를 코드 작성·수정·검증 보조·문서 초안·이미지 생성에 활용. 최종 수치·동작·표현을 검토. 세션 전체의 정확한 모델 식별자를 임의로 기재하지 않음 |

모델은 서버가 제공한 저장 수치·출처·허용 행동 범위 안에서 답변/제안합니다. 메뉴·시간대 집계와 재료 수지는 결정적 코드로 계산하고 AI 답변의 근거 ID를 검증합니다. 외부 발주·SNS 게시를 자율 수행하지 않습니다. 사장님이 수량·문구·번역·공개를 확인합니다.

RAG는 `execution_guide.py`에서 활성 문서를 업종·전략·채널·이용 조건으로 거르고 키워드 겹침 점수로 조각을 검색한 후 출처 ID와 안내 단계를 구성합니다. 벡터 DB·임베딩 검색을 구현했다고 설명하지 않습니다. 공개 후기는 별도의 실시간 검색·원문 확인 경로입니다.

## 주요 라이브러리와 고지

| 영역 | 주요 라이브러리 | 버전 근거·고지 |
|---|---|---|
| 화면 | React/ReactDOM19.3.1, React Router7.18.5, Vite7.3.7 | `frontend/package-lock.json`의 설치 해석 버전, MIT |
| 화면 도구 | TypeScript5.9.3 / qrcode.react4.2.0 / read-excel-file9.3.12 | Apache-2.0 / ISC / MIT, npm 잠금 파일 포함 |
| 글꼴 | 제주고딕·제주명조, Noto Sans SC/JP | 제주 글꼴 OFL 원문 포함. Noto 패키지 OFL-1.1, 원 패키지 고지 유지 |
| 서버 | Spring Boot4.0.9, Spring Security/JDBC, PostgreSQL 드라이버, Jackson | `backend/pom.xml` 및 Maven 전이 의존성 참조. 각 패키지 라이선스·NOTICE 유지 |
| CSV/Excel/Push | Commons CSV1.14.1, Apache POI6.0.0, com.interaso webpush1.3.0 | POM 포함. 전이 라이브러리까지 단일 라이선스로 묶지 않음 |
| Agent | FastAPI, httpx, LangChain OpenAI, LangGraph, Pydantic, Uvicorn 및 OpenAI SDK 전이 의존성 | `agent/requirements.txt`의 범위 기반 의존성. 특정 설치 환경의 정확 버전과 배포 버전이 같다고 단정하지 않음 |

이 문서는 전체 전이 의존성에 대한 법적 검토 완료 선언이 아닙니다. 배포/설치 때 사용하는 원 패키지의 LICENSE·NOTICE를 유지합니다. 오픈소스 라이브러리를 직접 개발했다고 표시하지 않습니다. 계정·DB·API·제3자 원문 저작권이 대회 규정만으로 자유롭게 이전된다고 해석하지 않습니다.

외부 API 목록과 설정은 RUNBOOK, 외부 데이터와 이용조건은 DATA_SPEC에 있습니다. 공식 규칙의 평가용 외부 AI 키 예외를 제외한 실제 키는 ZIP에 넣지 않습니다.
