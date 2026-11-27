#!/bin/bash
# Publică funcția adminGrant („Dă PRO+” din admin.html). Rulează în Cloud Shell, proiectul trasso-sub.
set -e
cd "$(dirname "$0")/functions"
npm install --silent
cd ..
firebase deploy --only functions:admin --project trasso-sub --non-interactive
