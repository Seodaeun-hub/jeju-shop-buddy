from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictFloat, StrictInt, model_validator

StrategyCode = Literal["OUTREACH", "PROMOTION", "INVENTORY"]
InputCode = Literal[
    "MONTHLY_SALES",
    "TIME_SERIES",
    "ITEM_PRICE_AND_ORDER_COST",
    "DISCOUNT_BUDGET",
    "ON_HAND_STOCK",
    "EXPECTED_USAGE",
    "INCOMING_STOCK",
]
EvidenceType = Literal["MONTHLY_SALES", "TIME_SERIES", "MARKET_CARD_SALES", "JEJU_BSI"]
AvailabilityStatus = Literal["AVAILABLE", "MISSING"]
CandidateStatus = Literal["AVAILABLE", "NEEDS_INPUT"]
RecommendationStatus = Literal["AVAILABLE", "NEEDS_INPUT", "RECOMMENDED"]
ResultStatus = Literal["OK", "INSUFFICIENT_DATA", "FALLBACK_REQUIRED"]

AVAILABILITY_FIELDS = {
    "MONTHLY_SALES": "monthlySales",
    "TIME_SERIES": "timeSeries",
    "MARKET_CARD_SALES": "marketCardSales",
    "JEJU_BSI": "jejuBsi",
}


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Store(Contract):
    area: str = Field(min_length=1)
    industryCode: str = Field(min_length=1)


class Period(Contract):
    beforeMonth: str = Field(pattern=r"^[0-9]{4}-(0[1-9]|1[0-2])$")
    afterMonth: str = Field(pattern=r"^[0-9]{4}-(0[1-9]|1[0-2])$")

    @model_validator(mode="after")
    def check_order(self):
        if self.beforeMonth >= self.afterMonth:
            raise ValueError("beforeMonth must precede afterMonth")
        return self


class Availability(Contract):
    monthlySales: AvailabilityStatus
    timeSeries: AvailabilityStatus
    marketCardSales: AvailabilityStatus
    jejuBsi: AvailabilityStatus


class Change(Contract):
    unit: Literal["PERCENT", "INDEX_POINT"]
    value: StrictInt | StrictFloat | None


class Evidence(Contract):
    id: str = Field(min_length=1)
    type: EvidenceType
    scope: Literal["STORE", "AREA_AND_INDUSTRY", "JEJU"]
    source: str = Field(min_length=1)
    label: str | None = None
    unit: Literal["KRW", "COUNT", "INDEX"]
    before: StrictInt | StrictFloat = Field(ge=0)
    after: StrictInt | StrictFloat = Field(ge=0)
    change: Change

    @model_validator(mode="after")
    def check_measurement(self):
        measurements = {
            "MONTHLY_SALES": ("STORE", {"KRW"}),
            "TIME_SERIES": ("STORE", {"KRW", "COUNT"}),
            "MARKET_CARD_SALES": ("AREA_AND_INDUSTRY", {"KRW"}),
            "JEJU_BSI": ("JEJU", {"INDEX"}),
        }
        scope, units = measurements[self.type]
        change_unit = "INDEX_POINT" if self.unit == "INDEX" else "PERCENT"
        if self.scope != scope or self.unit not in units or self.change.unit != change_unit:
            raise ValueError("evidence type, scope and units must agree")
        if self.type == "TIME_SERIES" and not (self.label and self.label.strip()):
            raise ValueError("time series evidence requires a time slot label")
        if self.unit in {"KRW", "COUNT"} and any(
            not isinstance(value, int) for value in (self.before, self.after)
        ):
            raise ValueError("currency and count evidence require integer values")
        if (self.change.value is None) != (change_unit == "PERCENT" and self.before == 0):
            raise ValueError("percentage change is unavailable only when its baseline is zero")
        return self


class Candidate(Contract):
    code: StrategyCode
    status: CandidateStatus
    missingInputs: list[InputCode]

    @model_validator(mode="after")
    def check_missing_inputs(self):
        if bool(self.missingInputs) != (self.status == "NEEDS_INPUT"):
            raise ValueError("candidate status must agree with missingInputs")
        if len(self.missingInputs) != len(set(self.missingInputs)):
            raise ValueError("missingInputs must be unique")
        return self


class StrategyRequest(Contract):
    schemaVersion: Literal["1.0"]
    analysisId: UUID
    inputFingerprint: str = Field(min_length=1)
    store: Store
    period: Period
    concern: str
    availability: Availability
    evidence: list[Evidence]
    strategies: list[Candidate] = Field(min_length=1, max_length=3)

    @model_validator(mode="after")
    def check_evidence_and_candidates(self):
        if len(self.evidence) != len({item.id for item in self.evidence}):
            raise ValueError("evidence IDs must be unique")
        if len(self.strategies) != len({item.code for item in self.strategies}):
            raise ValueError("strategy codes must be unique")
        evidence_types = {item.type for item in self.evidence}
        for evidence_type, field in AVAILABILITY_FIELDS.items():
            present = evidence_type in evidence_types
            if present != (getattr(self.availability, field) == "AVAILABLE"):
                raise ValueError(f"{field} availability must match supplied evidence")
        return self


class Recommendation(Contract):
    strategyCode: StrategyCode
    status: RecommendationStatus
    reason: str
    evidenceIds: list[str]
    missingInputs: list[InputCode]
    nextAction: str
    followUp: str


class RecommendationDraft(Contract):
    recommendations: list[Recommendation]


class StrategyResponse(RecommendationDraft):
    schemaVersion: Literal["1.0"]
    analysisId: UUID
    inputFingerprint: str
    status: ResultStatus
    contextEvidenceIds: list[str]
    requiredInputs: list[InputCode]
