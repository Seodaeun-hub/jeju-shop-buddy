# 가게짝꿍 대응 전략 Agent

Python 3.11 이상에서 실행한다. Spring Boot가 정리한 매출과 제주 데이터를 받아 기존 전략 후보를 검토하고 근거 ID를 반환한다.

```powershell
cd agent
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn strategy_agent.api:app --host 127.0.0.1 --port 8001
```

실행 셸에서 `STRATEGY_AI_API_KEY` 또는 `OPENAI_API_KEY`를 설정한다. 기본 모델은 `gpt-4.1-mini`이고 `STRATEGY_AI_MODEL`로 지정할 수 있다. 모델을 사용할 수 없으면 `FALLBACK_REQUIRED`를 반환한다.

같은 폴더에서 설계서의 두 요청을 보낼 수 있다.

```powershell
curl.exe --silent --show-error http://127.0.0.1:8001/internal/strategy-recommendations -H 'Content-Type: application/json' --data-binary '@tests/fixtures/aewol-pos.json'
curl.exe --silent --show-error http://127.0.0.1:8001/internal/strategy-recommendations -H 'Content-Type: application/json' --data-binary '@tests/fixtures/aewol-monthly.json'
```

자동 테스트는 모델 응답을 주입해 두 요청의 계약과 실패 분기를 검증한다. API 키 없이 실행할 수 있다.

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```
