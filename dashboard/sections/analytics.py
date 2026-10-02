import pandas as pd
import plotly.express as px
import streamlit as st


def render(api):
    st.subheader("Fraud analytics")
    txns = pd.DataFrame(api.get("/api/v1/transactions/recent", {"limit": 1000}))
    preds = pd.DataFrame(api.get("/api/v1/predictions/recent", {"limit": 1000}))
    if not len(preds):
        st.info("No data yet.")
        return

    df = preds.merge(txns[["transaction_id", "latitude", "longitude"]],
                     on="transaction_id", how="left") if len(txns) else preds
    df["hour"] = pd.to_datetime(df["predicted_at"]).dt.hour
    flagged = df[df["risk_level"].isin(["HIGH", "CRITICAL"])]

    c1, c2 = st.columns(2)
    with c1:
        st.plotly_chart(px.histogram(df, x="hour", color="risk_level", barmode="stack",
                                     title="Risk by hour of day"), use_container_width=True)
    with c2:
        st.plotly_chart(px.bar(flagged["merchant_category"].value_counts().head(10)
                               .rename_axis("category").reset_index(name="count"),
                               x="category", y="count",
                               title="Flagged by merchant category"),
                        use_container_width=True)

    c3, c4 = st.columns(2)
    with c3:
        st.plotly_chart(px.bar(flagged["location"].value_counts().head(10)
                               .rename_axis("location").reset_index(name="count"),
                               x="location", y="count",
                               title="Flagged by location"), use_container_width=True)
    with c4:
        if {"latitude", "longitude"} <= set(df.columns) and df["latitude"].notna().any():
            fig = px.scatter_mapbox(flagged.dropna(subset=["latitude", "longitude"]),
                                    lat="latitude", lon="longitude",
                                    color="risk_level", zoom=1, height=380,
                                    mapbox_style="carto-positron",
                                    title="Flagged transactions map")
            st.plotly_chart(fig, use_container_width=True)
        else:
            st.info("No geo data available.")

    st.plotly_chart(
        px.box(df, x="risk_level", y="amount", color="risk_level",
               category_orders={"risk_level": ["LOW", "MEDIUM", "HIGH", "CRITICAL"]},
               title="Amount distribution by risk level"),
        use_container_width=True)