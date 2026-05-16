from datetime import date, datetime
from typing import Optional
import uuid

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum
from pydantic import BaseModel

from auth import get_current_user
from database import get_db


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Models ---

class Trip(BaseModel):
    id: Optional[str] = None
    title: str
    location: str
    date: str


class ChatMessage(BaseModel):
    text: str
    trip_id: str


class UserProfile(BaseModel):
    full_name: Optional[str] = None
    country: Optional[str] = None
    language: Optional[str] = None
    age: Optional[int] = None
    interests: Optional[str] = None


class ItineraryItem(BaseModel):
    id: Optional[str] = None
    time: str
    place: str
    address: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    notes: Optional[str] = None


def parse_uuid(value: str, field_name: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"{field_name} must be a valid UUID") from exc


def parse_trip_dates(date_range: str) -> tuple[date, date]:
    parts = [part.strip() for part in date_range.split("-")]
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail="Trip date must use the format DD.MM.YYYY - DD.MM.YYYY")
    try:
        start_date = datetime.strptime(parts[0], "%d.%m.%Y").date()
        end_date = datetime.strptime(parts[1], "%d.%m.%Y").date()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Trip date must use the format DD.MM.YYYY - DD.MM.YYYY") from exc
    if end_date < start_date:
        raise HTTPException(status_code=400, detail="Trip end date must be after the start date")
    return start_date, end_date


def format_trip_date(start_date: date, end_date: date) -> str:
    return f"{start_date.strftime('%d.%m.%Y')} - {end_date.strftime('%d.%m.%Y')}"


def serialize_trip(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "title": row["title"],
        "location": row["location"],
        "date": format_trip_date(row["start_date"], row["end_date"]),
    }


def get_or_create_default_trip_day(db, trip_id: uuid.UUID, owner_user_id: uuid.UUID) -> uuid.UUID:
    db.execute(
        """
        SELECT id FROM trip_days
        JOIN trips ON trips.id = trip_days.trip_id
        WHERE trip_id = %s AND trips.owner_user_id = %s
        ORDER BY day_date LIMIT 1
        """,
        (trip_id, owner_user_id),
    )
    row = db.fetchone()
    if row:
        return row["id"]
    db.execute(
        """
        INSERT INTO trip_days (trip_id, day_date)
        SELECT id, start_date FROM trips
        WHERE id = %s AND owner_user_id = %s
        RETURNING id
        """,
        (trip_id, owner_user_id),
    )
    row = db.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Trip not found")
    return row["id"]


# --- Endpoints ---

@app.get("/")
def read_root():
    return {"status": "Traveleria Server is Online!"}


