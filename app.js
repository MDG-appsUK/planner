/* Day Planner v3 (static PWA)
   - Default view: Agenda (compact list)
   - Agenda-only parchment header styling (via html[data-view])
   - Day / Week / Month views + prev/next navigation
   - Multiple calendars
   - Events: title, start/end, location, notes, color
   - Repeats: daily, weekdays, weekly, monthly, until date
   - Delete repeating: delete one occurrence OR whole series (exdates)
   - Local storage only (localStorage)
*/

const STORE_KEY = "day_planner_v3";
const START_MIN = 6 * 60;
const END_MIN = 24 * 60;
const STEP = 30;

const $ = (id) => document.getElementById(id);

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}
function pad2(n){ return String(n).padStart(2, "0"); }

function toDateISO(d){
  const x = new Date(d);
  x.setHours(0,0,0,0);
  return `${x.getFullYear()}-${pad2(x.getMonth()+1)}-${pad2(x.getDate())}`;
}
function fromISODate(s){
  const [y,m,dd] = s.split("-").map(Number);
  const d = new Date(y, m-1, dd);
  d.setHours(0,0,0,0);
  return d;
}
function formatNiceDate(d){
  return d.toLocaleDateString(undefined, { weekday:"long", year:"numeric", month:"long", day:"numeric" });
}
function formatMonthTitle(d){
  return d.toLocaleDateString(undefined, { year:"numeric", month:"long" });
}
function minsToTime(mins){
  const h = Math.floor(mins/60);
  const m = mins % 60;
  return `${pad2(h)}:${pad2(m)}`;
}
function timeToMins(t){
  const [h,m] = t.split(":").map(Number);
  return h*60 + m;
}
function daysInMonth(year, monthIndex0){
  return new Date(year, monthIndex0 + 1, 0).getDate();
}
function clampToRangeTime(start, end){
  const s = timeToMins(start), e = timeToMins(end);
  if (e <= s) return { ok:false, msg:"End time must be after start time." };
  if (s < START_MIN || e > END_MIN) return { ok:false, msg:"Events must be between 06:00 and 24:00." };
  return { ok:true };
}

function loadState(){
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) {
    const defaultCalId = uid();
    return {
      theme: "dark",
      activeView: "agenda",                 // default view
      activeDate: toDateISO(new Date()),
      activeCalendarId: defaultCalId,
      calendars: [{ id: defaultCalId, name: "Personal" }],
      events: []
    };
  }
  try { return JSON.parse(raw); }
  catch {
    localStorage.removeItem(STORE_KEY);
    return loadState();
  }
}
function saveState(){
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

let state = loadState();

function ensureActiveCalendarValid(){
  if (!state.calendars.find(c => c.id === state.activeCalendarId)) {
    state.activeCalendarId = state.calendars[0]?.id || "";
  }
}

function setTheme(theme){
  state.theme = theme;
  document.documentElement.setAttribute("data-theme", theme === "light" ? "light" : "dark");
  saveState();
  render();
}
function toggleTheme(){
  setTheme(state.theme === "light" ? "dark" : "light");
}

function setActiveView(view){
  state.activeView = view;
  saveState();
  render();
}
function setActiveDate(iso){
  state.activeDate = iso;
  saveState();
  render();
}
function setActiveCalendar(id){
  state.activeCalendarId = id;
  saveState();
  render();
}

/* Recurrence model:
repeat: { freq: "none"|"daily"|"weekdays"|"weekly"|"monthly", until: "YYYY-MM-DD"|"" }
exdates: ["YYYY-MM-DD", ...] // excluded occurrences (delete just this day)
*/
function isExcluded(evt, isoDate){
  return Array.isArray(evt.exdates) && evt.exdates.includes(isoDate);
}

function occursOnDate(evt, isoDate){
  if (isExcluded(evt, isoDate)) return false;

  const target = fromISODate(isoDate);
  const start = fromISODate(evt.startDate);

  if (target < start) return false;

  const freq = evt.repeat?.freq || "none";
  const untilISO = evt.repeat?.until || "";
  const until = untilISO ? fromISODate(untilISO) : null;

  if (freq === "none") return evt.startDate === isoDate;

  if (!until) return false;
  if (target > until) return false;

  const diffDays = Math.floor((target - start) / (24*60*60*1000));

  if (freq === "daily") return true;

  if (freq === "weekdays") {
    const day = target.getDay(); // 0 Sun ... 6 Sat
    return day >= 1 && day <= 5; // Mon–Fri
  }

  if (freq === "weekly") return diffDays % 7 === 0;

  if (freq === "monthly") {
    const sd = start.getDate();
    const y = target.getFullYear(), m = target.getMonth();
    const dim = daysInMonth(y, m);
    const targetDom = Math.min(sd, dim);
    return target.getDate() === targetDom;
  }

  return false;
}

function eventsForCalendarOnDate(calendarId, isoDate){
  return state.events
    .filter(e => e.calendarId === calendarId)
    .filter(e => occursOnDate(e, isoDate))
    .map(e => ({ ...e, _occurrenceDate: isoDate }));
}

function buildSlots(){
  const slots = [];
  for (let m = START_MIN; m < END_MIN; m += STEP) slots.push(m);
  return slots;
}

function startOfWeek(iso){
  const d = fromISODate(iso);
  const day = d.getDay(); // 0 Sun ... 6 Sat
  const mondayOffset = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + mondayOffset);
  return d;
}
function addDays(dateObj, n){
  const d = new Date(dateObj);
  d.setDate(d.getDate() + n);
  d.setHours(0,0,0,0);
  return d;
}
function rangeOfWeekDates(iso){
  const mon = startOfWeek(iso);
  return Array.from({length:7}, (_,i) => addDays(mon, i));
}

