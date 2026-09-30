"""Запуск:  python -m app   (HOST, PORT — из окружения / .env)."""
import os

import uvicorn

from .config import load_dotenv

if __name__ == "__main__":
    load_dotenv(".env")
    uvicorn.run(
        "app.main:create_app", factory=True,
        host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8080")),
        proxy_headers=False,            # X-Forwarded-For разбирает само приложение (TRUST_PROXY)
        server_header=False, access_log=False,
    )
