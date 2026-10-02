up:            ## start full stack
    docker compose up -d --build
down:
    docker compose down
schema:        ## apply CQL schema
    docker compose exec cassandra cqlsh -f /schema.cql
seed:
    docker compose exec api python -m scripts.bootstrap --seed
train:
    docker compose exec api python -m models.train
producer:
    docker compose exec api python -m streaming.producer --rate 8 --fraud-rate 0.04
consumer-logs:
    docker compose logs -f consumer
test:
    pytest -q