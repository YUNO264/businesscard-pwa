// OpenCV.js runtime bootstrap.
// Loaded before vendor/opencv.js. Supports both Module callback and Promise-typed `cv`.
(() => {
  let resolveReady;
  let rejectReady;
  let settled = false;

  window.OpenCVReady = new Promise((resolve, reject) => {
    resolveReady = value => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    rejectReady = error => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
  });

  const previousModule = window.Module || {};
  const previousCallback = previousModule.onRuntimeInitialized;

  window.Module = {
    ...previousModule,
    onRuntimeInitialized() {
      try {
        previousCallback?.();
        if (window.cv?.Mat) return resolveReady(window.cv);
        if (window.Module?.Mat) {
          window.cv = window.Module;
          return resolveReady(window.cv);
        }
        // Some official builds expose `cv` as a Promise. preprocess.js will await it.
      } catch (e) {
        rejectReady(e);
      }
    }
  };

  window.__resolveOpenCVReady = resolveReady;
  window.__rejectOpenCVReady = rejectReady;

  window.addEventListener("error", ev => {
    if ((ev?.filename || "").includes("opencv")) {
      rejectReady(new Error("OpenCV.jsの読み込みに失敗しました。"));
    }
  });
})();
