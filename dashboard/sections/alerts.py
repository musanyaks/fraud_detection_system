import pandas as pd
import streamlit as st


def render(api):
    st.subheader("Alert case management")
    status = st.selectbox("Status", ["OPEN", "INVESTIGATING", "RESOLVED",
                                     "FALSE_POSITIVE"])
    df = pd.DataFrame(api.get("/api/v1/alerts", {"status": status}))
    if not len(df):
        st.success(f"No alerts with status {status}.")
        return

    st.dataframe(
        df[["created_at", "severity", "alert_id", "customer_id", "amount",
            "fraud_probability", "risk_score", "assigned_to"]]
        .sort_values("created_at", ascending=False).head(50),
        use_container_width=True, height=360)

    st.markdown("##### Investigate")
    alert_id = st.selectbox("Alert", df["alert_id"].astype(str).head(50),
                            format_func=lambda x: x[:8] + "…")
    row = df[df["alert_id"].astype(str) == alert_id].iloc[0]
    st.write("**Reasons:**")
    for r in row.get("reasons") or []:
        st.markdown(f"- {r}")

    c1, c2, c3 = st.columns(3)
    new_status = c1.selectbox("New status", ["INVESTIGATING", "RESOLVED",
                                             "FALSE_POSITIVE", "OPEN"])
    assignee = c2.text_input("Assign to", value="analyst")
    notes = c3.text_input("Notes")
    if st.button("Update alert", type="primary"):
        api.patch(f"/api/v1/alerts/{alert_id}",
                  {"status": new_status, "assigned_to": assignee, "notes": notes})
        st.success("Alert updated.")
        st.rerun()