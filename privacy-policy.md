# Privacy Policy — LETUS Task Watcher

**Last updated: 2026-06-28**

## Overview

LETUS Task Watcher is a Chrome extension that helps students at Tokyo University of Science track assignment deadlines on LETUS (the university's Moodle-based LMS). This policy explains what data the extension accesses and how it is handled.

## Data the Extension Accesses

When you initiate a scan, the extension fetches the following pages using your existing browser session (cookies):

- **Course pages** on `https://letus.ed.tus.ac.jp` — to collect links to assignment activities
- **Assignment activity pages** on `https://letus.ed.tus.ac.jp` — to read deadline dates, submission status labels (e.g. "提出済み", "未提出"), and start/end availability text

From those pages, the extension extracts and stores locally:

| Data | Purpose |
|------|---------|
| Assignment title | Display in popup and dashboard |
| Assignment URL | Link to the assignment page |
| Deadline date/time | Deadline display and notifications |
| Submission status text | Determine whether the assignment has been submitted |
| Course name and URL | Group assignments by course |

## Data Storage

All extracted data is stored exclusively in **`chrome.storage.local`** — your local browser storage. Data never leaves your device and is never sent to any external server.

## Data the Extension Does NOT Access

- Login credentials (username or password)
- Personal profile information
- Grade data
- Any pages outside of `https://letus.ed.tus.ac.jp`

## Data Deletion

You can delete all stored data at any time:

1. Open the extension dashboard
2. Scroll to the **データ管理** (Data Management) section
3. Click **すべての保存データを初期化** (Reset all saved data)

Uninstalling the extension also removes all stored data automatically.

## Permissions

| Permission | Why it is needed |
|------------|-----------------|
| `storage` | Save assignment data and settings in `chrome.storage.local` |
| `notifications` | Show deadline reminders and scan completion alerts |
| `host_permissions: https://letus.ed.tus.ac.jp/*` | Fetch course and assignment pages using your login session |

## Changes to This Policy

If this policy changes, the updated version will be committed to this repository with a new **Last updated** date.

## Contact

For questions or concerns, open an issue in the GitHub repository.
