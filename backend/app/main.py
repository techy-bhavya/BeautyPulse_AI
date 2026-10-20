from contextlib import asynccontextmanager
from threading import Thread
from datetime import datetime, timezone
import logging
from pathlib import Path
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, text
from sqlalchemy.orm import Session
from app.config import settings
from app.database import SessionLocal, engine, get_db, initialize_database
from app.models import DailyMetric, Investigation, Product, Review
from app.schemas import InvestigationRequest, ReviewSearchRequest
from app.services.analytics import get_consumer_insights, get_overview
from app.services.agent import build_investigation
from app.services.retrieval import search_reviews
from app.services.seed import embed_missing_reviews, seed_demo_data

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("beautypulse")


@asynccontextmanager
async def lifespan(app: FastAPI):
    initialize_database()
    if settings.enable_demo_seed:
        db = SessionLocal()
        try:
            seeded = seed_demo_data(db)
            if seeded:
                log.info("Demo dataset initialized")
        finally:
            db.close()
    if settings.has_openai and settings.enable_review_embeddings:
        def background_embedding_job() -> None:
            background_db = SessionLocal()
            try:
                embed_missing_reviews(background_db)
            except Exception:
                log.exception("Review embedding job failed; lexical retrieval remains available")
            finally:
                background_db.close()
        Thread(target=background_embedding_job, name="review-embeddings", daemon=True).start()
    yield


app = FastAPI(
    title=settings.app_name,
    description="Evidence-first consumer and business intelligence with SQL, review retrieval and a LangGraph investigation workflow.",
    version="1.0.0",
    lifespan=lifespan,
)
origins = [item.strip() for item in settings.cors_origins.split(",") if item.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if origins != ["*"] else ["*"],
    allow_credentials=origins != ["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/api/health", tags=["system"])
def health(db: Session = Depends(get_db)) -> dict:
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ok", "service": settings.app_name, "database": "connected", "timestamp": datetime.now(timezone.utc).isoformat()}
    except Exception as exc:
        log.exception("Health check failed")
        raise HTTPException(status_code=503, detail="Database connection failed") from exc


@app.get("/api/config", tags=["system"])
def public_config() -> dict:
    return {
        "app_name": settings.app_name,
        "mode": "LLM-assisted" if settings.has_openai else "Evidence-first demo mode",
        "openai_enabled": settings.has_openai,
        "embeddings_enabled": bool(settings.has_openai and settings.enable_review_embeddings),
        "data_note": "All seeded business metrics and reviews are synthetic portfolio-demo data.",
    }


@app.get("/api/products", tags=["analytics"])
def products(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.query(Product).order_by(Product.id).all()
    return [{"id": p.id, "name": p.name, "brand": p.brand, "category": p.category, "price": p.price, "description": p.description} for p in rows]


@app.get("/api/overview", tags=["analytics"])
def overview(
    product_id: int | None = Query(default=None, ge=1),
    days: int = Query(default=30, ge=7, le=90),
    db: Session = Depends(get_db),
) -> dict:
    if product_id is not None and db.get(Product, product_id) is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return get_overview(db, product_id, days)


@app.get("/api/consumer-insights", tags=["consumer"])
def consumer_insights(
    product_id: int | None = Query(default=None, ge=1),
    days: int = Query(default=30, ge=1, le=180),
    limit: int = Query(default=12, ge=1, le=50),
    db: Session = Depends(get_db),
) -> dict:
    if product_id is not None and db.get(Product, product_id) is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return get_consumer_insights(db, product_id, days, limit)


@app.post("/api/reviews/search", tags=["consumer"])
def review_search(payload: ReviewSearchRequest, db: Session = Depends(get_db)) -> dict:
    if payload.product_id is not None and db.get(Product, payload.product_id) is None:
        raise HTTPException(status_code=404, detail="Product not found")
    matches = search_reviews(db, payload.query, payload.product_id, payload.days, payload.limit)
    embedded_count = db.query(func.count(Review.id)).filter(Review.embedding.is_not(None)).scalar() or 0
    if settings.has_openai and settings.enable_review_embeddings and embedded_count:
        retrieval_mode = "semantic embeddings + cosine similarity"
    elif settings.has_openai and settings.enable_review_embeddings:
        retrieval_mode = "lexical fallback while review embeddings are prepared"
    else:
        retrieval_mode = "lexical fallback (works without an API key)"
    return {"query": payload.query, "count": len(matches), "retrieval_mode": retrieval_mode, "results": matches}


@app.post("/api/investigate", tags=["agent"])
def investigate(payload: InvestigationRequest, db: Session = Depends(get_db)) -> dict:
    if payload.product_id is not None and db.get(Product, payload.product_id) is None:
        raise HTTPException(status_code=404, detail="Product not found")
    try:
        result = build_investigation(db, payload.question.strip(), payload.product_id, payload.period_days)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        log.exception("Investigation failed")
        raise HTTPException(status_code=500, detail="Investigation failed. Check the server logs and try a narrower question.") from exc

    record = Investigation(
        question=result["question"], product_id=result["product_id"], period_days=result["period_days"],
        title=result["title"], summary=result["summary"], findings=result["findings"],
        metrics=result["metrics"], citations=result["citations"],
        recommended_actions=result["recommended_actions"], limitations=result["limitations"],
        sql_queries=result["sql_queries"], plan_steps=result["plan_steps"], confidence=result["confidence"],
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    result["id"] = record.id
    result["created_at"] = record.created_at.isoformat() if record.created_at else datetime.utcnow().isoformat()
    return result


def _record_summary(record: Investigation) -> dict:
    return {
        "id": record.id, "question": record.question, "product_id": record.product_id,
        "period_days": record.period_days, "title": record.title, "summary": record.summary,
        "created_at": record.created_at.isoformat() if record.created_at else None,
        "confidence": record.confidence,
    }


@app.get("/api/investigations", tags=["agent"])
def investigations(limit: int = Query(default=20, ge=1, le=100), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.query(Investigation).order_by(Investigation.created_at.desc(), Investigation.id.desc()).limit(limit).all()
    return [_record_summary(row) for row in rows]


@app.get("/api/investigations/{investigation_id}", tags=["agent"])
def investigation_detail(investigation_id: int, db: Session = Depends(get_db)) -> dict:
    record = db.get(Investigation, investigation_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Investigation not found")
    return _record_summary(record) | {
        "findings": record.findings, "metrics": record.metrics, "citations": record.citations,
        "recommended_actions": record.recommended_actions, "limitations": record.limitations,
        "sql_queries": record.sql_queries, "plan_steps": record.plan_steps,
        "synthetic_data": True, "mode": "Saved investigation",
    }


# When the React application is built, FastAPI serves it from the same origin.
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
if STATIC_DIR.exists() and (STATIC_DIR / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def frontend_fallback(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API route not found")
        requested = (STATIC_DIR / full_path).resolve()
        if full_path and requested.is_file() and STATIC_DIR.resolve() in requested.parents:
            return FileResponse(requested)
        return FileResponse(STATIC_DIR / "index.html")
else:
    @app.get("/", include_in_schema=False)
    def root():
        return {"service": settings.app_name, "message": "API is running. Start the frontend with `cd frontend && npm run dev`.", "docs": "/docs"}
