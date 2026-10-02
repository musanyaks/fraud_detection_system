"""
Synthetic transaction generator with injectable, learnable fraud patterns:
  CARD_TESTING       -> burst of tiny amounts on a new device (velocity signal)
  LARGE_PURCHASE     -> amount far above customer baseline, new location, often night
  IMPOSSIBLE_TRAVEL  -> transaction thousands of km from the previous one, minutes later
  ACCOUNT_TAKEOVER   -> failed attempts, then a large success from new device + location
"""
import random
import uuid as uuidlib
from datetime import datetime, timedelta, timezone

from common.schemas import Transaction

FIRST = ["Alice", "Ben", "Carla", "David", "Elena", "Farid", "Grace", "Hugo",
         "Iris", "Jonas", "Kira", "Liam", "Maya", "Noah", "Olga", "Pedro"]
LAST = ["Smith", "Okafor", "Garcia", "Chen", "Muller", "Patel", "Silva", "Kim",
        "Novak", "Rossi", "Dubois", "Haddad"]

CITIES = [
    ("New York", 40.7128, -74.0060, "US"), ("London", 51.5074, -0.1278, "GB"),
    ("Tokyo", 35.6762, 139.6503, "JP"), ("São Paulo", -23.5505, -46.6333, "BR"),
    ("Sydney", -33.8688, 151.2093, "AU"), ("Berlin", 52.5200, 13.4050, "DE"),
    ("Dubai", 25.2048, 55.2708, "AE"), ("Singapore", 1.3521, 103.8198, "SG"),
    ("Toronto", 43.6532, -79.3832, "CA"), ("Paris", 48.8566, 2.3522, "FR"),
]

MERCHANTS = {
    "grocery": ["FreshMart", "GreenGrocer", "DailyFoods", "MegaMarket"],
    "restaurant": ["SushiHub", "Bella Pasta", "Curry House", "Burger Point"],
    "retail": ["UrbanWear", "HomePlus", "GadgetHub"],
    "fuel": ["PetroGo", "FuelCity"],
    "electronics": ["ElectroWorld", "TechNova", "ByteStore"],
    "jewelry": ["LuxeGems", "GoldSmith & Co"],
    "travel": ["SkyBookings", "HotelExpress", "TravelDealz"],
    "entertainment": ["CineMax", "GameZone", "StreamFlix"],
    "online_services": ["CloudHost", "AppStore", "PlayPortal", "DigitalKeys"],
    "atm_cash": ["CityATM", "QuickCash"],
    "gambling": ["LuckyBet", "RoyalCasino"],
    "crypto": ["CoinExchange", "CryptoSwap"],
}
ALL_CATEGORIES = list(MERCHANTS.keys())
POS_CATEGORIES = {"grocery", "restaurant", "fuel", "retail"}


class Customer:
    def __init__(self, rng: random.Random, index: int):
        self.customer_id = uuidlib.uuid5(uuidlib.NAMESPACE_OID, f"cust-{index}")
        city = rng.choice(CITIES)
        self.home_city, self.home_lat, self.home_lon, self.home_country = city
        self.name = f"{rng.choice(FIRST)} {rng.choice(LAST)}"
        self.email = f"{self.name.lower().replace(' ', '.')}@example.com"
        self.avg_amount = round(rng.lognormvariate(3.8, 0.8), 2)   # ~20-400
        self.spend_sigma = rng.uniform(0.5, 1.1)
        self.created_at = datetime.now(timezone.utc) - timedelta(
            days=rng.randint(60, 2500))                            # account age
        self.night_owl = rng.random() < 0.10
        self.active_start = rng.randint(6, 10)
        self.active_end = rng.randint(18, 24)
        self.preferred_categories = rng.sample(
            [c for c in ALL_CATEGORIES if c not in ("gambling",)], k=rng.randint(2, 4))
        self.preferred_merchants = [
            (m, rng.choice(self.preferred_categories))
            for m in rng.sample(
                [m for c in self.preferred_categories for m in MERCHANTS[c]],
                k=rng.randint(2, 4))]
        self.devices = [f"dev-{uuidlib.uuid4().hex[:12]}" for _ in range(rng.randint(1, 3))]
        self.device_types = [rng.choice(["ios", "android", "desktop"]) for _ in self.devices]

    def to_record(self) -> dict:
        return {"customer_id": self.customer_id, "name": self.name, "email": self.email,
                "home_city": self.home_city, "home_country": self.home_country,
                "home_latitude": self.home_lat, "home_longitude": self.home_lon,
                "avg_amount": self.avg_amount, "account_created_at": self.created_at}


