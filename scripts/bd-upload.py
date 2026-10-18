#!/usr/bin/env python3
"""Заливка готовых разборов Strava из tools/strava-breakdown/bd-outbox/ в Supabase Storage.

Запускается launchd-агентом com.igor.trainingpeaks.bd-upload (WatchPaths на bd-outbox/).
На каждый *.pdf в папке:
  1. upsert в ig-reels/breakdowns/<имя>;
  2. подписанная ссылка на 30 дней;
  3. строка в public.bd_uploads (status='done', url, bytes, done_at);
  4. файл переезжает в bd-outbox/sent/.
При ошибке — строка со status='error' и текстом ошибки, файл остаётся в папке.

Ключи — как у остальных раннеров: SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY из .env.local
канонического каталога. В лог ключи не печатаются.
Только стандартная библиотека Python.

Переопределения для проверки: BD_OUTBOX (папка), BD_ENV_FILE (файл ключей).
"""
import datetime, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUTBOX = Path(os.environ.get("BD_OUTBOX") or REPO / "tools" / "strava-breakdown" / "bd-outbox")
ENV_FILE = Path(os.environ.get("BD_ENV_FILE") or Path.home() / "igor-tp-reports-bot" / ".env.local")
BUCKET = "ig-reels"
PREFIX = "breakdowns"
SIGN_SECONDS = 30 * 24 * 3600
# Тот же шаблон, что check-констрейнт bd_uploads.name: иначе не записать даже строку ошибки.
NAME_RE = re.compile(r"^[a-z0-9._-]+\.pdf$")


def log(msg):
    print(f"[{datetime.datetime.now():%Y-%m-%d %H:%M:%S}] bd-upload: {msg}", flush=True)


def load_env():
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit(f"bd-upload: нет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (смотрел {ENV_FILE})")
    return url.rstrip("/"), key


SB_URL, SB_KEY = load_env()


def http(method, url, data=None, headers=None, timeout=120):
    headers = {"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}", **(headers or {})}
    body = data
    if data is not None and not isinstance(data, (bytes, bytearray)):
        body = json.dumps(data).encode()
        headers.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            out = r.read()
    except urllib.error.HTTPError as e:
        # В текст ошибки идёт только путь без query и тело ответа — ключей там нет.
        raise RuntimeError(f"{method} {url.split('?')[0].replace(SB_URL, '')} -> {e.code}: "
                           f"{e.read().decode(errors='replace')[:500]}")
    return json.loads(out) if out else None


def insert_row(row):
    http("POST", f"{SB_URL}/rest/v1/bd_uploads", row, {"Prefer": "return=minimal"})


def wait_stable(f, tries=10):
    """WatchPaths срабатывает, пока файл ещё копируется: ждём, пока размер перестанет меняться."""
    size = -1
    for _ in range(tries):
        cur = f.stat().st_size
        if cur == size and cur > 0:
            return cur
        size = cur
        time.sleep(1)
    raise RuntimeError(f"файл не дописался за {tries} с (размер {size})")


def upload(f):
    name = f.name
    if not NAME_RE.match(name):
        raise ValueError(f"имя «{name}» не подходит: только a-z 0-9 . _ - и .pdf")
    size = wait_stable(f)
    path = f"{PREFIX}/{urllib.parse.quote(name)}"
    http("POST", f"{SB_URL}/storage/v1/object/{BUCKET}/{path}", f.read_bytes(),
         {"Content-Type": "application/pdf", "x-upsert": "true"})
    signed = http("POST", f"{SB_URL}/storage/v1/object/sign/{BUCKET}/{path}", {"expiresIn": SIGN_SECONDS})
    url = f"{SB_URL}/storage/v1{signed['signedURL']}"
    insert_row({"name": name, "status": "done", "url": url, "bytes": size,
                "done_at": datetime.datetime.now(datetime.timezone.utc).isoformat()})
    sent = OUTBOX / "sent"
    sent.mkdir(exist_ok=True)
    f.rename(sent / name)
    return size


def error_name(name):
    """Строка ошибки обязана пройти check-констрейнт, даже если имя файла кривое."""
    if NAME_RE.match(name):
        return name
    stem = re.sub(r"[^a-z0-9._-]+", "-", Path(name).stem.lower()).strip("-.") or "unnamed"
    return f"{stem}.pdf"


def main():
    if not OUTBOX.is_dir():
        log(f"нет папки {OUTBOX}, выхожу")
        return 0
    files = sorted(p for p in OUTBOX.iterdir()
                   if p.is_file() and p.suffix.lower() == ".pdf" and not p.name.startswith("."))
    if not files:
        return 0
    failed = 0
    for f in files:
        try:
            size = upload(f)
            log(f"ok {f.name} ({size} байт) -> {BUCKET}/{PREFIX}/{f.name}, перенесён в sent/")
        except Exception as e:
            failed += 1
            err = str(e)[:1000]
            log(f"ОШИБКА {f.name}: {err}")
            try:
                insert_row({"name": error_name(f.name), "status": "error", "error": f"{f.name}: {err}"})
            except Exception as e2:
                log(f"ОШИБКА записи в bd_uploads для {f.name}: {e2}")
    log(f"готово: {len(files) - failed} залито, {failed} с ошибкой")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
