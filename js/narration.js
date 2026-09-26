// PHASE 8 — NARRATIVE ENGINE
// ─────────────────────────────────────────
const narrationEl       = document.getElementById('narration')
const narrationChapter  = document.getElementById('narration-chapter')
const narrationLines    = document.getElementById('narration-lines')
const narrationContinue = document.getElementById('narration-continue')

let narrationActive   = false
let narrationTimer    = null
let narrationLineIdx  = 0
let narrationData     = null
let narrationCallback = null

// ── Show a narrative panel ──
// panelId: key in NARRATIVES
// onComplete: function to call when she dismisses the panel
function showNarration(panelId, onComplete) {
  const panel = NARRATIVES[panelId]
  if (!panel) {
    console.warn('No narrative panel:', panelId)
    if (onComplete) onComplete()
    return
  }

  narrationData     = panel
  narrationCallback = onComplete
  narrationLineIdx  = 0
  narrationActive   = true

  // Set chapter label
  narrationChapter.textContent = panel.chapter || ''

  // Clear previous lines
  narrationLines.innerHTML = ''

  // Hide continue prompt
  narrationContinue.classList.remove('narration__continue--visible')

  // Show panel
  narrationEl.classList.remove('narration--hidden', 'narration--gone')

  // Start revealing lines
  revealNextLine()
}

// ── Reveal lines one by one ──
function revealNextLine() {
  if (!narrationData) return

  const lines = narrationData.lines

  if (narrationLineIdx >= lines.length) {
    // All lines shown — show continue prompt
    narrationContinue.classList.add('narration__continue--visible')
    return
  }

  const lineData = lines[narrationLineIdx]
  narrationLineIdx++

  // Build line element
  const lineEl = document.createElement('div')

  if (lineData.empty) {
    lineEl.className = 'narration__line narration__line--empty narration__line--visible'
    narrationLines.appendChild(lineEl)
    // Empty lines appear instantly, move to next after short pause
    narrationTimer = setTimeout(revealNextLine, 120)
    return
  }

  lineEl.textContent = lineData.text

  const classes = ['narration__line']
  if (lineData.italic)    classes.push('narration__line--italic')
  if (lineData.highlight) classes.push('narration__line--highlight')
  lineEl.className = classes.join(' ')

  narrationLines.appendChild(lineEl)

  // Trigger fade-in on next frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      lineEl.classList.add('narration__line--visible')
    })
  })

  // Delay before next line — longer for highlight lines, shorter for normal
  // const delay = lineData.highlight ? 900 : lineData.italic ? 620 : 500
  const delay = lineData.highlight ? 2300 : lineData.italic ? 2000 : 1900
  narrationTimer = setTimeout(revealNextLine, delay)
}

// ── Dismiss the panel ──
function dismissNarration() {
  if (!narrationActive) return

  // Clear any pending timers
  clearTimeout(narrationTimer)

  // If lines are still appearing, skip to the end
  if (narrationLineIdx < narrationData.lines.length) {
    // Show all remaining lines instantly
    const remaining = narrationData.lines.slice(narrationLineIdx)
    remaining.forEach((lineData) => {
      if (lineData.empty) {
        const el = document.createElement('div')
        el.className = 'narration__line narration__line--empty narration__line--visible'
        narrationLines.appendChild(el)
        return
      }
      const el = document.createElement('div')
      el.textContent = lineData.text
      const classes = ['narration__line']
      if (lineData.italic)    classes.push('narration__line--italic')
      if (lineData.highlight) classes.push('narration__line--highlight')
      el.className = classes.join(' ')
      narrationLines.appendChild(el)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.classList.add('narration__line--visible')
        })
      })
    })

    narrationLineIdx = narrationData.lines.length
    narrationContinue.classList.add('narration__continue--visible')
    return
  }

  // Lines are all shown — actually dismiss
  narrationActive = false
  narrationEl.classList.add('narration--hidden')

  setTimeout(() => {
    narrationEl.classList.add('narration--gone')
    if (narrationCallback) {
      narrationCallback()
      narrationCallback = null
    }
  }, 700)
}

// ── Click or space to continue / skip ──
narrationEl.addEventListener('click', dismissNarration)

document.addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Enter') {
    if (narrationActive) {
      e.preventDefault()
      dismissNarration()
    }
  }
})

// ─────────────────────────────────────────
