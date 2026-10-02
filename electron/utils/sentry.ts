import * as Sentry from '@sentry/electron/main';
import { app } from 'electron';
import {
    buildExtractionFailureEvent,
    buildThinFormatEvent,
    buildDownloadFailureEvent,
    scrubEvent,
    scrubBreadcrumb,
    ExtractionFailureReport,
    ThinFormatReport,
    DownloadFailureReport
} from './telemetry';

/**
 * Error reporting for the main process.
 *
 * The SDK is initialised here and nowhere else. That is on purpose:
 *
 *  - One DSN in one file, so there is nothing to keep in sync.
 *  - The renderer client has no DSN and ships its events to this process over the
 *    SDK's custom protocol. A renderer's HTTP instrumentation would otherwise
 *    put every URL the app loads in an event.
 *  - Everything that reaches this file has been through `telemetry`, which is
 *    where the redaction lives.
 *
 * Development builds stay silent. A report generated while working on the app
 * is noise in the issue list, and it pushes real reports out of the way.
 */

/**
 * Set in the environment to report from a dev build. Needed to verify a fix
 * without shipping one first.
 */
const SEND_FROM_DEV = 'VD_SENTRY';

/**
 * The DSN comes from the environment, never from this file.
 *
 * `.env` is already gitignored and `utils/env.ts` loads it from the app's
 * resources directory when packaged, so the release workflow supplies this and
 * a checkout without one simply does not report. Nothing to rotate in git, and
 * nothing that leaks into a diff.
 */
const DSN_ENV = 'SENTRY_DSN';

let initialised = false;

/** True when this process reports. The gate for every reporter below. */
export function isSentryInitialised(): boolean {
    return initialised;
}

/**
 * Idempotent, and safe to call when reporting is off. `main.ts` calls it before
 * anything that can fail, so that a crash during the first window is still a
 * report rather than a silent exit.
 */
export function initSentry(): boolean {
    if (initialised) return true;
    if (!app?.isPackaged && process.env[SEND_FROM_DEV] !== '1') return false;

    // No DSN means no reporting, including in a packaged build: an app built
    // without one is the normal case for a local or private build, and a
    // half-configured reporter is worse than none.
    const dsn = process.env[DSN_ENV]?.trim();
    if (!dsn) return false;

    Sentry.init({
        dsn,
        // No accounts, no IPs, no machine identity beyond what an IP header
        // already implies.
        sendDefaultPii: false,
        // Enough to spot a regression in startup or a download, not enough to
        // bill like a monitoring product.
        tracesSampleRate: 0.1,
        // The useful trail for a fetch bug is a handful of steps, not a full
        // session replay of clicks.
        maxBreadcrumbs: 60,
        beforeSend(event) {
            return scrubEvent(event) || null;
        },
        beforeBreadcrumb(breadcrumb) {
            return scrubBreadcrumb(breadcrumb);
        }
    });

    initialised = true;
    return true;
}

/**
 * Called on quit.
 *
 * A report sent during shutdown is usually the one that matters, and the
 * process does not outlive us to retry it.
 */
export function flushSentry(): void {
    if (!initialised) return;
    void Sentry.flush(2000);
}

/** Report a metadata fetch that produced nothing. Returns whether it was sent. */
export function reportExtractionFailure(report: ExtractionFailureReport): boolean {
    if (!initialised) return false;
    const event = buildExtractionFailureEvent(report);
    if (!event) return false;
    Sentry.captureEvent(event);
    return true;
}

/** Report a successful fetch that returned too few formats to be useful. */
export function reportThinFormatList(report: ThinFormatReport): boolean {
    if (!initialised) return false;
    const event = buildThinFormatEvent(report);
    if (!event) return false;
    Sentry.captureEvent(event);
    return true;
}

/** Report a transfer that could not start or finish. A different problem from a fetch failure. */
export function reportDownloadFailure(report: DownloadFailureReport): boolean {
    if (!initialised) return false;
    const event = buildDownloadFailureEvent(report);
    if (!event) return false;
    Sentry.captureEvent(event);
    return true;
}
