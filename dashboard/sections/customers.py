import pandas as pd
import plotly.express as px
import streamlit as st


def render(api):
    st.subheader("Customer risk profiles")
    customers = pd.DataFrame(api.get("/api/v1/customers", {"limit": 200}))
    if not len(customers):
        st.info("No customers seeded yet — run training/bootstrap.")
        return
    cid = st.selectbox("Customer", customers["customer_id"].astype(str).head(100),
                       format_func=lambda x: f"{x[:8]}…")
    prof = api.get(f"/api/v1/customers/{cid}/profile")
    if prof.get("profile"):
        p = prof["profile"]
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Risk score", f"{p.get('current_risk_score', 0):.0f}")
        c2.metric("Avg amount", f"${p.get('avg_amount', 0):,.0f}")
        c3.metric("Txns (30d)", p.get("txn_count_30d", 0))
        c4.metric("Fraud history", p.get("fraud_count", 0))
        st.caption(f"Known devices: {len(p.get('known_devices') or [])} · "
                   f"Known locations: {len(p.get('known_locations') or [])}")

    txns = pd.DataFrame(api.get(f"/api/v1/customers/{cid}/transactions", {"limit": 100}))
    if len(txns):
        fig = px.scatter(txns, x="transaction_time", y="amount",
                         color="is_fraud",
                         color_discrete_map={True: "#c62828", False: "#90a4ae"},
                         hover_data=["merchant_name", "location"],
                         title="Transaction history (30 days)", height=350)
        st.plotly_chart(fig, use_container_width=True)
        c1, c2 = st.columns(2)
        c1.bar_chart(txns["merchant_category"].value_counts().head(8))
        c2.bar_chart(txns["location"].value_counts().head(8))

    preds = pd.DataFrame(api.get(f"/api/v1/customers/{cid}/predictions"))
    if len(preds):
        st.markdown("##### Risk predictions over time")
        st.line_chart(preds.set_index("predicted_at")["fraud_probability"])