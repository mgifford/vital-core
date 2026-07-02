# Hugging Face Docker Space: self-contained vital-core appliance that both
# crawls (its profile's targets) and serves the built report site.
#
# Base on the official Playwright image so Chromium + all the system libraries
# the scanner needs are already present and version-matched. Keep this tag in
# step with the "playwright" version in package.json.
FROM mcr.microsoft.com/playwright:v1.60.0-noble

# HF Spaces run as a non-root user (uid 1000). Create a writable app dir.
ENV HOME=/home/user \
    PORT=7860 \
    NODE_ENV=production
WORKDIR /app

# Install dependencies first for layer caching. --ignore-scripts skips
# Playwright's browser download (the base image already ships them).
COPY package.json package-lock.json ./
RUN npm ci --omit=optional --ignore-scripts

# App source. config/ is the source of truth for scan behavior and profiles;
# state/ data/ docs/ are NOT copied — they live on the persistent volume at
# $VITAL_DATA_ROOT (see README front matter / Space settings).
COPY src/ ./src/
COPY config/ ./config/
COPY vendor/ ./vendor/
COPY scripts/ ./scripts/

# Persistent volume mount point. HF persistent storage mounts at /data; the
# app writes state/ data/ docs/ under here so crawl history survives restarts.
ENV VITAL_DATA_ROOT=/data
RUN mkdir -p /data && chown -R 1000:1000 /app /data

USER 1000

EXPOSE 7860

# The supervisor serves docs/ and runs the scan+rebuild cron in-process.
# VITAL_PROFILE must be set in the Space settings (e.g. va).
CMD ["node", "src/serve-hf.js"]
