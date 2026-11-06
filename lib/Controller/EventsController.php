<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Bill Pardi
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\CalendarSidePanel\Controller;

use OCA\CalendarSidePanel\Service\UpcomingEventsService;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\OCSController;
use OCP\IRequest;
use OCP\IUserSession;

class EventsController extends OCSController {
	public function __construct(
		string $appName,
		IRequest $request,
		private IUserSession $userSession,
		private UpcomingEventsService $service,
	) {
		parent::__construct($appName, $request);
	}

	/**
	 * Upcoming events (today through day $days) for the logged-in user.
	 *
	 * @param int $days Number of days including today (1-31)
	 * @param string $tz IANA timezone of the browser, used to define "today"
	 */
	#[NoAdminRequired]
	public function upcoming(int $days = 7, string $tz = ''): DataResponse {
		$user = $this->userSession->getUser();
		if ($user === null) {
			return new DataResponse([], Http::STATUS_UNAUTHORIZED);
		}
		$days = max(1, min(31, $days));
		return new DataResponse($this->service->getUpcoming($user->getUID(), $days, $tz));
	}
}
