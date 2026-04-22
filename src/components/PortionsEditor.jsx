// Editor sady porcí pro potravinu. Používá se:
// - trenérský FoodEditModal (schvalování a správa potravin)
// - klientský FoodSearchModal (při přidávání nové potraviny a při návrhu úpravy)
//
// Hodnota `value` je pole { label: string, grams: string | number }.
// `onChange` dostane nové pole po každé úpravě.

export default function PortionsEditor({ value, onChange, unit = 'g', title = 'Doporučené porce', emptyLabel }) {
  const portions = value || [];

  function update(idx, key, val) {
    onChange(portions.map((p, i) => (i === idx ? { ...p, [key]: val } : p)));
  }

  function add() {
    onChange([...portions, { label: '', grams: '' }]);
  }

  function remove(idx) {
    onChange(portions.filter((_, i) => i !== idx));
  }

  return (
    <div className="modal-portions-editor">
      <div className="modal-portions-header">
        <span>{title}</span>
        <button type="button" className="modal-portions-add" onClick={add}>
          + Přidat
        </button>
      </div>
      {portions.length === 0 && (
        <div className="modal-portions-empty">
          {emptyLabel || 'Žádné porce — zapíše se jen přesná gramáž.'}
        </div>
      )}
      {portions.map((p, i) => (
        <div key={i} className="modal-portions-row">
          <input
            type="text"
            placeholder="Název (např. 1 plátek)"
            value={p.label}
            onChange={(e) => update(i, 'label', e.target.value)}
            className="modal-portions-label"
          />
          <input
            type="text"
            inputMode="decimal"
            placeholder="g"
            value={p.grams}
            onChange={(e) => update(i, 'grams', e.target.value)}
            className="modal-portions-grams"
          />
          <span className="modal-portions-unit">{unit}</span>
          <button
            type="button"
            className="modal-portions-remove"
            onClick={() => remove(i)}
            title="Smazat"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

// Očistí pole porcí: ignoruje prázdné řádky, vrací [{label, grams}] nebo chybu.
export function cleanPortions(list) {
  const out = [];
  for (const p of list || []) {
    const label = (p.label || '').trim();
    const g = parseFloat(String(p.grams ?? '').replace(',', '.'));
    if (label === '' && !Number.isFinite(g)) continue;
    if (label === '' || !Number.isFinite(g) || g <= 0) {
      return { error: 'Porce: vyplň název i gramáž (>0), nebo řádek smaž.' };
    }
    out.push({ label, grams: Math.round(g * 10) / 10 });
  }
  return { portions: out };
}
