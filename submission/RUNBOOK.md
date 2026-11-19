# 실행환경·사용자 매뉴얼

빠른 체험은 [가게짝꿍 HTTPS](https://gage-jjakkung.up.railway.app/), 촬영 순서는 [통합 README](../demo/final-recording/README.md)를 사용합니다. 기존 DB를 지우지 않습니다. 아래 설치는 **별도의 빈 평가 DB** 기준입니다.

## 구성과 준비물

React/TypeScript/Vite 화면 → Spring Boot4/Java21 API → PostgreSQL, Python3.11+/FastAPI/LangGraph Agent → 외부 OpenAI API입니다. Node22, npm, Java21, Maven3.9+, Python3.11+, PostgreSQL과 psql을 준비합니다. 인터넷·API 키가 필요하며 로컬 GPU에 LLM을 올리지 않습니다. 센터 제시 사양에서의 새 설치·실행은 아직 미검증입니다.

1. ZIP에서는 `01_실행소스`, GitHub에서 받은 소스에서는 `schema.sql`이 있는 저장소 루트로 이동합니다. PostgreSQL 관리자로 `createuser -U postgres -P shopbuddy_eval`, `createdb -U postgres -O shopbuddy_eval shopbuddy_eval`을 실행합니다. 비밀번호는 새로 정하고 실제 값은 문서에 적지 않습니다.
2. 빈 DB에 다음 파일을 순서대로 적용합니다. 파일당 `psql -h 127.0.0.1 -U shopbuddy_eval -d shopbuddy_eval -v ON_ERROR_STOP=1 -f 파일명`을 사용합니다: `schema.sql`, `migration-store-reviews.sql`, `migration-chart-questions.sql`, `migration-rehearsal-date.sql`, `migration-execution-outcome.sql`, `seed-jeju-areas.sql`. Railway와 같은 빈 DB 초기화 대상 목록입니다. 다른 환경의 개발용 seed·실제 매장 덤프는 넣지 않습니다.
3. 별도 셸에서 `cd agent`, `python -m venv .venv`, `.venv\Scripts\python.exe -m pip install -r requirements.txt`를 실행합니다. Agent 셸에 `STRATEGY_AI_API_KEY`를 환경변수로 설정하고 `.venv\Scripts\python.exe -m uvicorn strategy_agent.api:app --host 127.0.0.1 --port 8001`로 실행합니다. Linux/macOS는 `.venv/bin/python` 경로를 사용합니다.
4. 백엔드 셸에 `SHOP_BUDDY_DB_URL=jdbc:postgresql://127.0.0.1:5432/shopbuddy_eval`, `SHOP_BUDDY_DB_USER=shopbuddy_eval`, `SHOP_BUDDY_DB_PASSWORD=직접_정한_DB비밀번호`, `STRATEGY_AGENT_URL=http://127.0.0.1:8001`을 환경변수로 설정합니다. `mvn -f backend/pom.xml spring-boot:run`을 실행합니다. 예시 `.env` 파일은 자동으로 로드되지 않으므로 실제 셸이나 배포 서비스에 설정합니다.
5. 세 번째 셸에서 `npm --prefix frontend ci`, `npm --prefix frontend run dev -- --host 127.0.0.1`을 실행하고 출력된 로컬 주소를 엽니다. Vite가 `/api`를 localhost:8080으로 전달합니다.
6. 새 평가 계정을 직접 회원가입하고 매장을 등록합니다. 촬영 자료의 CSV 네 개·메뉴 사진·재료표를 순서대로 입력합니다. 실제 서비스 계정 비밀번호는 포함하지 않습니다.

Windows PowerShell 환경변수는 `$env:변수명='값'`, POSIX 셸은 `export 변수명='값'`으로 설정합니다. AI 키 입력은 키 값을 명령 기록에 직접 적지 않는 방식으로 진행합니다. 전체 변수 예시는 같은 폴더의 `environment.example`입니다.

## 외부 연동

| 기능 | 서버 설정 / 발급처 |
|---|---|
| AI 질문·전략·번역·홍보·영수증·아이폰 전사 | Agent: `STRATEGY_AI_API_KEY` 또는 `OPENAI_API_KEY`. [OpenAI API 플랫폼](https://platform.openai.com/)에서 평가용 키·사용 가능 모델·비용 한도 준비 |
| 네이버 매장명 검색 | Web: `NAVER_LOCAL_SEARCH_CLIENT_ID`, `NAVER_LOCAL_SEARCH_CLIENT_SECRET`. [네이버 개발자센터](https://developers.naver.com/) 검색 API 등록 |
| 주소 좌표 변환 | Web: `NAVER_MAPS_CLIENT_ID`, `NAVER_MAPS_CLIENT_SECRET`. [네이버 클라우드](https://www.ncloud.com/) Maps Geocoding 사용 설정 |
| 과거 강수 관측 | Web: `KMA_ASOS_SERVICE_KEY`. [공공데이터포털](https://www.data.go.kr/) 기상청 ASOS 일자료 API 활용 신청 |
| 현재·미래 예보 | Web: `KMA_FORECAST_SERVICE_KEY`. 단기예보 API 승인 키 |
| 토스포스 | Web: `SHOP_BUDDY_TOSS_ACCESS_KEY`, `SHOP_BUDDY_TOSS_ACCESS_SECRET`. 권한 있는 테스트 가맹점 키만 별도 설정. 이번2021년 본편에는 불필요 |

공개 QR·마이크·사진 다운로드의 실제 아이폰 검증은 HTTPS 배포 주소에서 진행합니다. 로컬 PC의 localhost 주소를 아이폰에 그대로 열면 PC 서비스에 접속하는 것이 아닙니다. Railway 운영 방식은 소스 루트의 [배포 안내](../deploy/railway.md)를 참조합니다.

## 오류·제약

- AI 키/Agent 누락: AI 기능이 실패·자료 확인 필요로 표시될 수 있습니다. POS 집계·내장 상권 조회와 AI 성공을 구분합니다.
- 지도/기상청 키 누락: 좌표·강수 조회에 실패할 수 있습니다. 같은 요일 범위를 쓴 결과를 날씨 기반 예측이라고 설명하지 않습니다.
- API 과금·쿼터·외부 검색 결과 변경에 따라 지연/실패가 가능합니다. 과거 후기 검색도 당시 자료의 존재·원문 확인이 필요합니다.
- QR은 공개 ID와 현재 호스트로 생성됩니다. 매장 삭제·공개 중지 시 닫힙니다. 저장·인쇄한 옛 주소 QR은 새 QR로 교체합니다.
- 자동 SNS 게시·외부 발주 주문은 수행하지 않습니다. 문구·사진·번역·발주 수량은 사용자가 확인합니다.
- 최종 심사위원용 ZIP은 같은 PC의 별도 추출 폴더·새 가상환경·독립 DB에서 설치와 주요 기능을 검증했습니다. 새 PC·센터 PC의 초기 환경 설치는 아직 검증하지 않았습니다. [제출 기록](README.md)에서 확인 범위를 볼 수 있습니다.

검증 명령(소스 루트): `python demo/the-aewol-june-rehearsal/validate_demo.py`, `python demo/the-aewol-june-rehearsal/validate_follow_up.py`, `npm --prefix frontend run verify:home`. 프런트 빌드: `npm --prefix frontend run build`. Agent 계약 테스트: `cd agent` 후 `.venv\Scripts\python.exe -m unittest discover -s tests`. 라이브 API 검증과 모형 응답 테스트를 구분합니다.
