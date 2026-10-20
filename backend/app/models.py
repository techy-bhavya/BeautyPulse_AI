from datetime import date, datetime
from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.config import settings
from app.database import Base

try:
    from pgvector.sqlalchemy import Vector
except Exception:  # pragma: no cover - pgvector is declared in requirements
    Vector = None  # type: ignore[assignment,misc]


class Product(Base):
    __tablename__ = "products"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    brand: Mapped[str] = mapped_column(String(100), nullable=False, default="GlowNest")
    category: Mapped[str] = mapped_column(String(80), nullable=False)
    price: Mapped[float] = mapped_column(Float, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    reviews = relationship("Review", back_populates="product", cascade="all, delete-orphan")
    metrics = relationship("DailyMetric", back_populates="product", cascade="all, delete-orphan")


class Review(Base):
    __tablename__ = "reviews"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    review_date: Mapped[date] = mapped_column(Date, index=True)
    rating: Mapped[int] = mapped_column(Integer)
    review_text: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(String(80), default="Demo marketplace")
    topic: Mapped[str] = mapped_column(String(80), default="Other", index=True)
    sentiment: Mapped[str] = mapped_column(String(30), default="Neutral")
    helpful_votes: Mapped[int] = mapped_column(Integer, default=0)
    # Real pgvector storage on PostgreSQL; JSON arrays keep SQLite frictionless for local demos.
    if settings.is_postgres and Vector is not None:
        embedding = mapped_column(Vector(1536), nullable=True)
    else:
        embedding = mapped_column(JSON, nullable=True)
    product = relationship("Product", back_populates="reviews")


class DailyMetric(Base):
    __tablename__ = "daily_metrics"
    __table_args__ = (UniqueConstraint("metric_date", "product_id", name="uq_metric_date_product"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    metric_date: Mapped[date] = mapped_column(Date, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    units_sold: Mapped[int] = mapped_column(Integer, default=0)
    revenue: Mapped[float] = mapped_column(Float, default=0.0)
    returns: Mapped[int] = mapped_column(Integer, default=0)
    stock_on_hand: Mapped[int] = mapped_column(Integer, default=0)
    stockout_hours: Mapped[float] = mapped_column(Float, default=0.0)
    ad_spend: Mapped[float] = mapped_column(Float, default=0.0)
    impressions: Mapped[int] = mapped_column(Integer, default=0)
    conversions: Mapped[int] = mapped_column(Integer, default=0)
    product = relationship("Product", back_populates="metrics")


class Investigation(Base):
    __tablename__ = "investigations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id", ondelete="SET NULL"), nullable=True)
    period_days: Mapped[int] = mapped_column(Integer, default=30)
    title: Mapped[str] = mapped_column(String(220), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    findings: Mapped[list] = mapped_column(JSON, default=list)
    metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    citations: Mapped[list] = mapped_column(JSON, default=list)
    recommended_actions: Mapped[list] = mapped_column(JSON, default=list)
    limitations: Mapped[list] = mapped_column(JSON, default=list)
    sql_queries: Mapped[list] = mapped_column(JSON, default=list)
    plan_steps: Mapped[list] = mapped_column(JSON, default=list)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
