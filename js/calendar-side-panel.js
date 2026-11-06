/**
 * SPDX-FileCopyrightText: 2026 Bill Pardi
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Calendar side panel: header button + right-hand "Upcoming events" drawer.
 * Vanilla JS, no build step. Read-only.
 */
(function () {
	'use strict'

	const APP = 'calendar_side_panel'
	const STORAGE_KEY = APP + ':open'
	const DAYS = 7 // today through today + 6
	const TICK_MS = 60 * 1000
	const REFRESH_MS = 5 * 60 * 1000
	const PANEL_ID = 'calendar-side-panel'

	const ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 16H5V10h14zm0-12H5V6h14zM7 12h5v5H7z"/></svg>'
	const CLOSE = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>'

	let trigger = null
	let panel = null
	let listEl = null
	let statusEl = null
	let refreshTimer = null
	let tickTimer = null
	let lastData = null
	let loading = false

	function tr(text) {
		return (window.t ? window.t(APP, text) : text)
	}

	function locale() {
		return (document.documentElement.getAttribute('data-locale') || document.documentElement.lang || navigator.language || 'en').replace('_', '-')
	}

	function ocsUrl() {
		const base = (window.OC && typeof window.OC.linkToOCS === 'function')
			? window.OC.linkToOCS('apps/' + APP + '/api/v1', 2)
			: (window.location.origin + '/ocs/v2.php/apps/' + APP + '/api/v1/')
		let tz = ''
		try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch (e) {}
		return base.replace(/\/?$/, '/') + 'events?format=json&days=' + DAYS + '&tz=' + encodeURIComponent(tz)
	}

	function requestToken() {
		return (window.OC && window.OC.requestToken) || document.head.getAttribute('data-requesttoken') || ''
	}

	function storedOpen() {
		try { return window.localStorage.getItem(STORAGE_KEY) === '1' } catch (e) { return false }
	}
	function storeOpen(open) {
		try { window.localStorage.setItem(STORAGE_KEY, open ? '1' : '0') } catch (e) {}
	}

	function el(tag, cls, text) {
		const node = document.createElement(tag)
		if (cls) node.className = cls
		if (text !== undefined) node.textContent = text
		return node
	}

	function dayKey(d) {
		return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
	}

	function parseLocalDate(ymd) {
		const p = ymd.split('-').map(Number)
		return new Date(p[0], p[1] - 1, p[2])
	}

	function dayLabel(d) {
		const today = new Date(); today.setHours(0, 0, 0, 0)
		const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - today) / 86400000)
		const date = d.toLocaleDateString(locale(), { weekday: 'long', month: 'short', day: 'numeric' })
		if (diff === 0) return tr('Today') + ' · ' + date
		if (diff === 1) return tr('Tomorrow') + ' · ' + date
		return date
	}

	function timeText(ev) {
		if (ev.allDay) return tr('All day')
		const opts = { hour: 'numeric', minute: '2-digit' }
		const s = new Date(ev.start)
		const e = new Date(ev.end)
		const st = s.toLocaleTimeString(locale(), opts)
		if (!(e > s)) return st
		if (dayKey(s) !== dayKey(e)) {
			return st + ' – ' + e.toLocaleDateString(locale(), { month: 'short', day: 'numeric' }) + ' ' + e.toLocaleTimeString(locale(), opts)
		}
		return st + ' – ' + e.toLocaleTimeString(locale(), opts)
	}

	function isEnded(ev, now, todayStart) {
		if (ev.allDay) return parseLocalDate(ev.end) <= todayStart
		const s = new Date(ev.start)
		const e = new Date(ev.end)
		return e > s ? e <= now : s < now
	}

	function isCurrent(ev, now) {
		if (ev.allDay) return false
		const s = new Date(ev.start)
		const e = new Date(ev.end)
		return s <= now && now < e
	}

	function render(data) {
		if (data !== undefined) lastData = data
		if (!listEl) return
		listEl.textContent = ''
		const now = new Date()
		const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
		const events = ((lastData && lastData.events) || []).filter((ev) => !isEnded(ev, now, todayStart))
		if (events.length === 0) {
			statusEl.textContent = tr('No upcoming events')
			statusEl.hidden = false
			return
		}
		statusEl.hidden = true

		const groups = new Map()
		for (const ev of events) {
			let day = ev.allDay ? parseLocalDate(ev.start) : new Date(ev.start)
			if (day < todayStart) day = todayStart // started before today and still running
			const key = dayKey(day)
			if (!groups.has(key)) groups.set(key, { date: new Date(day.getFullYear(), day.getMonth(), day.getDate()), items: [] })
			groups.get(key).items.push(ev)
		}

		const keys = Array.from(groups.keys()).sort()
		for (const key of keys) {
			const group = groups.get(key)
			// All-day pinned first, then timed events chronologically.
			group.items.sort((a, b) => {
				if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
				const d = new Date(a.start) - new Date(b.start)
				return d !== 0 ? d : String(a.title).localeCompare(String(b.title))
			})
			const section = el('section', 'csp-day')
			section.appendChild(el('h3', 'csp-day__title', dayLabel(group.date)))
			const ul = el('ul', 'csp-day__list')
			for (const ev of group.items) {
				const li = el('li', 'csp-event')
				const current = isCurrent(ev, now)
				if (ev.allDay) li.classList.add('csp-event--allday')
				if (current) li.classList.add('csp-event--current')
				const inner = el(ev.url ? 'a' : 'div', 'csp-event__link')
				if (ev.url) {
					inner.href = ev.url
					// New tab so Talk chats / calls are not interrupted.
					inner.target = '_blank'
					inner.rel = 'noopener noreferrer'
				}
				if (current) inner.setAttribute('aria-current', 'true')
				const dot = el('span', 'csp-event__dot')
				dot.style.backgroundColor = ev.color || '#0082c9'
				dot.setAttribute('aria-hidden', 'true')
				const body = el('span', 'csp-event__body')
				body.appendChild(el('span', 'csp-event__title', ev.title))
				const meta = el('span', 'csp-event__meta')
				if (current) meta.appendChild(el('span', 'csp-event__now', tr('Now')))
				meta.appendChild(document.createTextNode((current ? ' · ' : '') + timeText(ev) + (ev.calendar ? ' · ' + ev.calendar : '')))
				body.appendChild(meta)
				inner.title = ev.title + (ev.calendar ? ' (' + ev.calendar + ')' : '')
				inner.appendChild(dot)
				inner.appendChild(body)
				li.appendChild(inner)
				ul.appendChild(li)
			}
			section.appendChild(ul)
			listEl.appendChild(section)
		}
	}

	async function load() {
		if (loading) return
		loading = true
		if (!listEl.childElementCount) {
			statusEl.textContent = tr('Loading…')
			statusEl.hidden = false
		}
		try {
			const res = await fetch(ocsUrl(), {
				credentials: 'same-origin',
				headers: { 'OCS-APIRequest': 'true', Accept: 'application/json', requesttoken: requestToken() },
			})
			if (!res.ok) throw new Error('HTTP ' + res.status)
			const json = await res.json()
			render(json && json.ocs ? json.ocs.data : null)
		} catch (e) {
			console.error('[calendar_side_panel] could not load events', e)
			listEl.textContent = ''
			statusEl.textContent = tr('Could not load events')
			statusEl.hidden = false
		} finally {
			loading = false
		}
	}


	function syncFixedSidebars(open) {
		document.querySelectorAll('.app-sidebar, #app-sidebar').forEach((node) => {
			if (!(node instanceof HTMLElement) || node.id === PANEL_ID) return
			if (open) {
				try {
					if (window.getComputedStyle(node).position === 'fixed') {
						node.classList.add('csp-shifted')
						return
					}
				} catch (e) {}
			}
			node.classList.remove('csp-shifted')
		})
	}


	// Match the main app pane's vertical box so our top/bottom edges line up with it.
	let alignObserver = null
	let alignRaf = 0

	function contentPane() {
		for (const id of ['content-vue', 'content']) {
			const node = document.getElementById(id)
			if (node && node.getBoundingClientRect().height > 0) return node
		}
		return null
	}

	function alignPanel() {
		if (!panel || panel.hidden) return
		const pane = contentPane()
		if (!pane) return
		const r = pane.getBoundingClientRect()
		panel.style.top = Math.max(0, Math.round(r.top)) + 'px'
		panel.style.bottom = Math.max(0, Math.round(window.innerHeight - r.bottom)) + 'px'
	}

	function scheduleAlign() {
		if (alignRaf) return
		alignRaf = window.requestAnimationFrame(() => {
			alignRaf = 0
			alignPanel()
		})
	}

	function startAlign() {
		alignPanel()
		scheduleAlign() // again after #content reflows for our reserved width
		window.addEventListener('resize', scheduleAlign)
		const pane = contentPane()
		if (pane && 'ResizeObserver' in window) {
			if (alignObserver) alignObserver.disconnect()
			alignObserver = new ResizeObserver(scheduleAlign)
			alignObserver.observe(pane)
		}
	}

	function stopAlign() {
		window.removeEventListener('resize', scheduleAlign)
		if (alignObserver) {
			alignObserver.disconnect()
			alignObserver = null
		}
		if (panel) {
			panel.style.top = ''
			panel.style.bottom = ''
		}
	}

	function isOpen() {
		return panel && !panel.hidden
	}

	function open(focus) {
		if (!panel) return
		panel.hidden = false
		document.body.classList.add('calendar-side-panel--open')
		syncFixedSidebars(true)
		startAlign()

		if (!window.__cspSidebarObserver) {
			window.__cspSidebarObserver = new MutationObserver(() => {
				if (isOpen()) syncFixedSidebars(true)
			})
			window.__cspSidebarObserver.observe(document.body, { childList: true, subtree: true })
		}
		trigger.setAttribute('aria-expanded', 'true')
		storeOpen(true)
		load()
		clearInterval(refreshTimer)
		refreshTimer = setInterval(load, REFRESH_MS)
		clearInterval(tickTimer)
		// Re-render from cache every minute so ended events drop off and the highlight moves.
		tickTimer = setInterval(() => render(), TICK_MS)
		if (focus) {
			const btn = panel.querySelector('.csp-close')
			if (btn) btn.focus()
		}
	}

	function close(focusTrigger) {
		if (!panel) return
		panel.hidden = true
		document.body.classList.remove('calendar-side-panel--open')
		syncFixedSidebars(false)
		stopAlign()
		trigger.setAttribute('aria-expanded', 'false')
		storeOpen(false)
		clearInterval(refreshTimer)
		refreshTimer = null
		clearInterval(tickTimer)
		tickTimer = null
		if (focusTrigger) trigger.focus()
	}

	function build() {
		const headerEnd = document.querySelector('#header .header-end')
		if (!headerEnd || document.getElementById(PANEL_ID)) return

		const wrap = el('div', 'csp-header')
		trigger = el('button', 'csp-trigger')
		trigger.type = 'button'
		trigger.innerHTML = ICON
		trigger.setAttribute('aria-label', tr('Upcoming events'))
		trigger.title = tr('Upcoming events')
		trigger.setAttribute('aria-controls', PANEL_ID)
		trigger.setAttribute('aria-expanded', 'false')
		trigger.addEventListener('click', () => (isOpen() ? close(false) : open(true)))
		wrap.appendChild(trigger)
		headerEnd.insertBefore(wrap, headerEnd.firstChild)

		panel = el('aside', 'csp-panel')
		panel.id = PANEL_ID
		panel.hidden = true
		panel.setAttribute('aria-label', tr('Upcoming events'))

		const head = el('div', 'csp-panel__header')
		head.appendChild(el('h2', 'csp-panel__title', tr('Upcoming events')))
		const actions = el('div', 'csp-panel__actions')
		if (window.OC && typeof window.OC.generateUrl === 'function') {
			const openCal = el('a', 'csp-panel__open', tr('Open Calendar'))
			openCal.href = window.OC.generateUrl('/apps/calendar/')
			openCal.target = '_blank'
			openCal.rel = 'noopener noreferrer'
			actions.appendChild(openCal)
		}
		const closeBtn = el('button', 'csp-close')
		closeBtn.type = 'button'
		closeBtn.innerHTML = CLOSE
		closeBtn.setAttribute('aria-label', tr('Close'))
		closeBtn.title = tr('Close')
		closeBtn.addEventListener('click', () => close(true))
		actions.appendChild(closeBtn)
		head.appendChild(actions)
		panel.appendChild(head)

		const scroll = el('div', 'csp-panel__body')
		statusEl = el('p', 'csp-panel__status')
		statusEl.setAttribute('role', 'status')
		statusEl.hidden = true
		listEl = el('div', 'csp-panel__list')
		scroll.appendChild(statusEl)
		scroll.appendChild(listEl)
		panel.appendChild(scroll)
		document.body.appendChild(panel)

		document.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && isOpen()) {
				close(panel.contains(document.activeElement))
			}
		})
		document.addEventListener('visibilitychange', () => {
			if (!document.hidden && isOpen()) load()
		})

		if (storedOpen()) open(false)
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', build)
	} else {
		build()
	}
})()
