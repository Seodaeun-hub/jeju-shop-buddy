# 가게짝꿍 · 제주 소상공인 매출 대응 AI Agent

## API 연동 로컬 실행

1. 빈 개발용 PostgreSQL 데이터베이스에 `schema.sql`, `seed-jeju-areas.sql`, `seed-aewol-demo.sql` 순서로 적용합니다. 마지막 파일은 가상 매장과 개발용 로그인 정보를 제공합니다.
2. 백엔드에 `SHOP_BUDDY_DB_URL`, `SHOP_BUDDY_DB_USER`, `SHOP_BUDDY_DB_PASSWORD`를 설정하고 Java 21에서 `mvn -f backend/pom.xml spring-boot:run`을 실행합니다.
3. 저장소 루트에서 `npm --prefix frontend ci`와 `npm --prefix frontend run dev`를 실행합니다. 프론트엔드 개발 서버는 `/api` 요청을 로컬 백엔드의 8080 포트로 전달합니다.

[OpenAPI 명세](openapi-store.yaml)

## 전체 흐름 검증

개발용 계정으로 로그인하고 새 매장을 등록합니다. 월별 매출과 시간대별 결제 건수를 입력하면 분석 화면에서 저장한 값을 조회할 수 있습니다. 대응 전략의 추천 근거를 확인한 뒤 실행 계획을 생성하고 점검표 항목 하나를 완료합니다. 실행 전후 합계와 영업일 수를 입력해 결과를 저장하고, 새로고침 후 다시 로그인하여 완료 상태와 결과를 확인합니다.

애월 테스트 매장으로 위 흐름을 검증했습니다. 오후 2~5시 결제 건수 180건 → 90건을 근거로 주문 안내 점검이 추천됐습니다. 실행 결과 화면에는 하루 평균 매출 10만 원 → 15만 원(+50.00%), 하루 평균 결제 6건 → 8건(+33.33%)이 표시됐습니다. 매장부터 실행 결과까지 같은 식별자로 연결된 레코드를 PostgreSQL에서 확인했습니다.
