FROM ghcr.io/berriai/litellm:v1.87.1

WORKDIR /app

COPY litellm_config.yaml /app/config.yaml

CMD ["--host", "0.0.0.0", "--port", "8080", "--config", "/app/config.yaml"]
