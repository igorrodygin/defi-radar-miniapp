/* global Telegram */
const state = {
  token: null,
  user: null,
  route: "portfolio",

  // Wallet connections: one address per chain (evm/btc/sol/ton)
  wallets: {}, // { evm: "0x...", sol: "...", ton: "..." }

  // Latest fetched portfolios per chain
  portfolios: {}, // { evm: {...}, sol: {...} }

  // UI prefs
  selectedChain: localStorage.getItem("selectedChain") || "evm",
  demo: localStorage.getItem("demo") === "true",

  opportunities: [],
};

const elView = document.getElementById("view");
const elTitle = document.getElementById("topTitle");
const elRefresh = document.getElementById("btnRefresh");
const elSettings = document.getElementById("btnSettings");
const elTabs = document.querySelectorAll(".tab");

const sheet = document.getElementById("sheet");
const sheetCard = document.getElementById("sheetCard");
const sheetBackdrop = document.getElementById("sheetBackdrop");

function showToast(text) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

function openSheet(html) {
  sheetCard.innerHTML = html;
  sheet.classList.remove("hidden");
}
function closeSheet() {
  sheet.classList.add("hidden");
  sheetCard.innerHTML = "";
}
sheetBackdrop.addEventListener("click", closeSheet);

function setRoute(route) {
  state.route = route;
  for (const b of elTabs) {
    b.classList.toggle("active", b.dataset.route === route);
  }
  render();
}

for (const b of elTabs) {
  b.addEventListener("click", () => setRoute(b.dataset.route));
}

elRefresh.addEventListener("click", () => {
  if (state.route === "portfolio") loadAllPortfolios();
  if (state.route === "earn") loadEarn();
});

elSettings.addEventListener("click", () => setRoute("settings"));

function fmtUsd(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(n);
}
function fmtNum(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(n);
}
function maskAddr(a) {
  if (!a || a.length < 10) return a || "—";
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}
function chainLabel(chain) {
  if (chain === "evm") return "EVM (ETH)";
  if (chain === "btc") return "Bitcoin";
  if (chain === "sol") return "Solana";
  if (chain === "ton") return "TON";
  return chain;
}

