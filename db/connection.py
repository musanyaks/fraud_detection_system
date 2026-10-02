from datetime import datetime, timezone

import structlog
from cassandra.cluster import Cluster, ExecutionProfile, EXEC_PROFILE_DEFAULT
from cassandra.policies import TokenAwarePolicy, DCAwareRoundRobinPolicy
from cassandra.query import dict_factory


def utc_aware_dict_factory(colnames, rows):
    """Cassandra timestamps are epoch-UTC; return them tz-aware so datetime
    arithmetic against aware (ISO/Kafka) timestamps never raises
    'offset-naive and offset-aware'."""
    out = []
    for row in rows:
        d = dict(zip(colnames, row))
        for k, v in d.items():
            if isinstance(v, datetime) and v.tzinfo is None:
                d[k] = v.replace(tzinfo=timezone.utc)
        out.append(d)
    return out

from common.config import settings

log = structlog.get_logger()


class CassandraConnection:
    """Singleton cluster session with token-aware routing and prepared-statement cache."""
    _instance: "CassandraConnection | None" = None

    def __init__(self):
        profile = ExecutionProfile(
            load_balancing_policy=TokenAwarePolicy(
                DCAwareRoundRobinPolicy(local_dc="datacenter1")),
            row_factory=utc_aware_dict_factory,
            request_timeout=15,
        )
        self.cluster = Cluster(
            contact_points=settings.cassandra_hosts,
            port=settings.cassandra_port,
            execution_profiles={EXEC_PROFILE_DEFAULT: profile},
        )
        self.session = self._connect_with_retry()
        self.session.set_keyspace(settings.keyspace)
        self._prepared: dict[str, object] = {}
        log.info("cassandra_connected", hosts=settings.cassandra_hosts,
                 keyspace=settings.keyspace)

    def _connect_with_retry(self, attempts: int = 15, delay: int = 5):
        import time
        for i in range(attempts):
            try:
                return self.cluster.connect()
            except Exception as e:  # NoHostAvailable during startup
                log.warning("cassandra_retry", attempt=i + 1, error=str(e))
                time.sleep(delay)
        raise RuntimeError("Could not connect to Cassandra")

    def prepare(self, cql: str):
        if cql not in self._prepared:
            self._prepared[cql] = self.session.prepare(cql.replace("%s", "?"))
        return self._prepared[cql]

    def execute(self, cql: str, params: tuple | None = None):
        if params is None:
            return self.session.execute(cql)
        return self.session.execute(self.prepare(cql), params)

    @classmethod
    def get(cls) -> "CassandraConnection":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance