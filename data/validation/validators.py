from datetime import datetime, timedelta, timezone

REQUIRED = {"transaction_id", "customer_id", "timestamp", "amount", "merchant_id",
            "merchant_category", "channel", "device_id", "latitude", "longitude",
            "location", "country"}
CHANNELS = {"pos", "online", "atm", "bank", "mobile"}
STATUSES = {"approved", "declined", "failed"}


def validate_transaction(d: dict) -> tuple[bool, list[str]]:
    errors = []
    missing = REQUIRED - set(d)
    if missing:
        errors.append(f"missing fields: {sorted(missing)}")
    if d.get("amount") is None or not (0 < float(d["amount"]) < 1e7):
        errors.append("amount out of range")
    if not (-90 <= float(d.get("latitude", 0)) <= 90):
        errors.append("latitude out of range")
    if not (-180 <= float(d.get("longitude", 0)) <= 180):
        errors.append("longitude out of range")
    if d.get("channel") not in CHANNELS:
        errors.append(f"invalid channel: {d.get('channel')}")
    if d.get("status", "approved") not in STATUSES:
        errors.append(f"invalid status: {d.get('status')}")
    ts = d.get("timestamp")
    if isinstance(ts, datetime):
        if ts > datetime.now(timezone.utc) + timedelta(minutes=5):
            errors.append("timestamp in the future")
    return (len(errors) == 0, errors)


def validate_features(f: dict, expected: list[str]) -> tuple[bool, list[str]]:
    import math
    problems = []
    for name in expected:
        v = f.get(name)
        if v is None or (isinstance(v, float) and math.isnan(v)):
            problems.append(f"feature '{name}' missing/NaN")
    return (len(problems) == 0, problems)