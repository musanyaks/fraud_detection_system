import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st


def render(api):
    st.subheader("ML model performance")
    ev = api.get("/api/v1/models/evaluation")
    if not ev:
        st.warning("No evaluation artifact. Run `make train` first.")
        return

    rows = []
    for name in ["ensemble", "xgboost", "lightgbm", "random_forest",
                 "logistic_regression"]:
        if name in ev:
            m = ev[name]
            rows.append({"model": name, "ROC-AUC": m["roc_auc"], "PR-AUC": m["pr_auc"],
                         "Precision": m["precision"], "Recall": m["recall"],
                         "F1": m["f1"]})
    st.dataframe(pd.DataFrame(rows).set_index("model").round(4),
                 use_container_width=True)
    st.caption(f"Model version: `{ev['version']}` · decision threshold: "
               f"`{ev['threshold']:.3f}` (chosen on validation for max F1)")

    ens = ev["ensemble"]
    c1, c2 = st.columns(2)
    with c1:
        fig = go.Figure()
        fig.add_trace(go.Scatter(x=ens["roc_points"]["fpr"],
                                 y=ens["roc_points"]["tpr"],
                                 name=f"Ensemble (AUC={ens['roc_auc']:.3f})"))
        fig.add_trace(go.Scatter(x=[0, 1], y=[0, 1], mode="lines",
                                 line=dict(dash="dash"), name="chance"))
        fig.update_layout(title="ROC curve", height=380,
                          xaxis_title="FPR", yaxis_title="TPR")
        st.plotly_chart(fig, use_container_width=True)
    with c2:
        fig = go.Figure()
        fig.add_trace(go.Scatter(x=ens["pr_points"]["recall"],
                                 y=ens["pr_points"]["precision"],
                                 name=f"Ensemble (AP={ens['pr_auc']:.3f})"))
        fig.update_layout(title="Precision-Recall curve", height=380,
                          xaxis_title="Recall", yaxis_title="Precision")
        st.plotly_chart(fig, use_container_width=True)

    cm = ens["confusion_matrix"]
    st.plotly_chart(px.imshow(cm, text_auto=True, color_continuous_scale="OrRd",
                              labels=dict(x="Predicted", y="Actual"),
                              x=["Legit", "Fraud"], y=["Legit", "Fraud"],
                              title="Confusion matrix (test set)"),
                    use_container_width=True)

    c3, c4 = st.columns(2)
    with c3:
        st.info("🔴 Run `python -m models.monitoring` (or schedule it) to compute "
                "PSI drift against training distributions and persist it to the "
                "`model_monitoring` table.")
    with c4:
        m = api.get("/api/v1/models/metrics")
        if m.get("registry"):
            st.success(f"Registered version: {m['registry']['model_version']}")