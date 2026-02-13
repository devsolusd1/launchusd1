const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

const btnConnect = $("#connectWallet");
const btnDisconnect = $("#disconnectWallet");
const btnCreate = $("#createTokenBtn");
const badgeAddr = $("#walletAddr");
const btnClaim = $("#claimCreatorFeesBtn");

const modalCreate = $("#modalCreateToken");
const closeCreate = $("#closeCreateToken");
const cancelCreate = $("#cancelCreateToken");
const submitCreate = $("#submitCreateToken");

const inpImageFile = $("#ctImageFile");
const inpImage = $("#ctImage");
const inpName = $("#ctName");
const inpSymbol = $("#ctSymbol");
const inpBuyAmount = $("#ctBuyAmount");

const modalAddToken = $("#modalAddToken");
const openAddTokenBtn = $("#openAddToken");
const closeAddToken = $("#closeAddToken");
const cancelAddToken = $("#cancelAddToken");
const submitAddToken = $("#submitAddToken");
const addMint = $("#addMint");
const addName = $("#addName");
const addSymbol = $("#addSymbol");
const addImage = $("#addImage");

const API_BASE = "";
const USD1_MINT = "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB";
const SOL_MINT = "So11111111111111111111111111111111111111112";

const JUP_QUOTE = "https://lite-api.jup.ag/swap/v1/quote";
const JUP_SWAP = "https://lite-api.jup.ag/swap/v1/swap";

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1]);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}
function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}
const IPFS_GATEWAY = "https://coffee-bright-lungfish-824.mypinata.cloud/ipfs";

const PLACEHOLDER_IMG = "data:image/svg+xml;utf8," + encodeURIComponent(`
  <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'>
    <rect width='120' height='120' fill='#1f2937'/>
    <circle cx='60' cy='48' r='22' fill='#374151'/>
    <rect x='22' y='80' width='76' height='18' rx='9' fill='#374151'/>
  </svg>`);

