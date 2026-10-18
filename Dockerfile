# Arya Downloader v1 — Docker image (Node + Python + yt-dlp, no ffmpeg needed for v1)
FROM node:20-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && pip3 install --no-cache-dir --break-system-packages yt-dlp

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .

# Render sets $PORT; default 10000
EXPOSE 10000
CMD ["node", "server.js"]
