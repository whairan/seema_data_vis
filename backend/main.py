"""
Sima Backend API — v2
"""

import io, json, os, warnings
import numpy as np
import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from analyzer import (
    profile_dataset, compute_correlations,
    compute_pairwise_stats, generate_summary_prompt,
)

load_dotenv()
app = FastAPI(title="Sima API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:3000"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

datasets: dict[str, pd.DataFrame] = {}


class NpEnc(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, (np.integer,)): return int(o)
        if isinstance(o, (np.floating,)):
            if np.isnan(o) or np.isinf(o): return None
            return float(o)
        if isinstance(o, np.ndarray): return o.tolist()
        if isinstance(o, np.bool_): return bool(o)
        if pd.isna(o): return None
        return super().default(o)


def _sanitize(obj):
    """Recursively replace NaN/inf with None for JSON compliance."""
    if isinstance(obj, float):
        if obj != obj or obj == float('inf') or obj == float('-inf'): return None
        return obj
    if isinstance(obj, dict): return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list): return [_sanitize(v) for v in obj]
    return obj


def jres(data): return JSONResponse(_sanitize(json.loads(json.dumps(data, cls=NpEnc))))


# ── helpers ──────────────────────────────────────────────

def _looks_like_date(s: pd.Series, col_name: str = "") -> bool:
    sample = s.dropna().astype(str).head(20)
    if sample.empty: return False
    # Quick reject: if most values are short words (< 5 chars), likely not dates
    avg_len = sample.str.len().mean()
    if avg_len < 6: return False
    # Require at least some values contain digits (dates usually do)
    has_digits = sample.str.contains(r'\d').sum()
    if has_digits < len(sample) * 0.5: return False
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            pd.to_datetime(sample)
        return True
    except (ValueError, TypeError):
        return False


def _classify(df: pd.DataFrame, profile: dict) -> dict:
    """Classify columns into types. Numeric is ALWAYS numeric."""
    numeric, categorical, datetime_cols, id_cols, high_card = [], [], [], [], []
    ID_NAMES = {"id", "index", "key", "pk", "uuid"}
    n = profile["shape"]["rows"]

    for ci in profile["columns"]:
        col, nu = ci["name"], ci["unique"]

        # Numeric columns are always numeric
        if ci["type"] == "numeric":
            numeric.append(col)
            continue

        # For text/object columns: classify
        lo = col.lower().replace(" ", "_")
        if lo in ID_NAMES or lo.endswith("_id"):
            id_cols.append(col)
        elif nu == n and n > 10:
            # All unique in a big dataset => likely an ID
            id_cols.append(col)
        elif _looks_like_date(df[col], col):
            datetime_cols.append(col)
        elif nu > 30:
            high_card.append(col)
        else:
            categorical.append(col)

    return {
        "numeric": numeric, "categorical": categorical,
        "datetime": datetime_cols, "id": id_cols,
        "high_cardinality": high_card,
    }