function toHttpImage(u) {
  if (!u) return "";
  const s = String(u).trim();
  if (/^https?:\/\//i.test(s)) return s;
  const cid = s.startsWith("ipfs://")
    ? s.slice(7).replace(/^ipfs\//i, "")
    : (s.match(/\/ipfs\/([^/?#]+)/i)?.[1] || "");
  return cid ? `${IPFS_GATEWAY.replace(/\/+$/, "")}/${cid}` : s;
}

function truncateMiddle(str, head = 6, tail = 6) {
  if (!str) return "";
  if (str.length <= head + tail + 3) return str;
  return `${str.slice(0, head)}…${str.slice(-tail)}`;
}
function fmtMoney(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  try { return Number(n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }); }
  catch { return "$" + n; }
}
function shortPk(pk) {
  const s = String(pk || "");
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s;
}
function formIsValid() {
  const name = inpName.value.trim();
  const symbol = inpSymbol.value.trim();
  const buyAmt = parseFloat(inpBuyAmount.value);
  const hasFile = inpImageFile?.files && inpImageFile.files[0];
  const url = inpImage?.value?.trim() || "";
  const imageOk = Boolean(hasFile || url);
  return Boolean(name && symbol && !Number.isNaN(buyAmt) && buyAmt > 0 && imageOk);
}
function updateSubmitState() { if (submitCreate) submitCreate.disabled = !formIsValid(); }
[inpName, inpSymbol, inpBuyAmount, inpImage].forEach(el => el?.addEventListener("input", updateSubmitState));
inpImageFile?.addEventListener("change", updateSubmitState);

async function getJupQuoteSOLtoUSD1(outUsd1Ui, slippageBps = 100) {
  const outAmount = Math.floor(Number(outUsd1Ui) * 1e6);
  if (!(outAmount > 0)) throw new Error("Invalid buyAmount");
  const url = new URL(JUP_QUOTE);
  url.searchParams.set("inputMint", SOL_MINT);
  url.searchParams.set("outputMint", USD1_MINT);
  url.searchParams.set("amount", String(outAmount));
  url.searchParams.set("swapMode", "ExactOut");
  url.searchParams.set("slippageBps", String(slippageBps));
  const r = await fetch(url.toString(), { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`Jupiter quote failed (${r.status})`);
  return await r.json();
}
async function buildJupSwapTxExactOutSOLtoUSD1(walletPubkey, quote, slippageBps = 100) {
  const res = await fetch(JUP_SWAP, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse: { ...quote, slippageBps },
      userPublicKey: walletPubkey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      asLegacyTransaction: false
    })
  });
  if (!res.ok) throw new Error(`Jupiter swap build failed (${res.status})`);
  const j = await res.json();
  const b64 = j?.swapTransaction;
  if (!b64) throw new Error("Jupiter: no swapTransaction");
  return b64;
}

function base64ToUint8Array(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function uint8ToBase64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}
async function relaySignedTxBase64(signedB64) {
  const r = await fetch("/api/send-tx", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ txBase64: signedB64 })
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || "send failed");
  return j.signature;
}
async function signSendConfirmV0TxBase64(b64, wallet) {
  const bytes = base64ToUint8Array(b64);
  let tx;
  try { tx = solanaWeb3.VersionedTransaction.deserialize(bytes); }
  catch { tx = solanaWeb3.Transaction.from(bytes); }
  const signed = await wallet.signTransaction(tx);
  return await relaySignedTxBase64(uint8ToBase64(signed.serialize()));
}
async function sendTxsBase64Sequential(txsBase64, wallet) {
  const sigs = [];
  for (const b64 of txsBase64 || []) {
    const sig = await signSendConfirmV0TxBase64(b64, wallet);
    sigs.push(sig);
  }
  return sigs;
}

async function getUsd1BalanceFromServer(ownerPk) {
  const u = new URL("/api/get-spl-balance", location.origin);
  u.searchParams.set("owner", ownerPk);
  u.searchParams.set("mint", USD1_MINT);
  const r = await fetch(u.toString(), { cache: "no-store" });
  const j = await r.json();
  return Number(j.uiAmount || 0);
}

let wallet, pubkey;
function getProviders() {
  const w = window;
  return { phantom: w.solana?.isPhantom ? w.solana : null, solflare: w.solflare?.isSolflare ? w.solflare : null };
}
async function connectAny() {
  const { phantom, solflare } = getProviders();
  const provider = phantom || solflare;
  if (!provider) {
    alert("Install Phantom or Solflare to connect your wallet.");
    window.open("https://phantom.app/", "_blank");
    return null;
  }
  await provider.connect();
  return provider;
}
async function ensureWallet() {
  if (wallet?.publicKey) return wallet;
  wallet = await connectAny();
  pubkey = wallet?.publicKey?.toString?.();
  if (pubkey) {
    badgeAddr.textContent = shortPk(pubkey);
    badgeAddr.style.display = "inline-flex";
    btnConnect.textContent = "Connected";
    btnCreate.style.display = "inline-block";
    btnDisconnect.style.display = "inline-block";
    if (btnClaim) btnClaim.style.display = "inline-block";
  }
  return wallet;
}
btnConnect?.addEventListener("click", ensureWallet);
btnDisconnect?.addEventListener("click", async () => {
  try { if (wallet?.disconnect) await wallet.disconnect(); } catch {}
  wallet = null; pubkey = null;
  badgeAddr.style.display = "none";
  btnConnect.textContent = "Connect Wallet";
  btnCreate.style.display = "none";
  btnDisconnect.style.display = "none";
  if (btnClaim) btnClaim.style.display = "none"; 
});
btnClaim?.addEventListener("click", async () => {
  try {
    const w = await ensureWallet();
    if (!w?.publicKey) return;

    btnClaim.disabled = true;
    const prev = btnClaim.textContent;
    btnClaim.textContent = "Claiming…";

    const r = await fetch("/api/claim-creator-fee", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payer: wallet.publicKey.toBase58() })
    });
    const j = await r.json();

    if (!j.ok) {
      if (j.reason === "not-eligible") {
        alert("This wallet hasn't deployed any token on this site. Claim not allowed.");
      } else if (j.reason === "nothing-to-claim") {
        alert("No creator fees available to claim.");
      } else {
        alert(j.error || "Claim failed.");
      }
      return;
    }

    const txs = j.txsBase64 || (j.txBase64 ? [j.txBase64] : []);
    if (!txs.length) { alert("No transaction to sign."); return; }

    const sigs = await sendTxsBase64Sequential(txs, wallet);
    alert("Creator fees claimed!\n" + sigs.join("\n"));
  } catch (e) {
    console.error(e);
    alert(String(e?.message || e));
  } finally {
    btnClaim.disabled = false;
    btnClaim.textContent = "Claim creator fees";
  }
});