/* ---------- Rendering ---------- */
function renderTopBar(){
  ensureActiveCalendarValid();

  document.documentElement.setAttribute("data-theme", state.theme === "light" ? "light" : "dark");
  document.documentElement.setAttribute("data-view", state.activeView); // drives Agenda-only parchment header

  // Segmented active state
  for (const btn of document.querySelectorAll(".segBtn")) {
    btn.classList.toggle("active", btn.dataset.view === state.activeView);
    btn.setAttribute("aria-selected", btn.dataset.view === state.activeView ? "true" : "false");
  }

  // Date label depends on view
  const activeD = fromISODate(state.activeDate);

  if (state.activeView === "day" || state.activeView === "agenda") {
    $("dateLabel").textContent = formatNiceDate(activeD);
  } else if (state.activeView === "week") {
    const week = rangeOfWeekDates(state.activeDate);
    const start = week[0], end = week[6];
    const startStr = start.toLocaleDateString(undefined, { month:"short", day:"numeric" });
    const endStr = end.toLocaleDateString(undefined, { month:"short", day:"numeric", year:"numeric" });
    $("dateLabel").textContent = `${startStr} – ${endStr}`;
  } else {
    $("dateLabel").textContent = formatMonthTitle(activeD);
  }

  const cal = state.calendars.find(c => c.id === state.activeCalendarId);
  $("activeCalendarLabel").textContent = cal ? `Calendar: ${cal.name}` : "No calendar";

  // calendar select options
  const sel = $("calendarSelect");
  sel.innerHTML = "";
  for (const c of state.calendars) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    if (c.id === state.activeCalendarId) opt.selected = true;
    sel.appendChild(opt);
  }

  // event dialog calendar select
  const evtSel = $("evtCalendar");
  evtSel.innerHTML = "";
  for (const c of state.calendars) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    if (c.id === state.activeCalendarId) opt.selected = true;
    evtSel.appendChild(opt);
  }

  // Primary action label: Agenda => Populate, otherwise Add
  $("primaryAction").textContent = (state.activeView === "agenda") ? "Populate" : "+ Add";
}

function render(){
  renderTopBar();
  renderView();
}

function renderView(){
  const host = $("viewHost");
  host.innerHTML = "";

  if (state.activeView === "agenda") host.appendChild(renderAgendaView());
  else if (state.activeView === "day") host.appendChild(renderDayView());
  else if (state.activeView === "week") host.appendChild(renderWeekView());
  else host.appendChild(renderMonthView());
}

