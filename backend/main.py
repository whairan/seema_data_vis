"""
Sima Backend API
Endpoints for data upload, profiling, correlation analysis, and AI summaries.
"""

import io
import json
import os

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from analyzer import (
    profile_dataset,
    compute_correlations,
    compute_pairwise_stats,
    generate_summary_prompt,
)

load_dotenv()

app = FastAPI(title="Sima API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory store for uploaded datasets (single-user for now)
datasets: dict[str, pd.DataFrame] = {}


class NumpyEncoder(json.JSONEncoder):
    """Handle numpy types in JSON serialization."""
    def default(self, obj):
        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating,)):
            return float(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        if isinstance(obj, np.bool_):
            return bool(obj)
        if pd.isna(obj):
            return None
        return super().default(obj)


def json_response(data: dict) -> JSONResponse:
    return JSONResponse(content=json.loads(json.dumps(data, cls=NumpyEncoder)))


@app.get("/")
def root():
    return {"name": "Sima API", "version": "0.1.0", "status": "running"}


@app.get("/datasets")
def list_datasets():
    return {
        name: {"rows": len(df), "columns": len(df.columns), "column_names": df.columns.tolist()}
        for name, df in datasets.items()
    }


@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload a CSV or JSON file for analysis."""
    if not file.filename:
        raise HTTPException(400, "No filename provided")

    ext = file.filename.rsplit(".", 1)[-1].lower()
    content = await file.read()

    try:
        if ext == "csv":
            df = pd.read_csv(io.BytesIO(content))
        elif ext == "tsv":
            df = pd.read_csv(io.BytesIO(content), sep="\t")
        elif ext == "json":
            df = pd.read_json(io.BytesIO(content))
        else:
            raise HTTPException(400, f"Unsupported file type: {ext}")
    except Exception as e:
        raise HTTPException(400, f"Failed to parse file: {str(e)}")

    # Clean column names
    df.columns = df.columns.str.strip()

    name = file.filename.rsplit(".", 1)[0]
    datasets[name] = df

    return json_response({
        "name": name,
        "rows": len(df),
        "columns": len(df.columns),
        "column_names": df.columns.tolist(),
        "dtypes": {col: str(dtype) for col, dtype in df.dtypes.items()},
        "preview": json.loads(df.head(5).to_json(orient="records")),
    })


@app.get("/profile/{dataset_name}")
def get_profile(dataset_name: str):
    """Get comprehensive data profile."""
    if dataset_name not in datasets:
        raise HTTPException(404, f"Dataset '{dataset_name}' not found")
    profile = profile_dataset(datasets[dataset_name])
    return json_response(profile)


@app.get("/correlations/{dataset_name}")
def get_correlations(dataset_name: str, method: str = Query("pearson", enum=["pearson", "spearman", "kendall"])):
    """Get correlation matrix with p-values."""
    if dataset_name not in datasets:
        raise HTTPException(404, f"Dataset '{dataset_name}' not found")
    result = compute_correlations(datasets[dataset_name], method)
    return json_response(result)


@app.get("/pairwise/{dataset_name}")
def get_pairwise(dataset_name: str, col_a: str = Query(...), col_b: str = Query(...)):
    """Get detailed pairwise analysis for two columns."""
    if dataset_name not in datasets:
        raise HTTPException(404, f"Dataset '{dataset_name}' not found")
    df = datasets[dataset_name]
    if col_a not in df.columns or col_b not in df.columns:
        raise HTTPException(400, f"Column not found. Available: {df.columns.tolist()}")
    result = compute_pairwise_stats(df, col_a, col_b)
    return json_response(result)


@app.get("/data/{dataset_name}")
def get_data(dataset_name: str, limit: int = Query(500, ge=1, le=10000)):
    """Get raw data for charting."""
    if dataset_name not in datasets:
        raise HTTPException(404, f"Dataset '{dataset_name}' not found")
    df = datasets[dataset_name].head(limit)
    return json_response({
        "data": json.loads(df.to_json(orient="records")),
        "total_rows": len(datasets[dataset_name]),
        "returned_rows": len(df),
    })


@app.get("/summary/{dataset_name}")
async def get_ai_summary(dataset_name: str):
    """Generate AI-powered data summary using Claude."""
    if dataset_name not in datasets:
        raise HTTPException(404, f"Dataset '{dataset_name}' not found")

    df = datasets[dataset_name]
    profile = profile_dataset(df)
    correlations = compute_correlations(df)

    summary_input = generate_summary_prompt(profile, correlations)

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        # Return a structured summary without AI
        return json_response({
            "source": "statistical",
            "summary": _generate_fallback_summary(profile, correlations),
            "raw_stats": summary_input,
        })

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=600,
            messages=[{
                "role": "user",
                "content": (
                    "You are a data analyst. Given the following dataset statistics, write a concise, "
                    "insightful 3-5 sentence summary. Focus on: what the data represents, key patterns, "
                    "notable correlations, outliers, and any actionable insights. Be specific with numbers. "
                    "Do not use dashes. Do not use bullet points.\n\n"
                    f"{summary_input}"
                ),
            }],
        )
        return json_response({
            "source": "ai",
            "summary": message.content[0].text,
            "raw_stats": summary_input,
        })
    except Exception as e:
        return json_response({
            "source": "statistical",
            "summary": _generate_fallback_summary(profile, correlations),
            "error": str(e),
            "raw_stats": summary_input,
        })


def _generate_fallback_summary(profile: dict, correlations: dict) -> str:
    """Generate a basic summary without AI."""
    parts = []
    parts.append(
        f"This dataset contains {profile['shape']['rows']} rows and "
        f"{profile['shape']['columns']} columns ({profile['numeric_count']} numeric, "
        f"{profile['categorical_count']} categorical)."
    )

    if profile["missing_total"] > 0:
        parts.append(f"There are {profile['missing_total']} missing values across the dataset.")

    if correlations and "notable_correlations" in correlations:
        strong = [c for c in correlations["notable_correlations"] if c["strength"] == "strong"]
        if strong:
            top = strong[0]
            parts.append(
                f"The strongest correlation is between {top['col_a']} and {top['col_b']} "
                f"(r={top['correlation']:.3f}, {top['direction']})."
            )

    # Check for outliers
    outlier_cols = []
    for col in profile["columns"]:
        if col["type"] == "numeric" and col.get("outliers", {}).get("count", 0) > 0:
            outlier_cols.append(f"{col['name']} ({col['outliers']['count']})")
    if outlier_cols:
        parts.append(f"Outliers detected in: {', '.join(outlier_cols[:5])}.")

    return " ".join(parts)


# Load sample datasets on startup
@app.on_event("startup")
def load_samples():
    datasets["tech_revenue"] = pd.DataFrame({
        "company": ["Apple", "Microsoft", "Google", "Amazon", "Meta", "Tesla", "Netflix", "Nvidia"],
        "revenue_b": [394, 212, 307, 575, 135, 97, 34, 61],
        "profit_b": [97, 72, 74, 21, 39, 15, 5, 22],
        "employees_k": [164, 221, 182, 1540, 67, 128, 13, 26],
        "pe_ratio": [28, 35, 25, 60, 22, 70, 45, 65],
        "market_cap_t": [2.9, 2.8, 1.7, 1.5, 0.9, 0.8, 0.2, 1.1],
    })

    np.random.seed(42)
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    base_sales = np.array([40, 42, 48, 55, 60, 58, 65, 70, 75, 80, 85, 95])
    datasets["monthly_sales"] = pd.DataFrame({
        "month": months,
        "sales": base_sales + np.random.randint(-5, 10, 12),
        "marketing_spend": (base_sales * 0.3 + np.random.normal(0, 3, 12)).round(1),
        "returns": np.random.randint(3, 15, 12),
        "new_customers": (base_sales * 1.5 + np.random.normal(0, 8, 12)).astype(int),
        "satisfaction": (3.5 + np.cumsum(np.random.normal(0.05, 0.1, 12))).round(2),
    })

    datasets["city_stats"] = pd.DataFrame({
        "city": ["Tokyo", "Delhi", "Shanghai", "São Paulo", "Mumbai", "Cairo", "Beijing", "London", "NYC", "Paris"],
        "population_m": [37.4, 32.9, 28.5, 22.4, 21.7, 21.3, 20.9, 9.5, 8.3, 2.2],
        "area_km2": [2191, 1484, 6341, 1521, 603, 528, 16411, 1572, 783, 105],
        "density_per_km2": [17071, 22168, 4495, 14727, 35994, 40341, 1274, 6045, 10602, 20952],
        "avg_rent_usd": [1200, 350, 800, 500, 450, 300, 900, 2100, 3000, 1800],
        "life_expectancy": [84.5, 70.2, 77.3, 76.1, 71.8, 72.5, 77.9, 81.3, 79.1, 82.7],
    })