<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Bill Pardi
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\CalendarSidePanel\Listener;

use OCA\CalendarSidePanel\AppInfo\Application;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\IUser;
use OCP\IUserSession;
use OCP\Util;

/**
 * Same injection pattern as core notifications / user_status: load our header
 * script on every logged-in, user-rendered page.
 *
 * @template-implements IEventListener<BeforeTemplateRenderedEvent>
 */
class BeforeTemplateRenderedListener implements IEventListener {
	public function __construct(
		private IUserSession $userSession,
	) {
	}

	public function handle(Event $event): void {
		if (!($event instanceof BeforeTemplateRenderedEvent)) {
			return;
		}
		if (!$event->isLoggedIn() || $event->getResponse()->getRenderAs() !== TemplateResponse::RENDER_AS_USER) {
			return;
		}
		if (!($this->userSession->getUser() instanceof IUser)) {
			return;
		}

		Util::addStyle(Application::APP_ID, 'calendar-side-panel');
		Util::addScript(Application::APP_ID, 'calendar-side-panel');
	}
}
