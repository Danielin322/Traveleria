"""
Social feed: posts, likes, and threaded comments.

Post images ride the same two-phase S3 upload as wallet documents and the
profile photo (reserve a row, sign a PUT, confirm) and live in the same
WALLET_BUCKET, under users/<id>/social/ rather than users/<id>/wallet/. No
new bucket, no new env var to wire up.

Comments are stored as a flat, self-referencing table (parent_comment_id),
so a reply to a reply is just another row. This handler flattens each
top-level comment's whole subtree into one `replies` list, ordered by time,
tagging any reply that was not aimed at the top-level comment itself with
`replyingToName` -- the same one-level-of-nesting-on-screen convention
Instagram and Facebook use for deeper threads.
"""

import mimetypes
import os
import uuid

import boto3
from botocore.config import Config

from shared.auth import get_current_user
from shared.database import get_db
from shared.response import error, success
from shared.utils import AppError, format_trip_date, parse_body, parse_uuid

BUCKET = os.getenv("WALLET_BUCKET", "")

VIEW_URL_TTL_SECONDS = 15 * 60
UPLOAD_URL_TTL_SECONDS = 5 * 60
MAX_UPLOAD_BYTES = 15 * 1024 * 1024
MAX_POST_TEXT_LENGTH = 2000
MAX_COMMENT_LENGTH = 1000

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic"}

# SigV4 is required for presigned URLs to validate in every region.
_s3 = boto3.client("s3", config=Config(signature_version="s3v4"))


def lambda_handler(event, context):
    method = event.get("httpMethod", "GET")
    resource = event.get("resource", "")
    try:
        current_user = get_current_user(event)

        if resource == "/social/posts":
            if method == "GET":
                return _list_posts(current_user)
            if method == "POST":
                return _create_post(event, current_user)
        elif resource == "/social/posts/{post_id}":
            if method == "PUT":
                return _confirm_post(event, current_user)
            if method == "DELETE":
                return _delete_post(event, current_user)
        elif resource == "/social/posts/{post_id}/like":
            if method == "POST":
                return _like_post(event, current_user)
            if method == "DELETE":
                return _unlike_post(event, current_user)
        elif resource == "/social/posts/{post_id}/comments":
            if method == "POST":
                return _create_comment(event, current_user)
        elif resource == "/social/comments/{comment_id}":
            if method == "DELETE":
                return _delete_comment(event, current_user)
        elif resource == "/social/people":
            if method == "GET":
                return _list_people(current_user)
        elif resource == "/social/users/{user_id}":
            if method == "GET":
                return _get_user_profile(event, current_user)
        elif resource == "/social/users/{user_id}/follow":
            if method == "POST":
                return _follow_user(event, current_user)
            if method == "DELETE":
                return _unfollow_user(event, current_user)
        elif resource == "/social/users/{user_id}/posts":
            if method == "GET":
                return _get_user_posts(event, current_user)
        elif resource == "/social/shared-trips/{trip_id}":
            if method == "GET":
                return _get_shared_trip(event, current_user)
        elif resource == "/social/shared-trips/{trip_id}/copy":
            if method == "POST":
                return _copy_shared_trip(event, current_user)
        return error("Method not allowed", 405)
    except AppError as e:
        return error(e.message, e.status)
    except Exception as e:
        return error(str(e), 500)


def _display_name(full_name, email):
    """
    full_name is optional (see sql/002_user_profile.sql), and get_current_user
    fills in a synthetic `<sub>@cognito.local` email for a token with no real
    one, so neither is safe to show as-is.
    """
    if full_name:
        return full_name
    if email and not email.endswith("@cognito.local"):
        return email.split("@", 1)[0]
    return "Traveler"


def _file_url(s3_key):
    if not s3_key or not BUCKET:
        return None
    return _s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": BUCKET, "Key": s3_key},
        ExpiresIn=VIEW_URL_TTL_SECONDS,
    )


def _serialize_user(user_id, full_name, email, avatar_s3_key):
    return {
        "id": str(user_id),
        "name": _display_name(full_name, email),
        "avatar": _file_url(avatar_s3_key),
    }


