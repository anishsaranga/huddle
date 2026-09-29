# Ingest API: `POST /api/ingest`

The one endpoint the iPhone Shortcut ("Huddle Sync", "Huddle Backfill") pushes Apple Health data to.
Code: `src/app/api/ingest/route.ts` (thin) and `src/lib/ingest/*`. The metric list comes from
`src/lib/health/fields.ts`; the table below is checked against it by `tests/unit/ingest-docs.test.ts`.

## Authentication

Send your personal key (`gk_…`, 46 characters) in the `Authorization` header:

```
Authorization: Bearer gk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

`?key=gk_…` in the URL also works, as a fallback for clients that can't set headers.

> **Prefer the header.** URLs, query string included, end up in proxy, CDN and browser logs. Huddle
> itself never logs the query string (only the path), but it can't control what sits in between.

A missing, malformed, unknown or revoked key, or a key of a deactivated account, gets a bare `401` with an
empty body. Those requests aren't stored anywhere; the server logs only the IP, the reason and the auth
method (`bearer`, `query` or `none`).

## Limits

| What | Limit | Over the limit |
| --- | --- | --- |
| Requests per key | 60 per sliding hour | `429` with `Retry-After` (seconds) |
| Requests per client IP (counted before auth) | 60 per sliding hour | `429` with `Retry-After` |
| Body size | 3 MB, on the wire and after gzip decompression | `413` |
| Days per request (series: `window` span, or dates covered without one) | 366 | `400` |
| Sleep segments per request | 5,000 | `400` |
| `hr_hourly` rows per day | 48 in, at most 24 stored (one per hour) | `400` |
| Series: rows per metric / `hr` rows per request | 20,000 / 17,568 | `400` |
| Dates (and a series `window`) | from today − 400 to today + 1, in your timezone | `400` |

Rate limits are in memory on the single app instance (they reset on restart). The client IP is
`CF-Connecting-IP` (set by the Cloudflare tunnel), else the first `X-Forwarded-For` entry.

`Content-Encoding: gzip` (or `x-gzip`) is accepted; the 3 MB cap applies to the decompressed size too, so
a small "zip bomb" gets a `413`. Other encodings get `415`. The daily Shortcut doesn't need gzip (a normal
3-day sync is about 15 KB).

## Payload

The body is JSON in one of four shapes:

1. a single **Day** object: `{ "date": "2026-09-28", "steps": 8123 }`
2. an array of Days: `[{ "date": "2026-09-27", … }, { "date": "2026-09-28", … }]`
3. an object: `{ "days": [Day, …], "sleep_segments"?: Segments, "tz"?: "Europe/Berlin" }`
4. a **series** object: `{ "series": { metric: Columns, … }, "window"?, "hr"?, "sleep_segments"?, "tz"?, "meta"? }`,
   one column pair per metric over a whole window. **Recommended for Shortcuts**: see
   [Series](#series-recommended-for-shortcuts).

An object with a `series` key is the series shape, one with `days` the object form, anything else a Day.

`tz` (object and series forms) is an IANA timezone used to interpret local dates and wall-clock times.
When it's missing or not a valid IANA name, your profile timezone is used, else UTC. Invalid values are
ignored (and noted in the ingest log), not rejected.

### Day

| Key | Required | Meaning |
| --- | --- | --- |
| `date` | yes | Local date, `YYYY-MM-DD`, a real calendar date. |
| any metric below | no | The day's value. See "Values". |
| `hr_hourly` | no | Heart rate per local hour. See below. |
| `sleep_segments` | no | Raw sleep samples. Pooled with the top-level ones and assigned to nights by time. |

A day that appears twice in one request is merged: later keys win.

### Metrics

<!-- metric-table:start -->
| Key | What | Unit | Type | Valid range | Several values for a day (series) | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `steps` | Steps | count | int | 0 to 200,000 | summed | rounded to a whole number |
| `distance_m` | Walking + running distance | m | float | 0 to 500,000 | summed |  |
| `flights` | Flights climbed | count | int | 0 to 2,000 | summed | rounded to a whole number |
| `active_kcal` | Active energy | kcal | float | 0 to 15,000 | summed |  |
| `resting_kcal` | Resting energy | kcal | float | 0 to 10,000 | summed |  |
| `exercise_min` | Exercise minutes | min | float | 0 to 1,440 | summed |  |
| `stand_min` | Stand minutes | min | float | 0 to 1,440 | summed |  |
| `daylight_min` | Time in daylight | min | float | 0 to 1,440 | summed |  |
| `mindful_min` | Mindful minutes | min | float | 0 to 1,440 | summed |  |
| `resting_hr` | Resting heart rate | bpm | float | 20 to 200 | averaged |  |
| `walking_hr_avg` | Walking heart rate average | bpm | float | 30 to 230 | averaged |  |
| `hrv_sdnn_ms` | Heart rate variability (SDNN) | ms | float | 1 to 500 | averaged |  |
| `vo2max` | VO2 max | mL/kg/min | float | 5 to 100 | averaged |  |
| `spo2_pct` | Blood oxygen | % | float | 50 to 100 | averaged | a 0-1 fraction is multiplied by 100 |
| `resp_rate` | Respiratory rate | breaths/min | float | 4 to 60 | averaged |  |
| `wrist_temp_c` | Sleeping wrist temperature | °C | float | 25 to 45 | averaged |  |
| `weight_kg` | Weight | kg | float | 20 to 400 | averaged |  |
| `body_fat_pct` | Body fat | % | float | 1 to 80 | averaged | a 0-1 fraction is multiplied by 100 |
<!-- metric-table:end -->

Values must already be in the unit shown (the guide's Shortcut asks Health for these units).

### Values

Shortcuts often sends numbers as text, so any of these work:

- JSON numbers: `7412`, `51.5`
- numeric strings: `"7412"`, `"7412.0"`, `" 51 "`, `"-3.5"`, `".5"`
- comma thousands separators, only in the unambiguous form `"7,412"` / `"1,234,567.89"` (`"51,5"` is rejected)

Anything else (`"lots"`, `"12 steps"`, `true`) is a `400`. Out-of-range values are a `400` for that field,
never silently clamped. Int fields are rounded. SpO2 and body fat given as a fraction ≤ 1 are multiplied by
100 when that lands in range (so `0.97` → 97 %, but a body fat of `1` stays 1 %).

**Absent, `null` and empty:**

| In the payload | Stored value |
| --- | --- |
| key left out | untouched (whatever was stored stays) |
| `null` | cleared (NULL) |
| `""` or whitespace (what an empty Shortcut variable becomes) | cleared, like `null` |

Every other day column is updated only if its key is present. Re-sending a day is always safe: the Shortcut
sends full-day snapshots, so the newest snapshot wins.

### `hr_hourly`

Present for a day → that day's stored hourly rows are **replaced** by these (`[]`, `null` or empty columns
clear them). Absent → stored rows untouched.

Either an array of rows:

```json
"hr_hourly": [
  { "hour": 0, "avg": 58, "min": 52, "max": 66 },
  { "start": "2026-09-28T01:00:00+02:00", "avg": 55 }
]
```

or **columns** as newline-joined strings (what a Shortcut builds with "Combine Text" and no loops) or arrays:

```json
"hr_hourly": {
  "starts": "2026-09-28T00:00:00+02:00\n2026-09-28T01:00:00+02:00\n",
  "avg": "58\n55\n",
  "min": "52\n",
  "max": "66\n61"
}
```

- `hour` (0-23, local) or `start` (a timestamp, converted to the local hour in your timezone). In the column
  form give exactly one of `hours` / `starts`.
- `avg` is required per row (bpm, 20-250); `min` / `max` are optional. A row with an empty `avg` is dropped.
- All columns must have the same number of rows. One trailing newline is fine; the row count comes from
  `starts`/`hours` without trailing blank lines, so an empty last value (`"52\n"` above) still counts as a row.
- A `start` that falls on another local date than the Day's `date` is dropped (and counted), not an error.
- Duplicate hours: the last row wins.

### Sleep segments

Raw Health sleep-analysis samples, at the top level (object form) and/or per Day. They're pooled; which
night they belong to is worked out from the times, not from the Day they came in.

```json
"sleep_segments": [
  { "stage": "Core", "start": "2026-09-27T23:04:00+02:00", "end": "2026-09-28T00:31:00+02:00", "source": "Apple Watch" }
]
```

or columns: `{ "stages": "…\n…", "starts": "…", "ends": "…", "sources"?: "…" }` (newline strings or arrays;
row count from `starts`).

- **Stages** (case, spaces and punctuation ignored): `In Bed` → in_bed; `Asleep`, `Asleep Unspecified`,
  `Unspecified` → asleep; `Awake`; `Core` or `Light` (Fitbit) → core; `Deep`; `REM`. HealthKit's numeric
  codes 0-5 work too. Unknown stages are dropped and counted in the ingest log.
- `source`: the writing app/device as Health reports it (optional; empty when unknown).
- Segments with `end < start`, longer than 24 h, or exact duplicates are dropped and counted.

**How nights are built:** segments (all sources together) are sorted and split into sessions wherever there's
a gap of 90 minutes or more. A session belongs to the local date of its last `end` (its wake date). Sessions
with under 60 minutes asleep that end between 10:00 and 18:00 are naps and are ignored. For each wake date in
the payload the stored segments are **replaced** (the Shortcut resends whole nights) and the night summary is
recomputed:

- the source with stage detail (core/deep/rem) wins, then the one with the most sleep, then alphabetical;
- stage minutes are interval unions per stage (overlapping samples never double count);
- time in bed is the union of `In Bed` samples from any source (the iPhone usually writes those), else the
  chosen source's first-to-last span;
- awake is the chosen source's `Awake` time, else in bed − asleep.

Wake dates the payload doesn't mention are left alone. If a new session overlaps segments stored under a
different wake date (a night first synced half-finished), those older segments are removed and that night is
recomputed.

### Series (recommended for Shortcuts)

The Shortcut runs whenever you open a frequently used app, so it has to be fast. Looping over days and
metrics costs dozens of slow "Find Health Samples" actions. Instead, run **one** "Find Health Samples" per
metric over the whole window, **Group By Day** (Group By Hour for heart rate), and send each result as two
newline-joined columns: the group start dates and the values. The server turns them into days.

```json
{
  "tz": "Asia/Kolkata",
  "window": { "from": "2026-09-26", "to": "2026-09-29" },
  "series": {
    "steps":       { "starts": "Sep 26, 2026 at 12:00 AM\nSep 27, 2026 at 12:00 AM\nSep 28, 2026 at 12:00 AM\nSep 29, 2026 at 12:00 AM",
                     "values": "7412\n9020\n8311\n2104" },
    "active_kcal": { "starts": "Sep 26, 2026 at 12:00 AM\nSep 28, 2026 at 12:00 AM", "values": "412.5\n388" },
    "resting_hr":  { "starts": "Sep 26, 2026 at 12:00 AM\nSep 27, 2026 at 12:00 AM\nSep 28, 2026 at 12:00 AM", "values": "52\n53\n51" },
    "hrv_sdnn_ms": { "starts": "", "values": "" }
  },
  "hr": {
    "starts": "Sep 28, 2026 at 11:00 PM\nSep 29, 2026 at 12:00 AM\nSep 29, 2026 at 1:00 AM",
    "avg": "58\n55\n54",
    "min": "52\n50\n49",
    "max": "66\n61\n60"
  },
  "sleep_segments": {
    "stages": "In Bed\nCore\nDeep\nREM\nAwake",
    "starts": "Sep 28, 2026 at 10:51 PM\nSep 28, 2026 at 11:04 PM\nSep 29, 2026 at 12:31 AM\nSep 29, 2026 at 1:12 AM\nSep 29, 2026 at 6:40 AM",
    "ends": "Sep 29, 2026 at 6:58 AM\nSep 29, 2026 at 12:31 AM\nSep 29, 2026 at 1:12 AM\nSep 29, 2026 at 2:03 AM\nSep 29, 2026 at 6:52 AM",
    "sources": "Anish’s iPhone\nApple Watch\nApple Watch\nApple Watch\nApple Watch"
  },
  "meta": { "shortcut_version": "1", "device": "iPhone 15" }
}
```

Sent on 2026-09-29 (today), this writes, per local date:

| Date | `steps` | `active_kcal` | `resting_hr` | `hrv_sdnn_ms` | other metrics |
| --- | --- | --- | --- | --- | --- |
| 2026-09-26 | 7412 | 412.5 | 52 | cleared (null) | untouched |
| 2026-09-27 | 9020 | **cleared (null)** | 53 | cleared (null) | untouched |
| 2026-09-28 | 8311 | 388 | 51 | cleared (null) | untouched |
| 2026-09-29 (today) | 2104 | untouched | untouched | untouched | untouched |

plus hourly heart rate for 2026-09-28 (hour 23) and 2026-09-29 (hours 0 and 1), and the night waking on
2026-09-29.

**Keys:**

| Key | Required | Meaning |
| --- | --- | --- |
| `series` | yes (may be `{}` when there's `hr` or sleep) | `{ "<metric>": { "starts", "values" } }`: any metric name from the table above. Columns are newline-joined text or arrays, one row per group. Unknown metric names are recorded as unknown fields (by name), never stored. |
| `window` | no, but **recommended** | `{ "from", "to" }`: the local dates (inclusive) the Shortcut looked at. At most 366 days, `from` ≤ `to`, and inside the usual date limits. |
| `hr` | no | Hourly heart-rate groups over the window: `{ "starts", "avg", "min"?, "max"? }` columns (or an array of `{ start, avg, min?, max? }` rows). `starts` are required (`hours` would be ambiguous across days). |
| `sleep_segments` | no | Exactly as in the other shapes. |
| `tz` | no | As above. |
| `meta` | no | Anything about the sender, e.g. `{ "shortcut_version": "1", "device": "iPhone 15" }`. Recorded in the ingest log (up to 20 string / number / boolean / null values), never stored as metrics. |

**How rows become days:**

- **Starts** can be ISO 8601 timestamps, Shortcuts' English formats (`Sep 28, 2026 at 12:00 AM`, narrow
  no-break space included, `28 Sep 2026 at 00:00`), or plain dates (`2026-09-28`, `Sep 28, 2026`). Each start
  maps to its local date in `tz`. An unparseable start is a `400` naming the series and row.
- **Timezone guard:** when every start of a series lies within 2 hours of a local midnight, the series is
  taken as grouped by day in a slightly different timezone (say, the phone sends `+02:00` offsets and your
  profile is London), and each start is rounded to the nearest midnight: `23:00` the day before counts for
  the next date. Every start that wasn't exactly midnight is counted (`tzAdjustments` in the ingest log).
  A series whose starts are spread over the day (ungrouped samples) is left as is.
- **Window:** only dates inside `window` are written. Rows outside it are dropped and counted
  (`outsideWindow`). That's deliberate: the first group of a rolling "in the last N days" query is a
  partial day, so set `window.from` to the first *full* day.
- **Null fill (full-snapshot semantics):** Health omits days without samples. So, with a `window`, a metric
  whose series **was sent** but has no row for a window date gets an explicit `null` for that date ("we looked
  and there was nothing"; counted per metric as `nullFilled`). An empty series (`"starts": ""`) clears the
  metric for the whole window. **Exception:** this only applies to dates up to *yesterday*. Today may still
  be syncing from the watch, so a metric missing today stays untouched rather than wiping a value an earlier
  sync stored. Metrics **not sent** at all are always untouched. Without a `window` there's no null fill:
  absent dates are just absent (and the dates written are those appearing in any series or `hr`).
- **Several rows for one date** (the Shortcut forgot "Group By"): cumulative metrics are summed, the others
  averaged (see the table above). Empty values are ignored; all empty means `null`. The per-metric count of
  such dates is logged as `multiValueDates`, so the admin can spot a missing "Group By". Each value is range
  checked on its own, and the combined value again.
- A row with an empty value writes `null` for that date. Values are coerced like everywhere else
  ("Values" above); columns of different lengths are a `400` naming the series.
- **`hr`:** each start maps to its local date and hour (floored, no midnight rounding). Dates with at least
  one row with an `avg` get their hourly rows **replaced**; every other date is left alone, even inside the
  window (gaps in heart rate are common). Rows without `avg` are dropped; duplicate (date, hour): the last
  row wins; rows outside the window are dropped and counted.

Everything after that is shared with the other shapes: range checks, the date limits, the upsert (explicit
null clears, absent is untouched), sleep nights, the ingest log and score recomputation.

### Timestamps

- ISO 8601 with an offset or `Z`: `2026-09-28T23:42:00+02:00`, `2026-09-28T21:42:00Z` (**recommended**; the
  setup guide formats dates this way).
- ISO 8601 without an offset: `2026-09-28T23:42:00`, read as wall-clock time in your timezone.
- Shortcuts' English default formats, read in your timezone: `Sep 28, 2026 at 11:42 PM`,
  `28 Sep 2026 at 23:42` (including the narrow no-break space iOS puts before AM/PM). Other locales aren't
  supported: format dates as ISO 8601.
- Series `starts` may also be plain dates: `2026-09-28`, `Sep 28, 2026`, `28 Sep 2026`.

An unparseable timestamp is a `400`.

### Unknown fields

Keys Huddle doesn't know are **not** errors. They're listed in the response (`unknown_fields`) and recorded
with counts and value types in the ingest log (day-level keys and unknown series metric names by name;
others as `top.x`, `hr_hourly.x`, `sleep_segments.x`, and in the series shape `series.x` (inside a metric's
columns), `hr.x`, `window.x`). They're never written to the metric tables, but they stay in the raw body kept in
`ingest_events`, so new data a Shortcut starts sending is visible.

## Responses

All responses carry `Cache-Control: no-store`.

| Status | Body | When |
| --- | --- | --- |
| `200` | `{ "ok": true, "days_written", "date_range": { "from", "to" }, "last_sync_at", "unknown_fields": [...] }` | Stored. |
| `400` | `{ "error": "validation", "issues": [{ "path": [...], "message" }] }` (at most 50 issues) | Bad structure, values, dates or timestamps. Nothing is stored. |
| `400` | `{ "error": "invalid_json", "detail" }` / `{ "error": "invalid_gzip" }` | Body isn't UTF-8 JSON / isn't gzip. |
| `401` | *(empty)* | Missing, malformed, unknown or revoked key; deactivated account. |
| `405` | `{ "error": "method_not_allowed" }` | Not a POST (`Allow: POST`). |
| `413` | `{ "error": "too_large", "max_bytes": 3145728 }` | Over 3 MB (declared, streamed, or decompressed). |
| `415` | `{ "error": "unsupported_encoding" }` | `Content-Encoding` other than gzip/identity. |
| `429` | `{ "error": "rate_limited", "retry_after" }` + `Retry-After` header | Over 60 requests/hour for the key or IP. |
| `500` | `{ "error": "internal" }` | Database failure; nothing was stored (one transaction). |

`issues[].path` follows your payload's shape: `["steps"]` for a single Day, `[0, "steps"]` for an array,
`["days", 0, "steps"]` for the object form, `["series", "steps", "values", 3]` / `["series", "steps"]` (whole
series, e.g. column lengths) / `["hr", "starts", 0]` / `["window", "from"]` for the series shape. Date-window and
timestamp issues use `["date"]`, `["<date>", "hr_hourly", i, "start"]` or `["sleep_segments", i, "start"]`.

## What gets recorded

Every authenticated request (any status) gets an `ingest_events` row: status, `bearer`/`query`, bytes,
duration, a summary (payload `shape`: `day` / `array` / `days` / `series`; per-day field inventory: present /
explicit null / absent; unknown fields; hourly and sleep counts; sources and stages; nights written; naps
ignored; dropped rows by reason; rows inserted vs updated; timezone used; gzip; for the series shape also
`meta`, `window`, `tzAdjustments`, `multiValueDates`, `nullFilled` and `outsideWindow`), the raw JSON body (the first 64 KB of text when it wasn't valid JSON), and any
errors. The key is never stored: fields named `key` / `api_key` / `token` / … and anything shaped like a
`gk_` key are replaced with `[REDACTED]`. One `info` log line per request carries the same highlights; the
full body is logged at `debug`.

## Examples

Single day (Bearer):

```sh
curl -sS https://huddle.example.com/api/ingest \
  -H "Authorization: Bearer $HUDDLE_KEY" -H "Content-Type: application/json" \
  -d '{"date":"2026-09-28","steps":"8,123","resting_hr":52,"spo2_pct":0.97,"hrv_sdnn_ms":null}'
