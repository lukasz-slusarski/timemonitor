const API_URL = import.meta.env.VITE_API_URL || '';

// Biuro: scena three.js z public/biuro (ta sama domena, więc bierze token i motyw z aplikacji)
export function OfficeTab() {
  return (
    <div className="rounded-2xl border border-border overflow-hidden bg-card">
      <iframe
        title="Biuro"
        src={`/biuro/index.html?api=${encodeURIComponent(API_URL)}`}
        className="block w-full border-0"
        style={{ height: 'max(520px, calc(100vh - 230px))' }}
      />
    </div>
  );
}
