"""Генерация ADMIN_PASSWORD_HASH:  python -m app.hashpw  (пароль вводится скрыто)."""
import getpass
import sys

from .security import make_password_hash


def main() -> int:
    p1 = getpass.getpass("Пароль администратора: ")
    if len(p1) < 10:
        print("Пароль слишком короткий (нужно ≥ 10 символов).", file=sys.stderr)
        return 1
    if getpass.getpass("Ещё раз: ") != p1:
        print("Пароли не совпадают.", file=sys.stderr)
        return 1
    print("ADMIN_PASSWORD_HASH=" + make_password_hash(p1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