def _serialize_comments(comment_rows):
    """
    Turns the flat, self-referencing comment rows for one post into the
    (top-level comment, replies[]) shape the app renders. Every descendant of
    a top-level comment -- direct reply or reply-to-a-reply, to any depth --
    ends up in that comment's `replies`, each carrying a `depth` (1 = direct
    reply to the top-level comment, 2 = reply to a reply, and so on) so the
    UI can indent it correctly.

    Traversal is depth-first, not a global sort by time: a reply's own
    replies are listed immediately after it, before its siblings, so the
    thread's actual shape is visible in list order. Within one parent,
    siblings are still chronological.
    """
    children_by_parent: dict = {}
    for row in comment_rows:
        children_by_parent.setdefault(row["parent_comment_id"], []).append(row)
    for children in children_by_parent.values():
        children.sort(key=lambda r: r["created_at"])
    by_id = {row["id"]: row for row in comment_rows}

    def flatten(comment_id, depth):
        result = []
        for child in children_by_parent.get(comment_id, []):
            result.append((child, depth))
            result.extend(flatten(child["id"], depth + 1))
        return result

    comments = []
    for top in children_by_parent.get(None, []):
        replies = []
        for row, depth in flatten(top["id"], 1):
            parent = by_id[row["parent_comment_id"]]
            replies.append({
                "id": str(row["id"]),
                "user": _serialize_user(
                    row["user_id"], row["full_name"], row["email"], row["avatar_s3_key"]
                ),
                "text": row["text"],
                "createdAt": row["created_at"].isoformat(),
                "depth": depth,
                # None when replying straight to the top-level comment --
                # nothing extra to show there, same as before this existed.
                "replyingToName": (
                    _display_name(parent["full_name"], parent["email"])
                    if parent["id"] != top["id"]
                    else None
                ),
            })
        comments.append({
            "id": str(top["id"]),
            "user": _serialize_user(
                top["user_id"], top["full_name"], top["email"], top["avatar_s3_key"]
            ),
            "text": top["text"],
            "createdAt": top["created_at"].isoformat(),
            "replies": replies,
        })
    return comments


def _list_posts(current_user, author_id=None):
    """
    The main feed (author_id=None) is Instagram-style: the caller's own posts
    plus posts from anyone they follow, not every post in the app. Passing
    author_id narrows to one person's posts instead -- what a profile screen
    shows -- reusing the same query and serialization either way.
    """
    if author_id:
        scope_clause = "p.user_id = %s"
        scope_params = (author_id,)
    else:
        scope_clause = (
            "(p.user_id = %s OR p.user_id IN "
            "(SELECT followed_id FROM follows WHERE follower_id = %s))"
        )
        scope_params = (current_user["id"], current_user["id"])

    with get_db() as db:
        # Rows still 'pending' after an hour are uploads that never completed;
        # hiding them keeps a failed attempt from showing as a broken post.
        # st (shared trip) is a LEFT JOIN and always reflects the trip's
        # *current* title/dates -- this is a live link, not a snapshot taken
        # at share time -- and reads as "no trip" when st.id is NULL, which
        # covers both "never shared a trip" and "the trip was later deleted"
        # (shared_trip_id -> ON DELETE SET NULL).
        db.execute(
            f"""
            SELECT p.id, p.text, p.image_s3_key, p.created_at,
                   u.id AS author_id, u.full_name, u.email, u.avatar_s3_key,
                   st.id AS shared_trip_id, st.title AS shared_trip_title,
                   st.location AS shared_trip_location,
                   st.start_date AS shared_trip_start_date,
                   st.end_date AS shared_trip_end_date,
                   (SELECT COUNT(*) FROM day_places dp
                    JOIN trip_days td ON td.id = dp.trip_day_id
                    WHERE td.trip_id = st.id) AS shared_trip_events_count
            FROM posts p
            JOIN users u ON u.id = p.user_id
            LEFT JOIN trips st ON st.id = p.shared_trip_id
            WHERE (p.upload_status = 'ready' OR p.created_at > NOW() - INTERVAL '1 hour')
              AND {scope_clause}
            ORDER BY p.created_at DESC
            """,
            scope_params,
        )
        posts = db.fetchall()
        post_ids = [row["id"] for row in posts]

        likes_by_post = {pid: [] for pid in post_ids}
        comments_by_post = {pid: [] for pid in post_ids}

        if post_ids:
            db.execute(
                """
                SELECT pl.post_id, u.id AS user_id, u.full_name, u.email, u.avatar_s3_key
                FROM post_likes pl
                JOIN users u ON u.id = pl.user_id
                WHERE pl.post_id = ANY(%s)
                ORDER BY pl.created_at
                """,
                (post_ids,),
            )
            for row in db.fetchall():
                likes_by_post[row["post_id"]].append(row)

            db.execute(
                """
                SELECT c.id, c.post_id, c.parent_comment_id, c.text, c.created_at,
                       u.id AS user_id, u.full_name, u.email, u.avatar_s3_key
                FROM post_comments c
                JOIN users u ON u.id = c.user_id
                WHERE c.post_id = ANY(%s)
                ORDER BY c.created_at
                """,
                (post_ids,),
            )
            for row in db.fetchall():
                comments_by_post[row["post_id"]].append(row)

    return success([
        {
            "id": str(row["id"]),
            "user": _serialize_user(
                row["author_id"], row["full_name"], row["email"], row["avatar_s3_key"]
            ),
            "text": row["text"],
            "imageUri": _file_url(row["image_s3_key"]),
            "sharedTrip": (
                {
                    "id": str(row["shared_trip_id"]),
                    "title": row["shared_trip_title"],
                    "location": row["shared_trip_location"],
                    "date": format_trip_date(
                        row["shared_trip_start_date"], row["shared_trip_end_date"]
                    ),
                    "eventsCount": row["shared_trip_events_count"],
                }
                if row["shared_trip_id"]
                else None
            ),
            "createdAt": row["created_at"].isoformat(),
            "likes": [
                _serialize_user(r["user_id"], r["full_name"], r["email"], r["avatar_s3_key"])
                for r in likes_by_post[row["id"]]
            ],
            "comments": _serialize_comments(comments_by_post[row["id"]]),
        }
        for row in posts
    ])


