from fastapi.testclient import TestClient

from app.main import app


def test_health_and_products():
    with TestClient(app) as client:
        health = client.get("/api/health")
        assert health.status_code == 200
        assert health.json()["status"] == "ok"
        products = client.get("/api/products")
        assert products.status_code == 200
        assert len(products.json()) >= 8


def test_overview_has_demo_data():
    with TestClient(app) as client:
        response = client.get("/api/overview?product_id=1&days=30")
        assert response.status_code == 200
        body = response.json()
        assert len(body["kpis"]) == 4
        assert body["trends"]
        assert "synthetic" in body["data_note"].lower()


def test_investigation_returns_evidence_or_limitations():
    with TestClient(app) as client:
        response = client.post("/api/investigate", json={
            "question": "Investigate recent packaging complaints and business performance",
            "product_id": 1,
            "period_days": 30,
        })
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["id"]
        assert body["sql_queries"]
        assert body["findings"]
        assert body["limitations"]
        assert body["synthetic_data"] is True


def test_sql_guardrail_rejects_mutations():
    import pytest
    from app.services.analytics import _validate_select_sql

    _validate_select_sql("SELECT id FROM products WHERE id = :product_id")
    with pytest.raises(ValueError):
        _validate_select_sql("DELETE FROM products")