function openCreateModal() {
  modalCreate.classList.add("is-open");
  modalCreate.setAttribute("aria-hidden", "false");
  if (inpImageFile) inpImageFile.value = "";
  if (inpImage) inpImage.value = "";
  inpName.value = ""; inpSymbol.value = ""; inpBuyAmount.value = "";
  updateSubmitState();
}
function closeCreateModal() {
  modalCreate.classList.remove("is-open");
  modalCreate.setAttribute("aria-hidden", "true");
}
btnCreate?.addEventListener("click", async () => { const w = await ensureWallet(); if (w) openCreateModal(); });
closeCreate?.addEventListener("click", closeCreateModal);
cancelCreate?.addEventListener("click", closeCreateModal);

submitCreate?.addEventListener("click", async (e) => {
  e.preventDefault();
  if (!formIsValid()) { updateSubmitState(); return; }

  const name = inpName.value.trim();
  const symbol = inpSymbol.value.trim().toUpperCase();
  const buyAmt = parseFloat(inpBuyAmount.value);
  const hasFile = inpImageFile?.files && inpImageFile.files[0];
  let imageUrl = inpImage?.value?.trim() || "";

  try {
    await ensureWallet();

    if (hasFile) {
      const f = inpImageFile.files[0];
      const base64 = await fileToBase64(f);
      const up = await fetch(`${API_BASE}/api/upload-image`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: f.name, contentType: f.type || "application/octet-stream", base64 })
      });
      if (!up.ok) throw new Error(`upload failed (${up.status})`);
      const uj = await up.json();
      if (!uj.ok) throw new Error(uj.error || "upload failed");
      imageUrl = uj.imageUri;
    }

    if (buyAmt > 0) {
      const needUsd1 = Number(buyAmt) || 0;
      const haveUsd1 = await getUsd1BalanceFromServer(wallet.publicKey.toBase58());
      const deficit = Math.max(0, needUsd1 - haveUsd1);
      if (deficit > 0) {
        const slippageBps = 150;
        const quote = await getJupQuoteSOLtoUSD1(deficit, slippageBps);
        const swapB64 = await buildJupSwapTxExactOutSOLtoUSD1(
          wallet.publicKey.toBase58(),
          quote,
          slippageBps
        );
        await signSendConfirmV0TxBase64(swapB64, wallet);
      }
    }

    const r = await fetch(`${API_BASE}/api/prepare-launchpad`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payer: pubkey, name, symbol, image: imageUrl, buyAmountUsd1: String(buyAmt) })
    });
    if (!r.ok) throw new Error(`prepare failed (${r.status})`);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "prepare failed");

    const list1 = j.body?.txsBase64 ?? j.txsBase64 ?? [];
    if (list1.length) {
      await sendTxsBase64Sequential(list1, wallet);
    }

    if (j.needsAta) {
      const r2 = await fetch(`${API_BASE}/api/prepare-launchpad`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payer: pubkey, name, symbol, image: imageUrl, buyAmountUsd1: String(buyAmt) })
      });
      const j2 = await r2.json();
      const list2 = j2.body?.txsBase64 ?? j2.txsBase64 ?? [];
      if (list2.length) {
        await sendTxsBase64Sequential(list2, wallet);
      }
    }

    if (j.mint) {
      await fetch("/api/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mint: j.mint,
          name, symbol,
          image: imageUrl,
          metadata: j.metadataUri,
          creator: wallet.publicKey.toBase58(),
          platformId: j.platformId,
          mintSource: j.mintSource
        })
      }).catch(() => {});
      await reloadAndRenderCurrentTab();
    }

    alert("Launch submitted! Check the explorer.");
  } catch (e) {
    console.error(e);
    alert(String(e?.message || e));
  } finally {
    closeCreateModal();
  }
});

const GRID = $("#grid");
const tabsBox = $("#tabs");
const searchInp = $("#search");
const pagePrev = $("#pagePrev");
const pageNext = $("#pageNext");
const pageLbl = $("#pageLabel");

const PAGE_SIZE = 12;
let CURRENT_TAB = "featured";
let CURRENT_PAGE = 1;
let SEARCH_TEXT = "";
let TOKENS = [];