/* ---------- Agenda view ---------- */
function renderAgendaView(){
  const iso = state.activeDate;
  const evts = eventsForCalendarOnDate(state.activeCalendarId, iso)
    .slice()
    .sort((a,b) => timeToMins(a.start) - timeToMins(b.start));

  const card = document.createElement("div");
  card.className = "agendaCard";

  const title = document.createElement("h3");
  title.className = "agendaTitle";
  title.textContent = "Day’s Ledger";
  card.appendChild(title);

  if (evts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "agendaEmpty";
    empty.textContent = "No entries for this day.";
    card.appendChild(empty);
    return card;
  }

  const ul = document.createElement("ul");
  ul.className = "agendaList";

  for (const e of evts) {
    const li = document.createElement("li");
    li.className = "agendaItem";

    if (e.color) {
      li.style.borderColor = colorMix(e.color, 0.35);
      li.style.background = `linear-gradient(90deg, ${colorMix(e.color, 0.14, true)}, rgba(255,255,255,0.28))`;
    }

    const line = document.createElement("div");
    line.className = "agendaLine";
    line.textContent = `${e.start} – ${e.end}: ${e.title}`;
    li.appendChild(line);

    const subBits = [];
    if (e.location) subBits.push(e.location);
    if (e.notes) subBits.push(e.notes.length > 180 ? e.notes.slice(0,180) + "…" : e.notes);

    if (subBits.length) {
      const sub = document.createElement("div");
      sub.className = "agendaSub";
      sub.textContent = subBits.join(" • ");
      li.appendChild(sub);
    }

    li.style.cursor = "pointer";
    li.addEventListener("click", () => {
      openEventDialog({ ...e, date: iso, isEdit: true });
    });

    ul.appendChild(li);
  }

  card.appendChild(ul);
  return card;
}

/* ---------- Day view ---------- */
function renderDayView(){
  const wrap = document.createElement("div");
  wrap.className = "card timeline";

  const slots = buildSlots();
  const iso = state.activeDate;
  const evts = eventsForCalendarOnDate(state.activeCalendarId, iso);

  const starts = new Map();
  for (const e of evts) {
    const m = timeToMins(e.start);
    if (!starts.has(m)) starts.set(m, []);
    starts.get(m).push(e);
  }

  for (const m of slots) {
    const slot = document.createElement("div");
    slot.className = "slot";

    const time = document.createElement("div");
    time.className = "time";
    time.textContent = minsToTime(m);

    const cell = document.createElement("div");
    cell.className = "cell";
    cell.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      openEventDialog({
        date: state.activeDate,
        start: minsToTime(m),
        end: minsToTime(Math.min(m + STEP, END_MIN)),
        calendarId: state.activeCalendarId
      });
    });

    const list = starts.get(m) || [];
    for (const e of list) cell.appendChild(buildEventPill(e));

    slot.appendChild(time);
    slot.appendChild(cell);
    wrap.appendChild(slot);
  }

  return wrap;
}

/* ---------- Week view ---------- */
function renderWeekView(){
  const container = document.createElement("div");
  container.className = "weekWrap";

  const grid = document.createElement("div");
  grid.className = "weekGrid";

  const weekDates = rangeOfWeekDates(state.activeDate); // Mon..Sun
  const weekISOs = weekDates.map(toDateISO);
  const slots = buildSlots();

  const header = document.createElement("div");
  header.className = "weekHeader";

  const blank = document.createElement("div");
  blank.className = "hcell";
  blank.textContent = "";
  header.appendChild(blank);

  for (let i=0;i<7;i++){
    const d = weekDates[i];
    const label = d.toLocaleDateString(undefined, { weekday:"short", day:"numeric", month:"short" });
    const h = document.createElement("div");
    h.className = "hcell";
    h.textContent = label;
    h.style.cursor = "pointer";
    h.addEventListener("click", () => {
      setActiveDate(toDateISO(d));
      setActiveView("day");
    });
    header.appendChild(h);
  }

  const body = document.createElement("div");
  body.className = "weekBody";

  const bucket = new Map(); // `${iso}|${mins}` -> [events]
  for (const iso of weekISOs) {
    const evts = eventsForCalendarOnDate(state.activeCalendarId, iso);
    for (const e of evts) {
      const mins = timeToMins(e.start);
      const key = `${iso}|${mins}`;
      if (!bucket.has(key)) bucket.set(key, []);
      bucket.get(key).push(e);
    }
  }

  for (const mins of slots) {
    const row = document.createElement("div");
    row.className = "wrow";

    const t = document.createElement("div");
    t.className = "time";
    t.textContent = minsToTime(mins);
    row.appendChild(t);

    for (let col=0; col<7; col++){
      const iso = weekISOs[col];
      const cell = document.createElement("div");
      cell.className = "wcell";

      cell.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        openEventDialog({
          date: iso,
          start: minsToTime(mins),
          end: minsToTime(Math.min(mins + STEP, END_MIN)),
          calendarId: state.activeCalendarId
        });
      });

      const key = `${iso}|${mins}`;
      const list = bucket.get(key) || [];
      for (const evt of list) {
        const pill = document.createElement("div");
        pill.className = "miniPill";
        pill.textContent = evt.title;

        if (evt.color) {
          pill.style.borderColor = colorMix(evt.color, 0.35);
          pill.style.background = colorMix(evt.color, 0.12, true);
        }

        pill.addEventListener("click", (ev) => {
          ev.stopPropagation();
          openEventDialog({ ...evt, date: iso, isEdit: true });
        });

        pill.addEventListener("contextmenu", (ev) => {
          ev.preventDefault();
          requestDelete(evt, iso);
        });

        cell.appendChild(pill);
      }

      row.appendChild(cell);
    }

    body.appendChild(row);
  }

  grid.appendChild(header);
  grid.appendChild(body);
  container.appendChild(grid);

  const hint = document.createElement("p");
  hint.className = "muted";
  hint.style.marginTop = "10px";
  hint.textContent = "Tip: tap a day header to jump to Day view. (On desktop, right-click an event in Week view to delete.)";
  container.appendChild(hint);

  return container;
}

