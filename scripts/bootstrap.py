"""One-time setup: apply schema + seed customers. Training also seeds data."""
import argparse
import subprocess
import sys


def apply_schema_via_cqlsh():
    print("[bootstrap] applying cassandra/schema.cql via cqlsh …")
    subprocess.run(["cqlsh", "-f", "schema.cql"], cwd="db", check=True)


def seed(n_customers: int = 100):
    from db.connection import CassandraConnection
    from db.repositories import ProfileRepository
    from data.ingestion.generator import FraudTransactionGenerator
    gen = FraudTransactionGenerator(n_customers=n_customers)
    repo = ProfileRepository(CassandraConnection.get())
    for c in gen.customers:
        repo.save_customer(c.to_record())
    print(f"[bootstrap] seeded {n_customers} customers")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--schema", action="store_true")
    ap.add_argument("--seed", action="store_true")
    ap.add_argument("--customers", type=int, default=100)
    a = ap.parse_args()
    if a.schema:
        apply_schema_via_cqlsh()
    if a.seed:
        seed(a.customers)
    if not (a.schema or a.seed):
        print("usage: python -m scripts.bootstrap --schema --seed")
        sys.exit(1)