<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Bill Pardi
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\CalendarSidePanel\AppInfo;

use OCA\CalendarSidePanel\Listener\BeforeTemplateRenderedListener;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;

class Application extends App implements IBootstrap {
	public const APP_ID = 'calendar_side_panel';

	public function __construct(array $urlParams = []) {
		parent::__construct(self::APP_ID, $urlParams);
	}

	public function register(IRegistrationContext $context): void {
		$context->registerEventListener(BeforeTemplateRenderedEvent::class, BeforeTemplateRenderedListener::class);
	}

	public function boot(IBootContext $context): void {
	}
}
