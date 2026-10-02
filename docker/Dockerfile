FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app

COPY requirements.txt wheels/ /tmp/pkg/
RUN pip install --no-index --find-links=/tmp/pkg -r /tmp/pkg/requirements.txt \
    && rm -rf /tmp/pkg

# LightGBM needs libgomp.so.1 (slim images omit it). scikit-learn's wheel
# bundles it -> donate it. Fallback: apt from main-only HTTPS sources.
RUN G=$(ls /usr/local/lib/python3.11/site-packages/scikit_learn.libs/libgomp-*.so* 2>/dev/null | head -1) \
    && if [ -n "$G" ]; then \
         cp "$G" /usr/lib/x86_64-linux-gnu/libgomp.so.1 && ldconfig \
         && echo "libgomp installed from sklearn wheel"; \
       else \
         printf 'Types: deb\nURIs: https://deb.debian.org/debian\nSuites: trixie\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n' > /etc/apt/sources.list.d/debian.sources \
         && apt-get update && apt-get install -y --no-install-recommends libgomp1 \
         && rm -rf /var/lib/apt/lists/*; \
       fi

COPY . .
ENV PYTHONPATH=/app