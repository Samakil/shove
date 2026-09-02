const W = 720, H = 480;
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const CX = W / 2, CY = H / 2 + 8;
const STAGE_START_R = 168, STAGE_END_R = 96, DRAIN_TIME = 28;
const PR = 18, SPEED = 240, FRICTION = 5.2;
const SHOVE_CD = 0.8, SHOVE_RANGE = 46, SHOVE_SELF = 210, SHOVE_HIT = 560, SNAP_HZ = 20;
const SHOVE_ANIM = 0.22, HAND_FRAMES = 6, HAND_SIZE = 512;
const HITSTOP = 0.1;
const ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PEER_PREFIX = "bstrika-shove-";
const keys = new Set();
const pad = { shove: false };
const stick = { x: 0, y: 0, pid: null };
const PLAY_KEYS = ["KeyW","KeyA","KeyS","KeyD","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space"];
function preferTouchUI() {
  try {
    if (matchMedia("(pointer: coarse)").matches) return true;
    if (matchMedia("(hover: none)").matches && (navigator.maxTouchPoints || 0) > 0) return true;
  } catch (e) {}
  return false;
}
function setTouchUI(on) {
  const next = !!on;
  document.body.classList.toggle("touch-ui", next);
  const pads = document.getElementById("pads");
  if (pads) {
    pads.hidden = !next;
    pads.setAttribute("aria-hidden", next ? "false" : "true");
  }
  if (!next) {
    stick.x = 0; stick.y = 0; stick.pid = null;
    pad.shove = false;
    const knob = document.getElementById("stickKnob");
    if (knob) knob.style.transform = "translate(0px, 0px)";
    const shoveBtn = document.getElementById("shoveBtn");
    if (shoveBtn) shoveBtn.classList.remove("held");
  }
}
function releaseControls() {
  keys.clear();
  stick.x = 0; stick.y = 0; stick.pid = null;
  pad.shove = false;
  const knob = document.getElementById("stickKnob");
  if (knob) knob.style.transform = "translate(0px, 0px)";
  const shoveBtn = document.getElementById("shoveBtn");
  if (shoveBtn) shoveBtn.classList.remove("held");
}
setTouchUI(preferTouchUI());
try {
  const coarse = matchMedia("(pointer: coarse)");
  coarse.addEventListener("change", ev => { if (ev.matches) setTouchUI(true); });
} catch (e) {}
addEventListener("pointerdown", e => {
  if (e.pointerType === "touch") setTouchUI(true);
  unlockAudio();
}, true);
addEventListener("keydown", e => {
  unlockAudio();
  keys.add(e.code);
  if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space"].includes(e.code)) e.preventDefault();
  if (PLAY_KEYS.includes(e.code) && (!e.target || e.target.tagName !== "INPUT") && !preferTouchUI()) {
    setTouchUI(false);
  }
});
addEventListener("keyup", e => keys.delete(e.code));
addEventListener("blur", releaseControls);
(function bindTouchControls() {
  const stickEl = document.getElementById("stick");
  const knobEl = document.getElementById("stickKnob");
  const shoveBtn = document.getElementById("shoveBtn");
  function updateStick(ev) {
    const base = stickEl.querySelector(".stick-base");
    const r = base.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = ev.clientX - cx, dy = ev.clientY - cy;
    const max = Math.max(r.width, r.height) * 0.42;
    const len = Math.hypot(dx, dy);
    if (len > max && len > 0) { dx = dx / len * max; dy = dy / len * max; }
    stick.x = max ? dx / max : 0;
    stick.y = max ? dy / max : 0;
    knobEl.style.transform = "translate(" + dx + "px," + dy + "px)";
  }
  function endStick(ev) {
    if (stick.pid !== ev.pointerId) return;
    stick.pid = null; stick.x = 0; stick.y = 0;
    knobEl.style.transform = "translate(0px, 0px)";
  }
  stickEl.addEventListener("pointerdown", ev => {
    ev.preventDefault();
    stick.pid = ev.pointerId;
    try { stickEl.setPointerCapture(ev.pointerId); } catch (e) {}
    updateStick(ev);
  });
  stickEl.addEventListener("pointermove", ev => {
    if (stick.pid !== ev.pointerId) return;
    ev.preventDefault();
    updateStick(ev);
  });
  stickEl.addEventListener("pointerup", endStick);
  stickEl.addEventListener("pointercancel", endStick);
  shoveBtn.addEventListener("pointerdown", ev => {
    ev.preventDefault();
    pad.shove = true;
    shoveBtn.classList.add("held");
    try { shoveBtn.setPointerCapture(ev.pointerId); } catch (e) {}
  });
  const offShove = ev => { ev.preventDefault(); pad.shove = false; shoveBtn.classList.remove("held"); };
  shoveBtn.addEventListener("pointerup", offShove);
  shoveBtn.addEventListener("pointercancel", offShove);
  shoveBtn.addEventListener("lostpointercapture", offShove);
})();
function norm(x, y) {
  const l = Math.hypot(x, y) || 0;
  return l ? { x: x / l, y: y / l } : { x: 0, y: 0 };
}
function makeCode() {
  let c = "";
  for (let i = 0; i < 4; i++) c += ALPH[Math.floor(Math.random() * ALPH.length)];
  return c;
}
function makePlayer(id, color, x) {
  return { id, color, x, y: CY, vx: 0, vy: 0, cd: 0, shoving: 0, hit: 0, alive: true, facing: id === 1 ? 0 : Math.PI };
}
const HOST_KEY = "shove-host";
let slot = 0, code = "", peer = null, conn = null;
let incomingPending = false;
let joinAcceptT = 0, joiningCode = "";
let p1, p2, scores, mode, banner, bannerT, last, winner;
let stageR = STAGE_START_R, roundElapsed = 0;
let remoteIn = { x: 0, y: 0, shove: false };
let snapAcc = 0;
let hostSnap = null;
let camKick = 0, camAng = 0, impacts = [];
let hitstop = 0, pendingKick = null;
let audioCtx = null;
const handSheet = new Image();
const handTints = {};
function tintHandSheet(color) {
  const layer = document.createElement("canvas");
  layer.width = HAND_SIZE * HAND_FRAMES;
  layer.height = HAND_SIZE;
  const paint = layer.getContext("2d");
  paint.drawImage(handSheet, 0, 0);
  paint.globalCompositeOperation = "source-in";
  paint.fillStyle = color;
  paint.fillRect(0, 0, layer.width, layer.height);
  return layer;
}
handSheet.onload = () => {
  handTints.p1 = tintHandSheet("#3d9cff");
  handTints.p2 = tintHandSheet("#ff5a3d");
  handTints.local = tintHandSheet("#ffffff");
  handTints.hit = tintHandSheet("#fff6e0");
};
handSheet.src = "assets/hand_sheet.png";
function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch (e) {}
}
function playBass() {
  try {
    unlockAudio();
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(88, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.1);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.6, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.14);
  } catch (e) {}
}
function normalizeCode(raw) {
  return String(raw || "").toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 4);
}
function persistHost(c) {
  try { sessionStorage.setItem(HOST_KEY, JSON.stringify({ code: c, peerId: PEER_PREFIX + c })); } catch (e) {}
}
function clearHostPersist() {
  try { sessionStorage.removeItem(HOST_KEY); } catch (e) {}
}
function readHostPersist() {
  try {
    const raw = sessionStorage.getItem(HOST_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    const c = normalizeCode(o && o.code);
    return c.length === 4 ? { code: c, peerId: o.peerId || (PEER_PREFIX + c) } : null;
  } catch (e) { return null; }
}
function punchScore(id) {
  const el = document.getElementById("s" + id);
  if (!el) return;
  el.classList.remove("punch");
  void el.offsetWidth;
  el.classList.add("punch");
}
let rematchYes = [false, false];
let iSaidYes = false;
let declinedBy = 0;
function markRematchTapped(on) {
  const btn = document.getElementById("rematch");
  btn.disabled = !!on;
  btn.classList.toggle("tapped", !!on);
}
function meYes() {
  return iSaidYes || (slot === 1 ? rematchYes[0] : rematchYes[1]);
}
function theyYes() {
  return slot === 1 ? rematchYes[1] : rematchYes[0];
}
function noteLocalYes() {
  iSaidYes = true;
  if (slot === 1) rematchYes[0] = true;
  if (slot === 2) rematchYes[1] = true;
}
function syncEndChrome() {
  const el = document.getElementById("endplay");
  el.classList.remove("waiting", "offer", "reply", "committed");
  if (!el.classList.contains("show") || el.classList.contains("left") || el.classList.contains("declined")) {
    markRematchTapped(el.classList.contains("waiting"));
    return;
  }
  const me = meYes(), they = theyYes();
  if (me && they) {
    el.classList.add("waiting", "committed");
    markRematchTapped(true);
  } else if (me && !they) {
    el.classList.add("waiting");
    markRematchTapped(true);
  } else if (they && !me) {
    el.classList.add("reply");
    markRematchTapped(false);
  } else {
    el.classList.add("offer");
    markRematchTapped(false);
  }
}
function showEndplay(on) {
  const el = document.getElementById("endplay");
  el.classList.toggle("show", !!on);
  el.classList.remove("left", "declined", "waiting", "offer", "reply", "committed");
  document.getElementById("rematch").hidden = false;
  document.getElementById("again").hidden = false;
  if (!on) {
    rematchYes = [false, false];
    iSaidYes = false;
    declinedBy = 0;
    markRematchTapped(false);
  } else {
    syncEndChrome();
  }
}
function showTheyLeft() {
  setBanner("They left");
  mode = "over";
  rematchYes = [false, false];
  iSaidYes = false;
  const el = document.getElementById("endplay");
  el.classList.add("show", "left");
  el.classList.remove("declined", "waiting", "offer", "reply", "committed");
  document.getElementById("rematch").hidden = true;
  document.getElementById("again").hidden = true;
  markRematchTapped(false);
}
function showDeclined() {
  setBanner("That's 3");
  mode = "over";
  const el = document.getElementById("endplay");
  el.classList.add("show", "declined");
  el.classList.remove("left", "waiting", "offer", "reply", "committed");
  document.getElementById("rematch").hidden = true;
  document.getElementById("again").hidden = true;
  markRematchTapped(false);
}
function setBanner(text) {
  banner = text || "";
  document.getElementById("msg").textContent = banner;
}
function roomLink() {
  const u = new URL(location.href);
  u.searchParams.set("room", code);
  return u;
}
function updateShoveBtn() {
  const btn = document.getElementById("shoveBtn");
  if (!btn) return;
  const me = slot === 1 ? p1 : slot === 2 ? p2 : null;
  const dead = !!(me && me.cd > 0) || mode === "breath";
  btn.classList.toggle("dead", dead);
}
function showErr(m) { document.getElementById("err").textContent = m || ""; }
function send(obj) {
  const c = conn;
  if (!c || !c.open) return false;
  try {
    c.send(obj);
    return true;
  } catch (e) {
    try { c.close(); } catch (closeErr) {}
    return false;
  }
}
function setJoinBusy(on) {
  document.getElementById("join").disabled = !!on;
  document.getElementById("codein").disabled = !!on;
}
function setHostBusy(on) {
  document.getElementById("create").disabled = !!on;
}
function failGuestJoin(message) {
  clearTimeout(joinAcceptT); joinAcceptT = 0; joiningCode = "";
  const oldConn = conn, oldPeer = peer;
  conn = null; peer = null; slot = 0;
  try { if (oldConn) oldConn.close(); } catch (e) {}
  try { if (oldPeer) oldPeer.destroy(); } catch (e) {}
  setJoinBusy(false);
  document.getElementById("game").classList.remove("on");
  document.getElementById("lobby").classList.remove("hid");
  showErr(message || "Could not join the room.");
}
function makePeer(id) {
  if (typeof Peer !== "function") {
    showErr("Online service failed to load. Refresh and try again.");
    return null;
  }
  try {
    return id ? new Peer(id) : new Peer();
  } catch (e) {
    showErr("Online service failed to start. Refresh and try again.");
    return null;
  }
}
function wire(c) {
  conn = c;
  c.on("data", onMsg);
  c.on("close", () => {
    if (conn !== c) return;
    if (!document.getElementById("game").classList.contains("on")) return;
    showTheyLeft();
  });
}
function showHostCode(c) {
  code = c;
  document.getElementById("lobby").classList.add("waiting");
  document.getElementById("codebig").hidden = false;
  document.getElementById("codebig").textContent = code;
  document.getElementById("wait").hidden = false;
  document.getElementById("copylink").hidden = false;
  document.getElementById("roomhud").textContent = "Room " + code;
  const u = roomLink();
  history.replaceState(null, "", u);
  persistHost(code);
}
function hostIsWaiting() {
  if (document.getElementById("game").classList.contains("on")) return false;
  if (slot !== 1) return false;
  const saved = readHostPersist();
  return !!(saved && saved.code);
}
function hostBrokerDown() {
  if (!peer) return true;
  if (peer.destroyed) return true;
  if (peer.disconnected) return true;
  return false;
}
function isBrokerDrop(err) {
  const t = err && err.type;
  return t === "network" || t === "socket-closed" || t === "socket-error" || t === "server-error" || t === "disconnected";
}
let hostRejoinT = 0, hostOpening = false;
function scheduleHostReconnect(c) {
  const codeToUse = normalizeCode(c) || (readHostPersist() && readHostPersist().code) || code;
  if (!codeToUse) return;
  if (document.getElementById("game").classList.contains("on")) return;
  showErr("");
  slot = 1;
  showHostCode(codeToUse);
  clearTimeout(hostRejoinT);
  hostRejoinT = setTimeout(() => ensureHostBroker(), 280);
}
function ensureHostBroker() {
  if (document.getElementById("game").classList.contains("on")) return;
  const saved = readHostPersist();
  const c = (saved && saved.code) || (slot === 1 ? code : "");
  if (!c || (slot !== 1 && !saved)) return;
  if (slot !== 1 && saved) slot = 1;
  showErr("");
  showHostCode(c);
  if (hostOpening) return;
  if (peer && !peer.destroyed && !peer.disconnected) return;
  if (peer && !peer.destroyed && peer.disconnected) {
    try { peer.reconnect(); return; } catch (e) {}
  }
  hostRoom(c);
}
function bindHostPeer(tryCode, existingCode, n) {
  const boundPeer = peer;
  boundPeer.on("open", () => {
    if (peer !== boundPeer) return;
    hostOpening = false; slot = 1; showHostCode(tryCode);
  });
  boundPeer.on("connection", c => {
    if (peer !== boundPeer) {
      c.on("open", () => { try { c.close(); } catch (e) {} });
      return;
    }
    const gameActive = document.getElementById("game").classList.contains("on");
    if (incomingPending || gameActive || (conn && conn.open)) {
      c.on("open", () => {
        try { c.send({ t: "reject", reason: "full" }); } catch (e) {}
        setTimeout(() => { try { c.close(); } catch (e) {} }, 120);
      });
      return;
    }
    incomingPending = true;
    c.on("open", () => {
      const nowBusy = document.getElementById("game").classList.contains("on") || (conn && conn.open);
      if (nowBusy) {
        incomingPending = false;
        try { c.close(); } catch (e) {}
        return;
      }
      incomingPending = false;
      wire(c);
      send({ t: "welcome", code: tryCode });
      enterGame();
    });
    c.on("close", () => {
      if (conn !== c) incomingPending = false;
    });
  });
  boundPeer.on("disconnected", () => {
    if (peer !== boundPeer) return;
    if (!hostIsWaiting()) return;
    showErr("");
    if (document.visibilityState === "visible") scheduleHostReconnect(tryCode);
  });
  boundPeer.on("close", () => {
    if (peer !== boundPeer) return;
    if (!hostIsWaiting()) return;
    showErr("");
    if (document.visibilityState === "visible") scheduleHostReconnect(tryCode);
  });
  boundPeer.on("error", err => {
    if (peer !== boundPeer) return;
    if (err.type === "unavailable-id") {
      hostOpening = false;
      if (existingCode && n < 6) {
        setTimeout(() => hostRoom(existingCode, n + 1), 200 + n * 250);
        return;
      }
      if (!existingCode) hostRoom();
      else scheduleHostReconnect(existingCode);
      return;
    }
    if (hostIsWaiting() || existingCode) {
      showErr("");
      if (isBrokerDrop(err) && document.visibilityState === "visible") {
        scheduleHostReconnect(tryCode);
      }
      return;
    }
    hostOpening = false;
    setHostBusy(false);
    document.getElementById("lobby").classList.remove("waiting");
    showErr("Could not create a room.");
  });
}
function hostRoom(existingCode, attempt) {
  showErr("");
  setHostBusy(true);
  const tryCode = normalizeCode(existingCode) || makeCode();
  const n = attempt || 0;
  if (existingCode) {
    slot = 1;
    showHostCode(tryCode);
  }
  hostOpening = true;
  incomingPending = false;
  const oldPeer = peer;
  peer = null;
  if (oldPeer) { try { oldPeer.destroy(); } catch (e) {} }
  hostOpening = true;
  peer = makePeer(PEER_PREFIX + tryCode);
  if (!peer) { hostOpening = false; setHostBusy(false); return; }
  bindHostPeer(tryCode, existingCode, n);
}
function joinRoom(raw) {
  showErr("");
  const c = normalizeCode(raw);
  if (c.length < 4) { showErr("Type a 4-character code."); return; }
  setJoinBusy(true);
  clearTimeout(joinAcceptT); joinAcceptT = 0; joiningCode = "";
  clearHostPersist();
  const oldPeer = peer;
  peer = null;
  if (oldPeer) { try { oldPeer.destroy(); } catch (e) {} }
  const ERR_NO_ROOM = "No room. Check the code.";
  const ERR_NO_CONN = "Couldn't connect. The network may block peer-to-peer play.";
  let joined = false, missing = false, timer = 0;
  function failJoin(msg) {
    if (joined) return;
    if (timer) { clearTimeout(timer); timer = 0; }
    failGuestJoin(msg);
  }
  peer = makePeer();
  if (!peer) { setJoinBusy(false); return; }
  const joiningPeer = peer;
  joiningPeer.on("open", () => {
    if (peer !== joiningPeer) return;
    const cnx = joiningPeer.connect(PEER_PREFIX + c, { reliable: true });
    timer = setTimeout(() => failJoin(missing ? ERR_NO_ROOM : ERR_NO_CONN), 8000);
    cnx.on("open", () => {
      if (peer !== joiningPeer) { try { cnx.close(); } catch (e) {} return; }
      joined = true;
      if (timer) { clearTimeout(timer); timer = 0; }
      joiningCode = c;
      wire(cnx);
      joinAcceptT = setTimeout(() => failGuestJoin("Room did not accept the connection. Try again."), 3000);
    });
    cnx.on("error", () => { if (peer === joiningPeer) failJoin(missing ? ERR_NO_ROOM : ERR_NO_CONN); });
    cnx.on("iceStateChanged", state => {
      if (peer === joiningPeer && state === "failed") failJoin(ERR_NO_CONN);
    });
  });
  joiningPeer.on("error", err => {
    if (peer !== joiningPeer) return;
    if (joined) return;
    if (err && err.type === "peer-unavailable") {
      missing = true;
      failJoin(ERR_NO_ROOM);
    } else if (err && err.type === "webrtc") {
      failJoin(ERR_NO_CONN);
    } else {
      failJoin(err.message || "Could not join.");
    }
  });
}
function cleanAxis(value) {
  return cleanNumber(value, -1, 1, 0);
}
function cleanNumber(value, min, max, fallback) {
  try {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  } catch (e) {
    return fallback;
  }
}
function cleanPlayerState(d) {
  if (!d || typeof d !== "object") return null;
  const x = cleanNumber(d.x, -1000, W + 1000, null);
  const y = cleanNumber(d.y, -1000, H + 1000, null);
  const vx = cleanNumber(d.vx, -1000, 1000, null);
  const vy = cleanNumber(d.vy, -1000, 1000, null);
  const facing = cleanNumber(d.facing, -Math.PI * 4, Math.PI * 4, null);
  if (x == null || y == null || vx == null || vy == null || facing == null) return null;
  return {
    x, y, vx, vy, facing,
    shoving: cleanNumber(d.shoving, 0, 2, 0),
    hit: cleanNumber(d.hit, 0, 2, 0),
    cd: cleanNumber(d.cd, 0, 5, 0),
    alive: !!d.alive
  };
}
function cleanStatePacket(s) {
  if (!s || typeof s !== "object") return null;
  const a = cleanPlayerState(s.p1), b = cleanPlayerState(s.p2);
  const allowedModes = ["breath", "play", "pause", "over"];
  if (!a || !b || !allowedModes.includes(s.mode)) return null;
  const cleanImpact = i => {
    if (!i || typeof i !== "object") return null;
    const x = cleanNumber(i.x, -1000, W + 1000, null);
    const y = cleanNumber(i.y, -1000, H + 1000, null);
    if (x == null || y == null) return null;
    const splash = i.kind === "splash";
    return {
      x, y,
      nx: cleanNumber(i.nx, -1, 1, 0), ny: cleanNumber(i.ny, -1, 1, 0),
      t: cleanNumber(i.t, 0, 1, 0),
      kind: splash ? "splash" : "hit",
      color: i.color === "#3d9cff" || i.color === "#ff5a3d" ? i.color : "#d9f5ff"
    };
  };
  return {
    p1: a, p2: b,
    s1: Math.round(cleanNumber(s.s1, 0, 3, 0)),
    s2: Math.round(cleanNumber(s.s2, 0, 3, 0)),
    mode: s.mode,
    banner: typeof s.banner === "string" ? s.banner.slice(0, 80) : "",
    bannerT: cleanNumber(s.bannerT, 0, 10, 0),
    winner: Math.round(cleanNumber(s.winner, 0, 2, 0)),
    camKick: cleanNumber(s.camKick, 0, 1, 0),
    camAng: cleanNumber(s.camAng, -Math.PI * 4, Math.PI * 4, 0),
    impacts: (Array.isArray(s.impacts) ? s.impacts : []).slice(0, 24).map(cleanImpact).filter(Boolean),
    want1: !!s.want1, want2: !!s.want2,
    hitstop: cleanNumber(s.hitstop, 0, 0.5, 0),
    declinedBy: Math.round(cleanNumber(s.declinedBy, 0, 2, 0)),
    stageR: cleanNumber(s.stageR, STAGE_END_R, STAGE_START_R, STAGE_START_R),
    roundElapsed: cleanNumber(s.roundElapsed, 0, DRAIN_TIME + 10, 0)
  };
}
function onMsg(msg) {
  if (!msg || !msg.t) return;
  if (msg.t === "welcome" && slot === 0 && joiningCode) {
    clearTimeout(joinAcceptT); joinAcceptT = 0;
    slot = 2; code = normalizeCode(msg.code) || joiningCode; joiningCode = "";
    setJoinBusy(false);
    enterGame();
  }
  else if (msg.t === "reject" && slot === 0 && joiningCode) {
    failGuestJoin(msg.reason === "full" ? "Room is already in a match." : "The room rejected the connection.");
  }
  else if (msg.t === "in" && slot === 1) remoteIn = { x: cleanAxis(msg.x), y: cleanAxis(msg.y), shove: !!msg.shove };
  else if (msg.t === "state" && slot === 2) {
    const safeState = cleanStatePacket(msg);
    if (safeState) applyState(safeState);
  }
  else if (msg.t === "rematch" && slot === 1) wantRematch(2);
  else if (msg.t === "decline" && slot === 1) hostGotDecline(2);
}
function hostGotDecline(who) {
  if (mode !== "over" || declinedBy) return;
  declinedBy = who;
  if (who !== 1) showTheyLeft();
  else showDeclined();
  send({ t: "state", ...packState() });
}
function wantRematch(who) {
  if (mode !== "over" || declinedBy) return;
  rematchYes[who - 1] = true;
  if (slot === who) iSaidYes = true;
  if (rematchYes[0] && rematchYes[1]) resetMatch();
  else {
    syncEndChrome();
    if (slot === 1) send({ t: "state", ...packState() });
  }
}
function declineRematch() {
  if (mode !== "over" || declinedBy) return;
  if (meYes()) return;
  if (!theyYes()) return;
  if (slot === 1) {
    declinedBy = 1;
    showDeclined();
    send({ t: "state", ...packState() });
  } else {
    declinedBy = 2;
    showDeclined();
    send({ t: "decline" });
  }
}
function enterGame() {
  if (slot === 2) clearHostPersist();
  document.getElementById("lobby").classList.add("hid");
  document.getElementById("game").classList.add("on");
  document.getElementById("roomhud").textContent = "Room " + code;
  if (slot === 1) resetMatch();
}
function resetMatch() {
  scores = [0, 0]; winner = 0;
  document.getElementById("s1").textContent = "0";
  document.getElementById("s2").textContent = "0";
  document.getElementById("s1").classList.remove("punch");
  document.getElementById("s2").classList.remove("punch");
  showEndplay(false);
  camKick = 0; impacts = []; hitstop = 0; pendingKick = null;
  startBreath("Shove");
  if (slot === 1) send({ t: "state", ...packState() });
}
function startBreath(text) {
  p1 = makePlayer(1, "#3d9cff", CX - 70);
  p2 = makePlayer(2, "#ff5a3d", CX + 70);
  mode = "breath";
  stageR = STAGE_START_R;
  roundElapsed = 0;
  bannerT = 0.8;
  setBanner(text || "");
}
function kickCam(nx, ny) {
  camKick = 0.15;
  camAng = Math.atan2(ny, nx);
}
function addImpact(x, y, nx, ny) {
  impacts.push({ x, y, nx, ny, t: 0.2, kind: "hit" });
}
function addSplash(p) {
  impacts.push({ x: p.x, y: p.y, nx: 0, ny: 0, t: 0.7, kind: "splash", color: p.color });
}
function advanceDrain(dt) {
  roundElapsed = Math.min(DRAIN_TIME, roundElapsed + Math.max(0, dt));
  const u = roundElapsed / DRAIN_TIME;
  stageR = STAGE_START_R + (STAGE_END_R - STAGE_START_R) * u;
}
function localDir() {
  const mag = Math.hypot(stick.x, stick.y);
  if (mag > 0.12) {
    const s = Math.min(1, mag);
    return { x: (stick.x / mag) * s, y: (stick.y / mag) * s };
  }
  let x = 0, y = 0;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) x -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) x += 1;
  if (keys.has("KeyW") || keys.has("ArrowUp")) y -= 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) y += 1;
  return norm(x, y);
}
function localShove() { return keys.has("Space") || keys.has("Enter") || pad.shove; }
function dirFor(p) {
  if (mode !== "play") return { x: 0, y: 0 };
  if (slot !== 1) return { x: 0, y: 0 };
  if (p.id === 1) return localDir();
  return norm(remoteIn.x, remoteIn.y);
}
function shoveHeld(p) {
  if (mode !== "play") return false;
  if (p.id === 1) return localShove();
  return !!remoteIn.shove;
}
function tryShove(p, other) {
  if (p.cd > 0 || !p.alive || mode !== "play" || hitstop > 0) return null;
  if (!shoveHeld(p)) return null;
  p.cd = SHOVE_CD; p.shoving = SHOVE_ANIM;
  let dir = dirFor(p);
  if (!dir.x && !dir.y) dir = { x: Math.cos(p.facing), y: Math.sin(p.facing) };
  p.vx += dir.x * SHOVE_SELF; p.vy += dir.y * SHOVE_SELF;
  const dx = other.x - p.x, dy = other.y - p.y;
  const d = Math.hypot(dx, dy);
  if (other.alive && d < SHOVE_RANGE) {
    const hit = d < 1 ? dir : { x: dx / d, y: dy / d };
    other.vx += hit.x * SHOVE_HIT; other.vy += hit.y * SHOVE_HIT;
    other.hit = 0.16;
    addImpact((p.x + other.x) / 2, (p.y + other.y) / 2, hit.x, hit.y);
    return hit;
  }
  return null;
}
function stepPlayer(p, dt) {
  if (!p.alive) return;
  const dir = dirFor(p);
  if (dir.x || dir.y) p.facing = Math.atan2(dir.y, dir.x);
  p.vx += dir.x * SPEED * dt * 6; p.vy += dir.y * SPEED * dt * 6;
  p.vx *= Math.max(0, 1 - FRICTION * dt); p.vy *= Math.max(0, 1 - FRICTION * dt);
  const sp = Math.hypot(p.vx, p.vy);
  if (sp > 420) { p.vx *= 420 / sp; p.vy *= 420 / sp; }
  p.x += p.vx * dt; p.y += p.vy * dt;
  p.cd = Math.max(0, p.cd - dt); p.shoving = Math.max(0, p.shoving - dt);
  p.hit = Math.max(0, (p.hit || 0) - dt);
  if (Math.hypot(p.x - CX, p.y - CY) > stageR + PR * 0.15) p.alive = false;
}
function separate(a, b) {
  if (!a.alive || !b.alive) return;
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 0.001;
  const min = PR * 2;
  if (d < min) {
    const push = (min - d) / 2, nx = dx / d, ny = dy / d;
    a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
  }
}
function roundOver(loser) {
  if (mode !== "play") return;
  addSplash(loser);
  mode = "pause";
  const win = loser.id === 1 ? 2 : 1;
  scores[win - 1] += 1;
  document.getElementById("s" + win).textContent = String(scores[win - 1]);
  punchScore(win);
  if (scores[0] >= 3 || scores[1] >= 3) {
    winner = scores[0] >= 3 ? 1 : 2;
    rematchYes = [false, false];
    iSaidYes = false;
    declinedBy = 0;
    setBanner("That's 3");
    showEndplay(true);
    markRematchTapped(false);
    mode = "over";
  } else {
    const text = (scores[0] === 2 && scores[1] === 2) ? "Last one" : "Shove";
    startBreath(text);
  }
}
function packState() {
  const pack = p => ({ x: p.x, y: p.y, vx: p.vx, vy: p.vy, facing: p.facing, shoving: p.shoving, hit: p.hit, cd: p.cd, alive: p.alive });
  return { p1: pack(p1), p2: pack(p2), s1: scores[0], s2: scores[1], mode, banner, bannerT, winner, camKick, camAng, impacts, want1: rematchYes[0], want2: rematchYes[1], hitstop, declinedBy, stageR, roundElapsed };
}
function applyState(s) {
  hostSnap = s;
  function stamp(p, d, color, id) {
    if (!p) p = makePlayer(id, color, d.x);
    p.x = d.x; p.y = d.y; p.vx = d.vx; p.vy = d.vy;
    p.facing = d.facing; p.shoving = d.shoving; p.alive = d.alive; p.color = color;
    p.hit = d.hit || 0; p.cd = d.cd || 0;
    return p;
  }
  if (!p1 || !p2) { p1 = stamp(p1, s.p1, "#3d9cff", 1); p2 = stamp(p2, s.p2, "#ff5a3d", 2); }
  const prev1 = scores ? scores[0] : 0, prev2 = scores ? scores[1] : 0;
  scores = [s.s1, s.s2];
  mode = s.mode; banner = s.banner; bannerT = s.bannerT; winner = s.winner;
  camKick = s.camKick || 0; camAng = s.camAng || 0;
  stageR = s.stageR; roundElapsed = s.roundElapsed;
  const nextStop = s.hitstop || 0;
  if (nextStop > 0.05 && hitstop <= 0) playBass();
  hitstop = nextStop;
  impacts = Array.isArray(s.impacts) ? s.impacts.map(i => Object.assign({}, i)) : impacts;
  document.getElementById("s1").textContent = String(s.s1);
  document.getElementById("s2").textContent = String(s.s2);
  if (s.s1 > prev1) punchScore(1);
  if (s.s2 > prev2) punchScore(2);
  document.getElementById("msg").textContent = banner || "";
  if (s.want1 != null) rematchYes[0] = !!s.want1;
  if (s.want2 != null) rematchYes[1] = !!s.want2;
  if (slot === 1 && iSaidYes) rematchYes[0] = true;
  if (slot === 2 && iSaidYes) rematchYes[1] = true;
  if (s.declinedBy) declinedBy = s.declinedBy;
  if (declinedBy === slot) showDeclined();
  else if (declinedBy && declinedBy !== slot) showTheyLeft();
  else if (mode === "over" && banner === "They left") showTheyLeft();
  else if (mode === "over" && banner === "That's 3") {
    const el = document.getElementById("endplay");
    el.classList.add("show");
    el.classList.remove("left");
    if (el.classList.contains("declined")) showDeclined();
    else syncEndChrome();
  } else {
    showEndplay(false);
  }
}
function lerpToward(p, d, k) {
  if (!p || !d) return;
  p.x += (d.x - p.x) * k; p.y += (d.y - p.y) * k;
  p.vx += (d.vx - p.vx) * k; p.vy += (d.vy - p.vy) * k;
  p.facing = d.facing; p.shoving = d.shoving; p.alive = d.alive;
  if (d.hit != null) p.hit = d.hit;
  if (d.cd != null) p.cd = d.cd;
}
function stampBody(p, color, k) {
  const shoving = p.alive && p.shoving > 0;
  const stocky = p.id === 1;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = (stocky ? 12 : 9.5) * k;
  ctx.beginPath();
  ctx.moveTo(-2 * k, -7 * k);
  ctx.lineTo(shoving ? 7 * k : 3 * k, 7 * k);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc((shoving ? 8 : 5) * k, -13 * k, (stocky ? 6.6 : 5.8) * k, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = (stocky ? 6.2 : 5) * k;
  ctx.beginPath();
  ctx.moveTo(2 * k, 6 * k);
  ctx.lineTo((shoving ? 11 : 8) * k, 17 * k);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, 6 * k);
  ctx.lineTo((shoving ? -2 : -5) * k, 17 * k);
  ctx.stroke();
  ctx.lineWidth = (shoving ? 6.4 : 5.2) * k;
  if (shoving) {
    ctx.beginPath();
    ctx.moveTo(4 * k, -5 * k);
    ctx.lineTo(22 * k, -2 * k);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(2 * k, -3 * k);
    ctx.lineTo(17 * k, 7 * k);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(3 * k, -5 * k);
    ctx.lineTo(13 * k, 3 * k);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -4 * k);
    ctx.lineTo(-8 * k, 5 * k);
    ctx.stroke();
  }
}
function drawPlayer(p) {
  if (!p) return;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.facing);
  const s = p.alive ? 1 : 0.7;
  ctx.scale(s, s);
  const frame = p.shoving > 0 ? Math.min(HAND_FRAMES - 1, Math.floor((1 - p.shoving / SHOVE_ANIM) * HAND_FRAMES)) : 0;
  const sprite = p.id === 1 ? handTints.p1 : handTints.p2;
  const drawHand = (sheet, size, alpha) => {
    ctx.globalAlpha = alpha;
    ctx.drawImage(sheet, frame * HAND_SIZE, 0, HAND_SIZE, HAND_SIZE, -size / 2, -size / 2, size, size);
  };
  if (sprite) {
    if (slot && p.id === slot && handTints.local) drawHand(handTints.local, 88, 0.82);
    drawHand(p.alive ? sprite : handTints.local, 80, p.alive ? 1 : 0.22);
    if (p.alive && (p.hit || 0) > 0 && handTints.hit) drawHand(handTints.hit, 82, Math.min(1, p.hit * 6));
    ctx.globalAlpha = 1;
  } else {
    if (slot && p.id === slot) stampBody(p, "#ffffff", 1.16);
    stampBody(p, p.alive ? p.color : "#2a2f3a", 1);
  }
  ctx.restore();
}
function drawStage() {
  const water = ctx.createRadialGradient(CX, CY, 24, CX, CY, Math.max(W, H) * 0.62);
  water.addColorStop(0, "#102c3b");
  water.addColorStop(0.46, "#08202d");
  water.addColorStop(1, "#030b12");
  ctx.fillStyle = water;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.strokeStyle = "rgba(114,205,232,.10)";
  ctx.lineWidth = 1.4;
  const wave = ((last || 0) * 0.018) % 28;
  for (let r = stageR + 22 + wave; r < 390; r += 28) {
    ctx.beginPath();
    ctx.arc(CX, CY, r, 0.12, Math.PI * 1.18);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(CX, CY, r + 8, Math.PI * 1.22, Math.PI * 1.92);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = "rgba(0,0,0,.42)";
  ctx.beginPath();
  ctx.ellipse(CX, CY + 18, stageR + 21, stageR * 0.4 + 12, 0, 0, Math.PI * 2);
  ctx.fill();
  const floor = ctx.createRadialGradient(CX - 45, CY - 55, 8, CX, CY, stageR);
  floor.addColorStop(0, "#59616a");
  floor.addColorStop(0.55, "#343b43");
  floor.addColorStop(1, "#20272d");
  ctx.fillStyle = floor;
  ctx.beginPath();
  ctx.arc(CX, CY, stageR, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(CX, CY, stageR, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = "rgba(255,255,255,.04)";
  ctx.lineWidth = 1;
  for (let i = 1; i <= 4; i++) {
    ctx.beginPath();
    ctx.arc(CX, CY, stageR * (i / 5), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(2,9,13,.9)";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(CX, CY, stageR + 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "#9cd7e7";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(CX, CY, stageR, 0, Math.PI * 2);
  ctx.stroke();
}
function drawImpacts() {
  for (let i = 0; i < impacts.length; i++) {
    const hit = impacts[i];
    const splash = hit.kind === "splash";
    const life = splash ? 0.7 : 0.2;
    const u = 1 - hit.t / life;
    ctx.save();
    ctx.translate(hit.x, hit.y);
    ctx.globalAlpha = Math.max(0, hit.t / life);
    ctx.strokeStyle = splash ? "#d9f5ff" : "#fff4d0";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, (splash ? 12 : 8) + u * (splash ? 44 : 22), 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = splash ? (hit.color || "#d9f5ff") : "#ffe27a";
    ctx.lineWidth = 2;
    for (let k = 0; k < 6; k++) {
      const a = (splash ? -Math.PI / 2 : (hit.nx != null ? Math.atan2(hit.ny, hit.nx) : 0)) + k * Math.PI / 3;
      const r0 = (splash ? 7 : 4) + u * (splash ? 12 : 6), r1 = (splash ? 18 : 14) + u * (splash ? 36 : 18);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.restore();
  }
}
function decayFx(dt) {
  camKick = Math.max(0, camKick - dt);
  for (let i = impacts.length - 1; i >= 0; i--) {
    impacts[i].t -= dt;
    if (impacts[i].t <= 0) impacts.splice(i, 1);
  }
}
function draw() {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (camKick > 0) {
    const mag = camKick * 62;
    const t = last * 0.06;
    ctx.translate(
      Math.cos(camAng) * mag * Math.cos(t),
      Math.sin(camAng) * mag * Math.sin(t * 1.35)
    );
  }
  drawStage();
  drawImpacts();
  drawPlayer(p1);
  drawPlayer(p2);
  ctx.restore();
}
function tick(t) {
  const dt = Math.min(0.033, (t - last) / 1000);
  last = t;
  if (slot === 1 && p1) {
    if (mode === "breath") {
      decayFx(dt);
      bannerT -= dt;
      if (bannerT <= 0) { mode = "play"; setBanner(""); }
    } else if (mode === "play") {
      advanceDrain(dt);
      if (hitstop > 0) {
        hitstop = Math.max(0, hitstop - dt);
        if (p1) p1.cd = Math.max(0, p1.cd - dt);
        if (p2) p2.cd = Math.max(0, p2.cd - dt);
        if (hitstop <= 0) {
          if (pendingKick) {
            kickCam(pendingKick.x, pendingKick.y);
            pendingKick = null;
          }
          stepPlayer(p1, dt); stepPlayer(p2, dt); separate(p1, p2);
          if (!p1.alive && !p2.alive) { addSplash(p1); addSplash(p2); startBreath("Draw"); }
          else if (!p1.alive) roundOver(p1);
          else if (!p2.alive) roundOver(p2);
        }
      } else {
        decayFx(dt);
        const a = tryShove(p1, p2), b = tryShove(p2, p1);
        const hit = a || b;
        if (hit) {
          hitstop = HITSTOP;
          pendingKick = hit;
          playBass();
        } else {
          stepPlayer(p1, dt); stepPlayer(p2, dt); separate(p1, p2);
          if (!p1.alive && !p2.alive) { addSplash(p1); addSplash(p2); startBreath("Draw"); }
          else if (!p1.alive) roundOver(p1);
          else if (!p2.alive) roundOver(p2);
        }
      }
    } else {
      decayFx(dt);
    }
    snapAcc += dt;
    if (snapAcc >= 1 / SNAP_HZ) { snapAcc = 0; send({ t: "state", ...packState() }); }
  } else if (slot === 2) {
    decayFx(dt);
    const k = 1 - Math.exp(-18 * dt);
    if (hostSnap && p1 && p2) { lerpToward(p1, hostSnap.p1, k); lerpToward(p2, hostSnap.p2, k); }
    if (p2 && p2.alive && mode === "play" && hitstop <= 0) {
      const dir = localDir();
      if (dir.x || dir.y) p2.facing = Math.atan2(dir.y, dir.x);
      p2.vx += dir.x * SPEED * dt * 6; p2.vy += dir.y * SPEED * dt * 6;
      p2.vx *= Math.max(0, 1 - FRICTION * dt); p2.vy *= Math.max(0, 1 - FRICTION * dt);
      const sp = Math.hypot(p2.vx, p2.vy);
      if (sp > 420) { p2.vx *= 420 / sp; p2.vy *= 420 / sp; }
      p2.x += p2.vx * dt; p2.y += p2.vy * dt;
    }
    snapAcc += dt;
    if (snapAcc >= 1 / SNAP_HZ) {
      snapAcc = 0;
      const d = localDir();
      send({ t: "in", x: d.x, y: d.y, shove: localShove() });
    }
  }
  updateShoveBtn();
  draw();
  requestAnimationFrame(tick);
}
function newFight() {
  if (mode === "over" && meYes() && theyYes()) return;
  const oldConn = conn, oldPeer = peer;
  conn = null; peer = null;
  showEndplay(false);
  setBanner("");
  try { if (oldConn) oldConn.close(); } catch (e) {}
  try { if (oldPeer) oldPeer.destroy(); } catch (e) {}
  slot = 0; p1 = p2 = null; mode = ""; incomingPending = false;
  clearTimeout(joinAcceptT); joinAcceptT = 0; joiningCode = ""; setJoinBusy(false); setHostBusy(false);
  clearHostPersist();
  document.getElementById("game").classList.remove("on");
  document.getElementById("lobby").classList.remove("hid", "waiting");
  document.getElementById("codebig").hidden = true;
  document.getElementById("codebig").textContent = "";
  document.getElementById("wait").hidden = true;
  document.getElementById("copylink").hidden = true;
  document.getElementById("roomhud").textContent = "";
  const u = new URL(location.href);
  u.searchParams.delete("room");
  history.replaceState(null, "", u);
}
function bootNet() {
  if (document.getElementById("game").classList.contains("on")) return;
  if (slot === 1 && peer && !peer.destroyed && !peer.disconnected) return;
  const q = normalizeCode(new URLSearchParams(location.search).get("room"));
  const saved = readHostPersist();
  if (saved && (!q || q === saved.code)) {
    slot = 1;
    showHostCode(saved.code);
    ensureHostBroker();
    return;
  }
  if (q) {
    document.getElementById("codein").value = q;
    joinRoom(q);
  }
}
document.getElementById("create").onclick = () => hostRoom();
document.getElementById("join").onclick = () => joinRoom(document.getElementById("codein").value);
document.getElementById("copylink").onclick = () => {
  if (!code) return;
  const url = roomLink().toString();
  const btn = document.getElementById("copylink");
  const confirmCopy = text => {
    btn.textContent = text;
    setTimeout(() => { btn.textContent = "Copy link"; }, 1400);
  };
  if (navigator.share) {
    navigator.share({ title: "Shove", text: "Join " + code, url })
      .then(() => confirmCopy("Shared"))
      .catch(() => navigator.clipboard.writeText(url).then(() => confirmCopy("Copied")).catch(() => showErr("Could not copy the link.")));
    return;
  }
  navigator.clipboard.writeText(url).then(() => confirmCopy("Copied")).catch(() => showErr("Could not copy the link."));
};
document.getElementById("rematch").onclick = () => {
  if (mode !== "over" || declinedBy) return;
  if (iSaidYes || document.getElementById("rematch").disabled) return;
  noteLocalYes();
  if (slot === 1) wantRematch(1);
  else send({ t: "rematch" });
  if (mode === "over") syncEndChrome();
};
document.getElementById("accept").onclick = () => {
  if (mode !== "over" || declinedBy) return;
  if (iSaidYes) return;
  noteLocalYes();
  if (slot === 1) wantRematch(1);
  else send({ t: "rematch" });
  if (mode === "over") syncEndChrome();
};
document.getElementById("decline").onclick = declineRematch;
document.getElementById("newfight").onclick = newFight;
addEventListener("pageshow", e => { if (e.persisted) bootNet(); });
addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") { releaseControls(); return; }
  if (!hostIsWaiting() && !(readHostPersist() && slot === 1)) return;
  if (hostBrokerDown()) ensureHostBroker();
});
last = performance.now();
requestAnimationFrame(tick);
bootNet();
