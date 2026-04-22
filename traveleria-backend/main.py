import os
import uuid

import boto3
from dotenv import load_dotenv

load_dotenv()
from botocore.exceptions import ClientError
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

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
}


# --- S3 Client Setup ---

S3_BUCKET = os.getenv("S3_BUCKET_NAME")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")

def get_s3_client():
    return boto3.client(
        "s3",
        region_name=AWS_REGION,
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
        aws_session_token=os.getenv("AWS_SESSION_TOKEN"),
    )


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


# 4. Wallet / S3 Document Storage

@app.post("/wallet/upload")
async def upload_document(
    file: UploadFile = File(...),
    title: str = Form(...),
    color: str = Form(...),
):
    if not S3_BUCKET:
        raise HTTPException(status_code=500, detail="S3 bucket not configured")

    s3 = get_s3_client()
    key = f"wallet/{uuid.uuid4()}-{file.filename}"
    content = await file.read()

    try:
        s3.put_object(
            Bucket=S3_BUCKET,
            Key=key,
            Body=content,
            ContentType=file.content_type or "application/octet-stream",
            Metadata={"title": title, "color": color},
        )
    except ClientError as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Return a presigned URL valid for 1 hour
    url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": S3_BUCKET, "Key": key},
        ExpiresIn=3600,
    )
    return {
        "id": key,
        "title": title,
        "color": color,
        "url": url,
        "mimeType": file.content_type,
    }


@app.get("/wallet/documents")
def list_documents():
    if not S3_BUCKET:
        raise HTTPException(status_code=500, detail="S3 bucket not configured")

    s3 = get_s3_client()
    try:
        response = s3.list_objects_v2(Bucket=S3_BUCKET, Prefix="wallet/")
    except ClientError as e:
        raise HTTPException(status_code=500, detail=str(e))

    docs = []
    for obj in response.get("Contents", []):
        try:
            meta = s3.head_object(Bucket=S3_BUCKET, Key=obj["Key"])
            url = s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": S3_BUCKET, "Key": obj["Key"]},
                ExpiresIn=3600,
            )
            docs.append({
                "id": obj["Key"],
                "title": meta["Metadata"].get("title", "Untitled"),
                "color": meta["Metadata"].get("color", "#000000"),
                "url": url,
                "mimeType": meta["ContentType"],
            })
        except ClientError:
            continue

    return docs


@app.delete("/wallet/documents/{key:path}")
def delete_document(key: str):
    if not S3_BUCKET:
        raise HTTPException(status_code=500, detail="S3 bucket not configured")

    s3 = get_s3_client()
    try:
        s3.delete_object(Bucket=S3_BUCKET, Key=key)
    except ClientError as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"message": "Document deleted"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
