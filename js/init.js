// PHASE 9 — SOUND TOGGLE WIRING
// The button lives inside .scene, so swallow the click before the
// floor handler turns a mute into a walk across the room.
// ─────────────────────────────────────────
document.getElementById('sound-toggle').addEventListener('click', (e) => {
  e.stopPropagation()
  toggleSound()
})

// ─────────────────────────────────────────
// PHASE 9 — CUSTOM CURSOR
// ─────────────────────────────────────────
const customCursor = document.getElementById('custom-cursor')
let cursorVisible  = false

document.addEventListener('mousemove', (e) => {
  customCursor.style.left = e.clientX + 'px'
  customCursor.style.top  = e.clientY + 'px'

  if (!cursorVisible) {
    cursorVisible = true
    customCursor.style.opacity = '1'
  }
})

document.addEventListener('mouseleave', () => {
  customCursor.style.opacity = '0'
})

document.addEventListener('mouseenter', () => {
  customCursor.style.opacity = '1'
})

document.addEventListener('mousedown', () => {
  customCursor.classList.add('custom-cursor--click')
})

document.addEventListener('mouseup', () => {
  customCursor.classList.remove('custom-cursor--click')
})

// Expand on interactable hover
document.addEventListener('mouseover', (e) => {
  const isHoverable = e.target.closest(
    '.interactable, .dialogue__option, .inventory__item, ' +
    '.phone-app, .phone-pin__key, .note-flip-btn, ' +
    '.puzzle-submit, .narration, .patio-back-door, .sound-toggle'
  )
  customCursor.classList.toggle('custom-cursor--hover', !!isHoverable)
})

// ─────────────────────────────────────────
// PHASE 9 — LOADING & INIT
// Wait for fonts, then start
// ─────────────────────────────────────────
async function initGame() {
  // Wait for fonts
  try {
    await document.fonts.ready
  } catch (e) {
    // Fonts API not available — proceed anyway
  }

  // Small minimum display time so loading doesn't flash
  await new Promise((resolve) => setTimeout(resolve, 600))

  // Hide loading screen
  const loadingScreen = document.getElementById('loading-screen')
  loadingScreen.classList.add('loading-screen--hidden')
  setTimeout(() => { loadingScreen.style.display = 'none' }, 500)

  // Hide restaurant until narration ends
  document.getElementById('screen-restaurant').style.visibility = 'hidden'

  // Start the narration
  showNarration('intro', () => {
    document.getElementById('screen-restaurant').style.visibility = 'visible'
    initAudio()
    startAmbient()
  })
}

initGame()
