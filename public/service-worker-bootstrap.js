if ('serviceWorker' in navigator && location.protocol === 'https:') {
  (function () {
    var hadController = !!navigator.serviceWorker.controller;

    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (hadController) {
        location.reload();
      }
    });

    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (reg && reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    });
  })();
}
