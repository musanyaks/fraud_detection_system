import pandas as pd
import plotly.express as px
import streamlit as st


def render(api):
    data = api.get("/api/v1/metrics/overview")
    if not data:
        st.info("No data yet — start the consumer / producer.")
        return

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Transactions (today)", f"{data['total_transactions']:,}")
    c2.metric("Fraud detected", f"{data['fraud_detected']:,}",
              delta=f"{data['fraud_rate']:.2%} rate",
              delta_color="inverse")
    c3.metric("Amount at risk", f"${data['amount_at_risk']:,.0f}")
    c4.metric("High-risk customers", data["high_risk_customers"])

    c5, c6, c7 = st.columns(3)
    c5.metric("Open alerts", data["open_alerts"])
    c6.metric("Critical alerts", data["critical_alerts"])
    c7.metric("Total volume (today)", f"${data['total_amount']:,.0f}")

    preds = pd.DataFrame(api.get("/api/v1/predictions/recent", {"limit": 500}))
    if len(preds):
        counts = preds["risk_level"].value_counts().reindex(
            ["LOW", "MEDIUM", "HIGH", "CRITICAL"]).fillna(0)
        fig = px.bar(x=counts.index, y=counts.values,
                     color=counts.index,
                     color_discrete_map={"LOW": "#2e7d32", "MEDIUM": "#f9a825",
                                         "HIGH": "#ef6c00", "CRITICAL": "#c62828"},
                     labels={"x": "Risk level", "y": "Count"},
                     title="Risk level distribution (recent predictions)")
        fig.update_layout(showlegend=False, height=350)
        st.plotly_chart(fig, use_container_width=True)