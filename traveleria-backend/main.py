from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List

app = FastAPI()

# Enable CORS for mobile app communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Models for Data Validation ---

class Trip(BaseModel):
    id: str
    title: str
    location: str
    date: str  # This matches the "DD.MM.YYYY - DD.MM.YYYY" format from your app


class ChatMessage(BaseModel):
    text: str
    trip_id: str


class ItineraryItem(BaseModel):
    id: str
    time: str
    place: str
    address: str


# --- Mock Databases (Temporary until AWS RDS) ---

trips_db = [
    {"id": "1", "title": "Summer in Santorini", "date": "15.06.2024 - 22.06.2024", "location": "OIA, GREECE"},
    {"id": "2", "title": "Kyoto Cherry Blossoms", "date": "02.04.2024 - 10.04.2024", "location": "KYOTO, JAPAN"},
]

itineraries_db = {
    "1": [
        {"id": "101", "time": "09:00", "place": "Colosseum", "address": "Piazza del Colosseo, 1"},
        {"id": "102", "time": "12:30", "place": "Trattoria Romano", "address": "Via delle Muratte, 9"},
    ],
    "default": [
        {"id": "0", "time": "10:00", "place": "Local Landmark", "address": "City Center"}
    ]
}


# --- Endpoints ---

@app.get("/")
def read_root():
    print("LOG: Someone checked the server status!")
    return {"status": "Traveleria Server is Online!"}

# 1. Trips Management
@app.get("/trips")
def get_trips():
    return trips_db


@app.post("/trips")
def add_trip(trip: Trip):
    trips_db.append(trip.dict())
    return {"message": "Trip added successfully", "trip": trip}


# 2. Itinerary Management
@app.get("/trips/{trip_id}/itinerary")
def get_itinerary(trip_id: str):
    return itineraries_db.get(trip_id, [])


@app.post("/trips/{trip_id}/itinerary")
def add_itinerary_item(trip_id: str, item: ItineraryItem):
    if trip_id not in itineraries_db:
        itineraries_db[trip_id] = []
    itineraries_db[trip_id].append(item.dict())
    return {"message": "Event added successfully", "item": item}


# 3. AI Chat Logic
@app.post("/chat")
def chat_with_ai(message: ChatMessage):
    user_text = message.text.lower()

    if "food" in user_text or "eat" in user_text:
        response = "I found some great local restaurants near your location. Should I add them to your itinerary?"
    elif "weather" in user_text:
        response = "The forecast for your trip looks sunny! Perfect for outdoor activities."
    else:
        response = f"I've noted your request about '{message.text}'. How else can I assist with your trip?"

    return {"text": response}


if __name__ == "__main__":
    import uvicorn

    # Make sure host is 0.0.0.0 to allow access from your phone
    uvicorn.run(app, host="0.0.0.0", port=8000)