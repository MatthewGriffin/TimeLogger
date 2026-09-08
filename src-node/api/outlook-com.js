/**
 * Local Outlook calendar access over COM.
 *
 * Calendar data comes from the Outlook desktop client on this machine rather
 * than Microsoft Graph: it needs no app registration, no tenant consent and no
 * mailbox licence, and it reads whatever account the user already has open.
 * Graph remains in use only for OneNote note backups.
 */

import { spawn } from 'child_process';

const SCRIPT_TIMEOUT_MS = 60_000;

/**
 * Outlook's OlBusyStatus, mapped onto the Graph "showAs" vocabulary so the
 * rest of the app does not need to know where an event came from.
 */
const BUSY_STATUS = {
  0: 'free',
  1: 'tentative',
  2: 'busy',
  3: 'oof',
  4: 'workingElsewhere'
};

/** OlMeetingStatus values that mean the meeting was cancelled. */
const CANCELLED_MEETING_STATUS = new Set([5, 7]);

/**
 * Outlook's Restrict() parses dates using the machine's regional short date
 * format, so the filter must be built with the current culture. Hardcoding a
 * pattern silently returns the wrong range on non-US locales (an en-GB machine
 * reads "09/04" as 9 April, not 4 September).
 */
const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$startDate = $env:TL_START
$endDate = $env:TL_END

try {
  $outlook = New-Object -ComObject Outlook.Application
} catch {
  Write-Output (ConvertTo-Json @{ ok = $false; code = 'OUTLOOK_UNAVAILABLE'; error = $_.Exception.Message } -Compress)
  exit 0
}

try {
  $namespace = $outlook.GetNamespace('MAPI')
  $calendar = $namespace.GetDefaultFolder(9)

  $items = $calendar.Items
  # Both are required before Restrict() for recurring events to be expanded
  # into individual occurrences.
  $items.IncludeRecurrences = $true
  $items.Sort('[Start]')

  $culture = [Globalization.CultureInfo]::CurrentCulture
  $pattern = $culture.DateTimeFormat.ShortDatePattern + ' ' + $culture.DateTimeFormat.ShortTimePattern

  $from = [DateTime]::ParseExact($startDate, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
  $to = [DateTime]::ParseExact($endDate, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture).AddDays(1)

  $filter = "[Start] >= '" + $from.ToString($pattern, $culture) + "' AND [Start] < '" + $to.ToString($pattern, $culture) + "'"
  $restricted = $items.Restrict($filter)

  $events = New-Object System.Collections.ArrayList
  foreach ($item in $restricted) {
    try {
      # A non-appointment (e.g. a stray mail item) has no Start property.
      if ($null -eq $item.Start) { continue }
      [void]$events.Add([pscustomobject]@{
        id = [string]$item.EntryID
        subject = [string]$item.Subject
        start = $item.Start.ToString('yyyy-MM-dd HH:mm')
        end = $item.End.ToString('yyyy-MM-dd HH:mm')
        isAllDay = [bool]$item.AllDayEvent
        busyStatus = [int]$item.BusyStatus
        meetingStatus = [int]$item.MeetingStatus
        location = [string]$item.Location
        categories = [string]$item.Categories
        isRecurring = [bool]$item.IsRecurring
        organizer = [string]$item.Organizer
      })
    } catch {
      continue
    }
  }

  Write-Output (ConvertTo-Json @{ ok = $true; events = @($events) } -Depth 4 -Compress)
} catch {
  Write-Output (ConvertTo-Json @{ ok = $false; code = 'OUTLOOK_QUERY_FAILED'; error = $_.Exception.Message } -Compress)
}
`;

/**
 * Run the COM query in PowerShell.
 *
 * The script is passed as a base64 UTF-16LE -EncodedCommand so no quoting or
 * escaping of the script body is needed, and the dates go through the
 * environment so they can never be interpolated into the script text.
 */
function runScript(startDate, endDate) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');

    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      {
        windowsHide: true,
        env: { ...process.env, TL_START: startDate, TL_END: endDate }
      }
    );

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      child.kill();
      reject(new Error('Outlook did not respond within 60 seconds. Make sure Outlook is running and not showing a dialog.'));
    }, SCRIPT_TIMEOUT_MS);

    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });

    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Could not start PowerShell: ${error.message}`));
    });

    child.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const output = stdout.trim();
      if (!output) {
        reject(new Error(stderr.trim() || 'Outlook returned no data.'));
        return;
      }

      try {
        resolve(JSON.parse(output));
      } catch {
        reject(new Error(`Could not read Outlook response: ${output.slice(0, 200)}`));
      }
    });
  });
}

/** Parse the "yyyy-MM-dd HH:mm" the script emits, avoiding any timezone shift. */
function splitLocalStamp(stamp) {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(String(stamp || ''));
  if (!match) return null;
  return { date: match[1], time: match[2] };
}

function normalizeComEvent(raw) {
  const start = splitLocalStamp(raw.start);
  const end = splitLocalStamp(raw.end);
  const showAs = BUSY_STATUS[raw.busyStatus] ?? 'busy';
  const isAllDay = Boolean(raw.isAllDay);

  // Every occurrence of a recurring series reports the same EntryID, so the
  // start time is appended to keep occurrences distinct.
  const id = raw.id
    ? (raw.isRecurring && start ? `${raw.id}:${start.date}T${start.time}` : String(raw.id))
    : null;

  return {
    id,
    subject: raw.subject || 'Untitled event',
    date: start?.date ?? null,
    startTime: start?.time ?? null,
    endTime: end?.time ?? null,
    isAllDay,
    // An all-day event marked "out of office" is leave or a holiday, whereas an
    // all-day work commitment such as a conference stays "busy".
    isTimeOff: isAllDay && showAs === 'oof',
    isCancelled: CANCELLED_MEETING_STATUS.has(raw.meetingStatus),
    showAs,
    location: raw.location || null,
    categories: raw.categories
      ? String(raw.categories).split(',').map(value => value.trim()).filter(Boolean)
      : [],
    hasRecurrence: Boolean(raw.isRecurring),
    organizer: raw.organizer || null
  };
}

/**
 * Read appointments from the local Outlook calendar between two dates
 * (inclusive, YYYY-MM-DD).
 */
export async function getLocalCalendarEvents(startDate, endDate) {
  if (process.platform !== 'win32') {
    const error = new Error('Local Outlook calendar sync is only available on Windows.');
    error.notConfigured = true;
    throw error;
  }

  const result = await runScript(startDate, endDate);

  if (!result?.ok) {
    const message = result?.code === 'OUTLOOK_UNAVAILABLE'
      ? 'Could not connect to Outlook. Make sure the Outlook desktop app is installed and running, then try again.'
      : `Outlook calendar read failed: ${result?.error || 'unknown error'}`;
    const error = new Error(message);
    error.notConfigured = result?.code === 'OUTLOOK_UNAVAILABLE';
    throw error;
  }

  return (result.events || [])
    .map(normalizeComEvent)
    .filter(event => event.date && event.date >= startDate && event.date <= endDate);
}

/** Report whether the local Outlook client can be reached. */
export async function testOutlookCom() {
  try {
    const today = new Date().toLocaleDateString('en-CA');
    const events = await getLocalCalendarEvents(today, today);
    return { success: true, message: `Connected to Outlook (${events.length} event(s) today)`, count: events.length };
  } catch (error) {
    return { success: false, message: error.message };
  }
}