# 1. Trips
@app.get("/trips")
def get_trips(current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        db.execute(
            "SELECT id, title, location, start_date, end_date FROM trips WHERE owner_user_id = %s ORDER BY created_at DESC",
            (current_user["id"],),
        )
        return [serialize_trip(row) for row in db.fetchall()]


@app.post("/trips")
def add_trip(trip: Trip, current_user: dict = Depends(get_current_user)):
    start_date, end_date = parse_trip_dates(trip.date)
    with get_db() as db:
        db.execute(
            "INSERT INTO trips (owner_user_id, title, location, start_date, end_date) VALUES (%s, %s, %s, %s, %s) RETURNING id, title, location, start_date, end_date",
            (current_user["id"], trip.title, trip.location, start_date, end_date),
        )
        created_trip = serialize_trip(db.fetchone())
    return {"message": "Trip added successfully", "trip": created_trip}


# 2. Itinerary
@app.get("/trips/{trip_id}/itinerary")
def get_itinerary(trip_id: str, current_user: dict = Depends(get_current_user)):
    trip_uuid = parse_uuid(trip_id, "trip_id")
    with get_db() as db:
        db.execute(
            """
            SELECT dp.id, dp.visit_time AS time, dp.notes,
                   p.name AS place, COALESCE(p.address, '') AS address, p.lat, p.lng
            FROM day_places dp
            JOIN trip_days td ON td.id = dp.trip_day_id
            JOIN trips t ON t.id = td.trip_id
            JOIN places p ON p.id = dp.place_id
            WHERE td.trip_id = %s AND t.owner_user_id = %s
            ORDER BY td.day_date, dp.visit_time, p.name
            """,
            (trip_uuid, current_user["id"]),
        )
        return [
            {"id": str(row["id"]), "time": row["time"], "place": row["place"],
             "address": row["address"], "lat": row["lat"], "lng": row["lng"], "notes": row["notes"]}
            for row in db.fetchall()
        ]


@app.post("/trips/{trip_id}/itinerary")
def add_itinerary_item(trip_id: str, item: ItineraryItem, current_user: dict = Depends(get_current_user)):
    trip_uuid = parse_uuid(trip_id, "trip_id")
    with get_db() as db:
        trip_day_id = get_or_create_default_trip_day(db, trip_uuid, current_user["id"])
        google_place_id = f"manual:{uuid.uuid4()}"
        db.execute(
            "INSERT INTO places (name, address, google_place_id, lat, lng) VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (item.place, item.address, google_place_id, item.lat, item.lng),
        )
        place_id = db.fetchone()["id"]
        db.execute(
            "INSERT INTO day_places (trip_day_id, place_id, visit_time, notes) VALUES (%s, %s, %s, %s) RETURNING id, visit_time AS time",
            (trip_day_id, place_id, item.time, item.notes),
        )
        row = db.fetchone()
    return {"message": "Event added successfully", "item": {
        "id": str(row["id"]), "time": row["time"], "place": item.place,
        "address": item.address, "lat": item.lat, "lng": item.lng, "notes": item.notes,
    }}


@app.put("/trips/{trip_id}/itinerary/{event_id}")
def update_itinerary_item(
    trip_id: str, event_id: str, updated_item: ItineraryItem,
    current_user: dict = Depends(get_current_user),
):
    trip_uuid = parse_uuid(trip_id, "trip_id")
    event_uuid = parse_uuid(event_id, "event_id")
    with get_db() as db:
        db.execute(
            """
            SELECT dp.id, dp.place_id FROM day_places dp
            JOIN trip_days td ON td.id = dp.trip_day_id
            JOIN trips t ON t.id = td.trip_id
            WHERE dp.id = %s AND td.trip_id = %s AND t.owner_user_id = %s
            """,
            (event_uuid, trip_uuid, current_user["id"]),
        )
        row = db.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
        db.execute(
            "UPDATE places SET name = %s, address = %s, lat = %s, lng = %s, updated_at = NOW() WHERE id = %s",
            (updated_item.place, updated_item.address, updated_item.lat, updated_item.lng, row["place_id"]),
        )
        db.execute(
            "UPDATE day_places SET visit_time = %s, notes = %s, updated_at = NOW() WHERE id = %s",
            (updated_item.time, updated_item.notes, event_uuid),
        )
    return {"message": "Event updated successfully"}


@app.delete("/trips/{trip_id}/itinerary/{event_id}")
def delete_itinerary_item(
    trip_id: str, event_id: str, current_user: dict = Depends(get_current_user),
):
    trip_uuid = parse_uuid(trip_id, "trip_id")
    event_uuid = parse_uuid(event_id, "event_id")
    with get_db() as db:
        db.execute(
            """
            SELECT dp.id, dp.place_id FROM day_places dp
            JOIN trip_days td ON td.id = dp.trip_day_id
            JOIN trips t ON t.id = td.trip_id
            WHERE dp.id = %s AND td.trip_id = %s AND t.owner_user_id = %s
            """,
            (event_uuid, trip_uuid, current_user["id"]),
        )
        row = db.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
        place_id = row["place_id"]
        db.execute("DELETE FROM day_places WHERE id = %s", (event_uuid,))
        db.execute("DELETE FROM places WHERE id = %s", (place_id,))
    return {"message": "Event deleted successfully"}


# 3. User Profile
@app.get("/users/me")
def get_profile(current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        db.execute(
            """
            SELECT full_name, country, language, age, interests,
                   (SELECT COUNT(*) FROM trips WHERE owner_user_id = %s) AS trips_count
            FROM users WHERE id = %s
            """,
            (current_user["id"], current_user["id"]),
        )
        row = db.fetchone()
    return {
        "email": current_user["email"],
        "full_name": row["full_name"],
        "country": row["country"],
        "language": row["language"],
        "age": row["age"],
        "interests": row["interests"],
        "trips_count": row["trips_count"],
    }


@app.patch("/users/me")
def update_profile(profile: UserProfile, current_user: dict = Depends(get_current_user)):
    with get_db() as db:
        db.execute(
            """
            UPDATE users
            SET full_name = COALESCE(%s, full_name), country = COALESCE(%s, country),
                language = COALESCE(%s, language), age = COALESCE(%s, age),
                interests = COALESCE(%s, interests), updated_at = NOW()
            WHERE id = %s
            RETURNING full_name, country, language, age, interests
            """,
            (profile.full_name, profile.country, profile.language,
             profile.age, profile.interests, current_user["id"]),
        )
        row = db.fetchone()
    return {
        "full_name": row["full_name"], "country": row["country"],
        "language": row["language"], "age": row["age"], "interests": row["interests"],
    }


# 4. AI Chat
@app.post("/chat")
def chat_with_ai(message: ChatMessage, _current_user: dict = Depends(get_current_user)):
    user_text = message.text.lower()
    if "food" in user_text or "eat" in user_text:
        response = "I found some great local restaurants near your location. Should I add them to your itinerary?"
    elif "weather" in user_text:
        response = "The forecast for your trip looks sunny! Perfect for outdoor activities."
    else:
        response = f"I've noted your request about '{message.text}'. How else can I assist with your trip?"
    return {"text": response}


# NOTE: Wallet / S3 document storage is handled by AWS Lambda + API Gateway.


handler = Mangum(app)


handler = Mangum(app)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
