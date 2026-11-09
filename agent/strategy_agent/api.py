from fastapi import FastAPI

from .execution_guide import GuideRequest, GuideResponse, build_guide_graph, load_catalog
from .graph import build_graph
from .schemas import StrategyRequest, StrategyResponse

app = FastAPI(title="가게짝꿍 대응 전략 Agent")
graph = build_graph()
guide_graph = build_guide_graph(load_catalog())


@app.post("/internal/strategy-recommendations", response_model=StrategyResponse)
def recommend(request: StrategyRequest) -> StrategyResponse:
    return graph.invoke({"request": request})["result"]


@app.post("/internal/execution-guide", response_model=GuideResponse)
def execution_guide(request: GuideRequest) -> GuideResponse:
    return guide_graph.invoke({"request": request})["result"]
