from pathlib import Path
from contextlib import contextmanager
import os

import psycopg
from psycopg.rows import dict_row
from dotenv import load_dotenv


BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env")


def get_database_url() -> str:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError(
            "DATABASE_URL is not set. Add it to traveleria-backend/.env."
        )
    return database_url


def get_connection():
    return psycopg.connect(get_database_url(), row_factory=dict_row)


@contextmanager
def get_db():
    with get_connection() as conn:
        with conn.cursor() as db:
            yield db
        conn.commit()
