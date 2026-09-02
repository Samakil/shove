const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync('index.html', 'utf8');
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(Boolean)[0];

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
els.c.getContext = () => ({
  clearRect(){}, save(){}, restore(){}, translate(){}, rotate(){}, scale(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, arc(){}, ellipse(){}, fill(){}, clip(){},
  createRadialGradient(){ return {addColorStop(){}}; }
});

class FakeConn {
  constructor() { this.open = false; this.handlers = {}; this.closed = false; }
  on(name, fn) { (this.handlers[name] ||= []).push(fn); }
  emit(name, value) { for (const fn of this.handlers[name] || []) fn(value); }
  send() {}
  close() { this.closed = true; this.open = false; this.emit('close'); }
  openNow() { this.open = true; this.emit('open'); }
}
class FakePeer {
  constructor(id) { this.id = id; this.handlers = {}; this.destroyed = false; this.disconnected = false; FakePeer.latest = this; }
  on(name, fn) { (this.handlers[name] ||= []).push(fn); }
  emit(name, value) { for (const fn of this.handlers[name] || []) fn(value); }
  connect() { return new FakeConn(); }
  destroy() { this.destroyed = true; this.emit('close'); }
  reconnect() { this.disconnected = false; }
}

const storage = new Map();
const context = vm.createContext({
  console, Peer: FakePeer, URL, URLSearchParams, Math, JSON, performance: {now:()=>0},
  document: {
    body: els.body || element('body'), visibilityState: 'visible',
    getElementById: id => els[id], querySelector: sel => sel.startsWith('#') ? els[sel.slice(1)] : null
  },
  location: {href:'https://example.test/shove/'}, history: {replaceState(){}},
  navigator: {maxTouchPoints:0, clipboard:{writeText:()=>Promise.resolve()}},
  sessionStorage: {setItem:(k,v)=>storage.set(k,v), getItem:k=>storage.get(k)||null, removeItem:k=>storage.delete(k)},
  matchMedia: () => ({matches:false, addEventListener(){}}),
  addEventListener(){}, requestAnimationFrame(){}, setTimeout(){return 1}, clearTimeout(){},
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

const second = new FakeConn();
FakePeer.latest.emit('connection', second);
second.openNow();
assert.equal(second.closed, true, 'extra guest should be rejected');
assert.equal(vm.runInContext('conn', context), first, 'extra guest must not replace active guest');

vm.runInContext('Peer = undefined; peer = null; hostRoom("WXYZ")', context);
assert.match(els.err.textContent, /failed to load/i, 'missing PeerJS should show a useful error');

console.log('QA harness: all checks passed');