def _suggest(df, cls, profile):
    numeric = cls["numeric"]
    categorical = cls["categorical"]
    datetime_cols = cls["datetime"]
    high_card = cls["high_cardinality"]
    sugs = []

    # Time series
    for dt in datetime_cols:
        for nc in numeric[:3]:
            sugs.append({"type": "line", "title": f"{nc} over time",
                         "x": dt, "y": [nc], "reason": "Time series", "priority": 10})

    # Categorical bars
    for cat in categorical:
        nu = df[cat].nunique()
        if nu <= 20:
            for nc in numeric[:2]:
                sugs.append({"type": "bar", "title": f"{nc} by {cat}",
                             "x": cat, "y": [nc], "reason": f"{nu} categories", "priority": 8})

    # Scatter from correlation
    if len(numeric) >= 2:
        try:
            corr = df[numeric].corr()
            pairs = []
            for i, a in enumerate(numeric):
                for j, b in enumerate(numeric):
                    if i < j:
                        r = abs(corr.loc[a, b])
                        if not np.isnan(r): pairs.append((a, b, r))
            pairs.sort(key=lambda x: x[2], reverse=True)
            for a, b, r in pairs[:4]:
                s = "Strong" if r > 0.7 else "Moderate" if r > 0.4 else "Weak"
                sugs.append({"type": "scatter", "title": f"{a} vs {b} (r={r:.2f})",
                             "x": a, "y": [b], "reason": f"{s} correlation", "priority": 7 + r})
        except Exception: pass

    # Multi-metric
    if numeric and categorical:
        sugs.append({"type": "bar", "title": "Multi-metric comparison",
                     "x": categorical[0], "y": numeric[:3],
                     "reason": "Compare metrics", "priority": 6})

    # Distribution for high-cardinality text
    for hc in high_card[:2]:
        sugs.append({"type": "bar", "title": f"Top values: {hc}",
                     "x": hc, "y": [], "reason": "Category frequency",
                     "priority": 5, "viz_type": "distribution"})

    # If many numeric cols, suggest bubble
    if len(numeric) >= 3:
        sugs.append({"type": "bubble", "title": f"{numeric[0]} vs {numeric[1]} (size: {numeric[2]})",
                     "x": numeric[0], "y": [numeric[1]], "z": numeric[2],
                     "reason": "3D relationship via bubble size", "priority": 7})

    sugs.sort(key=lambda x: x.get("priority", 0), reverse=True)

    if not sugs:
        if numeric and categorical:
            sugs.append({"type": "bar", "x": categorical[0], "y": [numeric[0]],
                         "title": "Default", "reason": "Basic view", "priority": 1})
        elif len(numeric) >= 2:
            sugs.append({"type": "scatter", "x": numeric[0], "y": [numeric[1]],
                         "title": "Default", "reason": "Two numeric cols", "priority": 1})

    return sugs[:10]


# ── endpoints ────────────────────────────────────────────

@app.get("/")
def root(): return {"name": "Sima", "version": "0.2.0"}


@app.get("/datasets")
def list_datasets():
    return {n: {"rows": len(d), "columns": len(d.columns),
                "column_names": d.columns.tolist()} for n, d in datasets.items()}


@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, "No filename")
    ext = file.filename.rsplit(".", 1)[-1].lower()
    raw = await file.read()
    try:
        if ext == "csv": df = pd.read_csv(io.BytesIO(raw))
        elif ext == "tsv": df = pd.read_csv(io.BytesIO(raw), sep="\t")
        elif ext == "json": df = pd.read_json(io.BytesIO(raw))
        else: raise HTTPException(400, f"Unsupported: {ext}")
    except Exception as e:
        raise HTTPException(400, str(e))
    df.columns = df.columns.str.strip()
    name = file.filename.rsplit(".", 1)[0]
    datasets[name] = df
    return jres({"name": name, "rows": len(df), "columns": len(df.columns),
                 "column_names": df.columns.tolist()})


@app.delete("/datasets/{name}")
def delete_dataset(name: str):
    if name not in datasets:
        raise HTTPException(404, "Not found")
    del datasets[name]
    return {"deleted": name}


@app.get("/analyze/{name}")
def smart_analyze(name: str):
    if name not in datasets:
        raise HTTPException(404, f"'{name}' not found")
    df = datasets[name]
    profile = profile_dataset(df)
    cls = _classify(df, profile)
    sugs = _suggest(df, cls, profile)
    corr = compute_correlations(df) if len(cls["numeric"]) >= 2 else None
    return jres({
        "dataset_name": name,
        "profile": profile, "correlations": corr,
        "columns": cls, "suggestions": sugs,
        "data": json.loads(df.head(500).to_json(orient="records")),
        "total_rows": len(df),
    })


@app.get("/correlations/{name}")
def get_correlations(name: str, method: str = Query("pearson")):
    if name not in datasets: raise HTTPException(404)
    return jres(compute_correlations(datasets[name], method))


@app.get("/pairwise/{name}")
def get_pairwise(name: str, col_a: str = Query(...), col_b: str = Query(...)):
    if name not in datasets: raise HTTPException(404)
    df = datasets[name]
    if col_a not in df.columns or col_b not in df.columns:
        raise HTTPException(400, "Column not found")
    return jres(compute_pairwise_stats(df, col_a, col_b))


