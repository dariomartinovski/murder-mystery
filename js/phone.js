// PHASE 7 — SCREEN TRANSITIONS
// ─────────────────────────────────────────

// The item modal was authored inside the restaurant scene (Phase 5), but
// the patio needs to examine items too and a hidden screen would swallow
// it. Lifting it to <body> at startup keeps one modal working on every
// screen; the scene is centred in the viewport, so it lands in the same
// place and merely dims the letterbox as well.
document.body.appendChild(document.getElementById('item-modal'))

function transitionToPatio() {
  const restaurant = document.getElementById('screen-restaurant')
  const patio      = document.getElementById('screen-patio')

  // Stepping outside — dim the murmur
  if (ambientGain) {
    ambientGain.gain.linearRampToValueAtTime(0.03, audioCtx.currentTime + 1)
  }

  restaurant.classList.remove('game-screen--active')

  setTimeout(() => {
    patio.classList.add('game-screen--active')
    syncPatioInventory()

    // Only show narration on first visit
    if (!G.patioEntered) {
      G.patioEntered = true
      showNarration('patio-enter', () => {
        // She's on the patio, free to explore
      })
    }
  }, 600)
}

function transitionToRestaurant() {
  const restaurant = document.getElementById('screen-restaurant')
  const patio      = document.getElementById('screen-patio')

  // Back inside — restore the murmur
  if (ambientGain) {
    ambientGain.gain.linearRampToValueAtTime(0.06, audioCtx.currentTime + 1)
  }

  patio.classList.remove('game-screen--active')

  setTimeout(() => {
    restaurant.classList.add('game-screen--active')

    if (G.chatRead && !G.finalPlayed) {
      G.finalPlayed = true
      onChatRevealed()
    }
  }, 600)
}

// ─────────────────────────────────────────
// PHASE 7 — PATIO TOAST
// Same generation-token guard as showToast.
// ─────────────────────────────────────────
let patioToastTimer = null
let patioToastSeq   = 0

function showPatioToast(message, duration = 3500) {
  const toast = document.getElementById('patio-toast')
  if (!toast) return

  clearTimeout(patioToastTimer)
  const seq = ++patioToastSeq
  toast.classList.remove('toast--visible')

  setTimeout(() => {
    if (seq !== patioToastSeq) return
    toast.textContent = message
    toast.classList.add('toast--visible')

    patioToastTimer = setTimeout(() => {
      if (seq !== patioToastSeq) return
      toast.classList.remove('toast--visible')
    }, duration)
  }, 50)
}

// ─────────────────────────────────────────
// PHASE 7 — PHONE STATE
// ─────────────────────────────────────────
let phoneModalOpen    = false
let patioDialogueOpen = false
let phoneScreen       = 'home'  // 'home' | 'noteapp' | 'chatapp' | 'pin'

// ─────────────────────────────────────────
// PHASE 7 — PHONE MODAL
// ─────────────────────────────────────────
const phoneModal         = document.getElementById('phone-modal')
const phoneScreenContent = document.getElementById('phone-screen-content')
const phoneHomeBtn       = document.getElementById('phone-home-btn')
const phoneModalBackdrop = document.getElementById('phone-modal-backdrop')

let pinBuffer  = ''
let chatViewed = false   // she has seen the chat at least once

function openPhoneModal() {
  phoneModalOpen = true

  // Add receipt to inventory if not already there
  if (!inventory.includes('receipt')) {
    addToInventory('receipt')
    showPatioToast('You found a receipt on the table.')
  }

  phoneModal.classList.add('phone-modal--open')
  phoneModal.setAttribute('aria-hidden', 'false')
  renderPhoneHome()
}

function closePhoneModal() {
  phoneModalOpen = false
  phoneModal.classList.remove('phone-modal--open')
  phoneModal.setAttribute('aria-hidden', 'true')
  phoneScreen = 'home'
  pinBuffer   = ''

  // She has read the chat and put the phone away: arm the final sequence.
  // It plays once she is back inside the restaurant, not out here.
  if (chatViewed && !G.chatRead) {
    G.chatRead = true
    showPatioToast('The coat rack is by the entrance. Back inside.')
  }
}

phoneModalBackdrop.addEventListener('click', closePhoneModal)

phoneHomeBtn.addEventListener('click', () => {
  phoneScreen = 'home'
  pinBuffer   = ''
  renderPhoneHome()
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && phoneModalOpen) closePhoneModal()
})

// ── Home screen ──
function renderPhoneHome() {
  phoneScreen = 'home'
  phoneScreenContent.innerHTML = `
    <div class="phone-home">
      <div class="phone-app-grid">

        <div class="phone-app phone-app--notes" id="phone-app-notes">
          <div class="phone-app__icon ${G.crackedNoteApp ? '' : 'phone-app__icon--locked'}">
            📝
          </div>
          <span class="phone-app__label">note_app</span>
        </div>

        <div class="phone-app phone-app--chat" id="phone-app-chat">
          <div class="phone-app__icon ${G.crackedChatApp ? '' : 'phone-app__icon--locked'}">
            💬
          </div>
          <span class="phone-app__label">chat_app</span>
        </div>

      </div>
    </div>
  `

  document.getElementById('phone-app-notes').addEventListener('click', () => {
    if (G.crackedNoteApp) {
      renderNoteApp()
    } else {
      renderNoteAppLocked()
    }
  })

  document.getElementById('phone-app-chat').addEventListener('click', () => {
    if (!G.crackedNoteApp) {
      showPatioToast('note_app access required first.')
      return
    }
    if (G.crackedChatApp) {
      renderChatApp()
    } else {
      renderPinScreen()
    }
  })
}

