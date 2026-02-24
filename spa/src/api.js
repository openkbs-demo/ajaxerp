const API_URL = '/api';

export async function api(action, data = {}) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...data })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Грешка в API');
  return json;
}

export async function exportCsv(reportType, params = {}) {
  const data = await api('export.excel', { report_type: reportType, params });
  if (data.url) {
    window.open(data.url, '_blank');
  } else if (data.csv) {
    const blob = new Blob([data.csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = data.fileName;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
