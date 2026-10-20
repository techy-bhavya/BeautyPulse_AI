from datetime import date, timedelta
import logging
import random
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.config import settings
from app.models import DailyMetric, Product, Review

log = logging.getLogger(__name__)

PRODUCTS = [
    ("GlowNest Vitamin C Cleanser", "Cleanser", 449, "A brightening daily cleanser with a gentle citrus-inspired formula."),
    ("DewDrop Barrier Cream", "Moisturizer", 599, "A barrier-supporting cream for daily hydration."),
    ("CloudSkin SPF 50 Gel", "Sun Care", 699, "A lightweight daily sunscreen gel."),
    ("CalmLeaf Gel Moisturizer", "Moisturizer", 399, "A lightweight gel moisturizer for warm and humid weather."),
    ("NightBloom Retinol Serum", "Serum", 799, "A night-time serum positioned for a simple skin-care routine."),
    ("PureMint Daily Face Wash", "Cleanser", 349, "A refreshing daily face wash."),
    ("VelvetTint Lip Balm", "Lip Care", 249, "A tinted balm for everyday use."),
    ("SoftGlow Body Lotion", "Body Care", 499, "A fast-absorbing body lotion for daily hydration."),
]

TOPICS = {
    "Packaging": [
        "The cap arrived loose and some product had leaked into the box.",
        "The pump is difficult to use and the bottle does not close properly.",
        "Packaging feels flimsy; the lid cracked during delivery.",
        "A little product leaked during shipping, although the formula is fine.",
    ],
    "Irritation": [
        "My skin felt irritated after using this for two days.",
        "I noticed redness after application, so I stopped using it.",
        "The formula did not suit my skin and caused a little irritation.",
    ],
    "Fragrance": [
        "The fragrance is stronger than I expected and lingers for a while.",
        "I would prefer a milder scent; the smell is noticeable.",
        "The scent is pleasant but slightly too strong for everyday use.",
    ],
    "Texture": [
        "The texture feels sticky and takes a while to absorb.",
        "It spreads easily and feels light on my skin.",
        "The texture is a little thick, but it works into the skin after a minute.",
    ],
    "Effectiveness": [
        "After a few weeks, I have not seen the results I expected.",
        "It leaves my skin feeling clean without feeling too dry.",
        "This fits nicely into my routine and I am happy with the result.",
        "The product works well for me and I would purchase it again.",
    ],
    "Price": [
        "Good product, but I think the price is a little high for the quantity.",
        "Value for money when compared with similar products.",
        "I would buy it again if there were a bundle or a better offer.",
    ],
    "Delivery": [
        "The parcel arrived later than expected, but the product was okay.",
        "The outer box was damaged during delivery.",
        "Arrived quickly and was packed neatly.",
    ],
}


def classify_review(text: str, rating: int) -> tuple[str, str]:
    lowered = text.lower()
    keywords = {
        "Packaging": ("cap", "pump", "packaging", "bottle", "leak", "lid", "box"),
        "Irritation": ("irritat", "redness", "skin did not suit", "stopped using"),
        "Fragrance": ("fragrance", "scent", "smell"),
        "Texture": ("texture", "sticky", "absorb", "thick"),
        "Effectiveness": ("results", "works", "skin feeling", "routine"),
        "Price": ("price", "value", "quantity", "offer", "bundle"),
        "Delivery": ("parcel", "delivery", "arrived", "outer box"),
    }
    topic = next((name for name, words in keywords.items() if any(word in lowered for word in words)), "Other")
    sentiment = "Positive" if rating >= 4 else "Negative" if rating <= 2 else "Neutral"
    return topic, sentiment


def _make_review_text(rng: random.Random, product_name: str, topic: str, product_idx: int) -> tuple[str, int]:
    text = rng.choice(TOPICS[topic])
    if product_idx != 0 and topic == "Packaging" and rng.random() < 0.45:
        text = "The parcel arrived in good condition and the bottle was secure. " + text
    if topic in {"Packaging", "Irritation"}:
        rating = rng.choices([1, 2, 3, 4, 5], weights=[25, 34, 23, 13, 5])[0]
    elif topic in {"Effectiveness", "Texture"}:
        rating = rng.choices([1, 2, 3, 4, 5], weights=[7, 10, 16, 35, 32])[0]
    else:
        rating = rng.choices([1, 2, 3, 4, 5], weights=[8, 12, 20, 34, 26])[0]
    return f"{product_name}: {text}", rating