// ── note_app — locked (requires receipt puzzle) ──
function renderNoteAppLocked() {
  phoneScreen = 'noteapp-locked'
  phoneScreenContent.innerHTML = `
    <div class="phone-noteapp">
      <div class="phone-noteapp__header">note_app</div>
      <div class="phone-note">
        <strong>LOCKED</strong>
        This app is password protected.
        Check your items for a clue.
      </div>
    </div>
  `
}

// ── note_app — unlocked ──
function renderNoteApp() {
  phoneScreen = 'noteapp'
  phoneScreenContent.innerHTML = `
    <div class="phone-noteapp">
      <div class="phone-noteapp__header">note_app</div>

      <div class="phone-note">
        <strong>NOTE 1</strong>
        Chat password in mk time hh:mm
      </div>

      <div class="phone-note">
        <strong>NOTE 2</strong>
        call repair shop — phone stuck on Pacific/Auckland
        time since last trip.
      </div>
    </div>
  `

  // After she reads the notes, hint her to the chat app
  setTimeout(() => {
    showPatioToast('Look at the phone time.')
  }, 1200)
}

// ── PIN screen ──
function renderPinScreen() {
  phoneScreen = 'pin'
  pinBuffer   = ''

  phoneScreenContent.innerHTML = `
    <div class="phone-pin">
      <div class="phone-pin__label">
        Enter PIN<br>
        <span style="font-size:0.58rem; opacity:0.5;">chat_app</span>
      </div>

      <div class="phone-pin__dots" id="pin-dots">
        <div class="phone-pin__dot"></div>
        <div class="phone-pin__dot"></div>
        <div class="phone-pin__dot"></div>
        <div class="phone-pin__dot"></div>
      </div>

      <div class="phone-pin__keypad" id="pin-keypad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map((k) => `
          <button
            class="phone-pin__key ${k === '⌫' ? 'phone-pin__key--delete' : ''}"
            data-key="${k}">
            ${k}
          </button>
        `).join('')}
      </div>

      <div class="phone-pin__feedback" id="pin-feedback"></div>
    </div>
  `

  // Wire keypad
  document.getElementById('pin-keypad').addEventListener('click', (e) => {
    const key = e.target.closest('.phone-pin__key')
    if (!key) return

    const val = key.dataset.key
    if (val === '') return

    if (val === '⌫') {
      pinBuffer = pinBuffer.slice(0, -1)
    } else if (pinBuffer.length < 4) {
      pinBuffer += val
    }

    updatePinDots()

    if (pinBuffer.length === 4) {
      checkPin()
    }
  })
}

function updatePinDots() {
  const dots = document.querySelectorAll('.phone-pin__dot')
  dots.forEach((dot, i) => {
    dot.classList.toggle('phone-pin__dot--filled', i < pinBuffer.length)
  })
}

function checkPin() {
  const feedback = document.getElementById('pin-feedback')

  if (pinBuffer === '1115') {
    // Correct — crack the chat app
    G.crackedChatApp = true
    feedback.textContent = ''
    playChime()

    setTimeout(() => {
      renderChatApp()
    }, 400)

  } else {
    feedback.textContent = 'Incorrect PIN.'
    setTimeout(() => {
      pinBuffer = ''
      updatePinDots()
      if (feedback) feedback.textContent = ''
    }, 900)
  }
}

// ── chat_app — messages ──
function renderChatApp() {
  phoneScreen = 'chat'
  G.crackedChatApp = true

  phoneScreenContent.innerHTML = `
    <div class="phone-chat">
      <div class="phone-chat__header">
        chat_app &nbsp;·&nbsp; D
      </div>

      <div class="phone-message phone-message--received">
        <span class="phone-message__sender">D</span>
        <div class="phone-message__bubble">
          Is the special dessert ready?
        </div>
      </div>

      <div class="phone-message phone-message--sent">
        <div class="phone-message__bubble">
          Yes, but the kitchen sent it out the front by mistake.
        </div>
      </div>

      <div class="phone-message phone-message--received">
        <span class="phone-message__sender">D</span>
        <div class="phone-message__bubble">
          On my way. Don't let her leave! 😄
        </div>
      </div>

      <div class="phone-chat__cta" id="chat-cta">
        Go check the coat rack near the entrance.
      </div>
    </div>
  `

  // She reads at her own pace. The final beat waits until she puts the
  // phone down and walks back inside — see closePhoneModal / transitionToRestaurant.
  chatViewed = true
}

// ─────────────────────────────────────────
// PHASE 7 — FINAL REVEAL
// ─────────────────────────────────────────
function onChatRevealed() {
  // Called from transitionToRestaurant: the twist lands inside, once she has
  // read the messages, put the phone down and come back in from the cold.
  showNarration('chat-reveal', () => {
    showFinalScreen()
  })
}

function showFinalScreen() {
  const patio      = document.getElementById('screen-patio')
  const restaurant = document.getElementById('screen-restaurant')
  const final      = document.getElementById('screen-final')

  // The reveal can now fire from either screen, so leave both behind
  patio.classList.remove('game-screen--active')
  restaurant.classList.remove('game-screen--active')

  setTimeout(() => {
    final.classList.add('game-screen--active')
  }, 600)
}

// Place the patio player before the screen is ever shown
patioRenderPlayer()

// ─────────────────────────────────────────
