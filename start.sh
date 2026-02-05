#!/bin/bash
# Sima - Start both servers (run from inside sima/)

cleanup() {
    echo ""
    echo "Shutting down..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

# Start backend using conda activate
echo "=== Starting backend on :8000 ==="
eval "$(conda shell.bash hook)"
conda activate sima
cd backend
uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!
cd ..

# Start frontend
echo "=== Starting frontend on :5174 ==="
cd frontend
npm run dev -- --port 5174 &
FRONTEND_PID=$!
cd ..

echo ""
echo "=== Sima is running ==="
echo "Frontend: http://localhost:5174"
echo "Backend:  http://localhost:8000"
echo "Press Ctrl+C to stop both"
echo ""

wait