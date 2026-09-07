"""
Destination cover photos. Each destination (by slug) can hold a pool of
several cover photos in `destination_covers` rather than exactly one — a trip
is assigned a cover not already used by another of the *same user's* existing
trips to that destination, so a second trip you make to a place you've
already been to gets a different photo instead of sharing the first one.
Different users can still land on the same photo for the same destination —
only your own trips compete with each other for the pool. A cache miss (every
pool photo already taken by you, or there are none yet) fetches one more from
Pexels and re-hosts it in S3.

Pexels's license permits caching/rehosting images indefinitely without
attribution, so unlike some other stock photo APIs there is no required
credit or download trigger here — `credit_name`/`credit_url` are stored but
not shown in the UI.

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
    """Returns the id of the shared fallback cover row, creating it once if missing."""
    db.execute("SELECT id FROM destination_covers WHERE slug = %s LIMIT 1", (FALLBACK_SLUG,))
    row = db.fetchone()
    if row:
        return row["id"]
    db.execute(
        "INSERT INTO destination_covers (slug, cover_image_url) VALUES (%s, %s) RETURNING id",
        (FALLBACK_SLUG, _bucket_url(FALLBACK_KEY)),
    )
    return db.fetchone()["id"]


def get_or_create_cover_id(db, destination: str, owner_user_id, exclude_trip_id=None):
    """
    Resolves a destination to a `destination_covers.id`, assigning a cover not
    already used by another of `owner_user_id`'s own existing trips to the
    same destination. Other users' trips are not considered — only this
    user's trips compete with each other for the pool.

    `exclude_trip_id` is the trip being updated (so its own current cover
    still counts as "available" to it when the destination has not changed,
    rather than being bumped to a new photo on every unrelated edit) — omit
    it when creating a new trip, which cannot already own a cover.
    """
    if not destination or not BUCKET:
        return _ensure_fallback(db)

    slug = _slugify(destination)

    db.execute(
        """
        SELECT dc.id FROM destination_covers dc
        WHERE dc.slug = %(slug)s
          AND NOT EXISTS (
              SELECT 1 FROM trips t
              WHERE t.destination_cover_id = dc.id
                AND t.owner_user_id = %(owner_user_id)s
                AND t.id IS DISTINCT FROM %(exclude_trip_id)s
          )
        ORDER BY dc.created_at
        LIMIT 1
        """,
        {"slug": slug, "owner_user_id": owner_user_id, "exclude_trip_id": exclude_trip_id},
    )
    row = db.fetchone()
    if row:
        return row["id"]

    fetched = _fetch_pexels_photo(destination)
    if not fetched:
        return _ensure_fallback(db)

    image_bytes, credit_name, credit_url, photo_id = fetched
    key = f"covers/destinations/{slug}/{photo_id}.jpg"

    try:
        _s3.put_object(Bucket=BUCKET, Key=key, Body=image_bytes, ContentType="image/jpeg")
    except Exception:
        return _ensure_fallback(db)

    db.execute(
        """
        INSERT INTO destination_covers (slug, cover_image_url, credit_name, credit_url, photo_id)
        VALUES (%s, %s, %s, %s, %s)
        RETURNING id
        """,
        (slug, _bucket_url(key), credit_name, credit_url, photo_id),
    )
    return db.fetchone()["id"]