def _create_post(event, current_user):
    body = parse_body(event)
    text = (body.get("text") or "").strip() or None
    if text and len(text) > MAX_POST_TEXT_LENGTH:
        raise AppError(f"Posts must be {MAX_POST_TEXT_LENGTH} characters or fewer")

    mime_type = body.get("mimeType") or None
    has_image = bool(mime_type)
    if has_image and mime_type not in ALLOWED_IMAGE_TYPES:
        raise AppError(f"Unsupported image type: {mime_type}")

    raw_shared_trip_id = body.get("sharedTripId") or None
    shared_trip_uuid = (
        parse_uuid(raw_shared_trip_id, "sharedTripId") if raw_shared_trip_id else None
    )
    if shared_trip_uuid and has_image:
        raise AppError("A post can share a photo or a trip, not both")

    if not text and not has_image and not shared_trip_uuid:
        raise AppError("Add some text, a photo, or a trip first.")

    size = body.get("size")
    if isinstance(size, int) and size > MAX_UPLOAD_BYTES:
        raise AppError(f"Images must be {MAX_UPLOAD_BYTES // (1024 * 1024)} MB or smaller")

    post_id = uuid.uuid4()
    image_s3_key, upload_url = None, None
    if has_image:
        if not BUCKET:
            raise AppError("WALLET_BUCKET is not configured", status=500)
        extension = mimetypes.guess_extension(mime_type) or ""
        image_s3_key = f"users/{current_user['id']}/social/{post_id}{extension}"
        upload_url = _s3.generate_presigned_url(
            "put_object",
            Params={"Bucket": BUCKET, "Key": image_s3_key, "ContentType": mime_type},
            ExpiresIn=UPLOAD_URL_TTL_SECONDS,
        )

    with get_db() as db:
        if shared_trip_uuid:
            # Only your own trip can be shared -- this is not the co-editing
            # feature, so there is no "editor of someone else's trip" case.
            db.execute(
                "SELECT id FROM trips WHERE id = %s AND owner_user_id = %s",
                (shared_trip_uuid, current_user["id"]),
            )
            if not db.fetchone():
                raise AppError("Trip not found", status=404)

        db.execute(
            """
            INSERT INTO posts (id, user_id, text, image_s3_key, upload_status, shared_trip_id)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING created_at
            """,
            (
                post_id,
                current_user["id"],
                text,
                image_s3_key,
                "pending" if has_image else "ready",
                shared_trip_uuid,
            ),
        )
        row = db.fetchone()

    return success({
        "id": str(post_id),
        "createdAt": row["created_at"].isoformat(),
        "uploadUrl": upload_url,
        "contentType": mime_type,
    }, status=201)