```

The recommended daily Shortcut payload is the series shape: see the full example under
[Series](#series-recommended-for-shortcuts).

The older per-day object form (3 days, columnar, what "Combine Text with New Lines" produces inside a loop):

```json
{
  "tz": "Europe/Berlin",
  "days": [
    {
      "date": "2026-09-28",
      "steps": "8123",
      "active_kcal": "412.5",
      "resting_hr": "52",
      "hr_hourly": {
        "starts": "2026-09-28T00:00:00+02:00\n2026-09-28T01:00:00+02:00\n2026-09-28T02:00:00+02:00",
        "avg": "58\n55\n54",
        "min": "52\n50\n49",
        "max": "66\n61\n60"
      }
    },
    { "date": "2026-09-27", "steps": "10456", "resting_hr": "53" },
    { "date": "2026-09-26", "steps": "7210", "resting_hr": "" }
  ],
  "sleep_segments": {
    "stages": "In Bed\nCore\nDeep\nREM\nAwake",
    "starts": "2026-09-27T22:51:00+02:00\n2026-09-27T23:04:00+02:00\n2026-09-28T00:31:00+02:00\n2026-09-28T01:12:00+02:00\n2026-09-28T06:40:00+02:00",
    "ends": "2026-09-28T06:58:00+02:00\n2026-09-28T00:31:00+02:00\n2026-09-28T01:12:00+02:00\n2026-09-28T02:03:00+02:00\n2026-09-28T06:52:00+02:00",
    "sources": "Anish’s iPhone\nApple Watch\nApple Watch\nApple Watch\nApple Watch"
  }
}
```

Backfill: the series shape with a longer `window`, or the object form, with up to 366 days per request (the Backfill Shortcut sends 30-day chunks of
about 150 KB).

Gzip:

```sh
gzip -c payload.json > payload.json.gz
curl -sS https://huddle.example.com/api/ingest \
  -H "Authorization: Bearer $HUDDLE_KEY" -H "Content-Type: application/json" -H "Content-Encoding: gzip" \
  --data-binary @payload.json.gz
```

Query-string key (works, but see the warning above):

```sh
curl -sS "https://huddle.example.com/api/ingest?key=$HUDDLE_KEY" -H "Content-Type: application/json" -d @payload.json
```