async function fetchAllTokens() {
  const qs = new URLSearchParams({ tab: "new", page: "1", pageSize: "9999" });
  const r = await fetch(`/api/tokens?${qs.toString()}`, { cache: "no-store" });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || "tokens api failed");
  return j.items || [];
}

const JUP_BASE = "https://lite-api.jup.ag";
const TOKEN_SEARCH_URL = `${JUP_BASE}/tokens/v2/search`;

function normalizeMarketCapLike(hit) {
  if (typeof hit?.mcap === "number") return hit.mcap;
  if (typeof hit?.fdv === "number") return hit.fdv;
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
function pickImage(hit) { return hit?.logoURI || hit?.logoUri || hit?.image || hit?.logo || hit?.icon || ""; }
function pickName(hit) { return hit?.name ?? "—"; }
function pickSymbol(hit) { return hit?.symbol ?? ""; }
function chooseHitFromResponse(json, mint) {
  if (!json) return null;
  if (Array.isArray(json)) {
    let hit = json.find((t) => String(t?.id).toLowerCase() === String(mint).toLowerCase());
    if (hit) return hit;
    return json[0];
  }
  if (Array.isArray(json?.data)) {
    let hit = json.data.find((t) => String(t?.address).toLowerCase() === String(mint).toLowerCase());
    if (hit) return hit;
    return json.data[0];
  }
  return json;
}
async function fetchInfoFor(mint) {
  const url = new URL(TOKEN_SEARCH_URL);
  url.searchParams.set("query", mint);
  try {
    const res = await fetch(url.toString(), { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const json = await res.json();
    const hit = chooseHitFromResponse(json, mint);
    if (!hit) return null;
    return {
      name: pickName(hit),
      symbol: pickSymbol(hit),
      image: pickImage(hit),
      marketCap: normalizeMarketCapLike(hit)
    };
  } catch { return null; }
}
async function enrichMarketCaps(list) {
  const out = Array(list.length);
  let i = 0, CONC = 4;
  const workers = new Array(Math.min(CONC, list.length)).fill(0).map(async () => {
    while (i < list.length) {
      const idx = i++;
      const t = list[idx];
      const info = await fetchInfoFor(t.mint);
      const mc = info?.marketCap ?? t.marketCap ?? null;
      const name = t.name || info?.name || t.name;
      const sym = t.symbol || info?.symbol || t.symbol;
      const img = t.image || info?.image || t.image;
      out[idx] = { ...t, name, symbol: sym, image: img, marketCap: mc };
    }
  });
  await Promise.all(workers);
  return out;
}

function computeRows() {
  let rows = TOKENS.slice();
  if (SEARCH_TEXT) {
    const s = SEARCH_TEXT.toLowerCase();
    rows = rows.filter(r =>
      (r.name && r.name.toLowerCase().includes(s)) ||
      (r.symbol && r.symbol.toLowerCase().includes(s)) ||
      (r.mint && r.mint.toLowerCase().includes(s))
    );
  }
  if (CURRENT_TAB === "new") {
    rows.sort((a, b) => (Number(b.createdAt || 0) - Number(a.createdAt || 0)));
  } else if (CURRENT_TAB === "featured") {
    rows.sort((a, b) => (Number(b.marketCap || 0) - Number(a.marketCap || 0)));
  } else {
    rows.sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || "")) ||
      (Number(b.createdAt || 0) - Number(a.createdAt || 0))
    );
  }
  return rows;
}
function renderPage() {
  const rowsAll = computeRows();
  const total = rowsAll.length;
  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  CURRENT_PAGE = Math.min(CURRENT_PAGE, maxPage);
  const start = (CURRENT_PAGE - 1) * PAGE_SIZE;
  const pageRows = rowsAll.slice(start, start + PAGE_SIZE);
  GRID.innerHTML = "";
  if (!pageRows.length) {
    GRID.innerHTML = `<div class="empty">No tokens found.</div>`;
  } else {
    for (const t of pageRows) {
      const displayedCA = truncateMiddle(t.mint, 4, 4);
      const card = document.createElement("div");
      card.className = "token-card";
      card.innerHTML = `
        <div class="token-logo-wrap">
          <img class="token-logo" src="${escapeHTML(toHttpImage(t.image || ''))}" alt="${escapeHTML(t.symbol || t.name || 'token')}" onerror="this.src='/assets/placeholder.png'"/>
        </div>
        <div class="token-meta">
          <div class="token-title">
            <span class="token-name">${escapeHTML(t.name || "\u2014")}</span>
            <span class="token-symbol">${t.symbol ? escapeHTML(t.symbol) : ""}</span>
          </div>
          <div class="token-ca-row">
            <span class="token-ca-badge">${escapeHTML(displayedCA)}</span>
            <button class="btn btn--ghost btn--sm copy-ca-btn" data-ca="${escapeHTML(t.mint)}">Copy</button>
          </div>
          <div class="token-mc">
            <span class="label">MCap</span>
            <span class="token-mc-value">${fmtMoney(t.marketCap)}</span>
          </div>
        </div>
      `;
      GRID.appendChild(card);
    }
  }
  pageLbl.textContent = String(CURRENT_PAGE);
  pagePrev.disabled = CURRENT_PAGE <= 1;
  pageNext.disabled = CURRENT_PAGE >= maxPage;
}

