// PHASE 9 — SOUND SYSTEM
// Web Audio API — no external files needed
// ─────────────────────────────────────────
let audioCtx     = null
let ambientNode  = null
let ambientGain  = null
let soundEnabled = true

function initAudio() {
  if (audioCtx) return
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  } catch (e) {
    soundEnabled = false
  }
}

// ── Ambient restaurant murmur ──
// Brown noise filtered to sound like distant conversation
function startAmbient() {
  if (!soundEnabled || !audioCtx) return
  if (ambientNode) return  // already running

  const bufferSize = audioCtx.sampleRate * 4
  const buffer     = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate)
  const data       = buffer.getChannelData(0)

  // Brown noise
  let lastOut = 0
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1
    data[i]  = (lastOut + (0.02 * white)) / 1.02
    lastOut  = data[i]
    data[i] *= 3.5
  }

  ambientNode = audioCtx.createBufferSource()
  ambientNode.buffer = buffer
  ambientNode.loop   = true

  // Low-pass filter — makes it sound like muffled conversation
  const filter = audioCtx.createBiquadFilter()
  filter.type  = 'lowpass'
  filter.frequency.value = 420

  ambientGain = audioCtx.createGain()
  ambientGain.gain.value = 0

  ambientNode.connect(filter)
  filter.connect(ambientGain)
  ambientGain.connect(audioCtx.destination)

  ambientNode.start()

  // Fade in slowly
  ambientGain.gain.linearRampToValueAtTime(0.06, audioCtx.currentTime + 3)
}

function stopAmbient() {
  if (!ambientGain) return
  ambientGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 1.5)
  setTimeout(() => {
    if (ambientNode) { ambientNode.stop(); ambientNode = null }
  }, 1600)
}

// ── Footstep click ──
function playFootstep() {
  if (!soundEnabled || !audioCtx) return
  const osc  = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  osc.connect(gain)
  gain.connect(audioCtx.destination)
  osc.type = 'sine'
  osc.frequency.setValueAtTime(180, audioCtx.currentTime)
  osc.frequency.exponentialRampToValueAtTime(60, audioCtx.currentTime + 0.08)
  gain.gain.setValueAtTime(0.12, audioCtx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12)
  osc.start(audioCtx.currentTime)
  osc.stop(audioCtx.currentTime + 0.12)
}

// ── Puzzle solved chime ──
function playChime() {
  if (!soundEnabled || !audioCtx) return
  const frequencies = [523, 659, 784]  // C5, E5, G5 — a gentle major chord
  frequencies.forEach((freq, i) => {
    const osc  = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.connect(gain)
    gain.connect(audioCtx.destination)
    osc.type = 'sine'
    osc.frequency.value = freq
    const startTime = audioCtx.currentTime + i * 0.08
    gain.gain.setValueAtTime(0, startTime)
    gain.gain.linearRampToValueAtTime(0.08, startTime + 0.04)
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 1.2)
    osc.start(startTime)
    osc.stop(startTime + 1.2)
  })
}

// ── Sound toggle ──
function toggleSound() {
  soundEnabled = !soundEnabled
  const btn = document.getElementById('sound-toggle')
  if (btn) btn.textContent = soundEnabled ? '♪' : '♪̶'

  if (soundEnabled) {
    initAudio()
    startAmbient()
  } else {
    stopAmbient()
  }
}

// ─────────────────────────────────────────

// ── Typing tick ──
// A whisper-quiet keystroke: much softer than the footstep (0.12) and the
// chime (0.08). strength lets the narration's once-per-line pen stroke sit
// slightly above the dialogue's per-character cadence.
let lastTypeTick = 0

function playTypeTick(strength = 1) {
  if (!soundEnabled || !audioCtx) return

  // Cap the rate: at 45 chars/sec unthrottled ticks blur into a buzz
  const now = audioCtx.currentTime
  if (now - lastTypeTick < 0.03) return
  lastTypeTick = now

  const t    = now
  const freq = 1400 + Math.random() * 900   // slight per-key variance
  const osc  = audioCtx.createOscillator()
  const filter = audioCtx.createBiquadFilter()
  const gain = audioCtx.createGain()

  osc.type = 'triangle'
  osc.frequency.setValueAtTime(freq, t)
  osc.frequency.exponentialRampToValueAtTime(freq * 0.6, t + 0.035)

  filter.type = 'bandpass'
  filter.frequency.value = freq
  filter.Q.value = 0.8

  gain.gain.setValueAtTime(0.022 * strength, t)
  gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.045)

  osc.connect(filter)
  filter.connect(gain)
  gain.connect(audioCtx.destination)
  osc.start(t)
  osc.stop(t + 0.05)
}