@app.get("/summary/{name}")
async def get_summary(name: str):
    if name not in datasets: raise HTTPException(404)
    df = datasets[name]
    profile = profile_dataset(df)
    corr = compute_correlations(df)
    cls = _classify(df, profile)

    # Build rich context for AI
    rich_context = _build_rich_context(df, profile, corr, cls, name)
    basic_stats = generate_summary_prompt(profile, corr)

    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        return jres({"source": "statistical", "summary": _fallback_rich(df, profile, corr, cls),
                     "raw_stats": basic_stats})
    try:
        import anthropic
        msg = anthropic.Anthropic(api_key=key).messages.create(
            model="claude-sonnet-4-20250514", max_tokens=2000,
            messages=[{"role": "user", "content": rich_context}])
        return jres({"source": "ai", "summary": msg.content[0].text, "raw_stats": basic_stats})
    except Exception as e:
        return jres({"source": "statistical", "summary": _fallback_rich(df, profile, corr, cls),
                     "error": str(e), "raw_stats": basic_stats})


def _build_rich_context(df, profile, corr, cls, dataset_name):
    """Build a comprehensive data context for intelligent AI analysis."""
    sections = []

    # 1. Overview
    sections.append(f"DATASET: {dataset_name}")
    sections.append(f"Shape: {len(df)} rows × {len(df.columns)} columns")
    sections.append(f"Column types: {len(cls['numeric'])} numeric, {len(cls['categorical'])} categorical, "
                    f"{len(cls['datetime'])} datetime, {len(cls['id'])} ID, {len(cls['high_cardinality'])} high-cardinality text")

    # 2. All columns with their names (helps AI infer domain)
    sections.append(f"\nALL COLUMN NAMES: {', '.join(df.columns.tolist())}")

    # 3. Categorical breakdowns (this is where domain understanding comes from)
    sections.append("\nCATEGORICAL DISTRIBUTIONS:")
    for col in cls["categorical"]:
        vc = df[col].value_counts()
        total = len(df)
        breakdown = []
        for val, count in vc.head(10).items():
            pct = count / total * 100
            breakdown.append(f"{val}: {count} ({pct:.0f}%)")
        sections.append(f"  {col} ({vc.shape[0]} unique): {', '.join(breakdown)}")

    # 4. High cardinality text (top values)
    if cls["high_cardinality"]:
        sections.append("\nHIGH-CARDINALITY TEXT COLUMNS:")
        for col in cls["high_cardinality"]:
            vc = df[col].value_counts().head(8)
            items = [f"{v}: {c}" for v, c in vc.items()]
            sections.append(f"  {col} ({df[col].nunique()} unique): {', '.join(items)}")

    # 5. Numeric summaries with clinical/domain context
    sections.append("\nNUMERIC COLUMN STATISTICS:")
    for col in cls["numeric"]:
        s = df[col].describe()
        missing = df[col].isna().sum()
        miss_pct = missing / len(df) * 100
        line = f"  {col}: mean={s['mean']:.2f}, std={s['std']:.2f}, median={s['50%']:.2f}, range=[{s['min']:.1f}, {s['max']:.1f}]"
        if missing > 0:
            line += f", MISSING: {missing} ({miss_pct:.0f}%)"
        sections.append(line)

    # 6. Missing data patterns
    total_missing = df.isna().sum().sum()
    if total_missing > 0:
        sections.append(f"\nMISSING DATA PATTERN: {total_missing} total missing values")
        for col in df.columns:
            m = df[col].isna().sum()
            if m > 0:
                sections.append(f"  {col}: {m}/{len(df)} missing ({m/len(df)*100:.0f}%)")

    # 7. Key correlations
    if corr and "notable_correlations" in corr:
        sections.append("\nKEY CORRELATIONS:")
        for c in corr["notable_correlations"][:8]:
            sig = "statistically significant" if c["significant"] else "not significant"
            sections.append(f"  {c['col_a']} ↔ {c['col_b']}: r={c['correlation']:.3f} ({c['strength']}, {sig})")

    # 8. Sample rows (helps AI see actual data patterns)
    sections.append(f"\nSAMPLE ROWS (first 5):")
    sample = df.head(5).to_string(index=False, max_colwidth=30)
    sections.append(sample)

    context = "\n".join(sections)

    prompt = f"""You are SeeMa, an expert data intelligence analyst. Analyze this dataset comprehensively.

{context}

Write a thorough, insightful analysis structured as follows:

1. **Overview**: What is this data about? Infer the domain (medical, financial, sales, etc.) from column names and values. Describe what each record represents.

2. **Key Demographics/Segments**: For categorical columns, describe the population. What's the breakdown? Is it balanced or skewed?

3. **Vital Metrics**: For numeric columns, interpret the actual values in domain context. Don't just state "mean is X". Explain what that MEANS. (e.g., "average BMI of 29.3 sits on the border of Overweight and Obese", or "average revenue of $226B is driven primarily by Apple and Amazon")

4. **Patterns & Relationships**: What do the correlations reveal? What story do they tell? Are there expected or surprising relationships?

5. **Data Quality & Gaps**: Flag missing data patterns. Which columns are sparse? What does that imply? (e.g., "only 13% have A1C results, suggesting labs were only ordered for diabetic patients")

6. **Actionable Insights**: What should someone DO with this data? What questions should they investigate further?

Be specific with numbers, percentages, and actual values. Write in clear prose paragraphs with bold section headers. Do not use dashes or bullet points for lists; use numbered items or flowing prose instead. Be the kind of analyst who makes people say "wow, this tool actually understands my data."
"""
    return prompt


