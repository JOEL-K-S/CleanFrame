/* CleanFrame USB Media Discovery & Zero-Flicker Dual-Buffer Motion Controller.
   Scans mounted removable storage (USB drives) for photos and drives smooth
   hardware-accelerated Ken Burns crossfades across dual photo buffers.
   ES5-compatible for Samsung Tizen TV. */
(function () {
  'use strict';

  var IMAGE_EXT_REGEX = /\.(jpe?g|png|webp)$/i;
  var MAX_DEPTH = 3;
  var MAX_PHOTOS = 200;

  var state = {
    supported: !!(window.tizen && window.tizen.filesystem),
    connected: false,
    storages: [],
    photos: [],
    listeners: [],
    scanning: false,
    lastScan: 0,
    motionActive: false,
    timer: 0,
    currentIndex: 0,
    activeBufferIndex: 0,
    intervalMs: 20000,
    useMotion: true
  };

  var buffers = null;

  function notify() {
    for (var i = 0; i < state.listeners.length; i++) {
      try {
        state.listeners[i]({
          connected: state.connected,
          storages: state.storages.slice(),
          photos: state.photos.slice(),
          scanning: state.scanning,
          motionActive: state.motionActive
        });
      } catch (err) {
        if (window.console && console.error) console.error('[CleanFrame USB] listener error', err);
      }
    }
  }

  function getFs() {
    return window.tizen && window.tizen.filesystem;
  }

  function getBuffers() {
    if (!buffers) {
      var a = document.getElementById('photo');
      var b = document.getElementById('photoAlt');
      if (a && b) {
        buffers = [a, b];
      }
    }
    return buffers;
  }

  /* Scan a single directory recursively up to MAX_DEPTH */
  function scanDirectory(dir, depth, onComplete) {
    if (depth > MAX_DEPTH || state.photos.length >= MAX_PHOTOS) {
      onComplete();
      return;
    }

    try {
      dir.listFiles(function (files) {
        if (!files || !files.length) {
          onComplete();
          return;
        }

        var pending = files.length;
        function step() {
          pending--;
          if (pending <= 0) onComplete();
        }

        for (var i = 0; i < files.length; i++) {
          var f = files[i];
          if (f.isDirectory) {
            scanDirectory(f, depth + 1, step);
          } else if (f.isFile && IMAGE_EXT_REGEX.test(f.name)) {
            var uri = '';
            try { uri = f.toURI(); } catch (e) { uri = f.fullPath; }
            if (uri) {
              state.photos.push({
                name: f.name,
                uri: uri,
                fullPath: f.fullPath,
                fileSize: f.fileSize || 0
              });
            }
            step();
          } else {
            step();
          }
        }
      }, function () {
        onComplete();
      });
    } catch (e) {
      onComplete();
    }
  }

  /* Scan a specific storage device */
  function scanStorage(storage, onDone) {
    var fs = getFs();
    if (!fs) { onDone(); return; }

    try {
      fs.getStorage(storage.label, function (root) {
        scanDirectory(root, 0, onDone);
      }, function () {
        onDone();
      });
    } catch (e) {
      onDone();
    }
  }

  /* Full scan of all mounted removable / external storages */
  function scan(callback) {
    var fs = getFs();
    if (!fs) {
      state.supported = false;
      state.connected = false;
      state.photos = [];
      notify();
      if (callback) callback(state.photos);
      return;
    }

    state.scanning = true;
    notify();

    fs.listStorages(function (storageList) {
      var removable = [];
      for (var i = 0; i < storageList.length; i++) {
        var s = storageList[i];
        if ((s.type === 'REMOVABLE' || s.type === 'EXTERNAL') && s.state === 'MOUNTED') {
          removable.push(s);
        }
      }

      state.storages = removable;
      state.connected = removable.length > 0;
      state.photos = [];

      if (!removable.length) {
        state.scanning = false;
        state.lastScan = Date.now();
        if (state.motionActive) stopMotion();
        notify();
        if (callback) callback([]);
        return;
      }

      var pending = removable.length;
      function doneStorage() {
        pending--;
        if (pending <= 0) {
          state.scanning = false;
          state.lastScan = Date.now();
          notify();
          if (callback) callback(state.photos);
        }
      }

      for (var j = 0; j < removable.length; j++) {
        scanStorage(removable[j], doneStorage);
      }
    }, function () {
      state.scanning = false;
      notify();
      if (callback) callback([]);
    });
  }

  /* ---------- Dual-Buffer Zero-Flicker Crossfade Engine ---------- */

  function transitionToNextPhoto() {
    if (!state.motionActive || !state.photos.length) return;

    var bufs = getBuffers();
    if (!bufs) return;

    var incomingBufferIndex = (state.activeBufferIndex === 0) ? 1 : 0;
    var outgoing = bufs[state.activeBufferIndex];
    var incoming = bufs[incomingBufferIndex];

    var photo = state.photos[state.currentIndex];
    state.currentIndex = (state.currentIndex + 1) % state.photos.length;

    // Pre-decode incoming image in background
    var preloader = new Image();
    preloader.onload = function () {
      if (!state.motionActive) return;

      // Assign verified decoded source to incoming buffer
      incoming.src = photo.uri;

      // Alternate Ken Burns animation classes
      incoming.classList.remove('motion-1', 'motion-2');
      if (state.useMotion) {
        var motionClass = (incomingBufferIndex === 0) ? 'motion-1' : 'motion-2';
        incoming.classList.add(motionClass);
      }

      // Smooth crossfade: incoming fades in, outgoing fades out
      incoming.classList.remove('is-hidden');
      incoming.classList.add('is-active');

      outgoing.classList.remove('is-active');
      outgoing.classList.add('is-hidden');

      state.activeBufferIndex = incomingBufferIndex;

      // Schedule next slide
      clearTimeout(state.timer);
      state.timer = setTimeout(transitionToNextPhoto, state.intervalMs);
    };

    preloader.onerror = function () {
      // If photo fails to load, skip to next without interrupting current display
      if (state.motionActive) {
        clearTimeout(state.timer);
        state.timer = setTimeout(transitionToNextPhoto, 1000);
      }
    };

    preloader.src = photo.uri;
  }

  function startMotion(options) {
    var opts = options || {};
    if (opts.intervalMs) state.intervalMs = Math.max(5000, opts.intervalMs);
    if (opts.motion !== undefined) state.useMotion = !!opts.motion;

    if (!state.photos.length) {
      scan(function (photos) {
        if (photos.length) startMotion(opts);
      });
      return;
    }

    var bufs = getBuffers();
    if (!bufs) return;

    state.motionActive = true;
    clearTimeout(state.timer);

    // Initial setup: primary buffer active
    bufs[0].classList.add('is-active');
    bufs[0].classList.remove('is-hidden');
    bufs[1].classList.add('is-hidden');
    bufs[1].classList.remove('is-active');
    state.activeBufferIndex = 0;

    transitionToNextPhoto();
    notify();
  }

  function stopMotion() {
    state.motionActive = false;
    clearTimeout(state.timer);
    state.timer = 0;

    var bufs = getBuffers();
    if (bufs) {
      bufs[0].classList.remove('motion-1', 'motion-2', 'is-hidden');
      bufs[0].classList.add('is-active');
      bufs[1].classList.remove('motion-1', 'motion-2', 'is-active');
      bufs[1].classList.add('is-hidden');
    }
    notify();
  }

  /* Initialize listeners for dynamic USB connect / disconnect */
  function init() {
    var fs = getFs();
    if (!fs) return;

    try {
      fs.addStorageStateChangeListener(function () {
        scan();
      });
    } catch (e) {}

    scan();
  }

  window.CleanFrameUSB = {
    init: init,
    scan: scan,
    startMotion: startMotion,
    stopMotion: stopMotion,
    isAvailable: function () { return state.supported; },
    isConnected: function () { return state.connected; },
    isMotionActive: function () { return state.motionActive; },
    getPhotos: function () { return state.photos.slice(); },
    getStorages: function () { return state.storages.slice(); },
    onChange: function (fn) {
      if (typeof fn === 'function') {
        state.listeners.push(fn);
        fn({
          connected: state.connected,
          storages: state.storages.slice(),
          photos: state.photos.slice(),
          scanning: state.scanning,
          motionActive: state.motionActive
        });
      }
    }
  };

  if (window.tizen && window.tizen.filesystem) {
    init();
  }
}());