/* ---------- Month view ---------- */
function renderMonthView(){
  const wrap = document.createElement("div");
  wrap.className = "monthGrid";

  const d = fromISODate(state.activeDate);
  const y = d.getFullYear();
  const m = d.getMonth();

  const first = new Date(y, m, 1);
  first.setHours(0,0,0,0);
  const firstDow = (first.getDay() + 6) % 7; // Mon=0..Sun=6
  const dim = daysInMonth(y, m);

  const header = document.createElement("div");
  header.className = "monthHeader";
  for (const wd of ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]) {
    const el = document.createElement("div");
    el.textContent = wd;
    header.appendChild(el);
  }

  const body = document.createElement("div");
  body.className = "monthBody";

  const totalCells = Math.ceil((firstDow + dim) / 7) * 7;
  for (let cell=0; cell<totalCells; cell++){
    const dayCell = document.createElement("div");
    dayCell.className = "dayCell";

    const dayIndex = cell - firstDow + 1;
    const inMonth = dayIndex >= 1 && dayIndex <= dim;

    if (!inMonth) {
      dayCell.innerHTML = `<div class="dayNum"></div>`;
      body.appendChild(dayCell);
      continue;
    }

    const iso = `${y}-${pad2(m+1)}-${pad2(dayIndex)}`;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.addEventListener("click", () => {
      setActiveDate(iso);
      setActiveView("day");
    });

    const dn = document.createElement("div");
    dn.className = "dayNum";
    dn.textContent = String(dayIndex);

    const dots = document.createElement("div");
    dots.className = "dotRow";

    const evts = eventsForCalendarOnDate(state.activeCalendarId, iso);
    for (const e of evts.slice(0,6)) {
      const dot = document.createElement("div");
      dot.className = "dot";
      dot.style.background = e.color || "transparent";
      dots.appendChild(dot);
    }

    btn.appendChild(dn);
    btn.appendChild(dots);
    dayCell.appendChild(btn);

    body.appendChild(dayCell);
  }

  wrap.appendChild(header);
  wrap.appendChild(body);
  return wrap;
}

