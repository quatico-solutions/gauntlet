import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { Sidebar } from "./components/Sidebar";

const TABS = [
  { label: "Cards", path: "/cards" },
  { label: "Runs", path: "/runs" },
];

function CardsPage() {
  return <div className="p-6 text-slate">Select a card from the sidebar</div>;
}

function RunsPage() {
  return <div className="p-6 text-slate">Select a run from the sidebar</div>;
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const activeTab = location.pathname.startsWith("/runs") ? "/runs" : "/cards";

  return (
    <AppShell
      sidebar={
        <Sidebar
          tabs={TABS}
          activeTab={activeTab}
          onTabChange={(path) => navigate(path)}
        >
          <div className="p-3 text-sm text-slate">
            {activeTab === "/cards" ? "Loading cards..." : "Loading runs..."}
          </div>
        </Sidebar>
      }
    >
      <Routes>
        <Route path="/" element={<Navigate to="/cards" replace />} />
        <Route path="/cards/*" element={<CardsPage />} />
        <Route path="/runs/*" element={<RunsPage />} />
      </Routes>
    </AppShell>
  );
}