def _confirm_post(event, current_user):
    post_uuid = parse_uuid((event.get("pathParameters") or {}).get("post_id", ""), "post_id")
    body = parse_body(event)

    if body.get("confirmUpload"):
        with get_db() as db:
            db.execute(
                """
                UPDATE posts SET upload_status = 'ready', updated_at = NOW()
                WHERE id = %s AND user_id = %s
                RETURNING id
                """,
                (post_uuid, current_user["id"]),
            )
            if not db.fetchone():
                raise AppError("Post not found", status=404)
        return success({"message": "Post confirmed"})

    if "text" in body:
        # An edit, not a way to blank a post -- images stay immutable
        # (not requested), so this only ever touches the text column.
        text = (body.get("text") or "").strip()
        if not text:
            raise AppError("Post text cannot be empty")
        if len(text) > MAX_POST_TEXT_LENGTH:
            raise AppError(f"Posts must be {MAX_POST_TEXT_LENGTH} characters or fewer")
        with get_db() as db:
            db.execute(
                """
                UPDATE posts SET text = %s, updated_at = NOW()
                WHERE id = %s AND user_id = %s
                RETURNING id
                """,
                (text, post_uuid, current_user["id"]),
            )
            if not db.fetchone():
                raise AppError("Post not found", status=404)
        return success({"message": "Post updated"})

    raise AppError("Nothing to update")


def _delete_post(event, current_user):
    post_uuid = parse_uuid((event.get("pathParameters") or {}).get("post_id", ""), "post_id")
    with get_db() as db:
        db.execute(
            "SELECT image_s3_key FROM posts WHERE id = %s AND user_id = %s",
            (post_uuid, current_user["id"]),
        )
        row = db.fetchone()
        if not row:
            # Missing and belonging-to-someone-else look identical from here,
            # and both are answered the same way.
            raise AppError("Post not found", status=404)

        # Object first, like wallet's delete: a failure here leaves the row in
        # place and the delete can be retried, rather than orphaning the image.
        if row["image_s3_key"] and BUCKET:
            _s3.delete_object(Bucket=BUCKET, Key=row["image_s3_key"])
        # Cascades post_likes and post_comments (and their reply subtrees).
        db.execute("DELETE FROM posts WHERE id = %s", (post_uuid,))

    return success({"message": "Post deleted successfully"})


def _like_post(event, current_user):
    post_uuid = parse_uuid((event.get("pathParameters") or {}).get("post_id", ""), "post_id")
    with get_db() as db:
        db.execute("SELECT id FROM posts WHERE id = %s", (post_uuid,))
        if not db.fetchone():
            raise AppError("Post not found", status=404)
        db.execute(
            """
            INSERT INTO post_likes (post_id, user_id) VALUES (%s, %s)
            ON CONFLICT (post_id, user_id) DO NOTHING
            """,
            (post_uuid, current_user["id"]),
        )
    return success({"message": "Liked"})


def _unlike_post(event, current_user):
    post_uuid = parse_uuid((event.get("pathParameters") or {}).get("post_id", ""), "post_id")
    with get_db() as db:
        db.execute(
            "DELETE FROM post_likes WHERE post_id = %s AND user_id = %s",
            (post_uuid, current_user["id"]),
        )
    return success({"message": "Unliked"})


def _create_comment(event, current_user):
    post_uuid = parse_uuid((event.get("pathParameters") or {}).get("post_id", ""), "post_id")
    body = parse_body(event)
    text = (body.get("text") or "").strip()
    if not text:
        raise AppError("Comment cannot be empty")
    if len(text) > MAX_COMMENT_LENGTH:
        raise AppError(f"Comments must be {MAX_COMMENT_LENGTH} characters or fewer")

    raw_parent = body.get("parentCommentId")
    parent_uuid = parse_uuid(raw_parent, "parentCommentId") if raw_parent else None

    with get_db() as db:
        db.execute("SELECT id FROM posts WHERE id = %s", (post_uuid,))
        if not db.fetchone():
            raise AppError("Post not found", status=404)

        if parent_uuid:
            # Must belong to the same post, or a client could stitch a reply
            # onto a comment thread on a different post.
            db.execute(
                "SELECT id FROM post_comments WHERE id = %s AND post_id = %s",
                (parent_uuid, post_uuid),
            )
            if not db.fetchone():
                raise AppError("Comment not found", status=404)

        db.execute(
            """
            INSERT INTO post_comments (post_id, user_id, parent_comment_id, text)
            VALUES (%s, %s, %s, %s)
            RETURNING id, created_at
            """,
            (post_uuid, current_user["id"], parent_uuid, text),
        )
        row = db.fetchone()

    return success({"id": str(row["id"]), "createdAt": row["created_at"].isoformat()}, status=201)


