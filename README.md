# Sima — Data Intelligence Dashboard

A full-stack data visualization and analysis tool with correlation detection, interactive exploration, and AI-powered summaries.

## Architecture

```
sima/
├── backend/          # FastAPI + Python (stats, correlations, AI summaries)
│   ├── main.py       # API server
│   ├── analyzer.py   # Statistical analysis engine
│   └── requirements.txt
├── frontend/         # React + D3 + Recharts
│   ├── src/
│   │   └── App.jsx   # Main dashboard
│   ├── package.json
│   └── vite.config.js
└── README.md
```

## Quick Start

### 1. Backend (Python)

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 2. Frontend (React)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

## Features

- **Correlation Engine**: Heatmap matrix, Pearson/Spearman coefficients, p-values, scatter with trendlines
- **Interaction Explorer**: Linked brushing across charts, cross-filtering, grouping
- **AI Summary**: Claude API generates plain-English data narratives (requires ANTHROPIC_API_KEY env var)

## Tech Stack

| Layer | Tool | Why |
|-------|------|-----|
| Frontend | React + D3.js + Recharts | Full control + rapid prototyping |
| Backend | FastAPI | Async, fast, you already know it |
| Stats | pandas + scipy + numpy | Correlation, distribution detection, outliers |
| AI | Claude API | Natural language data summaries |
| Charts | Recharts + D3 | Interactive, composable |

## Environment Variables

```bash
# backend/.env
ANTHROPIC_API_KEY=sk-ant-...   # Optional: enables AI summaries
```
