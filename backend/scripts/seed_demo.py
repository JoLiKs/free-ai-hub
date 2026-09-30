"""Заполняет БД демонстрационными данными (для скриншотов/проверки админки). Только для локальной разработки!
   DB_PATH=/tmp/demo.db python scripts/seed_demo.py"""
import os
import random
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.db import Database  # noqa: E402

PROV = [("ovh", ["gpt-oss-20b", "Qwen3.5-9B", "Mistral-7B"]), ("chat", ["gpt-4o"]), ("llm7", ["turbo-mini", "codestral"]), ("pollinations", ["openai-fast"])]
Q = ["Объясни, как работает async/await в JavaScript", "Напиши стихотворение про осень", "Как приготовить борщ?", "Переведи на английский: «Доброе утро»",
     "Что такое SQL-инъекция и как от неё защититься?", "Порекомендуй книги по истории Беларуси", "Write a haiku about the sea", "Как ускорить сайт на GitHub Pages?",
     "Помоги составить резюме для junior-разработчика", "Почему небо голубое?"]
A = ["Коротко: async/await — синтаксический сахар над промисами.\n\n```js\nconst r = await fetch(url);\n```", "Листья медленно кружат,\nосень шепчет о былом…", "Свёкла, капуста, картофель, морковь, мясо — варите 1,5 часа.",
     "Good morning!", "Используйте параметризованные запросы — никогда не подставляйте ввод в SQL строкой.", "Рекомендую «Историю Беларуси» Ермаловича.", "Waves fold on the shore / salt wind writes on the silence / gulls carry the dawn",
     "Включите кэширование, сожмите изображения, уберите неиспользуемый JS.", "Начните с раздела «Навыки», затем проекты.", "Из-за рэлеевского рассеяния коротких волн."]
COUNTRIES = ["BY", "RU", "PL", "DE", "UA", "US", None, "KZ"]


def main(n=40):
    db = Database(os.environ.get("DB_PATH", "data/demo.db"))
    rnd = random.Random(7)
    import time
    now = int(time.time() * 1000)
    for i in range(n):
        sid = str(uuid.UUID(int=rnd.getrandbits(128), version=4))
        base = now - rnd.randint(0, 27) * 86_400_000 - rnd.randint(0, 80_000_000)
        prov, models = rnd.choice(PROV)
        model = rnd.choice(models)
        country = rnd.choice(COUNTRIES)
        for c in range(rnd.randint(1, 2)):
            chat = f"chat{i}x{c}"
            for k in range(rnd.randint(1, 5)):
                qi = rnd.randrange(len(Q))
                db.log_event(session_id=sid, chat_id=chat, provider=prov, model=model, slot="A", user_text=Q[qi], assistant_text=A[qi],
                             event_id=None, client_ts=None, lang="ru-RU", origin="https://joliks.github.io", country=country,
                             ip_hash="demo", now_ms=base + c * 3_600_000 + k * 90_000)
    print("ok:", db.stats(90)["total_messages"], "сообщений")


if __name__ == "__main__":
    main()
