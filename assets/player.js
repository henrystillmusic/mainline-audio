/* Mainline Audio — shared background music player.
 *
 * Used by every page that carries the background widget markup:
 *
 *   <audio id="bg-track" preload="auto"></audio>
 *   <div class="audio-widget" id="audio-widget"> ... </div>
 *
 * Pages without that markup simply do nothing. music.html deliberately opts out
 * of background playback (it runs its own foreground player and writes
 * mainlineAudioPlaying = "false" on unload); sync.html has its own WaveSurfer
 * cue player and is not part of this protocol. Neither loads this file.
 *
 * Behaviour is the canonical implementation established in cleanup Phase 1A:
 * if the previous page was playing, resume immediately; otherwise show the
 * widget and wait for the first click/touch, as browser autoplay rules require.
 */
(function () {
  if (window.__mainlinePlayerLoaded) return;
  window.__mainlinePlayerLoaded = true;

  const playlist = [
    { title: "Drift",                src: "/MAINLINE-AUDIO-SITE/MUSIC/SRS_Drift_Master_01.mp3" },
    { title: "Draped",               src: "/MAINLINE-AUDIO-SITE/MUSIC/SRS_Draped_Master_01.mp3" },
    { title: "Still Waters",         src: "/MAINLINE-AUDIO-SITE/MUSIC/SRS_Still_Waters_Master_01.mp3" },
    { title: "Weightless",           src: "/MAINLINE-AUDIO-SITE/MUSIC/SRS_Weightless_Master_01.mp3" },
    { title: "When the Mud Settles", src: "/MAINLINE-AUDIO-SITE/MUSIC/SRS_When_The_Mud_Settles.mp3" },
    { title: "Run Free",             src: "/MAINLINE-AUDIO-SITE/MUSIC/Henry_Still_Run_Free.mp3" },
  ];

  function shuffle(arr) {
    const s = [...arr];
    for (let i = s.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [s[i], s[j]] = [s[j], s[i]];
    }
    return s;
  }

  function start() {
    const audioWidget  = document.getElementById("audio-widget"),
          audio        = document.getElementById("bg-track"),
          muteBtn      = document.getElementById("mute-btn"),
          skipBtn      = document.getElementById("skip-btn"),
          wave1        = document.getElementById("wave-1"),
          wave2        = document.getElementById("wave-2"),
          nowPlaying   = document.getElementById("now-playing"),
          volumeSlider = document.getElementById("volume-slider");

    if (!audio || !audioWidget) return;

    let shuffled;
    try {
      const s = JSON.parse(localStorage.getItem("mainlineAudioOrder"));
      shuffled = Array.isArray(s) && s.every(t => playlist.some(p => p.title === t.title)) ? s : shuffle(playlist);
    } catch { shuffled = shuffle(playlist); }

    let trackIndex = parseInt(localStorage.getItem("mainlineAudioIndex"), 10);
    if (Number.isNaN(trackIndex) || trackIndex < 0 || trackIndex >= shuffled.length) trackIndex = 0;

    let savedTime   = parseFloat(localStorage.getItem("mainlineAudioTime")) || 0,
        savedVolume = parseFloat(localStorage.getItem("mainlineAudioVolume"));
    if (Number.isNaN(savedVolume)) savedVolume = 0.65;

    audio.volume = savedVolume;
    audio.muted  = localStorage.getItem("mainlineAudioMuted") === "true";
    volumeSlider.value = savedVolume;

    function updateNowPlaying() {
      const t = shuffled[trackIndex];
      nowPlaying.textContent = t ? `Now playing — ${t.title}` : "Now playing";
    }

    function updateMuteIcon() {
      const dim = "rgba(245,245,245,0.2)", bright = "rgba(245,245,245,0.7)";
      wave1.setAttribute("stroke", audio.muted ? dim : bright);
      wave2.setAttribute("stroke", audio.muted ? dim : bright);
      wave1.style.display = audio.muted ? "none" : "block";
      wave2.style.display = audio.muted ? "none" : "block";
    }

    function loadTrack(i) { audio.src = shuffled[i].src; audio.load(); updateNowPlaying(); }

    function saveAudioState() {
      localStorage.setItem("mainlineAudioOrder",  JSON.stringify(shuffled));
      localStorage.setItem("mainlineAudioIndex",  trackIndex);
      localStorage.setItem("mainlineAudioTime",   audio.currentTime || 0);
      localStorage.setItem("mainlineAudioMuted",  audio.muted);
      localStorage.setItem("mainlineAudioVolume", audio.volume);
    }

    function nextTrack() {
      trackIndex++; savedTime = 0;
      if (trackIndex >= shuffled.length) { shuffled = shuffle(playlist); trackIndex = 0; }
      loadTrack(trackIndex); audio.play(); saveAudioState();
    }

    audio.addEventListener("ended",      nextTrack);
    audio.addEventListener("timeupdate", saveAudioState);
    audio.addEventListener("error",      nextTrack);

    const wasPlaying = localStorage.getItem("mainlineAudioPlaying") === "true";
    function initPlayer(autoplay) {
      loadTrack(trackIndex);
      audio.addEventListener("loadedmetadata", () => {
        if (savedTime > 0 && savedTime < audio.duration) audio.currentTime = savedTime;
        if (autoplay) audio.play();
        saveAudioState();
      }, { once: true });
      audioWidget.classList.add("show"); updateMuteIcon(); updateNowPlaying();
    }

    if (wasPlaying) {
      initPlayer(true);
    } else {
      function startAudio() {
        initPlayer(true);
        document.removeEventListener("click", startAudio);
        document.removeEventListener("touchstart", startAudio);
      }
      audioWidget.classList.add("show"); updateNowPlaying();
      document.addEventListener("click", startAudio);
      document.addEventListener("touchstart", startAudio);
    }

    muteBtn.addEventListener("click", e => { e.stopPropagation(); audio.muted = !audio.muted; updateMuteIcon(); saveAudioState(); });
    skipBtn.addEventListener("click", e => { e.stopPropagation(); savedTime = 0; localStorage.setItem("mainlineAudioTime", 0); nextTrack(); });
    volumeSlider.addEventListener("click", e => e.stopPropagation());
    volumeSlider.addEventListener("input", e => {
      audio.volume = parseFloat(e.target.value);
      if (audio.volume > 0) audio.muted = false;
      updateMuteIcon(); saveAudioState();
    });

    window.addEventListener("beforeunload", () => {
      localStorage.setItem("mainlineAudioPlaying", !audio.paused && !audio.muted ? "true" : "false");
      saveAudioState();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
