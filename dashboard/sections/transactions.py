import pandas as pd
import streamlit as st


@st.experimental_fragment(run_every=5)
def _live_table(api, filters):
    df = pd.DataFrame(api.get("/api/v1/transactions/recent", {"limit": 300}))
    if not len(df):
        st.info("Waiting for transactions…")
        return
    df["risk"] = df["transaction_id"].map(_risk_map(api))
    if filters.get("level"):
        df = df[df["risk"] == filters["level"]]
    if filters.get("query"):
        q = filters["query"].lower()
        df = df[df.apply(lambda r: q in str(r.get("location", "")).lower()
                         or q in str(r.get("merchant_name", "")).lower(), axis=1)]
    st.dataframe(
        df[["transaction_time", "transaction_id", "customer_id", "amount",
            "merchant_name", "location", "channel", "status", "risk"]]
        .sort_values("transaction_time", ascending=False).head(40),
        use_container_width=True, height=520,
        column_config={"transaction_id": st.column_config.TextColumn("Txn ID",
                       width="medium"),
                       "customer_id": st.column_config.TextColumn("Customer",
                       width="medium")})


@st.cache_data(ttl=4)
def _risk_map(_api) -> dict:
    preds = pd.DataFrame(_api.get("/api/v1/predictions/recent", {"limit": 500}))
    return dict(zip(preds["transaction_id"], preds["risk_level"])) if len(preds) else {}


def render(api):
    st.subheader("Live transaction stream")
    c1, c2 = st.columns([1, 3])
    level = c1.selectbox("Risk level", ["", "LOW", "MEDIUM", "HIGH", "CRITICAL"])
    query = c2.text_input("Search (merchant / location)")
    _live_table(api, {"level": level, "query": query})