// Delegated click handler for copy buttons (attached once)
GRID?.addEventListener("click", async (e) => {
  const btn = e.target.closest(".copy-ca-btn");
  if (!btn) return;
  const ca = btn.getAttribute("data-ca") || "";
  try { await navigator.clipboard.writeText(ca); } catch {}
  const prev = btn.textContent;
  btn.textContent = "Copied!";
  btn.classList.add("success");
  setTimeout(() => { btn.textContent = prev; btn.classList.remove("success"); }, 1200);
});

async function reloadAndRenderCurrentTab() {
  let list = await fetchAllTokens();
  if (list.length) list = await enrichMarketCaps(list);
  list = list.map(t => ({ ...t, image: toHttpImage(t.image || "") }));
  TOKENS = list;
  renderPage();
}

tabsBox?.addEventListener("click", async (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  $$(".tab", tabsBox).forEach(b => { b.classList.remove("is-active"); b.setAttribute("aria-pressed", "false"); });
  btn.classList.add("is-active"); btn.setAttribute("aria-pressed", "true");
  CURRENT_TAB = btn.dataset.filter || "featured";
  CURRENT_PAGE = 1;
  await reloadAndRenderCurrentTab();
});
searchInp?.addEventListener("input", () => {
  SEARCH_TEXT = searchInp.value || "";
  CURRENT_PAGE = 1;
  renderPage();
});
pagePrev?.addEventListener("click", () => { if (CURRENT_PAGE > 1) { CURRENT_PAGE--; renderPage(); } });
pageNext?.addEventListener("click", () => { CURRENT_PAGE++; renderPage(); });

function openAddModal() { modalAddToken.setAttribute("aria-hidden", "false"); modalAddToken.classList.add("is-open"); }
function closeAddModal() { modalAddToken.setAttribute("aria-hidden", "true"); modalAddToken.classList.remove("is-open"); }
openAddTokenBtn?.addEventListener("click", openAddModal);
closeAddToken?.addEventListener("click", closeAddModal);
cancelAddToken?.addEventListener("click", closeAddModal);

submitAddToken?.addEventListener("click", async () => {
  const mint = (addMint.value || "").trim();
  if (!mint || mint.length < 32) { alert("Enter a valid mint address"); return; }
  let name = (addName.value || "").trim();
  let symbol = (addSymbol.value || "").trim();
  let image = toHttpImage((addImage.value || "").trim());
  if (!name || !symbol || !image) {
    const info = await fetchInfoFor(mint).catch(() => null);
    if (info) {
      if (!name) name = info.name || name;
      if (!symbol) symbol = info.symbol || symbol;
      if (!image) image = info.image || image;
    }
  }
  if (!name || !symbol) { alert("Could not resolve token info. Please fill Name and Ticker."); return; }
  try {
    await fetch("/api/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mint, name, symbol, image, creator: "" })
    });
    closeAddModal();
    addMint.value = addName.value = addSymbol.value = addImage.value = "";
    CURRENT_TAB = "new"; CURRENT_PAGE = 1;
    await reloadAndRenderCurrentTab();
  } catch (e) {
    alert("Failed to add token.");
  }
});

window.addEventListener("DOMContentLoaded", async () => {
  const y = $("#year"); if (y) y.textContent = new Date().getFullYear();
  CURRENT_TAB = "featured"; CURRENT_PAGE = 1; SEARCH_TEXT = "";
  await reloadAndRenderCurrentTab();
});
