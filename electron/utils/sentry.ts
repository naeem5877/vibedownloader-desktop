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
 * Replacement DSN, so the committed one can be swapped without a code change.
 */
const DSN_ENV = 'SENTRY_DSN';

const DSN = process.env[DSN_ENV] || 'https://6c88f371c5a7714b49d595dad64def03@o4511882967121920.ingest.de.sentry.io/4512188514697296';

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

    Sentry.init({
        dsn: DSN,
        // No accounts, no IPs, no machine identity beyond what an IP header
        // already implies.
        sendDefaultPii: false,
        enabled: true,
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
