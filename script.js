const $  = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}
function fmtMoney(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  try {
    return Number(n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  } catch { return "$" + n; }
}

(() => {
  const hb = $("#hamburger");
  const menu = $("#menuBox");
  if (!hb || !menu) return;
  hb.addEventListener("click", () => {
    const open = hb.getAttribute("aria-expanded") === "true";
    hb.setAttribute("aria-expanded", String(!open));
    menu.setAttribute("aria-hidden", String(open));
    menu.classList.toggle("is-open", !open);
  });
})();


let TOKENS_LOCAL = [];  
let TOKEN_INFO   = [];  
let ACTIVE_FILTER = "featured";
let SEARCH = "";


async function loadLocalTokens() {
  const r = await fetch("/tokens.json", { cache: "no-store" });
  const data = await r.json();

  let arr = [];
  if (Array.isArray(data)) {
    arr = data.map((x) => {
      if (typeof x === "string") return { mint: x, featured: true, isNew: false };
      return {
        mint: x?.mint,
        featured: Boolean(x?.featured ?? true),
        isNew: Boolean(x?.isNew ?? false),
      };
    }).filter(t => !!t.mint);
  } else if (data && typeof data === "object" && data.mint) {
    arr = [{ mint: data.mint, featured: Boolean(data.featured ?? true), isNew: Boolean(data.isNew ?? false) }];
  }

  TOKENS_LOCAL = arr;
}


const JUP_BASE = "https://lite-api.jup.ag";
const TOKEN_SEARCH_URL = `${JUP_BASE}/tokens/v2/search`;
const DEBUG = false; 

function normalizeMarketCapLike(hit) {
  if (typeof hit?.mcap === "number") return hit.mcap;                     
  if (typeof hit?.fdv === "number")  return hit.fdv;                       
  if (typeof hit?.marketCap === "number") return hit.marketCap;             
  if (hit?.marketCap && typeof hit.marketCap === "object") {
    if (typeof hit.marketCap.usd === "number") return hit.marketCap.usd;
    if (typeof hit.marketCap.USD === "number") return hit.marketCap.USD;
    if (typeof hit.marketCap.value === "number") return hit.marketCap.value;
  }
  if (typeof hit?.circSupply === "number" && typeof hit?.usdPrice === "number") {
    return hit.circSupply * hit.usdPrice;                                
  }
  return null;
}
function pickImage(hit) {
  return (
    hit?.logoURI ||
    hit?.logoUri ||
    hit?.image   ||
    hit?.logo    ||
    hit?.icon    || 
    ""
  );
}
function pickName(hit)   { return hit?.name   ?? "—"; }
function pickSymbol(hit) { return hit?.symbol ?? "";  }


function chooseHitFromResponse(json, mint) {
  if (!json) return null;


  if (Array.isArray(json)) {
    let hit = json.find((t) => String(t?.id).toLowerCase() === String(mint).toLowerCase());
    if (hit) return hit;

    let best = json[0], bestScore = -Infinity;
    for (const t of json) {
      const mc  = normalizeMarketCapLike(t) || 0;
      const liq = typeof t?.liquidity === "number" ? t.liquidity : 0;
      const score = mc + liq * 0.1;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    return best;
  }


  if (Array.isArray(json?.data)) {
    let hit = json.data.find((t) => String(t?.address).toLowerCase() === String(mint).toLowerCase());
    if (hit) return hit;

    let best = json.data[0], bestScore = -Infinity;
    for (const t of json.data) {
      const mc  = normalizeMarketCapLike(t) || 0;
      const liq = typeof t?.liquidity === "number" ? t.liquidity : 0;
      const score = mc + liq * 0.1;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    return best;
  }

  return json;
}

async function fetchOneTokenInfo(mint) {
  const url = `${TOKEN_SEARCH_URL}?query=${encodeURIComponent(mint)}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    if (DEBUG) console.warn("HTTP", res.status, mint);
    return { mint, name: "—", symbol: "", image: "", marketCap: null };
  }
  const json = await res.json();
  if (DEBUG) console.log("JUP search", mint, json);

  const hit = chooseHitFromResponse(json, mint);
  if (!hit) return { mint, name: "—", symbol: "", image: "", marketCap: null };

  return {
    mint,
    name: pickName(hit),
    symbol: pickSymbol(hit),
    image: pickImage(hit),
    marketCap: normalizeMarketCapLike(hit),
  };
}

async function mapLimit(items, limit, iter) {
  const out = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await iter(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

async function fetchTokenInfoAll() {
  const mints = TOKENS_LOCAL.map(t => t.mint);
  const info = await mapLimit(mints, 4, (mint) => fetchOneTokenInfo(mint)); 
  const flags = new Map(TOKENS_LOCAL.map(t => [t.mint, { featured: t.featured, isNew: t.isNew }]));
  TOKEN_INFO = info.map(t => Object.assign({}, t, flags.get(t.mint) || { featured: true, isNew: false }));
}

function getFilteredData() {
  let rows = TOKEN_INFO.slice();

  if (ACTIVE_FILTER === "featured") rows = rows.filter(r => r.featured);
  else if (ACTIVE_FILTER === "new") rows = rows.filter(r => r.isNew);

  if (SEARCH) {
    const s = SEARCH.toLowerCase().trim();
    rows = rows.filter(r =>
      (r.name   && r.name.toLowerCase().includes(s)) ||
      (r.symbol && r.symbol.toLowerCase().includes(s)) ||
      (r.mint   && r.mint.toLowerCase().includes(s))
    );
  }

  rows.sort((a, b) => (Number(b.marketCap || 0) - Number(a.marketCap || 0)) ||
                      String(a.name || "").localeCompare(String(b.name || "")));
  return rows;
}

function truncateMiddle(str, head = 6, tail = 6) {
  if (!str) return "";
  if (str.length <= head + tail + 3) return str;
  return `${str.slice(0, head)}…${str.slice(-tail)}`;
}

function renderGrid() {
  const grid = $("#grid");
  grid.innerHTML = "";

  const rows = getFilteredData();
  if (!rows.length) {
    grid.innerHTML = `<div class="empty">No tokens found.</div>`;
    return;
  }

  for (const t of rows) {
    const card = document.createElement("div");
    card.className = "token-card";

    const displayedCA = truncateMiddle(t.mint, 6, 6); 

    card.innerHTML = `
      <div class="token-logo-wrap">
        <img class="token-logo" src="${escapeHTML(t.image || "")}" alt="${escapeHTML(t.symbol || t.name || "token")}" />
      </div>

      <div class="token-meta">
        <div class="token-title">
          <span class="token-name">${escapeHTML(t.name)}</span>
          <span class="token-symbol">${t.symbol ? "(" + escapeHTML(t.symbol) + ")" : ""}</span>
        </div>

        <div class="token-ca-row">
          <span class="token-ca-badge">${escapeHTML(displayedCA)}</span>
          <button class="btn btn--ghost btn--sm btn--copy copy-ca-btn" 
                  data-ca="${escapeHTML(t.mint)}" 
                  title="Copy CA" 
                  aria-label="Copy contract address">
            Copy
          </button>
        </div>

        <div class="token-mc">
          <span class="label">Market Cap:</span>
          <span class="token-mc-value">${fmtMoney(t.marketCap)}</span>
        </div>
      </div>
    `;

    const btn = $(".copy-ca-btn", card);
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.ca);
        const prev = btn.textContent;
        btn.textContent = "Copiado!";
        btn.classList.add("success");
        setTimeout(() => { btn.textContent = prev; btn.classList.remove("success"); }, 1200);
      } catch {
        const prev = btn.textContent;
        btn.textContent = "Falhou";
        setTimeout(() => { btn.textContent = prev; }, 1200);
      }
    });

    grid.appendChild(card);
  }
}


(function setupTabs(){
  $$(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".tab").forEach(b => { b.classList.remove("is-active"); b.setAttribute("aria-pressed", "false"); });
      btn.classList.add("is-active"); btn.setAttribute("aria-pressed", "true");
      ACTIVE_FILTER = btn.dataset.filter || "featured";
      renderGrid();
    });
  });
})();

(function setupSearch(){
  const input = $("#search");
  if (!input) return;

  window.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== input) {
      e.preventDefault(); input.focus();
    }
  });

  input.addEventListener("input", () => {
    SEARCH = input.value || ""; renderGrid();
  });
})();

(async function boot(){
  const y = $("#year"); if (y) y.textContent = new Date().getFullYear();

  try {
    await loadLocalTokens();
    await fetchTokenInfoAll();
    renderGrid();

    setInterval(async () => {
      try { await fetchTokenInfoAll(); renderGrid(); } catch (e) { console.warn("refresh fail", e); }
    }, 30000);
  } catch (e) {
    console.error(e);
    const grid = $("#grid");
    if (grid) grid.innerHTML = `<div class="error">Failed to load tokens.</div>`;
  }
})();
