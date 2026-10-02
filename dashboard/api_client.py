import os
import requests
import streamlit as st


class ApiClient:
    def __init__(self):
        self.base = os.getenv("API_URL", "http://localhost:8000")
        self._token = None

    def login(self, username: str, password: str) -> bool:
        try:
            r = requests.post(f"{self.base}/api/v1/auth/token",
                              json={"username": username, "password": password},
                              timeout=5)
            r.raise_for_status()
            self._token = r.json()["access_token"]
            return True
        except Exception:
            return False

    def _headers(self):
        return {"Authorization": f"Bearer {self._token}"}

    def get(self, path: str, params: dict | None = None):
        try:
            r = requests.get(f"{self.base}{path}", params=params,
                             headers=self._headers(), timeout=10)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            st.toast(f"API error: {e}", icon="⚠️")
            return []

    def patch(self, path: str, body: dict):
        r = requests.patch(f"{self.base}{path}", json=body,
                           headers=self._headers(), timeout=10)
        r.raise_for_status()
        return r.json()