class FraudTransactionGenerator:
    FRAUD_PATTERNS = ["CARD_TESTING", "LARGE_PURCHASE", "IMPOSSIBLE_TRAVEL",
                      "ACCOUNT_TAKEOVER"]
    PATTERN_WEIGHTS = [0.35, 0.25, 0.20, 0.20]

    def __init__(self, n_customers: int = 300, seed: int = 42):
        self.rng = random.Random(seed)
        self.customers = [Customer(self.rng, i) for i in range(n_customers)]
        self._new_device_counter = 0

    # ---------- helpers ----------
    def _txn(self, cust: Customer, ts: datetime, amount: float, category: str,
             device_id: str, device_type: str, lat: float, lon: float, location: str,
             country: str, status: str = "approved", is_fraud: bool = False,
             channel: str | None = None) -> Transaction:
        if channel is None:
            channel = ("atm" if category == "atm_cash"
                       else "pos" if category in POS_CATEGORIES and self.rng.random() < 0.7
                       else "online")
        # channel variety: mobile banking + bank transfers (mock's 5 types)
        if channel == "online" and self.rng.random() < 0.18:
            channel = "mobile"
        elif channel == "pos" and self.rng.random() < 0.10:
            channel = "bank"
        return Transaction(
            transaction_id=uuidlib.uuid4(), customer_id=cust.customer_id,
            timestamp=ts, amount=round(amount, 2), merchant_id=self.rng.choice(MERCHANTS[category]),
            merchant_name=self.rng.choice(MERCHANTS[category]), merchant_category=category,
            channel=channel, card_present=channel in ("pos", "atm"),
            device_id=device_id, device_type=device_type,
            ip_address=f"{self.rng.randint(1, 223)}.{self.rng.randint(0, 255)}."
                       f"{self.rng.randint(0, 255)}.{self.rng.randint(1, 254)}",
            latitude=lat, longitude=lon, location=location, country=country,
            status=status, is_fraud=is_fraud)

    def _new_device(self) -> tuple[str, str]:
        self._new_device_counter += 1
        return (f"dev-new-{self._new_device_counter:08d}",
                self.rng.choice(["ios", "android", "desktop"]))

    def _random_far_city(self) -> tuple[str, float, float, str]:
        return self.rng.choice(CITIES)

    def _rand_time_near(self, ts: datetime, lo_s: int, hi_s: int) -> datetime:
        return ts + timedelta(seconds=self.rng.uniform(lo_s, hi_s))

    # ---------- legitimate behavior ----------
    def legitimate(self, cust: Customer, ts: datetime) -> Transaction:
        # hour-of-day shaping
        if not (cust.active_start <= ts.hour < cust.active_end or cust.night_owl):
            hour = self.rng.randint(cust.active_start, min(cust.active_end, 23) - 1)
            ts = ts.replace(hour=hour, minute=self.rng.randint(0, 59))
        merchant, category = (cust.preferred_merchants[0]
                              if self.rng.random() < 0.85
                              else self.rng.choice(cust.preferred_merchants))
        amount = self.rng.lognormvariate(__import__("math").log(cust.avg_amount),
                                         cust.spend_sigma)
        if category == "atm_cash":
            amount = max(20, round(amount / 10) * 10)
        amount = min(max(amount, 0.5), 25000)
        if self.rng.random() < 0.93:
            i = self.rng.randrange(len(cust.devices))
            device_id, device_type = cust.devices[i], cust.device_types[i]
        else:
            device_id, device_type = self._new_device()
        if self.rng.random() < 0.90:   # home city with jitter
            lat = cust.home_lat + self.rng.uniform(-0.05, 0.05)
            lon = cust.home_lon + self.rng.uniform(-0.05, 0.05)
            location, country = cust.home_city, cust.home_country
        else:                          # traveling
            city, lat, lon, country = self._random_far_city()
            location = city
        status = "declined" if self.rng.random() < 0.015 else "approved"
        return self._txn(cust, ts, amount, category, device_id, device_type,
                         lat, lon, location, country, status=status, is_fraud=False)

    # ---------- fraud patterns ----------
    def card_testing(self, cust: Customer, anchor: datetime) -> list[Transaction]:
        ts, dev, devtype = anchor + timedelta(seconds=self.rng.uniform(30, 120)), \
            *self._new_device()
        out = []
        for _ in range(self.rng.randint(5, 12)):
            ts = ts + timedelta(seconds=self.rng.uniform(10, 40))
            status = "declined" if self.rng.random() < 0.4 else "approved"
            out.append(self._txn(cust, ts, self.rng.uniform(1, 12), "online_services",
                                 dev, devtype, cust.home_lat, cust.home_lon,
                                 cust.home_city, cust.home_country,
                                 status=status, is_fraud=True, channel="online"))
        return out

    def large_purchase(self, cust: Customer, anchor: datetime) -> list[Transaction]:
        ts = anchor + timedelta(seconds=self.rng.uniform(60, 600))
        if self.rng.random() < 0.4:  # force night
            ts = ts.replace(hour=self.rng.randint(1, 5), minute=self.rng.randint(0, 59))
        amount = min(cust.avg_amount * self.rng.uniform(6, 40), 25000)
        category = self.rng.choice(["electronics", "jewelry", "travel", "crypto"])
        dev, devtype = self._new_device() if self.rng.random() < 0.6 else \
            (cust.devices[0], cust.device_types[0])
        city, lat, lon, country = self._random_far_city()
        return [self._txn(cust, ts, amount, category, dev, devtype, lat, lon,
                          city, country, is_fraud=True)]

    def impossible_travel(self, cust: Customer, anchor: datetime) -> list[Transaction]:
        ts = anchor + timedelta(seconds=self.rng.uniform(180, 1800))
        amount = cust.avg_amount * self.rng.uniform(3, 15)
        dev, devtype = self._new_device() if self.rng.random() < 0.7 else \
            (cust.devices[0], cust.device_types[0])
        city, lat, lon, country = self._random_far_city()
        return [self._txn(cust, ts, amount, self.rng.choice(ALL_CATEGORIES), dev,
                          devtype, lat, lon, city, country, is_fraud=True)]

    def account_takeover(self, cust: Customer, anchor: datetime) -> list[Transaction]:
        ts, dev, devtype = anchor + timedelta(seconds=self.rng.uniform(60, 300)), \
            *self._new_device()
        city, lat, lon, country = self._random_far_city()
        out = []
        for _ in range(self.rng.randint(2, 4)):   # failed attempts
            ts = ts + timedelta(seconds=self.rng.uniform(30, 120))
            out.append(self._txn(cust, ts, cust.avg_amount * self.rng.uniform(0.5, 2),
                                 "online_services", dev, devtype, lat, lon, city,
                                 country, status="failed", is_fraud=False,
                                 channel="online"))
        ts = ts + timedelta(seconds=self.rng.uniform(30, 180))
        out.append(self._txn(cust, ts, min(cust.avg_amount * self.rng.uniform(8, 30),
                                           25000),
                             self.rng.choice(["electronics", "crypto", "travel"]),
                             dev, devtype, lat, lon, city, country, is_fraud=True))
        return out

    def fraud_burst(self, anchor: datetime, cust: Customer | None = None) -> list[Transaction]:
        cust = cust or self.rng.choice(self.customers)
        pattern = self.rng.choices(self.FRAUD_PATTERNS, weights=self.PATTERN_WEIGHTS)[0]
        return getattr(self, pattern.lower())(cust, anchor)

    # ---------- batch history for training ----------
    def generate_history(self, days: int = 60, fraud_rate: float = 0.025,
                         gap_range_s: tuple[int, int] = (2 * 3600, 18 * 3600)):
        end = datetime.now(timezone.utc)
        start = end - timedelta(days=days)
        legit = []
        for cust in self.customers:
            t = start + timedelta(seconds=self.rng.uniform(0, 3600))
            while t < end:
                legit.append(self.legitimate(cust, t))
                t += timedelta(seconds=self.rng.uniform(*gap_range_s))
        n_fraud = int(len(legit) * fraud_rate)
        fraud = []
        anchors = self.rng.sample(range(10, len(legit)), min(n_fraud, len(legit) - 10))
        for i in anchors:
            fraud += self.fraud_burst(legit[i].timestamp, legit[i].customer_id
                                      and self._cust_by_id(legit[i].customer_id))
        return sorted(legit + fraud, key=lambda x: x.timestamp)

    def _cust_by_id(self, cid):
        for c in self.customers:
            if c.customer_id == cid:
                return c
        return self.rng.choice(self.customers)

    # ---------- online stream: yields (delay_seconds, [transactions]) ----------
    def stream(self, fraud_rate: float = 0.03, mean_rate_per_sec: float = 0.5):
        t = datetime.now(timezone.utc)
        while True:
            delay = self.rng.expovariate(mean_rate_per_sec)
            t = datetime.now(timezone.utc)   # wall clock, immune to clock jumps
            t += timedelta(seconds=delay)
            cust = self.rng.choice(self.customers)
            now = datetime.now(timezone.utc)
            txns = (self.fraud_burst(t, cust) if self.rng.random() < fraud_rate
                    else [self.legitimate(cust, t)])
            for x in txns:                      # never time-travel in either direction:
                lag = (now - x.timestamp).total_seconds()
                lead = (x.timestamp - now).total_seconds()
                if lead > 240 or lag > 3600:    # future >4min, or stale >1h
                    x.timestamp = now
            yield delay, txns