def seed_demo_data(db: Session) -> bool:
    if db.query(Product).count() > 0:
        return False

    rng = random.Random(20261020)
    products: list[Product] = []
    for name, category, price, description in PRODUCTS:
        product = Product(name=name, brand="GlowNest", category=category, price=float(price), description=description)
        db.add(product)
        products.append(product)
    db.flush()

    today = date.today()
    for product_idx, product in enumerate(products):
        for day_offset in range(90):
            d = today - timedelta(days=89 - day_offset)
            base_units = 42 + product_idx * 4
            seasonal = 1.0 + 0.13 * __import__("math").sin(day_offset / 9 + product_idx)
            units = max(8, int(base_units * seasonal + rng.randint(-8, 9)))
            # A demo scenario: product 1 has softer sales, more returns and more stock friction in the latest period.
            recent_scenario = product_idx == 0 and day_offset >= 60
            if recent_scenario:
                units = int(units * 0.83)
            price = PRODUCTS[product_idx][2]
            revenue = round(units * price * rng.uniform(0.94, 1.02), 2)
            return_rate = 0.035 + rng.random() * 0.025
            stockout = 0.0
            if recent_scenario:
                return_rate += 0.045
                stockout = rng.choice([0.0, 0.0, 0.0, 1.5, 3.0, 5.0])
            returned = min(units, int(round(units * return_rate)))
            stock = max(0, int(560 - day_offset * 2.4 + rng.randint(-40, 45)))
            ad_spend = round(rng.uniform(450, 1200), 2)
            impressions = int(ad_spend * rng.uniform(48, 78))
            conversions = max(1, int(units * rng.uniform(0.65, 0.95)))
            db.add(DailyMetric(
                metric_date=d, product_id=product.id, units_sold=units, revenue=revenue,
                returns=returned, stock_on_hand=stock, stockout_hours=stockout,
                ad_spend=ad_spend, impressions=impressions, conversions=conversions,
            ))

        review_count = 175 if product_idx == 0 else 95 + product_idx * 2
        for i in range(review_count):
            recent = i < int(review_count * 0.48)
            if recent:
                review_date = today - timedelta(days=rng.randint(0, 29))
            else:
                review_date = today - timedelta(days=rng.randint(30, 89))
            if product_idx == 0:
                if recent:
                    topic = rng.choices(list(TOPICS), weights=[36, 12, 9, 10, 14, 7, 12])[0]
                else:
                    topic = rng.choices(list(TOPICS), weights=[10, 8, 10, 12, 34, 14, 12])[0]
            else:
                topic = rng.choices(list(TOPICS), weights=[12, 8, 11, 14, 30, 13, 12])[0]
            review_text, rating = _make_review_text(rng, product.name, topic, product_idx)
            if product_idx == 0 and recent and topic == "Packaging" and rng.random() < 0.66:
                rating = rng.choice([1, 2, 2, 3])
            actual_topic, sentiment = classify_review(review_text, rating)
            db.add(Review(
                product_id=product.id, review_date=review_date, rating=rating,
                review_text=review_text, source=rng.choice(["Marketplace A", "Marketplace B", "Quick-commerce", "D2C store"]),
                topic=actual_topic, sentiment=sentiment, helpful_votes=rng.randint(0, 38), embedding=None,
            ))

    db.commit()
    log.info("Seeded fictional GlowNest demo dataset: %s products", len(products))
    # Embeddings are generated by a background task in main.py so API startup is not blocked.
    return True


def embed_missing_reviews(db: Session, batch_size: int = 48) -> int:
    if not settings.has_openai:
        return 0
    from openai import OpenAI
    client = OpenAI(api_key=settings.openai_api_key)
    query = db.query(Review).filter(Review.embedding.is_(None)).order_by(Review.id)
    changed = 0
    while True:
        rows = query.limit(batch_size).all()
        if not rows:
            break
        response = client.embeddings.create(
            model=settings.openai_embedding_model,
            input=[r.review_text[:2500] for r in rows],
        )
        for row, item in zip(rows, response.data):
            row.embedding = item.embedding
        db.commit()
        changed += len(rows)
    log.info("Generated embeddings for %s reviews", changed)
    return changed
