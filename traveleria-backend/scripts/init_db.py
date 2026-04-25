from pathlib import Path
import os
import sys

import psycopg
from dotenv import load_dotenv


BACKEND_DIR = Path(__file__).resolve().parents[1]
SQL_DIR = BACKEND_DIR / "sql"


def load_database_url() -> str:
    load_dotenv(BACKEND_DIR / ".env")
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError(
            "DATABASE_URL is not set. Add it to traveleria-backend/.env, for example: "
            "DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB_NAME"
        )
    return database_url


def sql_files() -> list[Path]:
    files = sorted(SQL_DIR.glob("*.sql"))
    if not files:
        raise RuntimeError(f"No SQL files found in {SQL_DIR}")
    return files


def main() -> int:
    try:
        database_url = load_database_url()
        files = sql_files()

        with psycopg.connect(database_url) as conn:
            with conn.cursor() as cursor:
                for sql_file in files:
                    print(f"Running {sql_file.relative_to(BACKEND_DIR)}")
                    cursor.execute(sql_file.read_text(encoding="utf-8"))
            conn.commit()

        print("Database schema setup completed.")
        return 0
    except Exception as exc:
        print(f"Database setup failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
