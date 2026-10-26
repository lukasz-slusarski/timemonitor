import { useState, useEffect, FormEvent } from 'react';

const API_URL = import.meta.env.VITE_API_URL || '';

interface PresenceToken {
  id: number;
  name: string;
  kind: 'human' | 'bot';
  app_user_id: number | null;
  model: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

const MODELS = ['male-a', 'male-b', 'male-c', 'male-d', 'male-e', 'male-f', 'female-a', 'female-b', 'female-c', 'female-d', 'female-e', 'female-f'];

// Tokeny biura: plugin Claude Code i boty wysyłają nimi zdarzenia do /api/presence/events
export function PresenceTokens({ token, users }: { token: string | null; users: { id: number; username: string; display_name: string | null }[] }) {
  const [tokens, setTokens] = useState<PresenceToken[]>([]);
  const [kind, setKind] = useState<'human' | 'bot'>('human');
  const [userId, setUserId] = useState('');
  const [name, setName] = useState('');
  const [model, setModel] = useState('male-f');
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const [error, setError] = useState('');

  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  const fetchTokens = async () => {
    const response = await fetch(`${API_URL}/admin/presence-tokens`, { headers });
    if (response.ok) setTokens(await response.json());
  };

  useEffect(() => { fetchTokens(); }, [token]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const response = await fetch(`${API_URL}/admin/presence-tokens`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ kind, app_user_id: kind === 'human' ? Number(userId) : undefined, name, model: `character-${model}` }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || 'Nie udało się utworzyć tokenu');
      return;
    }
    const label = kind === 'human' ? (name || users.find((u) => u.id === Number(userId))?.display_name || '') : name;
    setCreated({ name: label, token: data.token });
    setName('');
    fetchTokens();
  };

  const handleRevoke = async (t: PresenceToken) => {
    if (!confirm(`Unieważnić token „${t.name}”? Plugin z tym tokenem przestanie wysyłać dane.`)) return;
    await fetch(`${API_URL}/admin/presence-tokens/${t.id}`, { method: 'DELETE', headers });
    fetchTokens();
  };

  const inputClass = 'px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground';

  return (
    <div className="bg-card rounded-2xl border border-border p-4 mb-6">
      <h2 className="text-lg font-semibold text-foreground mb-1">Tokeny biura</h2>
      <p className="text-xs text-muted-foreground mb-3">
        Osoba wpisuje token przy instalacji pluginu: <code>claude plugin install biuro@important</code>. Bot wysyła nim zdarzenia na <code>/api/presence/events</code>.
      </p>

      {created && (
        <div className="mb-4 rounded-lg border border-border bg-muted/60 p-3 text-sm">
          <div className="text-foreground mb-1">Token dla: {created.name}. Skopiuj teraz, później nie będzie widoczny.</div>
          <div className="flex gap-2 items-center">
            <code className="flex-1 break-all text-xs">{created.token}</code>
            <button onClick={() => navigator.clipboard.writeText(created.token)} className="px-3 py-1.5 border border-border rounded-lg text-xs hover:bg-muted">Kopiuj</button>
            <button onClick={() => setCreated(null)} className="px-2 text-muted-foreground hover:text-foreground">✕</button>
          </div>
        </div>
      )}

      <form onSubmit={handleCreate} className="flex flex-wrap gap-2 items-center mb-4">
        <select value={kind} onChange={(e) => setKind(e.target.value as 'human' | 'bot')} className={inputClass}>
          <option value="human">Osoba</option>
          <option value="bot">Bot</option>
        </select>
        {kind === 'human' ? (
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className={inputClass} required>
            <option value="">Wybierz użytkownika</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.display_name || u.username}</option>)}
          </select>
        ) : (
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nazwa bota, np. OpenOutreach" className={inputClass} required />
        )}
        {kind === 'human' && (
          <select value={model} onChange={(e) => setModel(e.target.value)} className={inputClass} title="Postać w biurze">
            {MODELS.map((m) => <option key={m} value={m}>Postać {m}</option>)}
          </select>
        )}
        <button type="submit" className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm hover:opacity-90">Utwórz token</button>
        {error && <span className="text-sm text-destructive">{error}</span>}
      </form>

      {tokens.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground text-xs">
              <th className="py-1 font-medium">Nazwa</th>
              <th className="py-1 font-medium">Typ</th>
              <th className="py-1 font-medium">Ostatnio użyty</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id} className={`border-t border-border ${t.revoked_at ? 'opacity-50' : ''}`}>
                <td className="py-2 text-foreground">{t.name}</td>
                <td className="py-2 text-muted-foreground">{t.kind === 'bot' ? 'bot' : 'osoba'}</td>
                <td className="py-2 text-muted-foreground">{t.revoked_at ? 'unieważniony' : t.last_used_at ? new Date(t.last_used_at.replace(' ', 'T') + 'Z').toLocaleString('pl-PL') : 'nigdy'}</td>
                <td className="py-2 text-right">
                  {!t.revoked_at && <button onClick={() => handleRevoke(t)} className="text-xs text-destructive hover:underline">Unieważnij</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
