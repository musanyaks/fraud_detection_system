from datetime import datetime
from common.schemas import Transaction
from db.connection import CassandraConnection

_INSERT_CUSTOMER = """INSERT INTO transactions_by_customer
    (customer_id, transaction_time, transaction_id, amount, currency, merchant_id,
     merchant_name, merchant_category, channel, card_present, device_id, device_type,
     ip_address, latitude, longitude, location, country, status, is_fraud)
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"""

_INSERT_TIME = """INSERT INTO transactions_by_time
    (day, transaction_time, transaction_id, customer_id, amount, merchant_id,
     merchant_name, merchant_category, channel, device_id, location, country,
     latitude, longitude, status, is_fraud)
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"""

_INSERT_MERCHANT = """INSERT INTO transactions_by_merchant
    (merchant_id, day, transaction_time, transaction_id, customer_id, amount,
     location, status, is_fraud)
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)"""

_INSERT_DEVICE = """INSERT INTO transactions_by_device
    (device_id, transaction_time, transaction_id, customer_id, amount,
     location, ip_address, is_fraud)
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s)"""

_SELECT_CUSTOMER_WINDOW = """SELECT * FROM transactions_by_customer
    WHERE customer_id = %s AND transaction_time >= %s AND transaction_time < %s
    LIMIT %s"""

_SELECT_BY_DAY = """SELECT * FROM transactions_by_time WHERE day = %s LIMIT %s"""
_SELECT_BY_DEVICE = """SELECT * FROM transactions_by_device
    WHERE device_id = %s LIMIT %s"""
_SELECT_BY_MERCHANT_DAY = """SELECT * FROM transactions_by_merchant
    WHERE merchant_id = %s AND day = %s LIMIT %s"""


class TransactionRepository:
    def __init__(self, conn: CassandraConnection | None = None):
        self.conn = conn or CassandraConnection.get()

    # ---- writes (one denormalized row per access path) ----
    def save(self, t: Transaction) -> None:
        day = t.timestamp.strftime("%Y-%m-%d")
        s = self.conn.session
        s.execute(self.conn.prepare(_INSERT_CUSTOMER), (
            t.customer_id, t.timestamp, t.transaction_id, t.amount, t.currency,
            t.merchant_id, t.merchant_name, t.merchant_category, t.channel,
            t.card_present, t.device_id, t.device_type, t.ip_address,
            t.latitude, t.longitude, t.location, t.country, t.status, t.is_fraud))
        s.execute(self.conn.prepare(_INSERT_TIME), (
            day, t.timestamp, t.transaction_id, t.customer_id, t.amount,
            t.merchant_id, t.merchant_name, t.merchant_category, t.channel,
            t.device_id, t.location, t.country, t.latitude, t.longitude,
            t.status, t.is_fraud))
        s.execute(self.conn.prepare(_INSERT_MERCHANT), (
            t.merchant_id, day, t.timestamp, t.transaction_id, t.customer_id,
            t.amount, t.location, t.status, t.is_fraud))
        s.execute(self.conn.prepare(_INSERT_DEVICE), (
            t.device_id, t.timestamp, t.transaction_id, t.customer_id,
            t.amount, t.location, t.ip_address, t.is_fraud))

    # ---- reads ----
    def customer_window(self, customer_id, start: datetime, end: datetime, limit: int = 500):
        return list(self.conn.execute(
            _SELECT_CUSTOMER_WINDOW, (customer_id, start, end, limit)))

    def recent_by_day(self, day: str, limit: int = 300):
        return list(self.conn.execute(_SELECT_BY_DAY, (day, limit)))

    def count_by_day(self, day: str) -> int:
        rows = list(self.conn.execute(
            "SELECT count(*) FROM transactions_by_time WHERE day=%s", (day,)))
        return int(rows[0]["count"]) if rows else 0

    def device_history(self, device_id: str, limit: int = 200):
        return list(self.conn.execute(_SELECT_BY_DEVICE, (device_id, limit)))

    def merchant_day(self, merchant_id: str, day: str, limit: int = 200):
        return list(self.conn.execute(_SELECT_BY_MERCHANT_DAY, (merchant_id, day, limit)))