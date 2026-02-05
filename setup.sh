#!/bin/bash
# Sima - First time setup (run from inside sima/)

set -e

echo "=== Creating conda env ==="
conda create -n sima python=3.11 -y

echo "=== Installing backend deps ==="
conda run -n sima pip install -r backend/requirements.txt

echo "=== Installing frontend deps ==="
cd frontend
npm install
cd ..

echo ""
echo "=== Setup complete! ==="
echo "Now run: ./start.sh"