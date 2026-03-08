import { Routes, Route, Navigate } from "react-router-dom";

function Placeholder({ name }: { name: string }) {
  return (
    <div className="flex items-center justify-center h-screen bg-surface">
      <h1 className="heading-display text-2xl">{name}</h1>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/cards" replace />} />
      <Route path="/cards" element={<Placeholder name="Cards" />} />
      <Route path="/runs" element={<Placeholder name="Runs" />} />
    </Routes>
  );
}