def _fallback_rich(df, profile, corr, cls):
    """Rich fallback when no API key is available."""
    parts = []

    # Overview
    parts.append(f"**Overview**: This dataset contains {len(df)} records across {len(df.columns)} columns "
                 f"({len(cls['numeric'])} numeric, {len(cls['categorical'])} categorical).")

    # Categorical summaries
    for col in cls["categorical"][:3]:
        vc = df[col].value_counts()
        top3 = ", ".join([f"{v} ({c})" for v, c in vc.head(3).items()])
        parts.append(f"**{col}** has {vc.shape[0]} unique values. Top: {top3}.")

    # Numeric highlights
    num_highlights = []
    for col in cls["numeric"][:5]:
        mean = df[col].mean()
        miss = df[col].isna().sum()
        h = f"{col} averages {mean:.1f}"
        if miss > 0:
            h += f" ({miss} missing, {miss/len(df)*100:.0f}%)"
        num_highlights.append(h)
    if num_highlights:
        parts.append(f"**Numeric highlights**: {'; '.join(num_highlights)}.")

    # Correlations
    if corr and "notable_correlations" in corr:
        nc = corr["notable_correlations"]
        strong = [c for c in nc if c["strength"] == "strong"]
        if strong:
            top = strong[0]
            parts.append(f"**Strongest correlation**: {top['col_a']} ↔ {top['col_b']} "
                         f"(r={top['correlation']:.3f}). {len(strong)} strong correlations found.")

    # Missing data
    total = df.isna().sum().sum()
    if total > 0:
        sparse = [(c, df[c].isna().sum()) for c in df.columns if df[c].isna().sum() > len(df)*0.3]
        if sparse:
            sparse_str = ", ".join([f"{c} ({m}/{len(df)})" for c, m in sparse])
            parts.append(f"**Data gaps**: {total} total missing values. Sparse columns: {sparse_str}.")

    parts.append("\n*For a full AI-powered analysis, set ANTHROPIC_API_KEY in backend/.env*")
    return "\n\n".join(parts)


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
    m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
    b = np.array([40,42,48,55,60,58,65,70,75,80,85,95])
    datasets["monthly_sales"] = pd.DataFrame({
        "month": m, "sales": b + np.random.randint(-5,10,12),
        "marketing_spend": (b*0.3+np.random.normal(0,3,12)).round(1),
        "returns": np.random.randint(3,15,12),
        "new_customers": (b*1.5+np.random.normal(0,8,12)).astype(int),
        "satisfaction": (3.5+np.cumsum(np.random.normal(0.05,0.1,12))).round(2),
    })
    datasets["city_stats"] = pd.DataFrame({
        "city": ["Tokyo","Delhi","Shanghai","São Paulo","Mumbai","Cairo","Beijing","London","NYC","Paris"],
        "population_m": [37.4,32.9,28.5,22.4,21.7,21.3,20.9,9.5,8.3,2.2],
        "area_km2": [2191,1484,6341,1521,603,528,16411,1572,783,105],
        "density_per_km2": [17071,22168,4495,14727,35994,40341,1274,6045,10602,20952],
        "avg_rent_usd": [1200,350,800,500,450,300,900,2100,3000,1800],
        "life_expectancy": [84.5,70.2,77.3,76.1,71.8,72.5,77.9,81.3,79.1,82.7],
    })