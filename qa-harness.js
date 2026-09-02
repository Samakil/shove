const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync('index.html', 'utf8');
const script = fs.readFileSync('game.js', 'utf8');
assert.match(html, /<link rel="stylesheet" href="styles\.css">/, 'page should load the extracted stylesheet');
assert.match(html, /<script src="game\.js"><\/script>/, 'page should load the extracted game logic');
assert.ok(fs.readFileSync('styles.css', 'utf8').includes('.lobby'), 'stylesheet should contain the game layout');
assert.match(html, /id="cancelroom"/, 'waiting hosts should have a cancel-room control');
assert.match(html, /id="leave"/, 'players should have a leave-room control');
assert.doesNotMatch(html, /Again\?/, 'end screen should not show an Again heading');
assert.match(html, /id="newfight"[^>]*>Leave<\/button>/, 'end screen should offer Leave');

function classList() {
  const values = new Set();
  return {
    add: (...xs) => xs.forEach(x => values.add(x)),
    remove: (...xs) => xs.forEach(x => values.delete(x)),
    contains: x => values.has(x),
    toggle: (x, on) => on === undefined ? (values.has(x) ? (values.delete(x), false) : (values.add(x), true)) : (on ? values.add(x) : values.delete(x), !!on)
  };
}

function element(id) {
  return {
    id, classList: classList(), hidden: false, disabled: false, textContent: '', value: '', tagName: 'DIV', style: {},
    setAttribute() {}, addEventListener() {}, querySelector() { return element('child'); },
    getBoundingClientRect() { return {left:0, top:0, width:112, height:112}; }
  };
}

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const els = Object.fromEntries(ids.map(id => [id, element(id)]));
els.codein.tagName = 'INPUT';
const fakeContext = () => ({
  clearRect(){}, save(){}, restore(){}, translate(){}, rotate(){}, scale(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, arc(){}, ellipse(){}, fill(){}, clip(){},
  fillRect(){}, drawImage(){}, createRadialGradient(){ return {addColorStop(){}}; }
});
els.c.getContext = fakeContext;
class FakeImage { set src(value) { this.currentSrc = value; } }

class FakeConn {
  constructor() { this.open = false; this.handlers = {}; this.closed = false; this.sent = []; this.throwOnSend = false; }
  on(name, fn) { (this.handlers[name] ||= []).push(fn); }
  emit(name, value) { for (const fn of this.handlers[name] || []) fn(value); }
  send(value) { if (this.throwOnSend) throw new Error('send failed'); this.sent.push(value); }
  close() { this.closed = true; this.open = false; this.emit('close'); }
  openNow() { this.open = true; this.emit('open'); }
}
class FakePeer {
  constructor(id) { this.id = id; this.handlers = {}; this.destroyed = false; this.disconnected = false; FakePeer.latest = this; }
  on(name, fn) { (this.handlers[name] ||= []).push(fn); }
  emit(name, value) { for (const fn of this.handlers[name] || []) fn(value); }
  connect() { this.lastConn = new FakeConn(); return this.lastConn; }
  destroy() { this.destroyed = true; this.emit('close'); }
  reconnect() { this.disconnected = false; }
}

const storage = new Map();
const windowEvents = {};
const timers = new Map();
let nextTimer = 1;
function runTimersThrough(maxDelay) {
  const due = [...timers.entries()].filter(([, timer]) => timer.delay <= maxDelay).sort((a, b) => a[1].delay - b[1].delay);
  for (const [id, timer] of due) {
    if (!timers.delete(id)) continue;
    timer.fn();
  }
}
const context = vm.createContext({
  console, Peer: FakePeer, Image: FakeImage, URL, URLSearchParams, Math, JSON, performance: {now:()=>0},
  document: {
    body: els.body || element('body'), visibilityState: 'visible',
    getElementById: id => els[id], querySelector: sel => sel.startsWith('#') ? els[sel.slice(1)] : null,
    createElement(tag) { const el = element(tag); if (tag === 'canvas') el.getContext = fakeContext; return el; }
  },
  location: {href:'https://example.test/shove/'}, history: {replaceState(){}},
  navigator: {maxTouchPoints:0, clipboard:{writeText:()=>Promise.resolve()}},
  sessionStorage: {setItem:(k,v)=>storage.set(k,v), getItem:k=>storage.get(k)||null, removeItem:k=>storage.delete(k)},
  matchMedia: () => ({matches:false, addEventListener(){}}),
  addEventListener(name, fn){ (windowEvents[name] ||= []).push(fn); }, requestAnimationFrame(){},
  setTimeout(fn, delay = 0){ const id = nextTimer++; timers.set(id, {fn, delay}); return id; },
  clearTimeout(id){ timers.delete(id); },
});
vm.runInContext(script, context);

vm.runInContext('hostRoom("ABCD")', context);
FakePeer.latest.emit('open');
const first = new FakeConn();
FakePeer.latest.emit('connection', first);
first.openNow();
assert.equal(els.game.classList.contains('on'), true, 'first guest should start the game');
assert.equal(vm.runInContext('conn', context), first, 'first guest should own the connection');
assert.ok(storage.get('shove-host'), 'host identity should survive an in-game refresh');
assert.ok(first.sent.some(msg => msg.t === 'welcome'), 'accepted guest should receive an explicit welcome');
assert.equal(typeof els.cancelroom.onclick, 'function', 'cancel-room control should be wired');
assert.equal(typeof els.leave.onclick, 'function', 'leave-room control should be wired');

const second = new FakeConn();
FakePeer.latest.emit('connection', second);
second.openNow();
runTimersThrough(200);
assert.equal(second.closed, true, 'extra guest should be rejected');
assert.equal(vm.runInContext('conn', context), first, 'extra guest must not replace active guest');
assert.ok(second.sent.some(msg => msg.t === 'reject' && msg.reason === 'full'), 'extra guest should receive a room-full reason');

vm.runInContext('mode = "over"; rematchYes = [false, false]; iSaidYes = false; declinedBy = 0; showEndplay(true); wantRematch(2)', context);
assert.equal(els.endplay.classList.contains('reply'), true, 'a remote rematch request should show Accept and Decline');
els.accept.onclick();
assert.equal(vm.runInContext('mode', context), 'breath', 'accepting a rematch should start a fresh match');

vm.runInContext('mode = "play"; onMsg({t:"in", x:Infinity, y:"bad", shove:true})', context);
const remote = vm.runInContext('remoteIn', context);
assert.ok(Number.isFinite(remote.x) && Number.isFinite(remote.y), 'remote movement must stay finite');
assert.ok(Math.abs(remote.x) <= 1 && Math.abs(remote.y) <= 1, 'remote movement must be clamped');
for (const value of [undefined, null, NaN, Infinity, -Infinity, '1e999', {}, [], [2], 1e300, -1e300, 0.5]) {
  context.fuzzValue = value;
  vm.runInContext('onMsg({t:"in", x:fuzzValue, y:fuzzValue, shove:false})', context);
  const fuzzed = vm.runInContext('remoteIn', context);
  assert.ok(Number.isFinite(fuzzed.x) && Math.abs(fuzzed.x) <= 1, 'fuzzed x input must be safe');
  assert.ok(Number.isFinite(fuzzed.y) && Math.abs(fuzzed.y) <= 1, 'fuzzed y input must be safe');
}

vm.runInContext('keys.add("Space"); pad.shove = true; stick.x = 1; stick.y = -1; stick.pid = 9', context);
for (const fn of windowEvents.blur || []) fn({});
assert.equal(vm.runInContext('keys.size', context), 0, 'focus loss should release keyboard controls');
assert.equal(vm.runInContext('pad.shove', context), false, 'focus loss should release shove');
assert.equal(vm.runInContext('stick.pid', context), null, 'focus loss should release the stick');

first.throwOnSend = true;
assert.doesNotThrow(() => vm.runInContext('send({t:"state"})', context), 'a stale connection must not crash the game loop');

context.Peer = FakePeer;
vm.runInContext('newFight(); joinRoom("ABCD")', context);
let guestPeer = FakePeer.latest;
guestPeer.emit('open');
let guestConn = guestPeer.lastConn;
guestConn.openNow();
assert.equal(els.game.classList.contains('on'), false, 'guest must wait for host acceptance before entering');
guestConn.emit('data', {t:'welcome', code:'ABCD'});
assert.equal(els.game.classList.contains('on'), true, 'welcome should admit the guest');
assert.equal(vm.runInContext('slot', context), 2, 'welcomed guest should become player two');

vm.runInContext('newFight(); joinRoom("WXYZ")', context);
guestPeer = FakePeer.latest;
guestPeer.emit('open');
guestConn = guestPeer.lastConn;
guestConn.openNow();
guestConn.emit('data', {t:'reject', reason:'full'});
assert.match(els.err.textContent, /already in a match/i, 'rejected guest should see room-full feedback');
assert.equal(els.game.classList.contains('on'), false, 'rejected guest must remain in the lobby');

vm.runInContext('joinRoom("QWER")', context);
guestPeer = FakePeer.latest;
guestPeer.emit('open');
guestConn = guestPeer.lastConn;
guestConn.openNow();
runTimersThrough(3000);
assert.match(els.err.textContent, /did not accept/i, 'guest handshake should time out cleanly');
assert.equal(els.join.disabled, false, 'join controls should recover after a failed handshake');

context.Peer = FakePeer;
vm.runInContext('hostRoom("ABCD")', context);
const stalePeer = FakePeer.latest;
vm.runInContext('hostRoom("EFGH")', context);
const currentPeer = FakePeer.latest;
currentPeer.emit('open');
assert.equal(vm.runInContext('code', context), 'EFGH', 'newest host attempt should own the room code');
stalePeer.emit('open');
assert.equal(vm.runInContext('code', context), 'EFGH', 'stale open event must not replace the room code');
stalePeer.emit('error', {type:'unavailable-id'});
runTimersThrough(1000);
assert.equal(vm.runInContext('peer', context), currentPeer, 'stale peer error must not replace the current peer');
assert.equal(currentPeer.destroyed, false, 'stale peer error must not destroy the current room');

vm.runInContext('slot = 2; p1 = null; p2 = null; hostSnap = null', context);
assert.doesNotThrow(() => vm.runInContext('onMsg({t:"state"})', context), 'malformed initial state must not crash the guest');
assert.equal(vm.runInContext('hostSnap', context), null, 'malformed state should be ignored');
context.extremeState = {
  t:'state',
  p1:{x:1e300,y:-1e300,vx:1e300,vy:-1e300,facing:1e300,shoving:99,hit:99,cd:99,alive:true},
  p2:{x:360,y:248,vx:0,vy:0,facing:0,shoving:0,hit:0,cd:0,alive:true},
  s1:99,s2:-99,mode:'play',banner:'x'.repeat(500),bannerT:99,winner:99,camKick:99,camAng:1e300,
  impacts:Array.from({length:100},()=>({x:1e300,y:-1e300,nx:99,ny:-99,t:99})),want1:true,want2:false,hitstop:99,declinedBy:99
};
vm.runInContext('onMsg(extremeState)', context);
const safeState = vm.runInContext('hostSnap', context);
assert.ok(safeState && Number.isFinite(safeState.p1.x), 'extreme state should be sanitized');
assert.equal(safeState.s1, 3, 'score should be clamped to the winning limit');
assert.equal(safeState.s2, 0, 'negative score should be clamped');
assert.equal(safeState.impacts.length, 24, 'impact payload should be bounded');
assert.equal(safeState.banner.length, 80, 'banner payload should be bounded');

context.Peer = FakePeer;
vm.runInContext('newFight(); hostRoom("CANC")', context);
FakePeer.latest.emit('open');
assert.equal(els.cancelroom.hidden, false, 'waiting host should see Cancel room');
els.cancelroom.onclick();
assert.equal(vm.runInContext('slot', context), 0, 'Cancel room should release the host slot');
assert.equal(els.lobby.classList.contains('waiting'), false, 'Cancel room should return to the lobby');
assert.equal(els.cancelroom.hidden, true, 'Cancel room should hide after returning');

vm.runInContext('Peer = undefined; peer = null; hostRoom("WXYZ")', context);
assert.match(els.err.textContent, /failed to load/i, 'missing PeerJS should show a useful error');

console.log('QA harness: all checks passed');
