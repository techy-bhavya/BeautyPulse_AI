from pydantic import BaseModel, Field


class InvestigationRequest(BaseModel):
    question: str = Field(min_length=8, max_length=1200)
    product_id: int | None = None
    period_days: int = Field(default=30, ge=7, le=90)


class ReviewSearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=400)
    product_id: int | None = None
    days: int = Field(default=30, ge=1, le=180)
    limit: int = Field(default=8, ge=1, le=30)
