"""
Destination cover photos, cached once per destination in `destination_covers`
and reused by every trip that shares it (see photo_cover.md). A cache miss
fetches one Pexels photo, re-hosts it in S3, and upserts the cache row;
Pexels is never called again for that destination afterwards.

Pexels's license permits permanent caching/rehosting without attribution, so
unlike some other stock photo APIs there is no required credit or download
trigger here — `credit_name`/`credit_url` are stored purely as a nice-to-have
for the UI.

Never raises: any failure (missing config, network, Pexels quota, S3) falls
back to a shared default cover rather than blocking trip creation.
"""

import os
import re

import boto3
import httpx

PEXELS_API_KEY = os.getenv("PEXELS_API_KEY", "")
BUCKET = os.getenv("TRIP_COVERS_BUCKET", "")
REGION = os.getenv("AWS_REGION", "us-east-1")

FALLBACK_SLUG = "travel-default"
FALLBACK_KEY = "covers/defaults/travel-cover.jpg"

_s3 = boto3.client("s3", region_name=REGION)


def _bucket_url(key: str) -> str:
    return f"https://{BUCKET}.s3.{REGION}.amazonaws.com/{key}"


def _slugify(destination: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", destination.strip().lower()).strip("_")
    return slug or "unknown"


def _fetch_pexels_photo(destination: str):
    """Returns (image_bytes, credit_name, credit_url, photo_id), or None on any failure."""
    if not PEXELS_API_KEY:
        return None
    try:
        resp = httpx.get(
            "https://api.pexels.com/v1/search",
            params={
                "query": f"{destination} landmark landscape",
                "orientation": "landscape",
                "per_page": 1,
            },
            headers={"Authorization": PEXELS_API_KEY},
            timeout=10.0,
        )
        photos = resp.json().get("photos") or []
        if not photos:
            return None
        photo = photos[0]
        photo_id = str(photo["id"])
        image_url = photo["src"]["large"]
        credit_name = photo.get("photographer")
        credit_url = photo.get("photographer_url")

        image_resp = httpx.get(image_url, timeout=15.0)
        image_resp.raise_for_status()

        return image_resp.content, credit_name, credit_url, photo_id
    except Exception:
        return None


def _ensure_fallback(db) -> str:
    db.execute(
        """
        INSERT INTO destination_covers (slug, cover_image_url)
        VALUES (%s, %s)
        ON CONFLICT (slug) DO NOTHING
        """,
        (FALLBACK_SLUG, _bucket_url(FALLBACK_KEY)),
    )
    return FALLBACK_SLUG


def get_or_create_cover_slug(db, destination: str) -> str:
    """Resolves a destination to its `destination_covers.slug`, populating the cache on a miss."""
    if not destination or not BUCKET:
        return _ensure_fallback(db)

    slug = _slugify(destination)

    db.execute("SELECT 1 FROM destination_covers WHERE slug = %s", (slug,))
    if db.fetchone():
        return slug

    fetched = _fetch_pexels_photo(destination)
    if not fetched:
        return _ensure_fallback(db)

    image_bytes, credit_name, credit_url, photo_id = fetched
    key = f"covers/destinations/{slug}.jpg"

    try:
        _s3.put_object(Bucket=BUCKET, Key=key, Body=image_bytes, ContentType="image/jpeg")
    except Exception:
        return _ensure_fallback(db)

    db.execute(
        """
        INSERT INTO destination_covers (slug, cover_image_url, credit_name, credit_url, photo_id)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (slug) DO UPDATE SET
            cover_image_url = EXCLUDED.cover_image_url,
            credit_name = EXCLUDED.credit_name,
            credit_url = EXCLUDED.credit_url,
            photo_id = EXCLUDED.photo_id
        """,
        (slug, _bucket_url(key), credit_name, credit_url, photo_id),
    )
    return slug
