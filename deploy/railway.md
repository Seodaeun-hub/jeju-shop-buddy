# Railway 시연 환경

Railway 프로젝트 한 개에 `Web`, `Agent`, `Postgres` 서비스를 둡니다. `Web`이 화면과 API를 같은 HTTPS 주소로 제공하고, Agent와 PostgreSQL은 프로젝트 내부 주소로 연결합니다.

1. Railway에서 GitHub로 로그인합니다. **New Project → Empty Project**를 선택하고 **+ New → Database → Add PostgreSQL**을 누릅니다. DB 서비스 이름은 `Postgres`로 둡니다.
2. **+ New → Empty Service**를 두 번 선택해 `Agent`와 `Web`을 만듭니다. 각 서비스의 **Settings → Source → Connect Repo**에서 `Seodaeun-hub/jeju-shop-buddy`를 연결합니다. 저장소가 안 보이면 Railway GitHub 앱에 이 저장소 접근을 허용합니다. 두 서비스의 배포 브랜치를 `main`으로 지정합니다.
3. `Agent`의 **Settings → Source → Root Directory**를 `/agent`로 설정합니다. **Variables**에서 `STRATEGY_AI_API_KEY`를 설정한 뒤 **Deploy**를 누릅니다.
4. `Web`은 저장소 루트에서 빌드합니다. **Variables → Raw Editor**에 아래 내용을 넣고 이름이 다른 서비스가 있다면 해당 참조 이름을 바꿉니다.

   ```dotenv
   PGHOST=${{Postgres.PGHOST}}
   PGPORT=${{Postgres.PGPORT}}
   PGDATABASE=${{Postgres.PGDATABASE}}
   PGUSER=${{Postgres.PGUSER}}
   PGPASSWORD=${{Postgres.PGPASSWORD}}
   STRATEGY_AGENT_URL=http://${{Agent.RAILWAY_PRIVATE_DOMAIN}}:8001
   ```

5. `Web`의 **Settings → Deploy**에서 상태 확인 경로를 `/`로 지정하고 **Deploy**를 누릅니다. 로그에서 Spring Boot가 시작된 것을 확인한 뒤 **Settings → Networking → Public Networking → Generate Domain**을 선택합니다.
6. 생성된 HTTPS 주소에서 회원가입·로그인하고 시연 매장과 POS 자료를 등록합니다. 같은 주소에서 `/login`과 저장된 매출 분석 링크를 직접 열어도 화면이 표시되어야 합니다. 공개한 QR 메뉴판은 동일한 HTTPS 호스트를 사용합니다.

`Web`은 새 시연 DB에 초기 스키마와 제주 행정구역을 등록합니다. 새 DB를 사용하고, 기존 로컬 개발 DB에 이 시작 스크립트를 실행해 마이그레이션을 대신하지 마세요. 시연 계정은 배포된 주소에서 새로 만들면 됩니다.

토스포스·기상청·푸시는 필요할 때 `Web`에 각 서버 변수를 별도로 설정합니다. `Agent`의 AI API 키와 토스포스 키는 Railway 변수에 설정합니다.

### 발주 검토의 날씨 설정

과거 발주 시연에는 `Web → Variables`에 `KMA_ASOS_SERVICE_KEY`를 등록하고 배포합니다. 기상청 종관기상관측(ASOS) 일자료 API 사용이 승인된 키를 사용합니다. 현재·미래의 단기예보도 사용하려면 `KMA_FORECAST_SERVICE_KEY`를 별도로 등록합니다. 키 값은 문서나 저장소에 포함하지 않습니다.

날씨 조회는 매장 주소를 좌표로 바꾸므로 `Web`의 `NAVER_MAPS_CLIENT_ID`와 `NAVER_MAPS_CLIENT_SECRET`도 필요합니다. 네이버 장소 검색용 `NAVER_LOCAL_SEARCH_CLIENT_ID`·`NAVER_LOCAL_SEARCH_CLIENT_SECRET`과 구분합니다. 가상 매장도 실제로 조회되는 도로명 주소를 등록하면 주변 관측소의 과거 날씨를 사용할 수 있습니다.

발주 화면에 **기상청 강수 관측을 확인할 수 없어 같은 요일의 판매 범위를 참고했어요**가 보이면 주소 좌표 조회와 기상청 관측 키 설정을 확인합니다. 인증 변수를 추가한 뒤에는 `Web`을 다시 배포하고 **예상 판매량 보기**를 눌러 재조회합니다. 관측을 못 가져온 동안에는 날씨를 반영한 범위로 표시하지 않고 같은 요일 POS 범위를 안내합니다.

- [Railway 서비스와 저장소 연결](https://docs.railway.com/services)
- [Railway PostgreSQL 설정](https://docs.railway.com/databases/postgresql)
- [Railway HTTPS 주소 생성](https://docs.railway.com/networking/domains/working-with-domains)
