import pandas as pd
import plotly.express as px
import streamlit as st


def render(api):
    st.subheader("Fraud detection results")
    df = pd.DataFrame(api.get("/api/v1/predictions/recent", {"limit": 500}))
    if not len(df):
        st.info("No predictions yet.")
        return
    level = st.selectbox("Filter risk level",
                         ["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"])
    view = df if level == "ALL" else df[df["risk_level"] == level]
    view = view.sort_values("predicted_at", ascending=False)

    st.dataframe(
        view[["predicted_at", "transaction_id", "amount", "fraud_probability",
              "risk_score", "risk_level", "location", "merchant_category"]],
        use_container_width=True, height=380,
        column_config={
            "fraud_probability": st.column_config.ProgressColumn(
                "Fraud prob.", min_value=0.0, max_value=1.0, format="%.3f"),
            "risk_score": st.column_config.NumberColumn(format="%.1f")})

    flagged = view[view["risk_level"].isin(["HIGH", "CRITICAL"])]
    if len(flagged):
        st.markdown("##### Top flagged transactions — amount vs probability")
        fig = px.scatter(flagged, x="fraud_probability", y="amount",
                         color="risk_level", hover_data=["transaction_id"],
                         color_discrete_map={"HIGH": "#ef6c00",
                                             "CRITICAL": "#c62828"}, height=350)
        st.plotly_chart(fig, use_container_width=True)

    st.markdown("##### Detection detail")
    tid = st.text_input("Transaction ID for full explanation")
    if tid:
        detail = api.get(f"/api/v1/predictions/{tid}")
        if detail:
            st.json({"fraud_probability": detail["fraud_probability"],
                     "supervised_score": detail["supervised_score"],
                     "anomaly_score": detail["anomaly_score"],
                     "risk_level": detail["risk_level"],
                     "reasons": detail["reasons"],
                     "model_version": detail["model_version"]})