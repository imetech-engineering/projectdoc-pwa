#!/bin/sh
# Start de bridge en herstart hem als hij onverhoopt stopt.
cd "$(dirname "$0")" || exit 1
while true; do
  node server.js
  echo "Bridge gestopt, opnieuw starten over 5 seconden..."
  sleep 5
done
