import { useState } from "react";
import Login from "./components/Login.jsx";
import Sidebar from "./components/Sidebar.jsx";
import Topbar from "./components/Topbar.jsx";
import Overview from "./sections/Overview.jsx";
import Transactions from "./sections/Transactions.jsx";
import FraudDetection from "./sections/FraudDetection.jsx";
import Alerts from "./sections/Alerts.jsx";
import Customers from "./sections/Customers.jsx";
import Analytics from "./sections/Analytics.jsx";
import ModelMonitor from "./sections/ModelMonitor.jsx";
import Reports from "./sections/Reports.jsx";
import { getToken } from "./lib/api.js";
import { useLive } from "./lib/useLive.js";

const TITLES = {
  overview: "Dashboard Overview",
  transactions: "Transactions",
  fraud: "Fraud Detection",
  alerts: "Alerts & Cases",
  customers: "Customers",
  analytics: "Analytics",
  model: "Model Monitoring", reports: "Reports",
};

const SUBTITLES = {
  analytics: "Deep insights into transaction patterns, customer behaviour and fraud trends",
  customers: "Monitor customer behaviour, risk profiles and transaction patterns",
  transactions: "Monitor and analyze all financial transactions in real-time",
  fraud: "AI-powered fraud detection and risk analysis",
  reports: "Generate and view comprehensive reports on transactions, fraud and customer activity.",
};

export default function App() {
  const [page, setPage] = useState("overview");
  const authed = !!getToken();
  const ov = useLive(authed ? "/metrics/overview" : null, {}, 10000);

  if (!authed) return <Login />;

  return (
    <div className="layout">
      <Sidebar page={page} setPage={setPage} alertCount={ov.data?.open_alerts ?? 0} />
      <main>
        <Topbar title={TITLES[page]} subtitle={SUBTITLES[page]} />
        {page === "overview" && <Overview />}
        {page === "transactions" && <Transactions onNavigate={setPage} />}
        {page === "fraud" && <FraudDetection onNavigate={setPage} />}
        {page === "alerts" && <Alerts onNavigate={setPage} />}
        {page === "customers" && <Customers onNavigate={setPage} />}
        {page === "analytics" && <Analytics />}
        {page === "reports" && <Reports />}
        {page === "model" && <ModelMonitor />}
      </main>
    </div>
  );
}
