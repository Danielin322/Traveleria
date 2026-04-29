from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

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
    date: str


class ChatMessage(BaseModel):
    text: str
    trip_id: str


class ItineraryItem(BaseModel):
    id: str
    time: str
    place: str
    address: str
    lat: float
    lng: float
    notes: Optional[str] = None


# --- Mock Databases (Temporary until AWS RDS) ---

trips_db = [
    {"id": "1", "title": "Summer in Santorini", "date": "15.06.2024 - 22.06.2024", "location": "OIA, GREECE"},
    {"id": "2", "title": "Kyoto Cherry Blossoms", "date": "02.04.2024 - 10.04.2024", "location": "KYOTO, JAPAN"},
]

itineraries_db = {
    "1": [
        {
            "id": "101",
            "time": "09:00",
            "place": "Colosseum",
            "address": "Piazza del Colosseo, 1",
            "lat": 41.8902,
            "lng": 12.4922,
            "notes": None
        },
        {
            "id": "102",
            "time": "12:30",
            "place": "Trattoria Romano",
            "address": "Via delle Muratte, 9",
            "lat": 41.9006,
            "lng": 12.4833,
            "notes": None
        },
    ],
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


@app.delete("/trips/{trip_id}/itinerary/{event_id}")
def delete_itinerary_item(trip_id: str, event_id: str):
    # Check if the trip exists
    if trip_id in itineraries_db:
        # Filter out the deleted item
        initial_length = len(itineraries_db[trip_id])
        itineraries_db[trip_id] = [item for item in itineraries_db[trip_id] if item["id"] != event_id]

        # Check if an item was actually removed
        if len(itineraries_db[trip_id]) < initial_length:
            return {"message": "Event deleted successfully"}

    # Return error if event was not found
    raise HTTPException(status_code=404, detail="Event not found")


@app.put("/trips/{trip_id}/itinerary/{event_id}")
def update_itinerary_item(trip_id: str, event_id: str, updated_item: ItineraryItem):
    # Print to the console what the server is actually looking for
    print(f"DEBUG: Searching for trip {trip_id} and event {event_id}")

    # Check if the trip exists in our mock database
    if trip_id in itineraries_db:
        # Print all existing IDs for this trip to see if there is a mismatch
        existing_ids = [item["id"] for item in itineraries_db[trip_id]]
        print(f"DEBUG: Trip found. Existing event IDs: {existing_ids}")

        # Find the specific event and update its data
        for i, item in enumerate(itineraries_db[trip_id]):
            if item["id"] == event_id:
                itineraries_db[trip_id][i] = updated_item.dict()
                return {"message": "Event updated successfully", "item": updated_item}

    # If the trip or event wasn't found, return an error
    print(f"DEBUG: Target ID {event_id} was not found in the list above.")
    raise HTTPException(status_code=404, detail="Event not found")


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


# NOTE: Wallet / S3 document storage is handled by AWS Lambda + API Gateway.
# See the traveleria-wallet Lambda function. The mobile app calls the API Gateway
# URL directly (defined as WALLET_API_URL in the frontend constants).


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
