"""
Sima Statistical Analysis Engine
Handles: correlation matrices, distribution detection, outlier detection, data profiling
"""

import numpy as np
import pandas as pd
from scipy import stats
from typing import Any


def profile_dataset(df: pd.DataFrame) -> dict[str, Any]:
    """Generate a comprehensive profile of the dataset."""
    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    categorical_cols = df.select_dtypes(exclude=[np.number]).columns.tolist()

    profile = {
        "shape": {"rows": len(df), "columns": len(df.columns)},
        "columns": [],
        "numeric_count": len(numeric_cols),
        "categorical_count": len(categorical_cols),
        "missing_total": int(df.isnull().sum().sum()),
        "duplicate_rows": int(df.duplicated().sum()),
    }

    for col in df.columns:
        col_info = {
            "name": col,
            "dtype": str(df[col].dtype),
            "missing": int(df[col].isnull().sum()),
            "missing_pct": round(df[col].isnull().mean() * 100, 1),
            "unique": int(df[col].nunique()),
        }

        if col in numeric_cols:
            col_info["type"] = "numeric"
            desc = df[col].describe()
            col_info["stats"] = {
                "mean": round(float(desc["mean"]), 4),
                "std": round(float(desc["std"]), 4),
                "min": float(desc["min"]),
                "q25": float(desc["25%"]),
                "median": float(desc["50%"]),
                "q75": float(desc["75%"]),
                "max": float(desc["max"]),
                "skewness": round(float(df[col].skew()), 4),
                "kurtosis": round(float(df[col].kurtosis()), 4),
            }
            col_info["distribution"] = detect_distribution(df[col].dropna())
            col_info["outliers"] = detect_outliers(df[col].dropna())
        else:
            col_info["type"] = "categorical"
            value_counts = df[col].value_counts().head(10)
            col_info["top_values"] = [
                {"value": str(v), "count": int(c)}
                for v, c in value_counts.items()
            ]

        profile["columns"].append(col_info)

    return profile


def compute_correlations(df: pd.DataFrame, method: str = "pearson") -> dict[str, Any]:
    """Compute correlation matrix with p-values for numeric columns."""
    numeric_df = df.select_dtypes(include=[np.number])

    if numeric_df.shape[1] < 2:
        return {"error": "Need at least 2 numeric columns for correlation analysis"}

    cols = numeric_df.columns.tolist()
    n = len(cols)

    corr_matrix = numeric_df.corr(method=method).round(4)
    p_matrix = pd.DataFrame(np.zeros((n, n)), index=cols, columns=cols)

    for i in range(n):
        for j in range(i + 1, n):
            x = numeric_df[cols[i]].dropna()
            y = numeric_df[cols[j]].dropna()
            common = x.index.intersection(y.index)
            if len(common) < 3:
                p_matrix.iloc[i, j] = p_matrix.iloc[j, i] = 1.0
                continue

            if method == "pearson":
                _, p_val = stats.pearsonr(x[common], y[common])
            elif method == "spearman":
                _, p_val = stats.spearmanr(x[common], y[common])
            else:
                _, p_val = stats.kendalltau(x[common], y[common])

            p_matrix.iloc[i, j] = round(p_val, 6)
            p_matrix.iloc[j, i] = round(p_val, 6)

    # Find strongest correlations
    strong_correlations = []
    for i in range(n):
        for j in range(i + 1, n):
            r = corr_matrix.iloc[i, j]
            p = p_matrix.iloc[i, j]
            if abs(r) > 0.3:
                strength = "strong" if abs(r) > 0.7 else "moderate" if abs(r) > 0.5 else "weak"
                direction = "positive" if r > 0 else "negative"
                strong_correlations.append({
                    "col_a": cols[i],
                    "col_b": cols[j],
                    "correlation": float(r),
                    "p_value": float(p),
                    "significant": p < 0.05,
                    "strength": strength,
                    "direction": direction,
                })

    strong_correlations.sort(key=lambda x: abs(x["correlation"]), reverse=True)

    return {
        "method": method,
        "columns": cols,
        "matrix": corr_matrix.values.tolist(),
        "p_values": p_matrix.values.tolist(),
        "notable_correlations": strong_correlations,
    }


