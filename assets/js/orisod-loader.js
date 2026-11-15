// Loads a vendored library the first time the page needs it, not with the page. The page declares its
// libraries in ORISOD_LIBS, written as plain JSON so scripts/check_vendor.py can read every path:
//   "name": {"src": "/assets/vendor/...js", "global": "nameOnWindow", "timeoutMs": 60000, "blocks": true}
// and, for PDF.js only, "pdfjsWorker": "/assets/vendor/pdfjs/<version>/pdf.worker.min.js".
// orisodLoad(name) returns one promise shared by every caller until the library has loaded or failed:
//   blocks: true   it rejects when the library can't load, so the action that needs it stops;
//   blocks: false  it resolves null instead, so the page carries on without it.
// The page reports a failure with its own words in its own status and error lines. A failure (an error,
// or nothing after timeoutMs) is forgotten, so the next call tries again. orisodLoaded(name) is true once
// the library has loaded.
// With pdfjsWorker, the page starts the worker itself and, once the worker has sent its first message,
// resolves new pdfjsLib.PDFWorker({ port }), which the page passes as the worker for every PDF it opens. Left to
// itself, PDF.js 3.11 switches to its main-thread fallback for the rest of the page's life after one
// worker fails to load, so a retry could never start a real worker again.
const orisodLoads = {};
function orisodLoaded(name) {
  return Boolean(orisodLoads[name] && orisodLoads[name].loaded);
}
function orisodLoad(name) {
  const lib = ORISOD_LIBS[name];
  const state = orisodLoads[name] || (orisodLoads[name] = { ready: null, loaded: false });
  if (state.ready) return state.ready;
  const ready = new Promise((resolve, reject) => {
    let script = null, webWorker = null, done = false;
    const fail = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (script) script.remove();
      if (webWorker) webWorker.terminate();
      reject(err);
    };
    const succeed = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      state.loaded = true;
      resolve(value);
    };
    const timer = setTimeout(() => fail(new Error(name + ' took too long to load')), lib.timeoutMs);
    const start = () => {
      if (done) return;
      const global = window[lib.global];
      if (!lib.pdfjsWorker) return succeed(global);
      global.GlobalWorkerOptions.workerSrc = lib.pdfjsWorker;
      webWorker = new Worker(global.GlobalWorkerOptions.workerSrc);
      webWorker.addEventListener('error', () => fail(new Error(name + ' worker could not load')), { once: true });
      webWorker.addEventListener('message', () => succeed(new global.PDFWorker({ port: webWorker })), { once: true });
    };
    // A load that timed out may still have run the library; then it's used as is.
    if (window[lib.global]) return start();
    script = document.createElement('script');
    script.src = lib.src;
    script.onload = () => (window[lib.global] ? start() : fail(new Error(name + ' did not start')));
    script.onerror = () => fail(new Error(name + ' could not load'));
    document.body.appendChild(script);
  });
  state.ready = ready.catch((err) => {
    state.ready = null;
    if (lib.blocks) throw err;
    return null;
  });
  return state.ready;
}
