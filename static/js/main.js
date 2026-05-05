/* ─── VoiceRemover · main.js ────────────────────────────────── */

(function () {
  'use strict';

  /* ── State ──────────────────────────────────────────────────── */
  let currentSessionId = null;
  const waveSurfers = {};
  const audioCtx = {};    // mute-via-gain
  const gainNodes = {};
  let activeTrack = null; // track name currently playing

  /* ── Elements ───────────────────────────────────────────────── */
  const dropZone          = document.getElementById('dropZone');
  const fileInput         = document.getElementById('fileInput');
  const uploadCard        = document.getElementById('uploadCard');
  const uploadProgress    = document.getElementById('uploadProgress');
  const fileNameLabel     = document.getElementById('fileNameLabel');
  const progressBar       = document.getElementById('progressBar');
  const progressPct       = document.getElementById('progressPct');
  const progressStatus    = document.getElementById('progressStatus');
  const processingOverlay = document.getElementById('processingOverlay');
  const processingStatus  = document.getElementById('processingStatus');
  const resultsSection    = document.getElementById('resultsSection');
  const resetBtn          = document.getElementById('resetBtn');
  const heroSection       = document.querySelector('.hero');

  /* ── Toast helper ───────────────────────────────────────────── */
  function showToast(msg, type = '') {
    let toast = document.querySelector('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className = 'toast ' + type;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => toast.classList.add('show'));
    });
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  /* ── Drag-and-drop ──────────────────────────────────────────── */
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadCard.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    uploadCard.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadCard.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  /* ── File validation ────────────────────────────────────────── */
  const ALLOWED = ['mp3', 'wav', 'flac', 'ogg', 'm4a'];

  function getExt(name) {
    return name.split('.').pop().toLowerCase();
  }

  function handleFile(file) {
    const ext = getExt(file.name);
    if (!ALLOWED.includes(ext)) {
      showToast('Unsupported file type. Use mp3, wav, flac, ogg or m4a.', 'error');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      showToast('File is too large (max 50 MB).', 'error');
      return;
    }
    uploadFile(file);
  }

  /* ── Upload ─────────────────────────────────────────────────── */
  function uploadFile(file) {
    // Switch upload card to progress view
    dropZone.style.display = 'none';
    uploadProgress.style.display = 'block';
    fileNameLabel.textContent = file.name.length > 30
      ? file.name.slice(0, 27) + '…'
      : file.name;

    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload');

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        progressBar.style.width = pct + '%';
        progressPct.textContent = pct + '%';
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status === 200) {
        const data = JSON.parse(xhr.responseText);
        currentSessionId = data.session_id;
        progressStatus.textContent = 'Upload complete — starting analysis…';
        setTimeout(() => startProcessing(), 600);
      } else {
        let msg = 'Upload failed.';
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch (_) {}
        showToast(msg, 'error');
        resetUploadCard();
      }
    });

    xhr.addEventListener('error', () => {
      showToast('Network error during upload.', 'error');
      resetUploadCard();
    });

    xhr.send(formData);
  }

  /* ── Processing ─────────────────────────────────────────────── */
  const steps = [
    { id: 'step1', label: 'Upload complete', delay: 0     },
    { id: 'step2', label: 'Analysing audio', delay: 600   },
    { id: 'step3', label: 'Separating stems', delay: 1800 },
    { id: 'step4', label: 'Finalising tracks', delay: 3000 },
  ];

  const statusMessages = [
    'Analysing frequency spectrum…',
    'Running spectral separation…',
    'Reconstructing vocal track…',
    'Reconstructing accompaniment…',
    'Polishing output…',
  ];

  function startProcessing() {
    processingOverlay.style.display = 'flex';

    // Animate steps
    steps.forEach(({ id }, i) => {
      const el = document.getElementById(id);
      el.classList.remove('active', 'done');
      if (i === 0) el.classList.add('done');
    });

    let msgIdx = 0;
    const msgInterval = setInterval(() => {
      msgIdx = (msgIdx + 1) % statusMessages.length;
      processingStatus.textContent = statusMessages[msgIdx];
    }, 1200);

    // Advance steps visually
    for (let i = 1; i < steps.length; i++) {
      const { id, delay } = steps[i];
      setTimeout(() => {
        const prev = document.getElementById(steps[i - 1].id);
        if (prev) { prev.classList.remove('active'); prev.classList.add('done'); }
        const curr = document.getElementById(id);
        if (curr) curr.classList.add('active');
      }, delay);
    }

    // Actual API call
    fetch(`/process/${currentSessionId}`, { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        clearInterval(msgInterval);
        if (data.error) {
          showToast(data.error, 'error');
          processingOverlay.style.display = 'none';
          resetUploadCard();
          return;
        }
        // Mark all steps done
        steps.forEach(({ id }) => {
          const el = document.getElementById(id);
          el.classList.remove('active');
          el.classList.add('done');
        });
        processingStatus.textContent = 'Done!';
        setTimeout(() => showResults(data), 700);
      })
      .catch(() => {
        clearInterval(msgInterval);
        showToast('Processing failed — please try again.', 'error');
        processingOverlay.style.display = 'none';
        resetUploadCard();
      });
  }

  /* ── Show results ───────────────────────────────────────────── */
  function showResults(data) {
    processingOverlay.style.display = 'none';
    heroSection.style.display = 'none';
    resultsSection.style.display = 'block';
    resultsSection.scrollIntoView({ behavior: 'smooth' });

    const tracks = data.tracks;

    // Set download links
    document.getElementById('vocalsDownload').href        = tracks.vocals + '?dl=1';
    document.getElementById('accompanimentDownload').href = tracks.accompaniment + '?dl=1';

    // Build WaveSurfer instances
    buildWaveSurfer('vocals',        tracks.vocals);
    buildWaveSurfer('accompaniment', tracks.accompaniment);

    showToast('Separation complete!', 'success');
  }

  /* ── WaveSurfer ─────────────────────────────────────────────── */
  function buildWaveSurfer(trackName, url) {
    // Destroy existing
    if (waveSurfers[trackName]) {
      waveSurfers[trackName].destroy();
    }

    const colors = {
      vocals:        { wave: '#8B5CF6', progress: '#c4b5fd', cursor: '#fff' },
      accompaniment: { wave: '#EC4899', progress: '#f9a8d4', cursor: '#fff' },
    };
    const c = colors[trackName];

    const ws = WaveSurfer.create({
      container:     `#${trackName}Waveform`,
      waveColor:     c.wave,
      progressColor: c.progress,
      cursorColor:   c.cursor,
      barWidth:      2,
      barGap:        2,
      barRadius:     2,
      height:        80,
      backend:       'WebAudio',
      normalize:     true,
      interact:      true,
    });

    ws.load(url);

    ws.on('ready', () => {
      console.log(`[${trackName}] WaveSurfer ready`);
    });

    ws.on('finish', () => {
      togglePlayState(trackName, false);
      activeTrack = null;
    });

    waveSurfers[trackName] = ws;

    // Play button
    const playBtn  = document.getElementById(`${trackName}Play`);
    const iconPlay  = playBtn.querySelector('.icon-play');
    const iconPause = playBtn.querySelector('.icon-pause');
    const playLabel = playBtn.querySelector('.play-label');

    playBtn.addEventListener('click', () => {
      if (!ws.isReady) return;

      const isPlaying = ws.isPlaying();

      if (isPlaying) {
        ws.pause();
        togglePlayState(trackName, false);
        activeTrack = null;
      } else {
        // Pause other track if playing
        if (activeTrack && activeTrack !== trackName && waveSurfers[activeTrack]) {
          waveSurfers[activeTrack].pause();
          togglePlayState(activeTrack, false);
        }
        ws.play();
        togglePlayState(trackName, true);
        activeTrack = trackName;
      }
    });

    // Volume slider
    const volSlider = document.querySelector(`.volume-slider[data-track="${trackName}"]`);
    volSlider.addEventListener('input', () => {
      ws.setVolume(parseFloat(volSlider.value));
    });

    // Mute button
    const muteBtn = document.querySelector(`.mute-btn[data-track="${trackName}"]`);
    muteBtn.addEventListener('click', () => {
      const muted = muteBtn.classList.toggle('muted');
      ws.setMuted(muted);
    });
  }

  function togglePlayState(trackName, playing) {
    const playBtn   = document.getElementById(`${trackName}Play`);
    if (!playBtn) return;
    const iconPlay  = playBtn.querySelector('.icon-play');
    const iconPause = playBtn.querySelector('.icon-pause');
    const playLabel = playBtn.querySelector('.play-label');

    if (playing) {
      iconPlay.style.display  = 'none';
      iconPause.style.display = '';
      playLabel.textContent   = 'Pause';
    } else {
      iconPlay.style.display  = '';
      iconPause.style.display = 'none';
      playLabel.textContent   = 'Play';
    }
  }

  /* ── Reset ──────────────────────────────────────────────────── */
  function resetUploadCard() {
    dropZone.style.display = '';
    uploadProgress.style.display = 'none';
    progressBar.style.width = '0%';
    progressPct.textContent = '0%';
    progressStatus.textContent = 'Uploading…';
    fileInput.value = '';
    uploadCard.classList.remove('drag-over');
  }

  resetBtn.addEventListener('click', () => {
    // Destroy WaveSurfer instances
    Object.values(waveSurfers).forEach((ws) => { try { ws.destroy(); } catch (_) {} });
    Object.keys(waveSurfers).forEach((k) => delete waveSurfers[k]);
    activeTrack = null;
    currentSessionId = null;

    resultsSection.style.display = 'none';
    heroSection.style.display = '';
    resetUploadCard();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* ── Download link fix (inline stream → attachment via query) ── */
  document.addEventListener('click', (e) => {
    const a = e.target.closest('.btn-download');
    if (!a) return;
    const href = a.getAttribute('href');
    if (href && href.includes('?dl=1')) {
      // Swap stream URL for the /download endpoint
      const newHref = href.replace('/stream/', '/download/').replace('?dl=1', '');
      a.setAttribute('href', newHref);
    }
  });

})();
