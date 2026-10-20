from datetime import date, timedelta
from typing import Any
from sqlalchemy import func, text
from sqlalchemy.orm import Session
try:
    import sqlglot
    from sqlglot import exp
except ImportError:  # basic conservative fallback for offline smoke tests; production installs SQLGlot
    sqlglot = None
    exp = None
from app.models import DailyMetric, Product, Review


def _pct_change(current: float, previous: float) -> float:
    if previous == 0:
        return 0.0 if current == 0 else 100.0
    return round((current - previous) / abs(previous) * 100, 1)


def _as_float(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def get_data_end_date(db: Session) -> date:
    return db.query(func.max(DailyMetric.metric_date)).scalar() or date.today()


def _range_aggregate(db: Session, start: date, end: date, product_id: int | None = None) -> dict:
    query = db.query(
        func.coalesce(func.sum(DailyMetric.revenue), 0),
        func.coalesce(func.sum(DailyMetric.units_sold), 0),
        func.coalesce(func.sum(DailyMetric.returns), 0),
        func.coalesce(func.avg(DailyMetric.stockout_hours), 0),
        func.coalesce(func.sum(DailyMetric.ad_spend), 0),
        func.coalesce(func.sum(DailyMetric.impressions), 0),
        func.coalesce(func.sum(DailyMetric.conversions), 0),
    ).filter(DailyMetric.metric_date >= start, DailyMetric.metric_date <= end)
    if product_id is not None:
        query = query.filter(DailyMetric.product_id == product_id)
    row = query.one()
    return {
        "revenue": round(_as_float(row[0]), 2), "units_sold": int(row[1] or 0),
        "returns": int(row[2] or 0), "avg_stockout_hours": round(_as_float(row[3]), 2),
        "ad_spend": round(_as_float(row[4]), 2), "impressions": int(row[5] or 0),
        "conversions": int(row[6] or 0),
        "return_rate": round((int(row[2] or 0) / max(int(row[1] or 0), 1)) * 100, 2),
    }


def _review_aggregate(db: Session, start: date, end: date, product_id: int | None = None) -> dict:
    query = db.query(func.avg(Review.rating), func.count(Review.id)).filter(
        Review.review_date >= start, Review.review_date <= end
    )
    if product_id is not None:
        query = query.filter(Review.product_id == product_id)
    rating, count = query.one()
    return {"avg_rating": round(_as_float(rating), 2), "review_count": int(count or 0)}


def _delta(current: dict, previous: dict, field: str, unit: str = "%") -> dict:
    return {"value": current.get(field, 0), "previous": previous.get(field, 0), "change_pct": _pct_change(_as_float(current.get(field)), _as_float(previous.get(field))), "unit": unit}


def get_overview(db: Session, product_id: int | None = None, days: int = 30) -> dict:
    end = get_data_end_date(db)
    days = max(7, min(int(days), 90))
    current_start = end - timedelta(days=days - 1)
    previous_end = current_start - timedelta(days=1)
    previous_start = previous_end - timedelta(days=days - 1)

    current = _range_aggregate(db, current_start, end, None)
    previous = _range_aggregate(db, previous_start, previous_end, None)
    ratings = _review_aggregate(db, current_start, end, None)
    old_ratings = _review_aggregate(db, previous_start, previous_end, None)
    kpis = [
        {"key": "revenue", "label": "Net revenue", "value": current["revenue"], "format": "currency", "change_pct": _pct_change(current["revenue"], previous["revenue"]), "note": f"vs previous {days} days"},
        {"key": "units_sold", "label": "Units sold", "value": current["units_sold"], "format": "number", "change_pct": _pct_change(current["units_sold"], previous["units_sold"]), "note": f"vs previous {days} days"},
        {"key": "return_rate", "label": "Return rate", "value": current["return_rate"], "format": "percent", "change_pct": round(current["return_rate"] - previous["return_rate"], 2), "note": "percentage-point change", "is_rate": True},
        {"key": "avg_rating", "label": "Average rating", "value": ratings["avg_rating"], "format": "rating", "change_pct": round(ratings["avg_rating"] - old_ratings["avg_rating"], 2), "note": "star change vs prior period", "is_rate": True},
    ]

    selected = product_id or db.query(Product.id).order_by(Product.id).first()[0]
    metric_rows = db.query(DailyMetric).filter(
        DailyMetric.product_id == selected,
        DailyMetric.metric_date >= current_start,
        DailyMetric.metric_date <= end,
    ).order_by(DailyMetric.metric_date.asc()).all()
    review_rows = db.query(Review.review_date, func.avg(Review.rating), func.count(Review.id)).filter(
        Review.product_id == selected,
        Review.review_date >= current_start,
        Review.review_date <= end,
    ).group_by(Review.review_date).all()
    review_by_date = {r[0]: {"avg_rating": round(_as_float(r[1]), 2), "review_count": int(r[2])} for r in review_rows}
    trends = []
    for item in metric_rows:
        review_info = review_by_date.get(item.metric_date, {})
        trends.append({
            "date": item.metric_date.isoformat(), "revenue": round(item.revenue, 2),
            "units_sold": item.units_sold, "returns": item.returns,
            "avg_rating": review_info.get("avg_rating"), "review_count": review_info.get("review_count", 0),
        })

    topic_rows = db.query(Review.topic, func.count(Review.id)).filter(
        Review.review_date >= current_start, Review.review_date <= end
    )
    if product_id is not None:
        topic_rows = topic_rows.filter(Review.product_id == product_id)
    topic_rows = topic_rows.group_by(Review.topic).order_by(func.count(Review.id).desc()).all()
    topic_stats = [{"topic": topic or "Other", "count": int(count)} for topic, count in topic_rows]

    products = db.query(Product).order_by(Product.id).all()
    product_rows = []
    for product in products:
        current_rev = _review_aggregate(db, current_start, end, product.id)
        previous_rev = _review_aggregate(db, previous_start, previous_end, product.id)
        metric = _range_aggregate(db, current_start, end, product.id)
        product_rows.append({
            "id": product.id, "name": product.name, "brand": product.brand, "category": product.category,
            "price": product.price, "avg_rating": current_rev["avg_rating"], "review_count": current_rev["review_count"],
            "rating_change": round(current_rev["avg_rating"] - previous_rev["avg_rating"], 2),
            "revenue": metric["revenue"], "units_sold": metric["units_sold"], "return_rate": metric["return_rate"],
        })

    return {
        "range": {"start": current_start.isoformat(), "end": end.isoformat(), "days": days,
                  "previous_start": previous_start.isoformat(), "previous_end": previous_end.isoformat()},
        "kpis": kpis, "trends": trends, "topic_stats": topic_stats,
        "products": product_rows, "selected_product_id": selected,
        "data_note": "All commercial metrics and customer reviews are synthetic demo data generated for this portfolio project.",
    }


def get_consumer_insights(db: Session, product_id: int | None = None, days: int = 30, limit: int = 12) -> dict:
    end = get_data_end_date(db)
    start = end - timedelta(days=max(1, min(days, 180)) - 1)
    reviews_q = db.query(Review).filter(Review.review_date >= start, Review.review_date <= end)
    if product_id is not None:
        reviews_q = reviews_q.filter(Review.product_id == product_id)
    reviews = reviews_q.order_by(Review.review_date.desc(), Review.id.desc()).limit(limit).all()
    topic_q = db.query(Review.topic, func.count(Review.id), func.avg(Review.rating)).filter(
        Review.review_date >= start, Review.review_date <= end
    )
    if product_id is not None:
        topic_q = topic_q.filter(Review.product_id == product_id)
    topics = topic_q.group_by(Review.topic).order_by(func.count(Review.id).desc()).all()
    return {
        "range": {"start": start.isoformat(), "end": end.isoformat()},
        "topic_stats": [{"topic": t or "Other", "count": int(c), "avg_rating": round(_as_float(r), 2)} for t, c, r in topics],
        "reviews": [review_to_dict(r) for r in reviews],
    }


def review_to_dict(review: Review) -> dict:
    return {
        "id": review.id, "product_id": review.product_id, "date": review.review_date.isoformat(),
        "rating": review.rating, "text": review.review_text, "source": review.source,
        "topic": review.topic, "sentiment": review.sentiment, "helpful_votes": review.helpful_votes,
    }


def _validate_select_sql(sql: str) -> None:
    """Parse fixed analytics SQL and reject anything except a single read-only SELECT."""
    if sqlglot is None:
        import re
        normalized = sql.strip().lower()
        if not normalized.startswith("select ") or ";" in normalized or re.search(r"\b(insert|update|delete|drop|create|alter|truncate|grant|revoke)\b", normalized):
            raise ValueError("Only a single read-only SELECT query is permitted")
        return
    import re
    # SQLGlot validates the query shape after substituting safe literals for bind placeholders.
    validation_sql = re.sub(r":product_id\b", "1", sql)
    validation_sql = re.sub(r":(?:start_date|end_date)\b", "'2026-01-01'", validation_sql)
    parsed = sqlglot.parse(validation_sql, read="postgres")
    if len(parsed) != 1 or not isinstance(parsed[0], exp.Select):
        raise ValueError("Only a single read-only SELECT query is permitted")
    forbidden = (exp.Insert, exp.Update, exp.Delete, exp.Drop, exp.Create, exp.Alter, exp.Command)
    if any(parsed[0].find(kind) is not None for kind in forbidden):
        raise ValueError("Unsafe SQL construct rejected")


def query_metric_summary(db: Session, product_id: int, start: date, end: date) -> tuple[dict, str]:
    # Parameterized, allow-listed analytics query. Never execute LLM-generated raw SQL.
    sql = """SELECT COALESCE(SUM(revenue), 0) AS revenue,
       COALESCE(SUM(units_sold), 0) AS units_sold,
       COALESCE(SUM(returns), 0) AS returns,
       COALESCE(AVG(stockout_hours), 0) AS avg_stockout_hours,
       COALESCE(SUM(ad_spend), 0) AS ad_spend,
       COALESCE(SUM(impressions), 0) AS impressions,
       COALESCE(SUM(conversions), 0) AS conversions
FROM daily_metrics
WHERE product_id = :product_id AND metric_date >= :start_date AND metric_date <= :end_date"""
    _validate_select_sql(sql)
    _validate_select_sql(sql)
    row = db.execute(text(sql), {"product_id": product_id, "start_date": start, "end_date": end}).mappings().one()
    values = {key: _as_float(row[key]) for key in row.keys()}
    values.update({
        "revenue": round(values["revenue"], 2), "units_sold": int(values["units_sold"]),
        "returns": int(values["returns"]), "avg_stockout_hours": round(values["avg_stockout_hours"], 2),
        "ad_spend": round(values["ad_spend"], 2), "impressions": int(values["impressions"]),
        "conversions": int(values["conversions"]),
        "return_rate": round(values["returns"] / max(values["units_sold"], 1) * 100, 2),
    })
    return values, sql


def query_review_summary(db: Session, product_id: int, start: date, end: date) -> tuple[dict, str]:
    sql = """SELECT COALESCE(AVG(rating), 0) AS avg_rating, COUNT(*) AS review_count
FROM reviews
WHERE product_id = :product_id AND review_date >= :start_date AND review_date <= :end_date"""
    row = db.execute(text(sql), {"product_id": product_id, "start_date": start, "end_date": end}).mappings().one()
    return {"avg_rating": round(_as_float(row["avg_rating"]), 2), "review_count": int(row["review_count"] or 0)}, sql


def query_topic_summary(db: Session, product_id: int, start: date, end: date) -> tuple[list[dict], str]:
    sql = """SELECT topic, COUNT(*) AS review_count, COALESCE(AVG(rating), 0) AS avg_rating
FROM reviews
WHERE product_id = :product_id AND review_date >= :start_date AND review_date <= :end_date
GROUP BY topic ORDER BY review_count DESC"""
    _validate_select_sql(sql)
    rows = db.execute(text(sql), {"product_id": product_id, "start_date": start, "end_date": end}).mappings().all()
    return [{"topic": row["topic"] or "Other", "count": int(row["review_count"]), "avg_rating": round(_as_float(row["avg_rating"]), 2)} for row in rows], sql