def _delete_comment(event, current_user):
    comment_uuid = parse_uuid(
        (event.get("pathParameters") or {}).get("comment_id", ""), "comment_id"
    )
    with get_db() as db:
        # Cascades any replies nested under this comment, same as a post
        # taking its comments with it.
        db.execute(
            "DELETE FROM post_comments WHERE id = %s AND user_id = %s RETURNING id",
            (comment_uuid, current_user["id"]),
        )
        if not db.fetchone():
            raise AppError("Comment not found", status=404)
    return success({"message": "Comment deleted successfully"})


def _list_people(current_user):
    """Everyone but the caller, for a "find people to follow" screen."""
    with get_db() as db:
        db.execute(
            """
            SELECT u.id, u.full_name, u.email, u.avatar_s3_key,
                   EXISTS(
                       SELECT 1 FROM follows
                       WHERE follower_id = %s AND followed_id = u.id
                   ) AS is_following,
                   (SELECT COUNT(*) FROM follows WHERE followed_id = u.id) AS followers_count
            FROM users u
            WHERE u.id != %s
            ORDER BY u.created_at DESC
            """,
            (current_user["id"], current_user["id"]),
        )
        rows = db.fetchall()

    return success([
        {
            **_serialize_user(row["id"], row["full_name"], row["email"], row["avatar_s3_key"]),
            "isFollowing": row["is_following"],
            "followersCount": row["followers_count"],
        }
        for row in rows
    ])


def _get_user_profile(event, current_user):
    user_uuid = parse_uuid((event.get("pathParameters") or {}).get("user_id", ""), "user_id")
    with get_db() as db:
        db.execute(
            "SELECT id, full_name, email, avatar_s3_key FROM users WHERE id = %s",
            (user_uuid,),
        )
        user = db.fetchone()
        if not user:
            raise AppError("User not found", status=404)

        db.execute(
            "SELECT COUNT(*) AS n FROM posts WHERE user_id = %s AND upload_status = 'ready'",
            (user_uuid,),
        )
        posts_count = db.fetchone()["n"]

        db.execute("SELECT COUNT(*) AS n FROM follows WHERE followed_id = %s", (user_uuid,))
        followers_count = db.fetchone()["n"]

        db.execute("SELECT COUNT(*) AS n FROM follows WHERE follower_id = %s", (user_uuid,))
        following_count = db.fetchone()["n"]

        db.execute(
            "SELECT 1 FROM follows WHERE follower_id = %s AND followed_id = %s",
            (current_user["id"], user_uuid),
        )
        is_following = db.fetchone() is not None

    return success({
        **_serialize_user(user["id"], user["full_name"], user["email"], user["avatar_s3_key"]),
        "postsCount": posts_count,
        "followersCount": followers_count,
        "followingCount": following_count,
        "isFollowing": is_following,
        "isMe": user["id"] == current_user["id"],
    })


def _get_user_posts(event, current_user):
    user_uuid = parse_uuid((event.get("pathParameters") or {}).get("user_id", ""), "user_id")
    return _list_posts(current_user, author_id=user_uuid)


def _follow_user(event, current_user):
    user_uuid = parse_uuid((event.get("pathParameters") or {}).get("user_id", ""), "user_id")
    if user_uuid == current_user["id"]:
        raise AppError("You cannot follow yourself")
    with get_db() as db:
        db.execute("SELECT id FROM users WHERE id = %s", (user_uuid,))
        if not db.fetchone():
            raise AppError("User not found", status=404)
        db.execute(
            """
            INSERT INTO follows (follower_id, followed_id) VALUES (%s, %s)
            ON CONFLICT (follower_id, followed_id) DO NOTHING
            """,
            (current_user["id"], user_uuid),
        )
    return success({"message": "Followed"})


def _unfollow_user(event, current_user):
    user_uuid = parse_uuid((event.get("pathParameters") or {}).get("user_id", ""), "user_id")
    with get_db() as db:
        db.execute(
            "DELETE FROM follows WHERE follower_id = %s AND followed_id = %s",
            (current_user["id"], user_uuid),
        )
    return success({"message": "Unfollowed"})


