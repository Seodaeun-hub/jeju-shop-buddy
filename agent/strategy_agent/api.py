from fastapi import FastAPI

from .graph import build_graph
from .schemas import StrategyRequest, StrategyResponse

app = FastAPI(title="가게짝꿍 대응 전략 Agent")
graph = build_graph()


@app.post("/internal/strategy-recommendations", response_model=StrategyResponse)
def recommend(request: StrategyRequest) -> StrategyResponse:
    return graph.invoke({"request": request})["result"]
