## Version

1.0.4 — panel top/bottom copied from the measured `#content-vue` / `#content` box (ResizeObserver + window resize) so its edges line up with the app pane.

1.0.3 — stock rounded corners / body-container inset (builds on 1.0.2 push layout).

1.0.2 — push layout left instead of overlaying Talk's right side.

# Calendar side panel

Nextcloud app id: `calendar_side_panel`

Adds a calendar button to the top-right header on every logged-in page (Talk, Files, Mail, and the rest). Clicking it opens a right-hand **Upcoming events** panel.

The folder name under `custom_apps` **must** be `calendar_side_panel` (underscores), matching the app id.

## What it does

- Lists today through the end of the 7th day (today plus the next 6 days).
- Drops events that are already in the past, including timed events that have ended today.
- Pins all-day events at the top of each day. All-day events are never highlighted.
- Highlights timed events that are in progress (background, colored left bar, and a "Now" label). If several overlap, all of them are highlighted.
- Includes every calendar the signed-in user can see, including read-only subscriptions such as Outlook (ICS/webcal). It does not skip subscription calendars.
- Shows a color dot, the time or "All day", the title, and the calendar name. Days are grouped ("Today", "Tomorrow", then the date).
- Clicking an event opens it in the Calendar app in a new tab, using the same deep link as Calendar's Dashboard widget, so a Talk chat or call is not interrupted.
- The header also has an "Open Calendar" link. Esc or the close button dismisses the panel. Open/closed state is stored in `localStorage` under `calendar_side_panel:open`.
- The list refreshes when the panel opens, every 5 minutes while it is open, when the browser tab becomes visible again, and it re-renders every minute so ended events drop off and the "Now" highlight moves.

It is read-only: no creating, editing, or dragging events, and no month or week grid. It does **not** modify Talk or Calendar. On viewports ≥600px the panel reserves its width and shrinks `#content` / `#content-vue` so Talk (and other apps) reflow left, including Talk's own `.app-sidebar`. The panel is inset with `--body-container-margin` and rounded with `--body-container-radius` like stock `#content`. Below 600px it falls back to an overlay (still rounded/inset when margin is non-zero).

## Requirements

- Nextcloud 33–36 (`max-version` is 36; bump it in `appinfo/info.xml` before or right after a major upgrade, then redeploy and confirm the app is still enabled).
- PHP 8.2–8.5.
- The Calendar app should be enabled so event clicks can open in Calendar. This app still lists events if Calendar is installed as a dependency of the server calendar APIs.
- Write access to `custom_apps` (or the equivalent on Nextcloud All-in-One) and the ability to run `occ` as the web user (`www-data` on AIO).

## Install (standard Nextcloud)

Copy this directory onto the server as `custom_apps/calendar_side_panel`, fix ownership, and enable the app. From the unpacked project directory:

```bash
cp -a calendar_side_panel /var/www/html/custom_apps/calendar_side_panel
chown -R www-data:www-data /var/www/html/custom_apps/calendar_side_panel
sudo -u www-data php /var/www/html/occ app:enable calendar_side_panel
```

Adjust the Nextcloud root and web user if your server differs.

Prefer `occ app:enable` for a first install. If you run `occ upgrade` instead, **let it finish completely**. Do not interrupt it. Afterwards check:

```bash
sudo -u www-data php /var/www/html/occ app:list | grep calendar_side_panel
sudo -u www-data php /var/www/html/occ config:system:get maintenance
sudo -u www-data php /var/www/html/occ config:system:get loglevel
```

`maintenance` must be `false`. `loglevel` should be back to its normal value (usually `2`). If maintenance mode is still on, rerun `occ upgrade` to completion, then `occ maintenance:mode --off`. If logging was raised for debugging, set it back with `occ config:system:set loglevel --value=2 --type=integer`.

Do not restart the Nextcloud server or its containers unless the operator has approved that.

## Install (Nextcloud All-in-One)

On the AIO host, with this directory available as `./calendar_side_panel`:

```bash
docker cp ./calendar_side_panel nextcloud-aio-nextcloud:/var/www/html/custom_apps/calendar_side_panel
docker exec nextcloud-aio-nextcloud chown -R www-data:www-data /var/www/html/custom_apps/calendar_side_panel
docker exec -u www-data nextcloud-aio-nextcloud php occ app:enable calendar_side_panel
```

Verify:

```bash
docker exec -u www-data nextcloud-aio-nextcloud php occ app:list | grep calendar_side_panel
docker exec -u www-data nextcloud-aio-nextcloud php occ config:system:get maintenance
docker exec -u www-data nextcloud-aio-nextcloud php occ config:system:get loglevel
```

You should see `calendar_side_panel` under Enabled (currently `1.0.1`), `maintenance` = `false`, and `loglevel` = `2`.

## Upgrade

1. Back up the live folder (`custom_apps/calendar_side_panel`).
2. Bump `<version>` in `appinfo/info.xml` so Nextcloud re-registers the app. A same-version copy may still pick up PHP/JS changes, but a version bump is the reliable path.
3. Replace the folder (or `docker cp` over it) and `chown` again.
4. Run `occ app:enable calendar_side_panel`, or `occ upgrade` if you need a full upgrade. Never cut off `occ upgrade`.
5. Recheck `app:list`, `maintenance`, and `loglevel` as above.

## Uninstall

```bash
# standard:
sudo -u www-data php /var/www/html/occ app:disable calendar_side_panel
rm -rf /var/www/html/custom_apps/calendar_side_panel

# AIO:
docker exec -u www-data nextcloud-aio-nextcloud php occ app:disable calendar_side_panel
docker exec nextcloud-aio-nextcloud rm -rf /var/www/html/custom_apps/calendar_side_panel
```

## Verify after install

1. `occ app:list` shows `calendar_side_panel` under Enabled.
2. Hard-refresh a logged-in page (Ctrl+Shift+R), including Talk in the browser.
3. A calendar button should appear in the top-right header, just left of the notifications bell. Its accessible name is "Upcoming events".
4. Opening it should list remaining events for today (all-day first) plus the next 6 days, including subscription calendars. In-progress timed events should be highlighted. Ended timed events should not appear.
5. Talk Desktop may not load this header script; expect it in the web UI first.

The data endpoint (session required) is:

`GET /ocs/v2.php/apps/calendar_side_panel/api/v1/events?days=7&tz=America/New_York`

Send header `OCS-APIRequest: true`. Unauthenticated calls should return 401, not 404.

## How it works

- `BeforeTemplateRenderedListener` injects the app's JavaScript and CSS on logged-in pages (`RENDER_AS_USER`), the same header-injection pattern core apps such as Notifications use. There is no public API for adding a tab inside Talk's conversation sidebar, and this app does not patch Talk.
- `UpcomingEventsService` asks `OCP\Calendar\IManager` for every calendar on the user's principal, then `search()`es a time range. Recurring events come back as expanded occurrences. There is no `CalendarImpl`-only filter, so cached subscriptions (`CachedSubscriptionImpl`) are included.
- `EventsController` exposes the OCS route above.
- Event links match Calendar's Dashboard widget. Clicking a recurring event opens the series in Calendar, not a specific occurrence (same limitation as that widget).

## Project layout

```
appinfo/info.xml
appinfo/routes.php
lib/AppInfo/Application.php
lib/Listener/BeforeTemplateRenderedListener.php
lib/Controller/EventsController.php
lib/Service/UpcomingEventsService.php
js/calendar-side-panel.js
css/calendar-side-panel.css
img/
```

## Instructions for an AI assistant

1. Clone this repository. Keep the directory name `calendar_side_panel` when copying it into Nextcloud.
2. Do not install Talk, Calendar, or this app from a random app-store listing in place of this tree. Do not edit files under the Talk/`spreed` app.
3. Do not restart Nextcloud, AIO, or containers unless the operator explicitly approved a restart.
4. Copy the project to `.../custom_apps/calendar_side_panel`, `chown` to the web user, then `occ app:enable calendar_side_panel`.
5. If you run `occ upgrade`, wait until it exits successfully. Then confirm `maintenance` is `false` and `loglevel` is `2`.
6. Confirm `occ app:list` shows `calendar_side_panel` enabled at the version in `appinfo/info.xml`.
7. Tell the operator to hard-refresh the browser (Ctrl+Shift+R) and click the header calendar button.
8. Never print secrets (database passwords, app passwords, SSH passwords, `.env` files).
9. Before or after each Nextcloud major upgrade, bump `max-version` in `appinfo/info.xml` if needed, redeploy, and check that this app was not auto-disabled.

## License

AGPL-3.0-or-later. See `LICENSE`.