def _find_visible_trip(db, trip_uuid, current_user):
    """
    A shared trip is visible read-only to its owner, or to anyone at all once
    some post shares it -- "viewer" here just means "can see the post", not a
    collaborator role. Returns the trip row or raises 404.
    """
    db.execute(
        """
        SELECT id, title, location, start_date, end_date, owner_user_id
        FROM trips
        WHERE id = %s AND (
            owner_user_id = %s
            OR EXISTS (SELECT 1 FROM posts WHERE shared_trip_id = trips.id)
        )
        """,
        (trip_uuid, current_user["id"]),
    )
    trip = db.fetchone()
    if not trip:
        raise AppError("Trip not found", status=404)
    return trip


def _get_shared_trip(event, current_user):
    trip_uuid = parse_uuid((event.get("pathParameters") or {}).get("trip_id", ""), "trip_id")
    with get_db() as db:
        trip = _find_visible_trip(db, trip_uuid, current_user)

        db.execute(
            """
            SELECT dp.id, dp.visit_time AS time, dp.notes, td.day_date,
                   p.name AS place, COALESCE(p.address, '') AS address, p.lat, p.lng
            FROM day_places dp
            JOIN trip_days td ON td.id = dp.trip_day_id
            JOIN places p ON p.id = dp.place_id
            WHERE td.trip_id = %s
            ORDER BY td.day_date, dp.visit_time, p.name
            """,
            (trip_uuid,),
        )
        itinerary = [
            {
                "id": str(row["id"]),
                "date": row["day_date"].strftime("%d.%m.%Y"),
                "time": row["time"],
                "place": row["place"],
                "address": row["address"],
                "lat": row["lat"],
                "lng": row["lng"],
                "notes": row["notes"],
            }
            for row in db.fetchall()
        ]

    return success({
        "trip": {
            "id": str(trip["id"]),
            "title": trip["title"],
            "location": trip["location"],
            "date": format_trip_date(trip["start_date"], trip["end_date"]),
            "isOwner": trip["owner_user_id"] == current_user["id"],
        },
        "itinerary": itinerary,
    })


def _copy_shared_trip(event, current_user):
    trip_uuid = parse_uuid((event.get("pathParameters") or {}).get("trip_id", ""), "trip_id")
    with get_db() as db:
        trip = _find_visible_trip(db, trip_uuid, current_user)

        db.execute(
            """
            INSERT INTO trips (owner_user_id, title, location, start_date, end_date)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id, title, location, start_date, end_date
            """,
            (
                current_user["id"],
                f"{trip['title']} (Copy)",
                trip["location"],
                trip["start_date"],
                trip["end_date"],
            ),
        )
        new_trip = db.fetchone()

        db.execute(
            "SELECT id, day_date FROM trip_days WHERE trip_id = %s",
            (trip_uuid,),
        )
        source_days = db.fetchall()

        day_id_by_new_date = {}
        for day in source_days:
            db.execute(
                "INSERT INTO trip_days (trip_id, day_date) VALUES (%s, %s) RETURNING id",
                (new_trip["id"], day["day_date"]),
            )
            day_id_by_new_date[day["id"]] = db.fetchone()["id"]

        if day_id_by_new_date:
            # place_id is reused as-is, not duplicated -- day_places already
            # points at a shared places table with no ownership tie (see the
            # comment in lambdas/trips/handler.py's _delete_trip).
            db.execute(
                """
                SELECT trip_day_id, place_id, visit_time, notes
                FROM day_places WHERE trip_day_id = ANY(%s)
                """,
                (list(day_id_by_new_date.keys()),),
            )
            for row in db.fetchall():
                db.execute(
                    """
                    INSERT INTO day_places (trip_day_id, place_id, visit_time, notes)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (
                        day_id_by_new_date[row["trip_day_id"]],
                        row["place_id"],
                        row["visit_time"],
                        row["notes"],
                    ),
                )

    return success({
        "message": "Trip copied to your journeys",
        "trip": {
            "id": str(new_trip["id"]),
            "title": new_trip["title"],
            "location": new_trip["location"],
            "date": format_trip_date(new_trip["start_date"], new_trip["end_date"]),
        },
    }, status=201)
