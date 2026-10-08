/* LeadPilot frontend - vanilla JS, no build step.
 *
 * Persistence: leads live in localStorage. The backend is stateless: every chat /
 * debrief request carries the lead's context, which keeps the API trivially
 * deployable on serverless platforms (no database to host, nothing to lose on cold start).
 */
const STORE = "leadpilot.v1";
const $ = (s, el = document) => el.querySelector(s);

const SAMPLES = [
  { name: "Priya Raman", location: "Coimbatore", requirement: "3BHK apartment near Avinashi Road, east-facing", budget: "85L - 95L", timeline: "Within 3 weeks",
    message: "Hi, we saw your Saravanampatti listing. Our home loan is pre-approved for 80L. We need to shift before school reopens in November. Is the east-facing unit still available? My husband can visit this Saturday. Honestly I'm worried about the possession date getting delayed like it did with our last builder." },
  { name: "Arun Kumar", location: "Chennai", requirement: "Plot for investment, around 2400 sqft", budget: "Not sure, maybe 40-50L", timeline: "Sometime next year",
    message: "just browsing, send me the brochure. what is the price per sqft? my friend said plots on OMR are overpriced" },
  { name: "Meera Joshi", location: "Bengaluru", requirement: "2BHK ready-to-move flat in Whitefield", budget: "1.2 Cr", timeline: "1-2 months",
    message: "Customer: Is the 2BHK in Whitefield still available?\nAgent: Yes it is.\nCustomer: The price is a bit above what I expected. Another builder offered me 3% off. Can you do better?\nCustomer: I can pay 30% down right away if the deal is right." },
];

const state = { leads: [], selectedId: null, filter: "all", tab: "chat", busy: new Set() };

/* ---------- utils ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rich = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fmtTime = (iso) => { try { return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); } catch { return iso; } };
const get = (id) => state.leads.find((l) => l.id === id);
const selected = () => get(state.selectedId);

function load() { try { state.leads = JSON.parse(localStorage.getItem(STORE) || "[]"); } catch { state.leads = []; } }
function save() { try { localStorage.setItem(STORE, JSON.stringify(state.leads)); } catch { /* storage full/blocked: app still works for this session */ } }

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2200);
}

