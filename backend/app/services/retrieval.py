import logging
import math
import re
from datetime import timedelta
from sqlalchemy.orm import Session
from app.config import settings
from app.models import Product, Review
from app.services.analytics import get_data_end_date, review_to_dict

log = logging.getLogger(__name__)
STOP_WORDS = {"the", "and", "for", "with", "this", "that", "from", "what", "why", "over", "last", "month", "product", "reviews", "review", "about", "into", "were", "was", "are", "you", "your", "does", "did", "have", "has", "its", "it", "and", "not", "how", "can", "could", "would", "should", "their", "there", "been", "more", "less", "than"}


def tokens(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", text.lower()) if len(t) > 2 and t not in STOP_WORDS}


def _embedding(text: str) -> list[float] | None:
    if not settings.has_openai or not settings.enable_review_embeddings:
        return None
    from openai import OpenAI
    client = OpenAI(api_key=settings.openai_api_key)
    response = client.embeddings.create(model=settings.openai_embedding_model, input=text[:2500])
    return response.data[0].embedding


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def search_reviews(db: Session, query: str, product_id: int | None = None, days: int = 30, limit: int = 8, topic: str | None = None) -> list[dict]:
    end = get_data_end_date(db)
    start = end - timedelta(days=max(1, min(days, 180)) - 1)
    base_query = db.query(Review).filter(Review.review_date >= start, Review.review_date <= end)
    if product_id is not None:
        base_query = base_query.filter(Review.product_id == product_id)
    if topic:
        base_query = base_query.filter(Review.topic == topic)
    candidates = base_query.order_by(Review.review_date.desc()).limit(1200).all()
    if not candidates:
        return []

    query_embedding = None
    try:
        query_embedding = _embedding(query)
    except Exception as exc:
        log.warning("Embedding request failed; using lexical retrieval: %s", exc)

    if query_embedding:
        embedded = [r for r in candidates if r.embedding is not None]
        if embedded:
            ranked = sorted(embedded, key=lambda r: _cosine(query_embedding, list(r.embedding)), reverse=True)
            if len(ranked) < limit:
                ranked_ids = {r.id for r in ranked}
                remaining = [r for r in candidates if r.id not in ranked_ids]
                query_terms = tokens(query)
                remaining.sort(key=lambda r: (len(query_terms & tokens(r.review_text)) * 2 + (r.rating <= 2)), reverse=True)
                ranked += remaining[: limit - len(ranked)]
            return [review_to_dict(r) | {"retrieval_score": round(_cosine(query_embedding, list(r.embedding)), 3) if r.embedding is not None else 0.0} for r in ranked[:limit]]

    query_terms = tokens(query)
    def score(review: Review) -> float:
        review_terms = tokens(review.review_text + " " + str(review.topic))
        overlap = len(query_terms & review_terms)
        exact_bonus = 1.5 if any(term in review.review_text.lower() for term in query_terms) else 0.0
        complaint_bonus = 0.7 if review.rating <= 2 else 0.0
        recent_bonus = 0.1
        return overlap + exact_bonus + complaint_bonus + recent_bonus
    ranked = sorted(candidates, key=score, reverse=True)
    # Keyword retrieval is intentionally labelled as fallback in the response.
    return [review_to_dict(r) | {"retrieval_score": round(score(r), 3)} for r in ranked[:limit]]