/* ---------- Event pill ---------- */
function buildEventPill(e){
  const pill = document.createElement("div");
  pill.className = "eventPill";

  if (e.color) {
    pill.style.borderColor = colorMix(e.color, 0.35);
    pill.style.background = colorMix(e.color, 0.12, true);
  }

  const left = document.createElement("div");
  left.className = "pillText";

  const title = document.createElement("div");
  title.className = "eventTitle";
  title.textContent = e.title;

  const meta = document.createElement("div");
  meta.className = "eventMeta";

  const parts = [];
  parts.push(`${e.start}–${e.end}`);
  if (e.location) parts.push(e.location);
  if (e.repeat?.freq && e.repeat.freq !== "none") {
    const label = (e.repeat.freq === "weekdays") ? "weekdays" : e.repeat.freq;
    parts.push(`${label} until ${e.repeat.until}`);
  }
  meta.textContent = parts.join(" • ");

  left.appendChild(title);
  left.appendChild(meta);

  if (e.notes) {
    const notes = document.createElement("div");
    notes.className = "eventMeta";
    notes.textContent = e.notes.length > 140 ? e.notes.slice(0, 140) + "…" : e.notes;
    left.appendChild(notes);
  }

  const del = document.createElement("button");
  del.className = "iconBtn";
  del.title = "Delete event";
  del.textContent = "✕";
  del.addEventListener("click", (ev) => {
    ev.stopPropagation();
    requestDelete(e, e._occurrenceDate || state.activeDate);
  });

  pill.addEventListener("click", () => {
    openEventDialog({ ...e, date: e._occurrenceDate || state.activeDate, isEdit: true });
  });

  pill.appendChild(left);
  pill.appendChild(del);
  return pill;
}

/* ---------- Delete logic ---------- */
let pendingDelete = null;

function requestDelete(evt, occurrenceISO){
  const isRepeating = (evt.repeat?.freq && evt.repeat.freq !== "none");

  if (!isRepeating) {
    if (!confirm("Delete this event?")) return;
    state.events = state.events.filter(e => e.id !== evt.id);
    saveState();
    render();
    return;
  }

  pendingDelete = { id: evt.id, occurrenceISO };

  $("deleteDialogText").textContent =
    `“${evt.title}” on ${fromISODate(occurrenceISO).toLocaleDateString(undefined, { weekday:"long", year:"numeric", month:"long", day:"numeric" })}`;

  $("deleteDialog").showModal();
}

$("deleteOneBtn").addEventListener("click", (e) => {
  e.preventDefault();
  if (!pendingDelete) return;

  const { id, occurrenceISO } = pendingDelete;
  const evt = state.events.find(x => x.id === id);
  if (!evt) return;

  evt.exdates = Array.isArray(evt.exdates) ? evt.exdates : [];
  if (!evt.exdates.includes(occurrenceISO)) evt.exdates.push(occurrenceISO);

  saveState();
  pendingDelete = null;
  $("deleteDialog").close();
  render();
});

$("deleteAllBtn").addEventListener("click", (e) => {
  e.preventDefault();
  if (!pendingDelete) return;

  const { id } = pendingDelete;
  state.events = state.events.filter(e2 => e2.id !== id);

  saveState();
  pendingDelete = null;
  $("deleteDialog").close();
  render();
});

/* ---------- Event dialog ---------- */
function openEventDialog({
  id="",
  title="",
  start="06:00",
  end="06:30",
  calendarId="",
  repeat=null,
  location="",
  notes="",
  color="",
  date="",
  isEdit=false
}){
  $("dialogTitle").textContent = isEdit ? "Edit event" : "Add event";
  $("evtId").value = id || "";
  $("evtDate").value = date || state.activeDate;

  $("evtTitle").value = title || "";
  $("evtStart").value = start;
  $("evtEnd").value = end;
  $("evtCalendar").value = calendarId || state.activeCalendarId;

  $("evtLocation").value = location || "";
  $("evtNotes").value = notes || "";

  $("evtColor").value = color || "#0a84ff";

  const freq = repeat?.freq || "none";
  $("evtRepeatFreq").value = freq;
  $("evtRepeatUntil").value = repeat?.until || "";

  $("eventDialog").showModal();
}

function upsertEventFromDialog(){
  const id = $("evtId").value || uid();
  const date = $("evtDate").value || state.activeDate;

  const title = $("evtTitle").value.trim();
  const start = $("evtStart").value;
  const end = $("evtEnd").value;
  const calendarId = $("evtCalendar").value;

  const location = $("evtLocation").value.trim();
  const notes = $("evtNotes").value.trim();
  const color = $("evtColor").value || "";

  if (!title) return alert("Please add a title.");
  const timeOk = clampToRangeTime(start, end);
  if (!timeOk.ok) return alert(timeOk.msg);

  const freq = $("evtRepeatFreq").value;
  const until = $("evtRepeatUntil").value;

  let repeat = { freq: "none", until: "" };
  if (freq !== "none") {
    if (!until) return alert("For repeating events, please set an Until date.");
    repeat = { freq, until };
  }

  const existingIndex = state.events.findIndex(e => e.id === id);
  const existing = existingIndex >= 0 ? state.events[existingIndex] : null;
  const exdates = existing?.exdates || [];

  const evt = {
    id,
    calendarId,
    title,
    start,
    end,
    location,
    notes,
    color,
    startDate: existing ? existing.startDate : date,
    repeat,
    exdates
  };

  if (existingIndex >= 0) state.events[existingIndex] = evt;
  else state.events.push(evt);

  saveState();
  render();
}

