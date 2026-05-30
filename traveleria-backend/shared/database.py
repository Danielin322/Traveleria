import os
from contextlib import contextmanager
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from dotenv import load_dotenv

# Loads .env for local dev; silently no-ops in Lambda where env vars are set directly.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def _get_database_url() -> str:
    url = os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set.")
    return url


@contextmanager
def get_db():
    with psycopg.connect(_get_database_url(), row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            yield cur
        conn.commit()