async function api(path, opts = {}) {
  const headers = Object.assign(
    { "content-type": "application/json" },
    opts.headers || {}
  );
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  const res = await fetch(path, Object.assign({}, opts, { headers }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function isInTelegram() {
  return typeof Telegram !== "undefined" && Telegram.WebApp && Telegram.WebApp.initData;
}

async function authenticate() {
  if (isInTelegram()) {
    Telegram.WebApp.ready();
    Telegram.WebApp.expand();

    const initData = Telegram.WebApp.initData;
    const r = await api("/api/auth/telegram", {
      method: "POST",
      body: JSON.stringify({ initData })
    });
    state.token = r.token;
    state.user = r.user;
    return;
  }

  // Dev auth fallback (disable in prod)
  try {
    const r = await api("/api/auth/dev", {
      method: "POST",
      body: JSON.stringify({ userId: "dev_user", locale: navigator.language?.slice(0, 2) || "en" })
    });
    state.token = r.token;
    state.user = r.user;
    showToast("Dev mode (open inside Telegram for real auth)");
  } catch (e) {
    showToast("Open this app inside Telegram.");
  }
}

async function loadWallets() {
  try {
    const r = await api("/api/wallets");
    const wallets = {};
    for (const w of (r.wallets || [])) wallets[w.chain] = w.address;
    state.wallets = wallets;

    // Pick default selected chain
    const chains = Object.keys(wallets);
    if (chains.length && !wallets[state.selectedChain]) {
      state.selectedChain = chains[0];
      localStorage.setItem("selectedChain", state.selectedChain);
    }
  } catch (e) {
    // Backward-compat fallback (older backend)
    try {
      const r = await api("/api/wallet/active");
      if (r.wallet?.chain && r.wallet?.address) {
        state.wallets = { [r.wallet.chain]: r.wallet.address };
      }
    } catch (_) {}
  }
}

async function upsertWallet(chain, address) {
  await api("/api/wallets", { method: "POST", body: JSON.stringify({ chain, address }) });
  state.wallets[chain] = address;
  state.selectedChain = chain;
  localStorage.setItem("selectedChain", chain);
}

async function removeWallet(chain) {
  await api(`/api/wallets/${encodeURIComponent(chain)}`, { method: "DELETE" });
  delete state.wallets[chain];
  delete state.portfolios[chain];

  const remaining = Object.keys(state.wallets);
  if (remaining.length) {
    state.selectedChain = remaining[0];
    localStorage.setItem("selectedChain", state.selectedChain);
  }
}

function render() {
  if (!state.token) {
    elTitle.textContent = "DeFi Radar";
    elRefresh.style.visibility = "hidden";
    elView.innerHTML = `
      <div class="card">
        <h2>Loading…</h2>
        <div class="muted">Authenticating</div>
      </div>
    `;
    return;
  }

  if (state.route === "portfolio") {
    elTitle.textContent = "Portfolio";
    elRefresh.style.visibility = "visible";
    renderPortfolio();
    return;
  }
  if (state.route === "earn") {
    elTitle.textContent = "Earn";
    elRefresh.style.visibility = "visible";
    renderEarn();
    return;
  }
  if (state.route === "alerts") {
    elTitle.textContent = "Alerts";
    elRefresh.style.visibility = "hidden";
    renderAlerts();
    return;
  }
  if (state.route === "settings") {
    elTitle.textContent = "Settings";
    elRefresh.style.visibility = "hidden";
    renderSettings();
    return;
  }
}

/* -------------------- PORTFOLIO (multi-wallet) -------------------- */

function renderPortfolio() {
  const connectedChains = Object.keys(state.wallets);

  elView.innerHTML = `
    <div class="card">
      <h2>Connected wallets</h2>
      <div class="muted">Connect one address per supported chain. Read-only. No private keys.</div>

      <div id="walletList" style="margin-top:10px;"></div>

      <hr />

      <h3 style="margin:0 0 8px 0;">Add / update wallet</h3>
      <label>Chain</label>
      <select id="chainSelect">
        <option value="evm">EVM (ETH)</option>
        <option value="btc">Bitcoin</option>
        <option value="sol">Solana</option>
        <option value="ton">TON</option>
      </select>

      <label style="margin-top:10px;">Public address</label>
      <input id="addressInput" class="input" placeholder="0x… / bc1… / Sol… / UQ… (TON)" value="" />

      <button id="btnConnect" class="btn">Save wallet</button>
      <button id="btnDemo" class="btn secondary">${state.demo ? "Disable demo" : "Try demo"}</button>
    </div>

    <div id="portfolioResult"></div>
  `;

  // Render connected wallets list
  const walletList = document.getElementById("walletList");
  if (!connectedChains.length) {
    walletList.innerHTML = `<div class="muted">No wallets connected yet.</div>`;
  } else {
    walletList.innerHTML = `
      <div class="list">
        ${connectedChains.sort().map((ch) => `
          <div class="list-item">
            <div class="row">
              <div>
                <span class="badge">${chainLabel(ch)}</span>
                <div class="muted" style="margin-top:6px; word-break:break-all;">${maskAddr(state.wallets[ch])}</div>
              </div>
              <div class="row gap8">
                <button class="btn inline secondary" data-view="${ch}">View</button>
                <button class="btn inline danger" data-remove="${ch}">Remove</button>
              </div>
            </div>
          </div>
        `).join("")}
      </div>
    `;

    walletList.querySelectorAll("[data-view]").forEach((b) => {
      b.addEventListener("click", () => {
        state.selectedChain = b.dataset.view;
        localStorage.setItem("selectedChain", state.selectedChain);
        showToast(`Viewing ${chainLabel(state.selectedChain)}`);
        loadAllPortfolios();
      });
    });

    walletList.querySelectorAll("[data-remove]").forEach((b) => {
      b.addEventListener("click", async () => {
        const ch = b.dataset.remove;
        if (!confirm(`Remove ${chainLabel(ch)} wallet?`)) return;
        try {
          await removeWallet(ch);
          showToast("Removed");
          renderPortfolio();
          if (!state.demo) await loadAllPortfolios();
        } catch (e) {
          showToast(e.message);
        }
      });
    });
  }

  const chainSel = document.getElementById("chainSelect");
  const addrIn = document.getElementById("addressInput");
  chainSel.value = state.selectedChain;

  chainSel.addEventListener("change", () => {
    state.selectedChain = chainSel.value;
    localStorage.setItem("selectedChain", state.selectedChain);
    // Prefill with existing wallet address (if any)
    addrIn.value = state.wallets[state.selectedChain] || "";
  });

  // Prefill address with current chain if connected
  addrIn.value = state.wallets[state.selectedChain] || "";

  document.getElementById("btnDemo").addEventListener("click", async () => {
    state.demo = !state.demo;
    localStorage.setItem("demo", state.demo ? "true" : "false");
    if (state.demo) {
      showToast("Demo mode enabled");
      document.getElementById("portfolioResult").innerHTML = demoPortfolioHtml();
    } else {
      showToast("Demo mode disabled");
      await loadAllPortfolios();
    }
  });

  document.getElementById("btnConnect").addEventListener("click", async () => {
    state.demo = false;
    localStorage.setItem("demo", "false");

    const chain = chainSel.value;
    const address = addrIn.value.trim();
    if (!address) return showToast("Enter an address");

    try {
      await upsertWallet(chain, address);
      showToast("Saved");
      renderPortfolio();
      await loadAllPortfolios();
    } catch (e) {
      showToast(e.message);
    }
  });

  // initial load
  if (state.demo) {
    document.getElementById("portfolioResult").innerHTML = demoPortfolioHtml();
  } else {
    loadAllPortfolios();
  }
}

function demoPortfolioHtml() {
  return `
    <div class="card">
      <h2>Total balance</h2>
      <div style="font-size: 28px; font-weight: 800;">$1,234.56</div>
      <div class="muted">Demo data</div>
    </div>

    <div class="card">
      <h2>Wallets</h2>
      <div class="list">
        <div class="list-item row"><span><strong>EVM</strong></span><span>$700.00</span></div>
        <div class="list-item row"><span><strong>SOL</strong></span><span>$400.00</span></div>
        <div class="list-item row"><span><strong>TON</strong></span><span>$134.56</span></div>
      </div>
    </div>

    <div class="card">
      <h2>What you can do now</h2>
      <div class="list">
        <div class="list-item">
          <div class="row"><strong>Explore Earn</strong><span class="muted">Top APYs</span></div>
          <button class="btn inline" id="btnGoEarn">Open</button>
        </div>
        <div class="list-item">
          <div class="row"><strong>Create price alert</strong><span class="muted">Stay updated</span></div>
          <button class="btn inline" id="btnGoAlerts">Create</button>
        </div>
      </div>
    </div>
  `;
}

async function loadAllPortfolios() {
  const target = document.getElementById("portfolioResult");
  if (!target) return;

  const chains = Object.keys(state.wallets);
  if (!chains.length) {
    target.innerHTML = `
      <div class="card">
        <h2>No wallets connected</h2>
        <div class="muted">Add at least one address above to see portfolio.</div>
      </div>
    `;
    return;
  }

  target.innerHTML = `<div class="card"><h2>Loading…</h2><div class="muted">Fetching balances</div></div>`;

  try {
    const results = await Promise.all(chains.map(async (chain) => {
      const address = state.wallets[chain];
      const data = await api(`/api/portfolio?chain=${encodeURIComponent(chain)}&address=${encodeURIComponent(address)}`);
      return [chain, data];
    }));

    state.portfolios = {};
    for (const [chain, data] of results) state.portfolios[chain] = data;

    renderPortfolioResults();
  } catch (e) {
    target.innerHTML = `
      <div class="card">
        <h2>Error</h2>
        <div class="muted">${e.message}</div>
        <button class="btn" id="btnRetry">Retry</button>
      </div>
    `;
    document.getElementById("btnRetry")?.addEventListener("click", loadAllPortfolios);
  }
}

function renderPortfolioResults() {
  const target = document.getElementById("portfolioResult");
  if (!target) return;

  const chains = Object.keys(state.portfolios);
  const sum = chains.reduce((acc, ch) => acc + (state.portfolios[ch]?.totalFiat || 0), 0);

  target.innerHTML = `
    <div class="card">
      <h2>Total across wallets</h2>
      <div style="font-size: 28px; font-weight: 800;">${fmtUsd(sum)}</div>
      <div class="muted">Sum of available fiat estimates</div>
    </div>

    ${chains.sort().map((ch) => {
      const p = state.portfolios[ch];
      return `
        <div class="card">
          <div class="row">
            <h2 style="margin:0;">${chainLabel(ch)}</h2>
            <span class="badge">${maskAddr(state.wallets[ch])}</span>
          </div>
          <div style="font-size: 22px; font-weight: 800; margin-top:8px;">${fmtUsd(p.totalFiat)}</div>
          <div class="muted">Last updated: ${new Date(p.updatedAt).toLocaleString()}</div>

          <hr />
          <h3>Assets</h3>
          <div class="list">
            ${(p.assets || []).map(a => `
              <div class="list-item row">
                <span><strong>${a.symbol}</strong></span>
                <span class="small">${fmtNum(a.amount)} <span class="muted">${fmtUsd(a.fiat)}</span></span>
              </div>
            `).join("")}
          </div>

          <hr />
          <div class="row">
            <div>
              <strong>What you can do now</strong>
              <div class="muted">Explore earn options for this chain</div>
            </div>
            <button class="btn inline" data-goearn="${ch}">Earn</button>
          </div>
        </div>
      `;
    }).join("")}

    <div class="card">
      <h2>Quick actions</h2>
      <div class="list">
        <div class="list-item">
          <div class="row"><strong>Explore Earn</strong><span class="muted">Find APY options</span></div>
          <button class="btn inline" id="btnGoEarn">Open</button>
        </div>
        <div class="list-item">
          <div class="row"><strong>Create alert</strong><span class="muted">Price/APY notifications</span></div>
          <button class="btn inline" id="btnGoAlerts">Create</button>
        </div>
      </div>
    </div>
  `;

  target.querySelectorAll("[data-goearn]").forEach((b) => {
    b.addEventListener("click", () => {
      const ch = b.dataset.goearn;
      state.selectedChain = ch;
      localStorage.setItem("selectedChain", ch);
      setRoute("earn");
    });
  });

  document.getElementById("btnGoEarn")?.addEventListener("click", () => setRoute("earn"));
  document.getElementById("btnGoAlerts")?.addEventListener("click", () => {
    setRoute("alerts");
    setTimeout(() => openCreateAlertSheet(), 0);
  });
}

/* -------------------- EARN -------------------- */

function riskBadge(risk) {
  const klass = risk === "low" ? "ok" : (risk === "medium" ? "warn" : "danger");
  return `<span class="badge ${klass}">${risk.toUpperCase()}</span>`;
}

function walletChoicesForChain(chain) {
  if (chain === "evm") return ["metamask"];
  if (chain === "sol") return ["phantom"];
  if (chain === "ton") return ["telegram"];
  return ["generic"];
}

function buildWalletLink(wallet, url, refUrl) {
  try {
    const u = new URL(url);
    const dapp = (u.host + u.pathname).replace(/\/+$/, "");
    if (wallet === "metamask") return `https://link.metamask.io/dapp/${dapp}`;
    if (wallet === "phantom") return `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(refUrl)}`;
    if (wallet === "telegram") return "https://t.me/wallet";
    return url;
  } catch {
    return url;
  }
}

function renderEarn() {
  elView.innerHTML = `
    <div class="card">
      <h2>Filters</h2>
      <label>Chain</label>
      <select id="earnChain">
        <option value="evm">EVM</option>
        <option value="sol">Solana</option>
        <option value="ton">TON</option>
      </select>
      <div class="muted" style="margin-top:8px;">Opportunities are estimates. Not financial advice.</div>
    </div>

    <div id="earnList"></div>
  `;

  const sel = document.getElementById("earnChain");
  // Default to selectedChain, but if no opportunities for it, user can change
  sel.value = state.selectedChain || "evm";
  sel.addEventListener("change", () => {
    state.selectedChain = sel.value;
    localStorage.setItem("selectedChain", state.selectedChain);
    loadEarn();
  });

  loadEarn();
}

async function loadEarn() {
  const list = document.getElementById("earnList");
  if (!list) return;
  list.innerHTML = `<div class="card"><h2>Loading…</h2><div class="muted">Fetching opportunities</div></div>`;

  try {
    const data = await api(`/api/opportunities?chain=${encodeURIComponent(state.selectedChain)}`);
    state.opportunities = data.items || [];
    if (!state.opportunities.length) {
      list.innerHTML = `<div class="card"><h2>No opportunities</h2><div class="muted">Try another chain.</div></div>`;
      return;
    }

    list.innerHTML = `
      <div class="card">
        <h2>Opportunities</h2>
        <div class="list">
          ${state.opportunities.map(o => `
            <div class="list-item">
              <div class="row">
                <div>
                  <strong>${o.title}</strong>
                  <div class="muted">${o.asset} · ${chainLabel(o.chain)}</div>
                </div>
                ${riskBadge(o.risk)}
              </div>
              <div class="row" style="margin-top:8px;">
                <div><span class="muted">APY</span> <strong>${o.apy}%</strong></div>
                <button class="btn inline" data-opp="${o.id}">Details</button>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    `;

    list.querySelectorAll("button[data-opp]").forEach(btn => {
      btn.addEventListener("click", () => openOpportunity(btn.dataset.opp));
    });
  } catch (e) {
    list.innerHTML = `<div class="card"><h2>Error</h2><div class="muted">${e.message}</div></div>`;
  }
}

async function openOpportunity(id) {
  try {
    const o = await api(`/api/opportunities/${encodeURIComponent(id)}`);
    openSheet(renderOpportunitySheet(o));
    wireOpportunitySheet(o);
  } catch (e) {
    showToast(e.message);
  }
}

function renderOpportunitySheet(o) {
  return `
    <div class="row">
      <div>
        <h2 style="margin:0;">${o.title}</h2>
        <div class="muted">${o.asset} · ${chainLabel(o.chain)}</div>
      </div>
      ${riskBadge(o.risk)}
    </div>

    <div class="card" style="margin-top:10px;">
      <div class="row">
        <div><span class="muted">APY</span><div style="font-size:20px;font-weight:800;">${o.apy}%</div></div>
        <div><span class="muted">Lockup</span><div style="font-weight:700;">${o.lockupDays || 0}d</div></div>
      </div>
      <div class="muted" style="margin-top:10px;">${o.whyRisk || ""}</div>
    </div>

    <div class="card">
      <h3>Calculator (estimate)</h3>
      <label>Amount (${o.asset})</label>
      <input class="input" id="calcAmount" type="number" min="0" step="0.0001" placeholder="0.0" />
      <label style="margin-top:10px;">Period</label>
      <select id="calcPeriod">
        <option value="30">30 days</option>
        <option value="90">90 days</option>
        <option value="365" selected>1 year</option>
      </select>
      <div class="muted" style="margin-top:10px;" id="calcOut">Enter amount to estimate earnings.</div>
    </div>

    <div class="card">
      <h3>Action</h3>
      <button class="btn" id="btnOpenWallet">Open in wallet</button>
      <button class="btn secondary" id="btnCopyDetails">Copy details</button>
      <div class="muted" style="margin-top:8px;">You confirm transactions in your wallet.</div>
    </div>

    <button class="btn secondary" id="btnCloseSheet">Close</button>
  `;
}

function wireOpportunitySheet(o) {
  document.getElementById("btnCloseSheet").addEventListener("click", closeSheet);

  const amountEl = document.getElementById("calcAmount");
  const periodEl = document.getElementById("calcPeriod");
  const outEl = document.getElementById("calcOut");

  function recalc() {
    const amt = Number(amountEl.value);
    const days = Number(periodEl.value);
    if (!amt || amt <= 0) {
      outEl.textContent = "Enter amount to estimate earnings.";
      return;
    }
    const earnings = amt * (Number(o.apy) / 100) * (days / 365);
    outEl.textContent = `Estimated earnings: ~${fmtNum(earnings)} ${o.asset} (estimate)`;
  }
  amountEl.addEventListener("input", recalc);
  periodEl.addEventListener("change", recalc);

  document.getElementById("btnCopyDetails").addEventListener("click", async () => {
    const payload = `Opportunity: ${o.title}\nChain: ${o.chain}\nAsset: ${o.asset}\nAPY: ${o.apy}%\nURL: ${o.actionUrl}`;
    try {
      await navigator.clipboard.writeText(payload);
      showToast("Copied");
    } catch {
      showToast("Copy failed");
    }
  });

  document.getElementById("btnOpenWallet").addEventListener("click", () => openWalletPicker(o));
}

function openWalletPicker(o) {
  const choices = walletChoicesForChain(o.chain);
  const refUrl = window.location.origin;

  const tiles = choices.map((w) => {
    const name = w === "metamask" ? "MetaMask" : (w === "phantom" ? "Phantom" : (w === "telegram" ? "Telegram Wallet" : "Wallet"));
    return `
      <div class="list-item row" style="cursor:pointer;" data-wallet="${w}">
        <strong>${name}</strong>
        <span class="muted">Open ${o.actionType} flow</span>
      </div>
    `;
  }).join("");

  openSheet(`
    <h2 style="margin:0 0 8px 0;">Choose wallet</h2>
    <div class="muted" style="margin-bottom:10px;">We'll open a recommended DeFi URL inside the wallet browser.</div>
    <div class="list">${tiles}</div>
    <button class="btn secondary" id="btnCancelWallet">Cancel</button>
  `);

  document.getElementById("btnCancelWallet").addEventListener("click", closeSheet);

  sheetCard.querySelectorAll("[data-wallet]").forEach((el) => {
    el.addEventListener("click", () => {
      const wallet = el.dataset.wallet;
      const link = buildWalletLink(wallet, o.actionUrl, refUrl);

      window.location.href = link;

      setTimeout(() => {
        openSheet(`
          <h2 style="margin:0 0 8px 0;">Continue in wallet</h2>
          <div class="muted">If the wallet didn't open automatically, use copy + open it manually.</div>
          <div class="card" style="margin-top:10px;">
            <div class="muted">URL</div>
            <div style="word-break:break-all;">${o.actionUrl}</div>
            <button class="btn" id="btnCopyUrl">Copy URL</button>
            <button class="btn secondary" id="btnBack">Back</button>
          </div>
        `);
        document.getElementById("btnCopyUrl").addEventListener("click", async () => {
          try { await navigator.clipboard.writeText(o.actionUrl); showToast("Copied"); } catch { showToast("Copy failed"); }
        });
        document.getElementById("btnBack").addEventListener("click", () => openWalletPicker(o));
      }, 900);
    });
  });
}

/* -------------------- ALERTS -------------------- */

function renderAlerts() {
  elView.innerHTML = `
    <div class="card">
      <h2>Alerts</h2>
      <div class="muted">To receive Telegram notifications: open the bot chat and send <strong>/start</strong>.</div>
      <button class="btn" id="btnCreateAlert">Create alert</button>
    </div>
    <div id="alertsList"></div>
  `;
  document.getElementById("btnCreateAlert").addEventListener("click", openCreateAlertSheet);
  loadAlerts();
}

async function loadAlerts() {
  const list = document.getElementById("alertsList");
  if (!list) return;

  list.innerHTML = `<div class="card"><h2>Loading…</h2><div class="muted">Fetching alerts</div></div>`;
  try {
    const data = await api("/api/alerts");
    if (!data.items.length) {
      list.innerHTML = `<div class="card"><h2>No alerts</h2><div class="muted">Create your first one.</div></div>`;
      return;
    }

    list.innerHTML = `
      <div class="card">
        <h2>Your alerts</h2>
        <div class="list">
          ${data.items.map(a => `
            <div class="list-item">
              <div class="row">
                <div>
                  <strong>${a.type.toUpperCase()}</strong>
                  <div class="muted">${a.asset} · ${a.chain} · ${a.condition} ${a.threshold}</div>
                </div>
                <label class="muted" style="display:flex;align-items:center;gap:6px;">
                  <input type="checkbox" data-toggle="${a.id}" ${a.enabled ? "checked" : ""}/>
                  on
                </label>
              </div>
              <div class="row" style="margin-top:10px;">
                <span class="muted">${a.frequency}</span>
                <button class="btn inline danger" data-del="${a.id}">Delete</button>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    `;

    list.querySelectorAll("input[data-toggle]").forEach(ch => {
      ch.addEventListener("change", async () => {
        try {
          await api(`/api/alerts/${ch.dataset.toggle}`, { method: "PATCH", body: JSON.stringify({ enabled: ch.checked }) });
          showToast("Saved");
        } catch (e) {
          showToast(e.message);
          ch.checked = !ch.checked;
        }
      });
    });

    list.querySelectorAll("button[data-del]").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this alert?")) return;
        try {
          await api(`/api/alerts/${btn.dataset.del}`, { method: "DELETE" });
          loadAlerts();
        } catch (e) {
          showToast(e.message);
        }
      });
    });
  } catch (e) {
    list.innerHTML = `<div class="card"><h2>Error</h2><div class="muted">${e.message}</div></div>`;
  }
}

function openCreateAlertSheet(prefill = {}) {
  const defaultType = prefill.type || "price";
  const defaultChain = prefill.chain || state.selectedChain || "evm";
  const defaultAsset = prefill.asset || (defaultChain === "btc" ? "BTC" : (defaultChain === "sol" ? "SOL" : (defaultChain === "ton" ? "TON" : "ETH")));

  openSheet(`
    <h2 style="margin:0 0 8px 0;">Create alert</h2>

    <div class="card">
      <label>Type</label>
      <select id="aType">
        <option value="price">Price</option>
        <option value="apy">APY</option>
      </select>

      <label style="margin-top:10px;">Chain</label>
      <select id="aChain">
        <option value="evm">evm</option>
        <option value="btc">btc</option>
        <option value="sol">sol</option>
        <option value="ton">ton</option>
      </select>

      <label style="margin-top:10px;">Asset</label>
      <input id="aAsset" class="input" placeholder="ETH / BTC / SOL / TON" />

      <label style="margin-top:10px;">Condition</label>
      <select id="aCond">
        <option value="above">Above</option>
        <option value="below">Below</option>
      </select>

      <label style="margin-top:10px;">Threshold</label>
      <input id="aThr" class="input" type="number" step="0.01" placeholder="e.g. 3500" />

      <label style="margin-top:10px;">Frequency</label>
      <select id="aFreq">
        <option value="instant">Instant</option>
        <option value="daily">Daily digest</option>
        <option value="weekly">Weekly digest</option>
      </select>

      <button class="btn" id="btnSaveAlert">Save</button>
      <button class="btn secondary" id="btnCancelAlert">Cancel</button>
    </div>
  `);

  const elType = document.getElementById("aType");
  const elChain = document.getElementById("aChain");
  const elAsset = document.getElementById("aAsset");
  const elThr = document.getElementById("aThr");

  elType.value = defaultType;
  elChain.value = defaultChain;
  elAsset.value = defaultAsset;

  document.getElementById("btnCancelAlert").addEventListener("click", closeSheet);

  document.getElementById("btnSaveAlert").addEventListener("click", async () => {
    const type = elType.value;
    const chain = elChain.value;
    const asset = elAsset.value.trim().toUpperCase();
    const condition = document.getElementById("aCond").value;
    const threshold = Number(elThr.value);
    const frequency = document.getElementById("aFreq").value;

    if (!asset) return showToast("Asset required");
    if (!Number.isFinite(threshold) || threshold <= 0) return showToast("Threshold must be > 0");

    try {
      await api("/api/alerts", { method: "POST", body: JSON.stringify({ type, chain, asset, condition, threshold, frequency }) });
      closeSheet();
      loadAlerts();
    } catch (e) {
      showToast(e.message);
    }
  });
}

/* -------------------- SETTINGS -------------------- */

function renderSettings() {
  const chains = Object.keys(state.wallets);
  elView.innerHTML = `
    <div class="card">
      <h2>Account</h2>
      <div class="muted">User: ${state.user?.id || "—"}</div>
      <hr />
      <h3 style="margin-top:0;">Connected wallets</h3>
      ${chains.length ? `
        <div class="list" style="margin-top:10px;">
          ${chains.sort().map((ch) => `
            <div class="list-item row">
              <div>
                <strong>${chainLabel(ch)}</strong>
                <div class="muted" style="word-break:break-all;">${maskAddr(state.wallets[ch])}</div>
              </div>
              <button class="btn inline danger" data-remove="${ch}">Remove</button>
            </div>
          `).join("")}
        </div>
      ` : `<div class="muted">No wallets connected.</div>`}
    </div>

    <div class="card">
      <h2>Notifications</h2>
      <div class="muted">1) Set webhook for your bot</div>
      <div class="muted">2) Open bot chat and send <strong>/start</strong></div>
      <div class="muted">3) Create alerts in the Alerts tab</div>
    </div>

    <div class="card">
      <h2>About</h2>
      <div class="muted">Non-custodial. Read-only. Not financial advice.</div>
    </div>

    <button class="btn secondary" id="btnBackToPortfolio">Back</button>
  `;

  document.getElementById("btnBackToPortfolio").addEventListener("click", () => setRoute("portfolio"));
  elView.querySelectorAll("[data-remove]").forEach((b) => {
    b.addEventListener("click", async () => {
      const ch = b.dataset.remove;
      if (!confirm(`Remove ${chainLabel(ch)} wallet?`)) return;
      try {
        await removeWallet(ch);
        showToast("Removed");
        renderSettings();
      } catch (e) {
        showToast(e.message);
      }
    });
  });
}

/* -------------------- BOOT -------------------- */

(async function boot() {
  render();
  await authenticate();
  await loadWallets();

  // Attach click handlers for demo buttons in injected HTML (demoPortfolioHtml)
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.id === "btnGoEarn") setRoute("earn");
    if (t && t.id === "btnGoAlerts") {
      setRoute("alerts");
      setTimeout(() => openCreateAlertSheet(), 0);
    }
  });

  render();
  setRoute("portfolio");
})();
