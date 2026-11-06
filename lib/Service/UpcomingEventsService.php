<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Bill Pardi
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\CalendarSidePanel\Service;

use DateInterval;
use DateTimeImmutable;
use DateTimeInterface;
use DateTimeZone;
use OCP\App\IAppManager;
use OCP\Calendar\IManager as ICalendarManager;
use OCP\IConfig;
use OCP\IURLGenerator;
use Psr\Log\LoggerInterface;
use Throwable;

/**
 * Lists event occurrences using OCP\Calendar\IManager::getCalendarsForPrincipal(),
 * the same source as OCA\Calendar\Dashboard\CalendarWidget. Unlike core's
 * calendar StatusService we do NOT filter to CalendarImpl, so cached read-only
 * subscriptions (OCA\DAV\CalDAV\CachedSubscriptionImpl) are included.
 * search() with a timerange returns recurrences already expanded in 'objects'.
 */
class UpcomingEventsService {
	private const MAX_ITEMS = 300;

	public function __construct(
		private ICalendarManager $calendarManager,
		private IConfig $config,
		private IURLGenerator $urlGenerator,
		private IAppManager $appManager,
		private LoggerInterface $logger,
	) {
	}

	public function getUpcoming(string $userId, int $days, string $tzName): array {
		$tz = $this->resolveTimezone($userId, $tzName);
		$now = new DateTimeImmutable('now', $tz);
		$start = new DateTimeImmutable('today', $tz);
		// Today through the end of day $days (today counts as day 1).
		$end = $start->add(new DateInterval('P' . $days . 'D'));

		$calendarAppEnabled = $this->appManager->isEnabledForUser('calendar');
		$items = [];

		foreach ($this->calendarManager->getCalendarsForPrincipal('principals/users/' . $userId) as $calendar) {
			try {
				if (method_exists($calendar, 'isEnabled') && $calendar->isEnabled() === false) {
					continue;
				}
				if (method_exists($calendar, 'isDeleted') && $calendar->isDeleted()) {
					continue;
				}
				$color = $this->sanitizeColor($calendar->getDisplayColor());
				$calName = (string)($calendar->getDisplayName() ?? '');
				$results = $calendar->search('', [], ['timerange' => ['start' => $start, 'end' => $end]]);
			} catch (Throwable $e) {
				$this->logger->warning('calendar_side_panel: could not read calendar', ['exception' => $e]);
				continue;
			}

			foreach ($results as $event) {
				if (($event['type'] ?? 'VEVENT') !== 'VEVENT') {
					continue;
				}
				$uid = (string)($event['uid'] ?? '');
				foreach (($event['objects'] ?? []) as $object) {
					$item = $this->toItem($object, $uid, $calName, $color, $calendarAppEnabled, $start, $end, $now);
					if ($item !== null) {
						$items[] = $item;
					}
				}
			}
		}

		usort($items, static function (array $a, array $b): int {
			return [$a['sort'], $a['allDay'] ? 0 : 1, $a['title']] <=> [$b['sort'], $b['allDay'] ? 0 : 1, $b['title']];
		});
		$items = array_slice($items, 0, self::MAX_ITEMS);
		foreach ($items as &$item) {
			unset($item['sort']);
		}

		return [
			'timezone' => $tz->getName(),
			'start' => $start->format(DateTimeInterface::ATOM),
			'end' => $end->format(DateTimeInterface::ATOM),
			'events' => $items,
		];
	}

	private function toItem(array $object, string $uid, string $calName, string $color, bool $linkable, DateTimeImmutable $rangeStart, DateTimeImmutable $rangeEnd, DateTimeImmutable $now): ?array {
		$dtStart = $object['DTSTART'][0] ?? null;
		if (!($dtStart instanceof DateTimeInterface)) {
			return null;
		}
		$status = strtoupper((string)($object['STATUS'][0] ?? ''));
		if ($status === 'CANCELLED') {
			return null;
		}
		$allDay = strtoupper((string)($object['DTSTART'][1]['VALUE'] ?? '')) === 'DATE';
		$dtStart = DateTimeImmutable::createFromInterface($dtStart);

		$dtEnd = $object['DTEND'][0] ?? null;
		if ($dtEnd instanceof DateTimeInterface) {
			$dtEnd = DateTimeImmutable::createFromInterface($dtEnd);
		} elseif (isset($object['DURATION'][0])) {
			try {
				$dtEnd = $dtStart->add(new DateInterval((string)$object['DURATION'][0]));
			} catch (Throwable) {
				$dtEnd = null;
			}
		}
		if (!($dtEnd instanceof DateTimeImmutable) || $dtEnd < $dtStart) {
			$dtEnd = $allDay ? $dtStart->add(new DateInterval('P1D')) : $dtStart;
		}

		if ($allDay) {
			// DATE values come back as UTC midnight; keep them as plain dates.
			$startDate = $dtStart->format('Y-m-d');
			$endDate = $dtEnd->format('Y-m-d'); // exclusive
			$tz = $rangeStart->getTimezone();
			$localStart = new DateTimeImmutable($startDate, $tz);
			$localEnd = new DateTimeImmutable($endDate, $tz);
			if ($localEnd <= $rangeStart || $localStart >= $rangeEnd) {
				return null;
			}
			$sort = $localStart->getTimestamp();
			$startOut = $startDate;
			$endOut = $endDate;
			$current = false; // all-day events are never highlighted
		} else {
			// Drop ended events (end <= now); zero-length events drop once their start has passed.
			if ($dtStart >= $rangeEnd) {
				return null;
			}
			if ($dtEnd > $dtStart ? $dtEnd <= $now : $dtStart < $now) {
				return null;
			}
			$current = $dtStart <= $now && $now < $dtEnd;
			$sort = $dtStart->getTimestamp();
			$startOut = $dtStart->format(DateTimeInterface::ATOM);
			$endOut = $dtEnd->format(DateTimeInterface::ATOM);
		}

		$url = null;
		if ($linkable && $uid !== '') {
			try {
				// Same deep link as OCA\Calendar\Dashboard\CalendarWidget::getItems()
				$path = $this->urlGenerator->linkToRoute('calendar.view.index', ['objectId' => $uid]);
			} catch (Throwable) {
				$path = '';
			}
			if ($path === '') {
				// Router not populated (e.g. CLI); build the equivalent link by hand.
				$path = $this->urlGenerator->linkTo('', 'index.php') . '/apps/calendar/?objectId=' . rawurlencode($uid);
			}
			$url = $this->urlGenerator->getAbsoluteURL($path);
		}

		$title = trim((string)($object['SUMMARY'][0] ?? ''));
		return [
			'title' => $title !== '' ? $title : 'Untitled event',
			'allDay' => $allDay,
			'start' => $startOut,
			'end' => $endOut,
			'calendar' => $calName,
			'color' => $color,
			'url' => $url,
			'current' => $current,
			'sort' => $sort,
		];
	}

	private function resolveTimezone(string $userId, string $tzName): DateTimeZone {
		foreach ([$tzName, $this->config->getUserValue($userId, 'core', 'timezone', ''), date_default_timezone_get()] as $candidate) {
			if ($candidate === '' || $candidate === null) {
				continue;
			}
			try {
				return new DateTimeZone($candidate);
			} catch (Throwable) {
			}
		}
		return new DateTimeZone('UTC');
	}

	private function sanitizeColor(?string $color): string {
		$c = ltrim(trim((string)$color), '#');
		if (preg_match('/^([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i', $c) === 1) {
			return '#' . substr($c, 0, strlen($c) === 8 ? 6 : strlen($c));
		}
		return '#0082c9';
	}
}
