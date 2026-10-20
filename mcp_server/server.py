"""MCP server for authorized, read-only BeautyPulse business-data tools.

Run from the repository root with:
    python -m mcp_server.server

Configure the same DATABASE_URL used by the API. This server uses stdio transport.
"""
from datetime import timedelta
from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from mcp.server.fastmcp import FastMCP  # noqa: E402
from app.database import SessionLocal, initialize_database  # noqa: E402
from app.models import Product  # noqa: E402
from app.services.analytics import get_data_end_date, query_metric_summary, query_review_summary, query_topic_summary  # noqa: E402
from app.services.retrieval import search_reviews  # noqa: E402
from app.services.seed import seed_demo_data  # noqa: E402

mcp = FastMCP("BeautyPulse Business Data")


def _init() -> None:
    initialize_database()
    db = SessionLocal()
    try:
        seed_demo_data(db)
    finally:
        db.close()


@mcp.tool()
def list_products() -> list[dict]:
    """List available products and IDs in the demo workspace."""
    db = SessionLocal()
    try:
        return [{"id": p.id, "name": p.name, "brand": p.brand, "category": p.category, "price_inr": p.price}
                for p in db.query(Product).order_by(Product.id).all()]
    finally:
        db.close()


@mcp.tool()
def get_product_metrics(product_id: int, days: int = 30) -> dict:
    """Read-only current-versus-previous period KPIs for a product. Days must be 7–90."""
    if days < 7 or days > 90:
        return {"error": "days must be between 7 and 90"}
    db = SessionLocal()
    try:
        product = db.get(Product, product_id)
        if not product:
            return {"error": "product_id not found", "available_products": list_products()}
        end = get_data_end_date(db)
        start = end - timedelta(days=days - 1)
        prev_end = start - timedelta(days=1)
        prev_start = prev_end - timedelta(days=days - 1)
        current_metrics, _ = query_metric_summary(db, product_id, start, end)
        previous_metrics, _ = query_metric_summary(db, product_id, prev_start, prev_end)
        current_reviews, _ = query_review_summary(db, product_id, start, end)
        previous_reviews, _ = query_review_summary(db, product_id, prev_start, prev_end)
        return {
            "product": product.name,
            "current_period": {"start": start.isoformat(), "end": end.isoformat(), **current_metrics, **current_reviews},
            "previous_period": {"start": prev_start.isoformat(), "end": prev_end.isoformat(), **previous_metrics, **previous_reviews},
            "data_provenance": "Synthetic portfolio demo data",
        }
    finally:
        db.close()


@mcp.tool()
def get_complaint_trends(product_id: int, days: int = 30) -> list[dict]:
    """Return review-topic counts and average rating for the last N days."""
    if days < 1 or days > 180:
        return [{"error": "days must be between 1 and 180"}]
    db = SessionLocal()
    try:
        end = get_data_end_date(db)
        start = end - timedelta(days=days - 1)
        topics, _ = query_topic_summary(db, product_id, start, end)
        return topics
    finally:
        db.close()


@mcp.tool()
def search_consumer_reviews(query: str, product_id: int, days: int = 30, limit: int = 5) -> list[dict]:
    """Retrieve review evidence with record IDs, dates, ratings, topics and source labels."""
    if days < 1 or days > 180 or limit < 1 or limit > 10:
        return [{"error": "days must be 1–180 and limit must be 1–10"}]
    db = SessionLocal()
    try:
        rows = search_reviews(db, query, product_id, days, limit)
        return [{"review_id": r["id"], "date": r["date"], "rating": r["rating"], "topic": r["topic"],
                 "sentiment": r["sentiment"], "text": r["text"], "source": r["source"]} for r in rows]
    finally:
        db.close()


if __name__ == "__main__":
    _init()
    mcp.run(transport="stdio")