/* ---------- Calendars ---------- */
function openCalendarDialog(){
  refreshCalendarList();
  $("calDialog").showModal();
}

function refreshCalendarList(){
  const wrap = $("calList");
  wrap.innerHTML = "";

  for (const c of state.calendars) {
    const row = document.createElement("div");
    row.className = "calRow";

    const left = document.createElement("div");
    const name = document.createElement("div");
    name.className = "calName";
    name.textContent = c.name;

    const meta = document.createElement("div");
    meta.className = "small";
    const count = state.events.filter(e => e.calendarId === c.id).length;
    meta.textContent = `${count} base event(s)`;

    left.appendChild(name);
    left.appendChild(meta);

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";

    const del = document.createElement("button");
    del.className = "btn danger";
    del.textContent = "Delete";
    del.disabled = state.calendars.length === 1;
    del.addEventListener("click", () => {
      if (!confirm(`Delete calendar "${c.name}" and all its events?`)) return;
      state.events = state.events.filter(e => e.calendarId !== c.id);
      state.calendars = state.calendars.filter(x => x.id !== c.id);
      ensureActiveCalendarValid();
      saveState();
      refreshCalendarList();
      render();
    });

    actions.appendChild(del);
    row.appendChild(left);
    row.appendChild(actions);
    wrap.appendChild(row);
  }
}

function createCalendar(name){
  const trimmed = name.trim();
  if (!trimmed) return;
  state.calendars.push({ id: uid(), name: trimmed });
  saveState();
  refreshCalendarList();
  render();
}

/* ---------- Navigation ---------- */
function goPrev(){
  const d = fromISODate(state.activeDate);

  if (state.activeView === "day" || state.activeView === "agenda") d.setDate(d.getDate() - 1);
  else if (state.activeView === "week") d.setDate(d.getDate() - 7);
  else d.setMonth(d.getMonth() - 1);

  setActiveDate(toDateISO(d));
}

function goNext(){
  const d = fromISODate(state.activeDate);

  if (state.activeView === "day" || state.activeView === "agenda") d.setDate(d.getDate() + 1);
  else if (state.activeView === "week") d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);

  setActiveDate(toDateISO(d));
}

/* ---------- Color helper ---------- */
function colorMix(hex, alpha, asBg=false){
  const pct = Math.round(alpha * 100);
  if (asBg) return `color-mix(in srgb, ${hex} ${pct}%, transparent)`;
  return `color-mix(in srgb, ${hex} ${pct}%, transparent)`;
}

/* ---------- Wiring ---------- */
$("prevBtn").addEventListener("click", goPrev);
$("nextBtn").addEventListener("click", goNext);

$("calendarSelect").addEventListener("change", (e) => setActiveCalendar(e.target.value));

$("primaryAction").addEventListener("click", () => {
  if (state.activeView === "agenda") {
    setActiveView("day"); // “populate mode”
    return;
  }
  openEventDialog({
    date: state.activeDate,
    start: "09:00",
    end: "09:30",
    calendarId: state.activeCalendarId
  });
});

$("eventForm").addEventListener("submit", (e) => {
  e.preventDefault();
  upsertEventFromDialog();
  $("eventDialog").close();
});

$("manageCalendars").addEventListener("click", openCalendarDialog);

$("createCal").addEventListener("click", (e) => {
  e.preventDefault();
  createCalendar($("newCalName").value);
  $("newCalName").value = "";
});

$("themeToggle").addEventListener("click", toggleTheme);

for (const btn of document.querySelectorAll(".segBtn")) {
  btn.addEventListener("click", () => setActiveView(btn.dataset.view));
}

/* ---------- Service Worker ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try { await navigator.serviceWorker.register("./service-worker.js"); }
    catch {}
  });
}

/* ---------- Init ---------- */
setTheme(state.theme || "dark");
render();
