// public/app.js
// Vanilla JS single-page app -- no build step required.

const API = '/api';
let debounceTimer;

// ---------- health / db banner ----------
async function checkHealth() {
  try {
    const res = await fetch(`${API}/health`);
    const data = await res.json();
    const banner = document.getElementById('db-banner');
    if (data.status !== 'ok') {
      banner.textContent = `CognoDB unreachable — ${data.dbError || 'check your connection settings'}`;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  } catch (e) {
    // server itself unreachable
  }
}
checkHealth();
setInterval(checkHealth, 15000);

function debounce(fn, ms = 300) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(fn, ms);
}

async function apiGet(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Request failed (${res.status})`);
  }
  return res.json();
}

// ---------- tabs ----------
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
  });
});

// ================= EXPLORE AUTHOR =================
const exploreSearch = document.getElementById('explore-search');
const exploreResults = document.getElementById('explore-results');
const exploreEmpty = document.getElementById('explore-empty');
const exploreDetail = document.getElementById('explore-detail');
exploreEmpty.classList.remove('hidden');

exploreSearch.addEventListener('input', () => {
  debounce(async () => {
    const q = exploreSearch.value.trim();
    exploreResults.innerHTML = '';
    if (!q) return;
    try {
      const authors = await apiGet(`/authors?search=${encodeURIComponent(q)}`);
      exploreResults.innerHTML = authors.map(a =>
        `<div class="result-item" data-id="${a.id}"><strong>${a.name}</strong><div class="rmeta">h-index ${a.hIndex}</div></div>`
      ).join('') || `<div class="empty-state">No authors match "${q}".</div>`;
      exploreResults.querySelectorAll('.result-item').forEach(el => {
        el.addEventListener('click', () => loadAuthor(el.dataset.id));
      });
    } catch (e) {
      exploreResults.innerHTML = `<div class="empty-state">${e.message}</div>`;
    }
  });
});

async function loadAuthor(id) {
  exploreEmpty.classList.add('hidden');
  exploreDetail.classList.remove('hidden');
  document.getElementById('explore-name').textContent = 'Loading…';
  document.getElementById('explore-meta').textContent = '';
  document.getElementById('explore-papers').innerHTML = '';
  try {
    const data = await apiGet(`/authors/${id}`);
    document.getElementById('explore-name').textContent = data.profile.name;
    document.getElementById('explore-meta').textContent =
      `h-index ${data.profile.hIndex} · joined ${data.profile.joinedYear}` +
      (data.profile.institution ? ` · ${data.profile.institution} (${data.profile.country})` : '');

    document.getElementById('explore-papers').innerHTML = data.papers.map(p => `
      <li>
        <div class="ptitle">${p.paperTitle}</div>
        <div class="pmeta">${p.venue} · ${p.year}</div>
        ${p.coAuthors.filter(c => c.id).length ? `<div class="pcoauthors">with ${p.coAuthors.filter(c => c.id).map(c => `<span>${c.name}</span>`).join(', ')}</div>` : ''}
      </li>`).join('') || '<li>No papers on record.</li>';

    renderNetwork('explore-network', data.graph);
  } catch (e) {
    document.getElementById('explore-name').textContent = 'Error';
    document.getElementById('explore-meta').textContent = e.message;
  }
}

function renderNetwork(containerId, graph) {
  const container = document.getElementById(containerId);
  const colors = { me: '#c69a3a', paper: '#1c1a15', coauthor: '#6b6455' };
  const nodes = new vis.DataSet(graph.nodes.map(n => ({
    id: n.id,
    label: n.label.length > 28 ? n.label.slice(0, 26) + '…' : n.label,
    shape: n.group === 'paper' ? 'box' : 'ellipse',
    color: { background: n.group === 'me' ? '#c69a3a' : '#f6f1e4', border: colors[n.group] || '#6b6455' },
    font: { color: '#1c1a15', size: 12 },
  })));
  const edges = new vis.DataSet(graph.edges.map((e, i) => ({ id: i, from: e.from, to: e.to })));
  new vis.Network(container, { nodes, edges }, {
    physics: { stabilization: true, barnesHut: { springLength: 110 } },
    interaction: { hover: true, zoomView: true },
    edges: { color: '#c9c2ac', arrows: { to: { enabled: false } }, width: 1 },
  });
}

// ================= CITATION TRAIL =================
setupPicker('citation-from', '/papers', p => `${p.title} (${p.year})`, p => p.id);
setupPicker('citation-to', '/papers', p => `${p.title} (${p.year})`, p => p.id);

let citationFromId = null, citationToId = null;
document.getElementById('citation-from-search').addEventListener('picked', e => { citationFromId = e.detail.id; toggleCitationBtn(); });
document.getElementById('citation-to-search').addEventListener('picked', e => { citationToId = e.detail.id; toggleCitationBtn(); });
function toggleCitationBtn() {
  document.getElementById('citation-run').disabled = !(citationFromId && citationToId);
}
document.getElementById('citation-empty').classList.remove('hidden');

document.getElementById('citation-run').addEventListener('click', async () => {
  const loading = document.getElementById('citation-loading');
  const none = document.getElementById('citation-none');
  const result = document.getElementById('citation-result');
  const empty = document.getElementById('citation-empty');
  empty.classList.add('hidden'); none.classList.add('hidden'); result.classList.add('hidden');
  loading.classList.remove('hidden');
  try {
    const data = await apiGet(`/queries/citation-path?from=${citationFromId}&to=${citationToId}`);
    loading.classList.add('hidden');
    if (!data.found) { none.classList.remove('hidden'); return; }
    result.classList.remove('hidden');
    result.innerHTML = `<div class="trail-hops">${data.hops} hop${data.hops === 1 ? '' : 's'} via CITES</div>` +
      data.nodes.map((n, i) => `
        ${i > 0 ? '<span class="trail-arrow">→</span>' : ''}
        <div class="trail-node"><div class="tn-kind">Paper · ${n.year}</div>${n.title}</div>
      `).join('');
  } catch (e) {
    loading.classList.add('hidden');
    result.classList.remove('hidden');
    result.innerHTML = `<div class="empty-state">${e.message}</div>`;
  }
});

// ================= RECOMMEND =================
const recommendSearch = document.getElementById('recommend-search');
const recommendResults = document.getElementById('recommend-results');
document.getElementById('recommend-empty').classList.remove('hidden');

recommendSearch.addEventListener('input', () => {
  debounce(async () => {
    const q = recommendSearch.value.trim();
    recommendResults.innerHTML = '';
    if (!q) return;
    try {
      const authors = await apiGet(`/authors?search=${encodeURIComponent(q)}`);
      recommendResults.innerHTML = authors.map(a =>
        `<div class="result-item" data-id="${a.id}"><strong>${a.name}</strong><div class="rmeta">h-index ${a.hIndex}</div></div>`
      ).join('') || `<div class="empty-state">No authors match "${q}".</div>`;
      recommendResults.querySelectorAll('.result-item').forEach(el => {
        el.addEventListener('click', () => loadRecommendations(el.dataset.id));
      });
    } catch (e) {
      recommendResults.innerHTML = `<div class="empty-state">${e.message}</div>`;
    }
  });
});

async function loadRecommendations(authorId) {
  const loading = document.getElementById('recommend-loading');
  const none = document.getElementById('recommend-none');
  const list = document.getElementById('recommend-list');
  const empty = document.getElementById('recommend-empty');
  empty.classList.add('hidden'); none.classList.add('hidden'); list.classList.add('hidden');
  loading.classList.remove('hidden');
  try {
    const recs = await apiGet(`/queries/recommend/${authorId}`);
    loading.classList.add('hidden');
    if (recs.length === 0) { none.classList.remove('hidden'); return; }
    list.classList.remove('hidden');
    list.innerHTML = recs.map(r => `
      <li>
        <div>
          <div class="rec-name">${r.name}</div>
          <div class="rec-sub">${r.sharedCollaborators} shared collaborator${r.sharedCollaborators === 1 ? '' : 's'} · ${r.sharedTopics} shared topic${r.sharedTopics === 1 ? '' : 's'} · h-index ${r.hIndex}</div>
        </div>
        <div class="score-badge">score ${r.score}</div>
      </li>`).join('');
  } catch (e) {
    loading.classList.add('hidden');
    list.classList.remove('hidden');
    list.innerHTML = `<div class="empty-state">${e.message}</div>`;
  }
}

// ================= TOPIC INFLUENCE =================
(async function loadTopics() {
  try {
    const topics = await apiGet('/queries/topics');
    const select = document.getElementById('influence-topic');
    topics.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id; opt.textContent = t.name;
      select.appendChild(opt);
    });
  } catch (e) { /* health banner already reports this */ }
})();
document.getElementById('influence-empty').classList.remove('hidden');

document.getElementById('influence-topic').addEventListener('change', async (e) => {
  const topicId = e.target.value;
  const loading = document.getElementById('influence-loading');
  const none = document.getElementById('influence-none');
  const list = document.getElementById('influence-list');
  const empty = document.getElementById('influence-empty');
  empty.classList.add('hidden'); none.classList.add('hidden'); list.classList.add('hidden');
  if (!topicId) { empty.classList.remove('hidden'); return; }
  loading.classList.remove('hidden');
  try {
    const rows = await apiGet(`/queries/topic-influence/${topicId}`);
    loading.classList.add('hidden');
    if (rows.length === 0) { none.classList.remove('hidden'); return; }
    list.classList.remove('hidden');
    list.innerHTML = rows.map(r => `
      <li>
        <div>
          <div class="rec-name">${r.name}</div>
          <div class="inf-sub">cited by ${r.citingPapers} paper${r.citingPapers === 1 ? '' : 's'}, from ${r.sourcePapers} source paper${r.sourcePapers === 1 ? '' : 's'}</div>
        </div>
        <div class="score-badge">${r.citingPapers}</div>
      </li>`).join('');
  } catch (e) {
    loading.classList.add('hidden');
    list.classList.remove('hidden');
    list.innerHTML = `<div class="empty-state">${e.message}</div>`;
  }
});

// ================= SHORTEST PATH =================
setupPicker('path-from', '/authors', a => a.name, a => a.id);
setupPicker('path-to', '/authors', a => a.name, a => a.id);

let pathFromId = null, pathToId = null;
document.getElementById('path-from-search').addEventListener('picked', e => { pathFromId = e.detail.id; togglePathBtn(); });
document.getElementById('path-to-search').addEventListener('picked', e => { pathToId = e.detail.id; togglePathBtn(); });
function togglePathBtn() {
  document.getElementById('path-run').disabled = !(pathFromId && pathToId);
}
document.getElementById('path-empty').classList.remove('hidden');

document.getElementById('path-run').addEventListener('click', async () => {
  const loading = document.getElementById('path-loading');
  const none = document.getElementById('path-none');
  const result = document.getElementById('path-result');
  const empty = document.getElementById('path-empty');
  empty.classList.add('hidden'); none.classList.add('hidden'); result.classList.add('hidden');
  loading.classList.remove('hidden');
  try {
    const data = await apiGet(`/queries/shortest-path?from=${pathFromId}&to=${pathToId}`);
    loading.classList.add('hidden');
    if (!data.found) { none.classList.remove('hidden'); return; }
    result.classList.remove('hidden');
    result.innerHTML = `<div class="trail-hops">${data.hops} hop${data.hops === 1 ? '' : 's'}</div>` +
      data.nodes.map((n, i) => `
        ${i > 0 ? '<span class="trail-arrow">→</span>' : ''}
        <div class="trail-node"><div class="tn-kind">${n.kind}</div>${n.label}</div>
      `).join('');
  } catch (e) {
    loading.classList.add('hidden');
    result.classList.remove('hidden');
    result.innerHTML = `<div class="empty-state">${e.message}</div>`;
  }
});

// ---------- generic search-and-pick widget for citation/path pickers ----------
function setupPicker(prefix, endpoint, labelFn, idFn) {
  const input = document.getElementById(`${prefix}-search`);
  const results = document.getElementById(`${prefix}-results`);
  const picked = document.getElementById(`${prefix}-picked`);
  input.addEventListener('input', () => {
    debounce(async () => {
      const q = input.value.trim();
      results.innerHTML = '';
      if (!q) return;
      try {
        const items = await apiGet(`${endpoint}?search=${encodeURIComponent(q)}`);
        results.innerHTML = items.map(it =>
          `<div class="result-item" data-id="${idFn(it)}">${labelFn(it)}</div>`
        ).join('') || `<div class="empty-state">No results for "${q}".</div>`;
        results.querySelectorAll('.result-item').forEach(el => {
          el.addEventListener('click', () => {
            picked.classList.remove('hidden');
            picked.textContent = el.textContent;
            results.innerHTML = '';
            input.value = '';
            input.dispatchEvent(new CustomEvent('picked', { detail: { id: el.dataset.id }, bubbles: false }));
          });
        });
      } catch (e) {
        results.innerHTML = `<div class="empty-state">${e.message}</div>`;
      }
    });
  });
}
