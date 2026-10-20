.PHONY: up down logs test
up:
	docker compose up --build

down:
	docker compose down

logs:
	docker compose logs -f app

test:
	cd backend && PYTHONPATH=. pytest ../tests -q
