#!/bin/sh
# Pull the latest code and rebuild. Keys, prefs and the alarm log live in the
# dk-live-cache volume and are untouched.
set -e
cd "$(dirname "$0")"
git pull
docker compose up -d --build
docker compose logs --tail 20
