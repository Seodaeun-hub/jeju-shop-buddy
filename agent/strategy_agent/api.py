from fastapi import FastAPI, HTTPException
from langchain_core.exceptions import OutputParserException
from openai import OpenAIError

from .chart_question import build_question_graph
from .chart_question_schemas import ChartQuestionRequest, ChartQuestionResponse
from .execution_guide import GuideRequest, GuideResponse, build_guide_graph, load_catalog
from .graph import build_graph
from .schemas import StrategyRequest, StrategyResponse

app = FastAPI(title="가게짝꿍 대응 전략 Agent")
graph = build_graph()
guide_graph = build_guide_graph(load_catalog())
question_graph = build_question_graph()


@app.post("/internal/strategy-recommendations", response_model=StrategyResponse)
def recommend(request: StrategyRequest) -> StrategyResponse:
    return graph.invoke({"request": request})["result"]


@app.post("/internal/execution-guide", response_model=GuideResponse)
def execution_guide(request: GuideRequest) -> GuideResponse:
    return guide_graph.invoke({"request": request})["result"]


@app.post("/internal/chart-questions", response_model=ChartQuestionResponse)
def chart_question(request: ChartQuestionRequest) -> ChartQuestionResponse:
    try:
        return question_graph.invoke({"request": request})["result"]
    except (OpenAIError, OutputParserException, ValueError, TimeoutError):
        raise HTTPException(status_code=503, detail={"code": "QA_UNAVAILABLE"}) from None
