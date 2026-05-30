import os
import numpy as np
import pandas as pd
from flask import Flask, render_template, request, jsonify

from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    confusion_matrix,
    precision_recall_fscore_support,
    accuracy_score,
    precision_recall_curve,
    auc
)

from imblearn.over_sampling import SMOTE

# -------------------------
# App Setup
# -------------------------
app = Flask(__name__)

GLOBAL_MODEL_STATE = {
    "rf": None,
    "features": None
}

# -------------------------
# Home Page
# -------------------------
@app.route('/')
def home():
    return render_template('index.html')


# -------------------------
# ML Pipeline (FULL DATASET)
# -------------------------
@app.route('/api/pipeline', methods=['POST'])
def run_pipeline():

    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files['file']
    df = pd.read_csv(file)

    # Ensure label column exists
    if 'Class' not in df.columns:
        df['Class'] = 0

    df.dropna(inplace=True)

    # -------------------------
    # USE FULL DATASET (NO SAMPLING)
    # -------------------------
    df = df.copy()

    # -------------------------
    # Outlier Removal (IQR)
    # -------------------------
    if 'Amount' in df.columns:
        Q1 = df['Amount'].quantile(0.25)
        Q3 = df['Amount'].quantile(0.75)
        IQR = Q3 - Q1
        lower = Q1 - 1.5 * IQR
        upper = Q3 + 1.5 * IQR
        df = df[(df['Amount'] >= lower) & (df['Amount'] <= upper)]

    # -------------------------
    # Features / Target
    # -------------------------
    X = df.drop(columns=['Class'])
    if 'Time' in X.columns:
        X = X.drop(columns=['Time'])

    y = df['Class']

    if len(np.unique(y)) < 2:
        return jsonify({"error": "Dataset must contain both Fraud and Genuine classes"}), 400

    # -------------------------
    # Train/Test Split
    # -------------------------
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    # -------------------------
    # SMOTE (optimized)
    # -------------------------
    smote = SMOTE(random_state=42, k_neighbors=3)
    X_train_res, y_train_res = smote.fit_resample(X_train, y_train)

    # -------------------------
    # Random Forest (optimized for large data)
    # -------------------------
    rf = RandomForestClassifier(
        n_estimators=50,
        max_depth=12,
        random_state=42,
        n_jobs=-1
    )

    rf.fit(X_train_res, y_train_res)

    GLOBAL_MODEL_STATE["rf"] = rf
    GLOBAL_MODEL_STATE["features"] = list(X_train_res.columns)

    # -------------------------
    # Evaluation
    # -------------------------
    y_test_pred = rf.predict(X_test)
    y_test_prob = rf.predict_proba(X_test)[:, 1]

    precision, recall, f1, _ = precision_recall_fscore_support(
        y_test, y_test_pred, average='binary', zero_division=0
    )

    acc = accuracy_score(y_test, y_test_pred)
    tn, fp, fn, tp = confusion_matrix(y_test, y_test_pred).ravel()

    prec_curve, rec_curve, _ = precision_recall_curve(y_test, y_test_prob)
    pr_auc = auc(rec_curve, prec_curve)

    # -------------------------
    # Full Predictions for UI
    # -------------------------
    X_disp = df.drop(columns=['Class'])
    if 'Time' in X_disp.columns:
        X_disp = X_disp.drop(columns=['Time'])

    full_probs = rf.predict_proba(X_disp)[:, 1]
    full_preds = rf.predict(X_disp)

    records = []

    amounts = df['Amount'].values if 'Amount' in df.columns else np.zeros(len(df))
    true_labels = df['Class'].values
    v1s = df['V1'].values if 'V1' in df.columns else np.zeros(len(df))
    v3s = df['V3'].values if 'V3' in df.columns else np.zeros(len(df))

    for i in range(len(df)):
        records.append({
            "pred": int(full_preds[i]),
            "fraudProb": float(full_probs[i]),
            "amount": float(amounts[i]),
            "trueLabel": int(true_labels[i]),
            "v1": float(v1s[i]),
            "v3": float(v3s[i])
        })

    step = max(1, len(prec_curve) // 100)
    pr_curve_data = {
        "precision": prec_curve[::step].tolist(),
        "recall": rec_curve[::step].tolist()
    }

    # -------------------------
    # Response
    # -------------------------
    return jsonify({
        "metrics": {
            "precision": float(precision),
            "recall": float(recall),
            "f1": float(f1),
            "accuracy": float(acc),
            "cm": [[int(tn), int(fp)], [int(fn), int(tp)]],
            "prAUC": float(pr_auc),
            "prCurve": pr_curve_data
        },
        "fullPreds": records
    })


# -------------------------
# Single Prediction
# -------------------------
@app.route('/api/predict_single', methods=['POST'])
def predict_single():

    model = GLOBAL_MODEL_STATE.get("rf")
    features = GLOBAL_MODEL_STATE.get("features")

    if model is None:
        return jsonify({"error": "Model not trained yet"}), 400

    data = request.json

    input_data = {col: 0.0 for col in features}

    input_data["Amount"] = float(data.get("amount", 0.0))

    if "V4" in input_data:
        input_data["V4"] = float(data.get("loc_risk", 0.0))
    if "V10" in input_data:
        input_data["V10"] = float(data.get("behavior", 0.0))
    if "V12" in input_data:
        input_data["V12"] = float(data.get("device", 0.0))
    if "V14" in input_data:
        input_data["V14"] = float(data.get("merchant", 0.0))
    if "V17" in input_data:
        input_data["V17"] = float(data.get("failed", 0.0))

    df_input = pd.DataFrame([input_data])
    df_input = df_input[features]

    pred = model.predict(df_input)[0]
    prob = model.predict_proba(df_input)[0][1]

    return jsonify({
        "prediction": int(pred),
        "probability": float(prob)
    })


# -------------------------
# Run App
# -------------------------
if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))

    for directory in ["templates", "static/css", "static/js"]:
        if not os.path.exists(directory):
            os.makedirs(directory)

    app.run(host="0.0.0.0", port=port)