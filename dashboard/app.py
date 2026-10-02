import os
import streamlit as st

from dashboard.api_client import ApiClient
from dashboard.sections import (overview, transactions, fraud, customers,
                             analytics, ml_model, alerts)

st.set_page_config(page_title="Fraud Radar", page_icon="🛡️", layout="wide")

if "api" not in st.session_state:
    st.session_state.api = ApiClient()

if not st.session_state.api._token:
    st.title("🛡️ Fraud Detection Platform")
    with st.form("login"):
        u = st.text_input("Username", value=os.getenv("DASH_USER", "admin"))
        p = st.text_input("Password", type="password",
                          value=os.getenv("DASH_PASSWORD", "admin123"))
        if st.form_submit_button("Sign in", use_container_width=True):
            if st.session_state.api.login(u, p):
                st.rerun()
            else:
                st.error("Login failed — is the API running and trained?")
    st.stop()

st.sidebar.title("🛡️ Fraud Radar")
st.sidebar.caption(f"Model: live ensemble · {st.session_state.api.base}")

tabs = st.tabs(["Overview", "Transactions", "Fraud Detection", "Customer Risk",
                "Analytics", "ML Model", "Alerts"])
with tabs[0]:
    overview.render(st.session_state.api)
with tabs[1]:
    transactions.render(st.session_state.api)
with tabs[2]:
    fraud.render(st.session_state.api)
with tabs[3]:
    customers.render(st.session_state.api)
with tabs[4]:
    analytics.render(st.session_state.api)
with tabs[5]:
    ml_model.render(st.session_state.api)
with tabs[6]:
    alerts.render(st.session_state.api)