from datetime import date
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import Field, StrictFloat, StrictInt, field_validator, model_validator

from .schemas import Contract, StrategyCode

Chart = Literal["MONTHLY_SALES", "MARKET_CARD_SALES", "JEJU_BSI", "TIME_SERIES"]
Intent = Literal[
    "SALES", "MARKET", "BSI", "TIME_SLOT", "CAUSE", "STRATEGY", "GUIDE",
    "REVIEWS", "PLAN", "RESULT", "ITEM_SALES", "COST", "STOCK", "OUT_OF_SCOPE",
]
ActionType = Literal[
    "OPEN_STRATEGY", "OPEN_REVIEWS", "OPEN_PLAN_RESULTS", "OPEN_EXECUTION_GUIDE",
    "ADD_TIME_SERIES", "SELECT_PLAN",
]
Number = StrictInt | StrictFloat
Unit = Literal["KRW", "COUNT", "INDEX", "QUANTITY"]
Topic = Literal["AFTERNOON_ORDER", "PARKING", "WAIT_TIME"]


class Source(Contract):
    label: str
    url: str | None = None

    @field_validator("url")
    @classmethod
    def https_link(cls, value):
        if value is not None:
            link = urlsplit(value)
            if link.scheme != "https" or not link.hostname or link.username or link.password:
                raise ValueError("Source URL must be an HTTPS link")
        return value


class Action(Contract):
    type: ActionType
    targetId: str


class Fact(Contract):
    id: str = Field(min_length=1, pattern=r"^[a-zA-Z0-9_-]+$")
    label: str | None = None
    source: Source | None = None


class Change(Contract):
    value: Number | None
    unit: Literal["PERCENT", "INDEX_POINT"]


class PeriodPair(Contract):
    before: str
    after: str


class MetricFact(Fact):
    kind: Literal["METRIC"]
    metric: Literal[
        "MONTHLY_SALES", "MARKET_CARD_SALES", "JEJU_BSI", "TIME_SERIES",
        "ITEM_SALES", "UNIT_COST", "STOCK",
    ]
    before: Number | None
    after: Number | None
    unit: Unit
    change: Change | None = None
    period: PeriodPair | None = None
    scope: str | None = None
    chart: Chart | None = None


class StrategyFact(Fact):
    kind: Literal["STRATEGY"]
    code: StrategyCode
    reason: str | None = None
    evidenceIds: list[str] = Field(default_factory=list)


class GuideFact(Fact):
    kind: Literal["GUIDE"]
    action: str
    when: str | None = None
    strategyCode: StrategyCode = "OUTREACH"


class ReviewFact(Fact):
    kind: Literal["REVIEW"]
    date: date
    topic: Topic
    excerpt: str


class PlanFact(Fact):
    kind: Literal["PLAN"]
    planId: str
    completed: int = Field(ge=0)
    total: int = Field(ge=0)
    strategyCode: StrategyCode | None = None
    startDate: str | None = None
    endDate: str | None = None


class ResultPeriod(Contract):
    start: str
    end: str
    businessDays: int = Field(ge=1)


class DailyMetric(Contract):
    before: Number
    after: Number
    unit: Literal["KRW", "COUNT"]
    changePercent: Number | None


class ResultFact(Fact):
    kind: Literal["RESULT"]
    planId: str
    scope: str
    before: ResultPeriod
    after: ResultPeriod
    dailyAverageSales: DailyMetric | None = None
    dailyAveragePayments: DailyMetric | None = None


Evidence = Annotated[
    MetricFact | StrategyFact | GuideFact | ReviewFact | PlanFact | ResultFact,
    Field(discriminator="kind"),
]


class Context(Contract):
    focusedEvidenceIds: list[str] = Field(default_factory=list, max_length=200)
    planId: str | None = None
    comparisonPeriod: tuple[str, str] | None = None
    recentQuestions: list[str] = Field(default_factory=list, max_length=5)


class ChartQuestionRequest(Contract):
    schemaVersion: Literal["1.0"]
    question: str = Field(min_length=1, max_length=1000)
    chart: Chart
    context: Context
    availableEvidence: list[Evidence] = Field(max_length=200)
    allowedActions: list[Action] = Field(max_length=60)

    @model_validator(mode="after")
    def unique_evidence(self):
        ids = {fact.id for fact in self.availableEvidence}
        if not self.question.strip() or len(ids) != len(self.availableEvidence):
            raise ValueError("Question must be nonblank and evidence IDs must be unique")
        return self


class QuestionIntent(Contract):
    intents: list[Intent]
    timeMetric: Literal["COUNT", "KRW"] | None
    reviewTopic: Topic | None
    strategyCode: StrategyCode | None
    focusEvidenceId: str | None
    reviewPeriod: PeriodPair | None
    largestTimeDrop: bool
    resultMetric: Literal["COUNT", "KRW"] | None


class Section(Contract):
    kind: Literal["OBSERVATION", "HYPOTHESIS", "ACTION"]
    template: str
    text: str
    evidenceIds: list[str]


class MissingInput(Contract):
    code: str
    label: str


class ChartQuestionResponse(Contract):
    status: Literal["ANSWERED", "PARTIAL", "MISSING_DATA", "CLARIFICATION_REQUIRED", "OUT_OF_SCOPE"]
    intents: list[Intent]
    sections: list[Section]
    evidence: list[Evidence]
    missingInputs: list[MissingInput]
    actions: list[Action]
    focusedEvidenceIds: list[str]
    planId: str | None = None