async function api(path, body) {
  const r = await fetch("/api" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let data = {}; try { data = await r.json(); } catch { /* non-JSON error page */ }
  if (!r.ok) {
    let msg = data.detail;
    if (Array.isArray(msg)) msg = msg.map((m) => m.msg).join("; ");
    throw new Error(msg || `Request failed (${r.status})`);
  }
  return data;
}

function dueInfo(l) {
  if (!l.dueAt) return null;
  const diff = l.dueAt - Date.now();
  if (diff <= 0) return { label: "Follow up now", cls: "due-now", sort: 0 };
  const h = diff / 3600000;
  if (h < 1) return { label: "Due in <1h", cls: "due-soon", sort: 1 };
  if (h < 24) return { label: `Due in ${Math.round(h)}h`, cls: h < 6 ? "due-soon" : "", sort: 2 };
  return { label: `Due in ${Math.round(h / 24)}d`, cls: "", sort: 3 };
}
const isDue = (l) => l.dueAt && l.dueAt - Date.now() < 24 * 3600000;

function pushEvent(lead, kind, text) { lead.timeline.push({ at: new Date().toISOString(), kind, text }); }

function contextOf(lead) {
  return { lead: lead.input, analysis: lead.analysis, timeline: lead.timeline.slice(-15).map((e) => ({ at: e.at, kind: e.kind, text: e.text.slice(0, 1800) })) };
}

/* ---------- sidebar ---------- */
function renderSidebar() {
  const counts = { all: state.leads.length, hot: 0, warm: 0, cold: 0, due: 0 };
  state.leads.forEach((l) => { counts[l.tier]++; if (isDue(l)) counts.due++; });

  const q = $("#queue");
  q.hidden = counts.due === 0;
  q.textContent = `${counts.due} follow-up${counts.due === 1 ? "" : "s"} due in the next 24h`;

  $("#filters").innerHTML = ["all", "hot", "warm", "cold", "due"].map((f) =>
    `<button class="chip ${state.filter === f ? "active" : ""}" data-action="filter" data-filter="${f}">${f === "due" ? "Due" : f[0].toUpperCase() + f.slice(1)} ${counts[f]}</button>`).join("");

  let leads = state.leads.filter((l) => state.filter === "all" ? true : state.filter === "due" ? isDue(l) : l.tier === state.filter);
  leads.sort((a, b) => b.analysis.score - a.analysis.score);

  if (!leads.length) {
    $("#list").innerHTML = `<p class="muted" style="padding:8px 4px">${state.leads.length ? "No leads in this view." : "No leads yet. Add one to see AI prioritization."}</p>`;
    return;
  }
  const groups = state.filter === "all" ? ["hot", "warm", "cold"] : [null];
  $("#list").innerHTML = groups.map((g) => {
    const items = g ? leads.filter((l) => l.tier === g) : leads;
    if (!items.length) return "";
    const title = g ? `<div class="group-title">${g === "hot" ? "Hot" : g === "warm" ? "Warm" : "Cold"} (${items.length})</div>` : "";
    return title + items.map(itemHtml).join("");
  }).join("");
}

function itemHtml(l) {
  const d = dueInfo(l);
  return `<button class="item ${l.tier} ${l.id === state.selectedId ? "sel" : ""}" data-action="select" data-id="${l.id}">
    <div class="item-top"><span class="item-name">${esc(l.input.name)}</span><span class="score ${l.tier}">${l.analysis.score}</span></div>
    <div class="item-sub">${esc(l.input.requirement)}</div>
    <div class="item-meta">
      <span class="tag">${esc(l.analysis.urgency)} urgency</span>
      ${d ? `<span class="tag ${d.cls}">${d.label}</span>` : `<span class="tag done">Followed up</span>`}
    </div></button>`;
}

/* ---------- main panel ---------- */
function renderMain() {
  const l = selected();
  const main = $("#main");
  if (!l) {
    main.innerHTML = `<div class="empty"><h2>Prioritize your leads in seconds</h2>
      <p>Add a lead and the AI will summarize it, score it, tell you what to do next, and draft a reply.</p>
      <p><button class="btn primary" data-action="new-lead">+ New lead</button></p></div>`;
    return;
  }
  const a = l.analysis, d = dueInfo(l);
  main.innerHTML = `
    <div class="lead-head">
      <div>
        <h1>${esc(l.input.name)}</h1>
        <div class="sub">${esc(l.input.location || "Location n/a")} &middot; ${esc(l.input.budget || "Budget n/a")} &middot; ${esc(l.input.timeline || "Timeline n/a")}</div>
        <div class="sub">${esc(l.input.requirement)}</div>
      </div>
      <div class="head-right">
        ${d ? `<span class="tag ${d.cls}">${d.label}</span>` : ""}
        <div class="big-score"><span class="tier-badge ${l.tier}">${l.tier}</span><br><b>${a.score}</b><span class="muted">/100</span>
          <div class="bar ${l.tier}"><i style="width:${a.score}%"></i></div></div>
        <div>
          ${l.dueAt ? `<button class="btn small" data-action="mark-done">Mark follow-up done</button><br>` : ""}
          <button class="btn small danger" data-action="delete" style="margin-top:4px">Delete</button>
        </div>
      </div>
    </div>

    <div class="next"><div class="label">Recommended next action</div><div class="big">${esc(a.next_action)}</div></div>

    <div class="cards">
      <div class="card"><div class="label">Summary</div>${esc(a.summary)}</div>
      <div class="card"><div class="label">Customer intent</div>${esc(a.intent)}
        <div class="muted" style="margin-top:6px;font-size:12px">Why ${a.score}: ${esc(a.score_reason)}</div></div>
      <div class="card"><div class="label">Key requirements</div><div class="chips">${a.key_requirements.map((x) => `<span class="pill">${esc(x)}</span>`).join("") || '<span class="muted">None extracted</span>'}</div></div>
      <div class="card"><div class="label">Objections / concerns</div>${a.objections.length ? `<ul>${a.objections.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : '<span class="muted">None detected</span>'}</div>
      <div class="card wide"><div class="label">Suggested response <button class="btn small" data-action="copy-reply">Copy</button></div>
        <textarea class="reply" id="reply" rows="4">${esc(l.editedReply ?? a.suggested_response)}</textarea></div>
    </div>

    <div class="tabs">
      <button class="tab" data-action="tab" data-tab="chat">Ask copilot</button>
      <button class="tab" data-action="tab" data-tab="debrief">Log a call (re-score)</button>
      <button class="tab" data-action="tab" data-tab="timeline">Timeline (${l.timeline.length})</button>
    </div>
    <div class="panel" id="panel"></div>`;
  renderPanel();
}

function renderPanel() {
  const l = selected(); const panel = $("#panel");
  if (!l || !panel) return;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === state.tab));
  const busy = state.busy.has(l.id);

  if (state.tab === "chat") {
    const quick = ["What should I emphasize on the call?", "Make my reply more assertive", "Shorten the reply for WhatsApp", "What objections should I expect?"];
    panel.innerHTML = `
      <div class="quick">${quick.map((q) => `<button class="chip" data-action="quick" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>
      <div class="chat-log" id="chat-log">
        ${l.chat.length ? l.chat.map((m, i) => `<div class="msg ${m.role}">${rich(m.content)}${m.role === "assistant" ? `<button class="btn small copy" data-action="copy-msg" data-i="${i}">Copy</button>` : ""}</div>`).join("") : `<div class="muted">Ask anything about ${esc(l.input.name)}. Answers use this lead's data, analysis and timeline.</div>`}
        ${busy ? '<div class="msg assistant typing">Thinking...</div>' : ""}
      </div>
      <form class="row" id="chat-form"><input id="chat-input" placeholder="Ask a follow-up about this lead..." maxlength="2000" autocomplete="off" ${busy ? "disabled" : ""}><button class="btn primary" ${busy ? "disabled" : ""}>Send</button></form>`;
    const log = $("#chat-log"); log.scrollTop = log.scrollHeight;
  } else if (state.tab === "debrief") {
    panel.innerHTML = `
      <p class="muted" style="margin-top:0">Just spoke to ${esc(l.input.name)}? Paste rough notes. The AI re-scores the lead, updates the next action and drafts the follow-up.</p>
      <textarea id="notes" rows="4" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:8px 10px" maxlength="4000" placeholder="e.g. Husband liked the unit but wants 2% off. Will visit Sunday if parking is covered. Loan docs ready.">${esc(l.notesDraft || "")}</textarea>
      <p><button class="btn primary" data-action="debrief" ${busy ? "disabled" : ""}>${busy ? '<span class="spinner"></span>Analyzing...' : "Update lead from call"}</button></p>
      ${l.lastDebrief ? `<div class="result"><div class="label">Last update</div><span class="delta ${l.lastDebrief.delta >= 0 ? "up" : "down"}">${l.lastDebrief.delta >= 0 ? "+" : ""}${l.lastDebrief.delta} pts</span> &middot; ${esc(l.lastDebrief.text)}</div>` : ""}`;
  } else {
    panel.innerHTML = `<ul class="timeline">${[...l.timeline].reverse().map((e) =>
      `<li><div class="when">${esc(fmtTime(e.at))} &middot; ${esc(e.kind)}</div>${esc(e.text)}</li>`).join("")}</ul>`;
  }
}

function render() { renderSidebar(); renderMain(); }

/* ---------- actions ---------- */
function openModal(sample) {
  const f = $("#lead-form"); f.reset(); $("#form-error").hidden = true; $("#sample").value = "";
  $("#modal").hidden = false; setTimeout(() => f.elements.name.focus(), 0);
}
const closeModal = () => ($("#modal").hidden = true);

async function submitLead(ev) {
  ev.preventDefault();
  const f = ev.target; const btn = $("#analyze-btn"); const err = $("#form-error");
  const input = Object.fromEntries(new FormData(f).entries());
  for (const k in input) input[k] = String(input[k]).trim();
  err.hidden = true; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Analyzing...';
  try {
    const res = await api("/analyze", { lead: input });
    const lead = { id: uid(), createdAt: new Date().toISOString(), input, analysis: res.analysis, tier: res.tier,
      dueAt: Date.now() + res.analysis.follow_up_hours * 3600000, timeline: [], chat: [] };
    pushEvent(lead, "created", `Lead created. AI score ${res.analysis.score} (${res.tier}). Follow up in ~${res.analysis.follow_up_hours}h.`);
    state.leads.push(lead); state.selectedId = lead.id; state.tab = "chat"; state.filter = "all";
    save(); closeModal(); render();
  } catch (e) {
    err.textContent = e.message; err.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = "Analyze with AI";
  }
}

async function sendChat(text) {
  const l = selected(); if (!l || !text.trim() || state.busy.has(l.id)) return;
  const history = l.chat.map(({ role, content }) => ({ role, content: content.slice(0, 3900) }));
  l.chat.push({ role: "user", content: text }); state.busy.add(l.id); renderPanel();
  try {
    const res = await api("/chat", { ...contextOf(l), history, message: text });
    l.chat.push({ role: "assistant", content: res.reply });
  } catch (e) {
    l.chat.push({ role: "assistant", content: "Sorry, I couldn't answer: " + e.message });
  } finally {
    state.busy.delete(l.id); save(); if (selected() === l) renderPanel();
  }
}

async function runDebrief() {
  const l = selected(); const notes = ($("#notes")?.value || "").trim();
  if (!l) return;
  if (!notes) return toast("Add some call notes first");
  state.busy.add(l.id); renderPanel();
  try {
    const res = await api("/debrief", { ...contextOf(l), notes });
    pushEvent(l, "call", notes);
    pushEvent(l, "re-score", `Score ${l.analysis.score} -> ${res.analysis.score} (${res.tier}). ${res.what_changed}`);
    l.analysis = res.analysis; l.tier = res.tier; l.editedReply = undefined;
    l.dueAt = Date.now() + res.analysis.follow_up_hours * 3600000;
    l.lastDebrief = { delta: res.score_delta, text: res.what_changed };
    l.notesDraft = "";
    save(); render();
  } catch (e) {
    toast(e.message);
  } finally {
    state.busy.delete(l.id); save(); if (selected() === l) { renderSidebar(); renderPanel(); }
  }
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied"); }
  catch { toast("Copy failed - select the text manually"); }
}

/* ---------- events ---------- */
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]"); if (!el) return;
  const l = selected();
  switch (el.dataset.action) {
    case "new-lead": openModal(); break;
    case "close-modal": closeModal(); break;
    case "filter": state.filter = el.dataset.filter; renderSidebar(); break;
    case "select": state.selectedId = el.dataset.id; state.tab = "chat"; render(); break;
    case "tab": state.tab = el.dataset.tab; renderPanel(); break;
    case "quick": sendChat(el.dataset.q); break;
    case "debrief": runDebrief(); break;
    case "copy-reply": copy($("#reply").value); break;
    case "copy-msg": copy(l.chat[+el.dataset.i].content); break;
    case "mark-done":
      l.dueAt = null; pushEvent(l, "follow-up", "Marked follow-up as done."); save(); render(); break;
    case "delete":
      if (confirm(`Delete ${l.input.name}?`)) { state.leads = state.leads.filter((x) => x.id !== l.id); state.selectedId = null; save(); render(); }
      break;
  }
});

document.addEventListener("submit", (e) => {
  if (e.target.id === "lead-form") return submitLead(e);
  if (e.target.id === "chat-form") {
    e.preventDefault(); const i = $("#chat-input"); const t = i.value; i.value = ""; sendChat(t);
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "reply" && selected()) { selected().editedReply = e.target.value; save(); }
  if (e.target.id === "notes" && selected()) selected().notesDraft = e.target.value;
});
$("#sample").addEventListener("change", (e) => {
  const s = SAMPLES[+e.target.value]; if (!s) return;
  const f = $("#lead-form"); Object.entries(s).forEach(([k, v]) => (f.elements[k].value = v));
});
$("#modal").addEventListener("mousedown", (e) => { if (e.target.id === "modal") closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

// keep "due in Xh" labels fresh
setInterval(() => { if ($("#modal").hidden) renderSidebar(); }, 60000);

load();
state.selectedId = [...state.leads].sort((a, b) => b.analysis.score - a.analysis.score)[0]?.id ?? null;
render();
