/**
 * Accessibility snapshot, computed in the page.
 *
 * Returns a compact outline of what a person would actually see and be able to
 * act on, with every reported element tagged `data-oa-ref` so the automation can
 * click exactly the node the model chose — no selector guessing, no ambiguity.
 *
 * This runs instead of Playwright's own accessibility snapshot because that one
 * returns no way back to the element. Here the ref *is* the handle.
 *
 * Cost is the point: a LinkedIn search page is ~2 MB of DOM and about 900 tokens
 * once it comes through here.
 */
(options) => {
  const {
    maxNodes = 150,
    maxNameLength = 80,
    includeText = true,
    viewportOnly = false
  } = options || {}

  // Cleared every run so refs never survive a navigation and point at a stale node.
  for (const stale of document.querySelectorAll('[data-oa-ref]')) {
    stale.removeAttribute('data-oa-ref')
  }

  /** Tags that carry an implicit ARIA role worth reporting. */
  const TAG_ROLES = {
    A: 'link',
    BUTTON: 'button',
    INPUT: 'textbox',
    SELECT: 'combobox',
    TEXTAREA: 'textbox',
    H1: 'heading',
    H2: 'heading',
    H3: 'heading',
    H4: 'heading',
    H5: 'heading',
    H6: 'heading',
    IMG: 'image',
    NAV: 'navigation',
    MAIN: 'main',
    FORM: 'form',
    DIALOG: 'dialog',
    TABLE: 'table',
    LI: 'listitem',
    OPTION: 'option',
    SUMMARY: 'button',
    LABEL: 'label'
  }

  const INPUT_ROLES = {
    checkbox: 'checkbox',
    radio: 'radio',
    submit: 'button',
    button: 'button',
    reset: 'button',
    image: 'button',
    search: 'searchbox',
    range: 'slider',
    file: 'button'
  }

  /** Roles the model can act on. These are always kept. */
  const INTERACTIVE = new Set([
    'button',
    'link',
    'textbox',
    'searchbox',
    'combobox',
    'checkbox',
    'radio',
    'switch',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'tab',
    'option',
    'slider',
    'spinbutton'
  ])

  /** Roles that give the model its bearings but are not actionable. */
  const STRUCTURAL = new Set([
    'heading',
    'dialog',
    'alertdialog',
    'alert',
    'status',
    'navigation',
    'main',
    'form',
    'listitem',
    'article',
    'table',
    'row'
  ])

  function roleOf(element) {
    const explicit = element.getAttribute('role')
    if (explicit) return explicit.trim().split(/\s+/)[0].toLowerCase()

    if (element.tagName === 'INPUT') {
      const type = (element.getAttribute('type') || 'text').toLowerCase()
      if (type === 'hidden') return null
      return INPUT_ROLES[type] || 'textbox'
    }
    return TAG_ROLES[element.tagName] || null
  }

  function clean(value) {
    if (!value) return ''
    const text = String(value).replace(/\s+/g, ' ').trim()
    return text.length > maxNameLength ? `${text.slice(0, maxNameLength - 1)}…` : text
  }

  /**
   * Accessible name, following the parts of the spec that decide real pages:
   * aria-labelledby, aria-label, a bound <label>, then the element's own text.
   */
  function nameOf(element, role) {
    const labelledBy = element.getAttribute('aria-labelledby')
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((node) => node.textContent || '')
        .join(' ')
      if (text.trim()) return clean(text)
    }

    const ariaLabel = element.getAttribute('aria-label')
    if (ariaLabel && ariaLabel.trim()) return clean(ariaLabel)

    if (element.tagName === 'IMG') {
      return clean(element.getAttribute('alt') || element.getAttribute('title'))
    }

    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') {
      if (element.labels && element.labels.length) {
        const text = clean(element.labels[0].textContent)
        if (text) return text
      }
      const fallback =
        element.getAttribute('placeholder') ||
        element.getAttribute('name') ||
        element.getAttribute('title')
      if (fallback) return clean(fallback)
      if (element.tagName === 'INPUT') {
        const type = (element.getAttribute('type') || '').toLowerCase()
        if (type === 'submit' || type === 'button') return clean(element.value)
      }
      return ''
    }

    // Own text, but not a whole container's worth of it — a card's text belongs
    // to the card, not to the button inside it.
    const text = clean(element.textContent)
    if (text && (INTERACTIVE.has(role) || element.children.length <= 3)) return text
    return clean(element.getAttribute('title'))
  }

  function isVisible(element) {
    // Cheap checks first: getComputedStyle on every node in a 2 MB DOM is the
    // one thing that would make this snapshot slow.
    const rect = element.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return false
    if (viewportOnly && (rect.bottom < 0 || rect.top > window.innerHeight)) return false

    const style = window.getComputedStyle(element)
    if (style.visibility === 'hidden' || style.display === 'none') return false
    if (Number(style.opacity) === 0) return false
    if (element.getAttribute('aria-hidden') === 'true') return false
    return true
  }

  function stateOf(element, role) {
    const flags = []
    if (element.disabled || element.getAttribute('aria-disabled') === 'true') flags.push('disabled')

    const checked = element.getAttribute('aria-checked')
    if (checked === 'true' || element.checked === true) flags.push('checked')

    const expanded = element.getAttribute('aria-expanded')
    if (expanded) flags.push(expanded === 'true' ? 'expanded' : 'collapsed')

    if (element.getAttribute('aria-selected') === 'true') flags.push('selected')
    if (element.getAttribute('aria-current')) flags.push('current')

    if (role === 'textbox' || role === 'searchbox' || role === 'combobox') {
      const value = clean(element.value)
      if (value) flags.push(`value="${value}"`)
      if (element.required) flags.push('required')
    }
    return flags
  }

  const nodes = []
  let counter = 0
  let truncated = false

  function walk(element, depth) {
    if (nodes.length >= maxNodes) {
      truncated = true
      return
    }
    if (element.tagName === 'SCRIPT' || element.tagName === 'STYLE' || element.tagName === 'NOSCRIPT') {
      return
    }

    let recordedDepth = depth
    const role = roleOf(element)

    if (role && isVisible(element)) {
      const name = nameOf(element, role)
      const interactive = INTERACTIVE.has(role)
      const structural = STRUCTURAL.has(role)

      // A node earns a line if it can be acted on, or if it names a region the
      // model needs to know it is inside. Everything else is noise.
      if ((interactive && (name || role !== 'link')) || (structural && name)) {
        counter += 1
        const ref = `e${counter}`
        element.setAttribute('data-oa-ref', ref)
        nodes.push({
          ref,
          role,
          name,
          depth,
          interactive,
          states: stateOf(element, role),
          tag: element.tagName.toLowerCase(),
          href: element.tagName === 'A' ? element.getAttribute('href') : null
        })
        recordedDepth = depth + 1
      }
    }

    for (const child of element.children) {
      walk(child, recordedDepth)
    }
  }

  walk(document.body, 0)

  // A little page text carries meaning no role can: result counts, empty states,
  // error banners. Capped hard — this is a hint, not a transcript.
  let text = ''
  if (includeText) {
    const main = document.querySelector('main') || document.body
    text = clean(main.innerText || '').slice(0, 1200)
  }

  return {
    url: location.href,
    title: document.title,
    nodes,
    text,
    truncated,
    scroll: {
      y: Math.round(window.scrollY),
      height: Math.round(document.body.scrollHeight),
      viewport: Math.round(window.innerHeight)
    }
  }
}
