// fake-idb.mjs — a minimal in-memory IndexedDB (open, get, put, delete, getAllKeys) for the key store's tests: the subset store.mjs uses, with the parts of
// the real semantics that matter to it, and stricter where strictness catches a bug:
//   · values are STRUCTURED-CLONED on put and on get (so a CryptoKey goes through the same clone the browser does, and
//     a test can check it comes back non-extractable and still signs);
//   · events fire asynchronously, a transaction is active only while its creating task or a request callback runs —
//     a request issued after awaiting something else throws TransactionInactiveError, exactly the bug real IndexedDB
//     punishes; a transaction commits when its last request's callbacks issue no more;
//   · writes are staged and land only at commit; an error aborts the whole transaction and nothing lands;
//   · readonly transactions refuse writes; overlapping readwrite transactions are refused outright (the store serialises
//     its calls — if two ever overlapped, the test should fail, not quietly last-writer-win);
//   · fail(op, key, value) → true makes that request fail (QuotaExceededError), for the no-data-loss tests;
//   · open() can be made to fail (failOpen), and raw(name) exposes the committed data so a test can read or tamper with
//     exactly what sits "on disk".
const later = (fn) => (typeof setImmediate === 'function' ? setImmediate(fn) : setTimeout(fn, 0));   // a new task, as IndexedDB events are
const err = (name, message = name) => Object.assign(new Error(message), { name });

export function fakeIndexedDB(opts = {}) {
  const fail = opts.fail || (() => false);   // read per request, and failOpen per open, so a test can flip them
  const dbs = new Map();   // name -> { version, stores: Map<storeName, Map<key, value>>, writing: false }

  function open(name, version) {
    const r = { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
    later(() => {
      if (opts.failOpen) { r.error = err('UnknownError', 'fake: open failed'); if (r.onerror) r.onerror({ target: r }); return; }
      const d = dbs.get(name) || { version: 0, stores: new Map(), writing: false };
      dbs.set(name, d);
      const conn = connection(d);
      r.result = conn;
      if (version > d.version) {
        const old = d.version;
        d.version = version;
        conn._upgrading = true;
        if (r.onupgradeneeded) r.onupgradeneeded({ target: r, oldVersion: old, newVersion: version });
        conn._upgrading = false;
      }
      if (r.onsuccess) r.onsuccess({ target: r });
    });
    return r;
  }

  function connection(d) {
    return {
      _upgrading: false,
      closed: false,
      objectStoreNames: { contains: (n) => d.stores.has(n) },
      createObjectStore(n) {
        if (!this._upgrading) throw err('InvalidStateError', 'fake: createObjectStore outside an upgrade');
        d.stores.set(n, new Map());
        return {};
      },
      transaction(names, mode = 'readonly') {
        if (this.closed) throw err('InvalidStateError', 'fake: connection closed');
        const list = [].concat(names);
        for (const n of list) if (!d.stores.has(n)) throw err('NotFoundError', 'fake: no store ' + n);
        if (mode === 'readwrite') {
          if (d.writing) throw err('InvalidStateError', 'fake: overlapping readwrite transactions');
          d.writing = true;
        }
        return transaction(d, list, mode);
      },
      close() { this.closed = true; },
    };
  }

  function transaction(d, names, mode) {
    const staged = new Map(names.map((n) => [n, new Map(d.stores.get(n))]));
    const pending = [];
    let active = true, finished = false, scheduled = false;
    const t = { mode, error: null, oncomplete: null, onerror: null, onabort: null, objectStore };
    const deactivate = () => later(() => { active = false; });
    deactivate();   // active for the rest of the task that made it

    function finish(ok) {
      if (finished) return;
      finished = true;
      active = false;
      if (mode === 'readwrite') d.writing = false;
      if (ok) {
        for (const [n, m] of staged) { const live = d.stores.get(n); live.clear(); for (const [k, v] of m) live.set(k, v); }   // in place: raw() stays live
        if (t.oncomplete) t.oncomplete({ target: t });
      } else {
        if (t.onerror) t.onerror({ target: t });
        if (t.onabort) t.onabort({ target: t });
      }
    }
    function pump() {
      if (scheduled) return;
      scheduled = true;
      later(() => {
        scheduled = false;
        if (finished) return;
        if (!pending.length) { finish(true); return; }
        active = true;
        const batch = pending.splice(0);
        for (const job of batch) {
          if (finished) return;
          try {
            job.req.result = job.run();
            if (job.req.onsuccess) job.req.onsuccess({ target: job.req });
          } catch (e) {
            job.req.error = e;
            t.error = e;
            if (job.req.onerror) job.req.onerror({ target: job.req });
            finish(false);
            return;
          }
        }
        deactivate();
        pump();
      });
    }
    function request(run, write) {
      if (finished || !active) throw err('TransactionInactiveError', 'fake: the transaction is not active');
      if (write && mode !== 'readwrite') throw err('ReadOnlyError', 'fake: write in a readonly transaction');
      const req = { result: undefined, error: null, onsuccess: null, onerror: null };
      pending.push({ req, run });
      pump();
      return req;
    }
    const key = (k) => { if (typeof k !== 'string' && typeof k !== 'number') throw err('DataError', 'fake: bad key'); return k; };
    function objectStore(n) {
      const m = staged.get(n);
      if (!m) throw err('NotFoundError', 'fake: store not in this transaction');
      return {
        get: (k) => { key(k); return request(() => (m.has(k) ? structuredClone(m.get(k)) : undefined), false); },
        put: (v, k) => {
          key(k);
          const copy = structuredClone(v);   // DataCloneError is thrown here, synchronously, as in a browser
          return request(() => { if (fail('put', k, v)) throw err('QuotaExceededError', 'fake: quota'); m.set(k, copy); return k; }, true);
        },
        getAllKeys: () => request(() => [...m.keys()].sort(), false),
        delete: (k) => { key(k); return request(() => { if (fail('delete', k)) throw err('QuotaExceededError', 'fake: quota'); m.delete(k); return undefined; }, true); },
      };
    }
    pump();   // a transaction with no requests still completes
    return t;
  }

  return {
    open,
    /** The committed data of one database's object store (default 'kv'): what sits "on disk". Tests read and tamper. */
    raw: (name, store = 'kv') => { const d = dbs.get(name); return d ? d.stores.get(store) : undefined; },
    names: () => [...dbs.keys()],
  };
}