def detect_distribution(series: pd.Series) -> dict[str, Any]:
    """Detect the most likely distribution of a numeric series."""
    if len(series) < 8:
        return {"type": "insufficient_data", "confidence": 0}

    data = series.values.astype(float)

    # Test normality
    if len(data) >= 8:
        stat_shapiro, p_shapiro = stats.shapiro(data[:5000])  # shapiro max 5000
    else:
        stat_shapiro, p_shapiro = 0, 0

    # Test log-normality (if all positive)
    p_lognorm = 0
    if np.all(data > 0):
        log_data = np.log(data)
        if len(log_data) >= 8:
            _, p_lognorm = stats.shapiro(log_data[:5000])

    # Test uniformity
    stat_ks, p_uniform = stats.kstest(data, "uniform", args=(data.min(), data.max() - data.min()))

    results = []
    if p_shapiro > 0.05:
        results.append({"type": "normal", "p_value": round(p_shapiro, 4), "confidence": round(p_shapiro, 3)})
    if p_lognorm > 0.05:
        results.append({"type": "log-normal", "p_value": round(p_lognorm, 4), "confidence": round(p_lognorm, 3)})
    if p_uniform > 0.05:
        results.append({"type": "uniform", "p_value": round(p_uniform, 4), "confidence": round(p_uniform, 3)})

    skew = float(series.skew())
    kurt = float(series.kurtosis())

    if abs(skew) > 1:
        results.append({"type": "skewed", "direction": "right" if skew > 0 else "left", "skewness": round(skew, 3), "confidence": 0.8})

    if not results:
        results.append({"type": "non-parametric", "confidence": 0.5})

    results.sort(key=lambda x: x.get("confidence", 0), reverse=True)
    return results[0]


def detect_outliers(series: pd.Series) -> dict[str, Any]:
    """Detect outliers using IQR method."""
    q1 = series.quantile(0.25)
    q3 = series.quantile(0.75)
    iqr = q3 - q1
    lower = q1 - 1.5 * iqr
    upper = q3 + 1.5 * iqr

    outlier_mask = (series < lower) | (series > upper)
    outlier_values = series[outlier_mask].tolist()

    return {
        "count": int(outlier_mask.sum()),
        "percentage": round(outlier_mask.mean() * 100, 1),
        "lower_bound": round(float(lower), 4),
        "upper_bound": round(float(upper), 4),
        "values": [round(v, 4) for v in outlier_values[:20]],  # cap at 20
    }


def compute_pairwise_stats(df: pd.DataFrame, col_a: str, col_b: str) -> dict[str, Any]:
    """Compute detailed stats for a pair of columns."""
    x = df[col_a].dropna()
    y = df[col_b].dropna()
    common = x.index.intersection(y.index)
    x, y = x[common], y[common]

    if len(x) < 3:
        return {"error": "Insufficient data points"}

    result: dict[str, Any] = {"col_a": col_a, "col_b": col_b, "n": len(x)}

    # Both numeric
    if np.issubdtype(x.dtype, np.number) and np.issubdtype(y.dtype, np.number):
        r_pearson, p_pearson = stats.pearsonr(x, y)
        r_spearman, p_spearman = stats.spearmanr(x, y)

        # Linear regression
        slope, intercept, r_value, p_value, std_err = stats.linregress(x, y)

        result["pearson"] = {"r": round(float(r_pearson), 4), "p": round(float(p_pearson), 6)}
        result["spearman"] = {"r": round(float(r_spearman), 4), "p": round(float(p_spearman), 6)}
        result["regression"] = {
            "slope": round(float(slope), 6),
            "intercept": round(float(intercept), 6),
            "r_squared": round(float(r_value**2), 4),
            "std_err": round(float(std_err), 6),
        }

        # Scatter data
        result["scatter"] = [
            {"x": round(float(xi), 4), "y": round(float(yi), 4)}
            for xi, yi in zip(x.values, y.values)
        ]

    return result


def generate_summary_prompt(profile: dict, correlations: dict) -> str:
    """Generate a prompt for Claude to summarize the data."""
    lines = []
    lines.append(f"Dataset: {profile['shape']['rows']} rows, {profile['shape']['columns']} columns")
    lines.append(f"Numeric columns: {profile['numeric_count']}, Categorical columns: {profile['categorical_count']}")
    lines.append(f"Missing values: {profile['missing_total']}, Duplicate rows: {profile['duplicate_rows']}")

    lines.append("\nColumn summaries:")
    for col in profile["columns"]:
        if col["type"] == "numeric":
            s = col["stats"]
            lines.append(f"  {col['name']}: mean={s['mean']}, std={s['std']}, range=[{s['min']}, {s['max']}], "
                         f"distribution={col['distribution'].get('type', 'unknown')}, "
                         f"outliers={col['outliers']['count']}")
        else:
            top = ", ".join([f"{v['value']}({v['count']})" for v in col.get("top_values", [])[:5]])
            lines.append(f"  {col['name']}: {col['unique']} unique values, top: {top}")

    if correlations and "notable_correlations" in correlations:
        lines.append("\nNotable correlations:")
        for c in correlations["notable_correlations"][:10]:
            sig = "significant" if c["significant"] else "not significant"
            lines.append(f"  {c['col_a']} vs {c['col_b']}: r={c['correlation']:.3f} ({c['strength']} {c['direction']}, {sig})")

    return "\n".join(lines)
