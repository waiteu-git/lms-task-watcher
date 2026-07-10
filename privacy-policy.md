# Privacy Policy — LETUS Task Watcher

**Last updated: 2026-07-09**

## Overview

LETUS Task Watcher is a Chrome extension that helps students at Tokyo University of Science (TUS) track assignment deadlines on LETUS (the university's Moodle-based LMS) and view their timetable from the CLASS course-registration system. This policy explains what data the extension accesses and how it is handled.

**All data stays on your device. The extension does not operate any server and never transmits your data to us or any third party.**

Use of this extension is subject to the [Terms of Use](https://lms.waiteu.dev/terms). The extension does not collect any data until you accept the terms.

## Data the Extension Accesses

When you open a page or start a scan, the extension reads the following pages using your existing browser session (cookies). It never asks for or handles your username or password.

- **Course and assignment pages** on `https://letus.ed.tus.ac.jp` — to collect assignment links, deadline dates, and submission-status labels (e.g. "提出済み", "未提出").
- **Student timetable and syllabus pages** on `https://class.admin.tus.ac.jp` — to read your registered courses, class periods/rooms, and syllabus text.

From those pages, the extension extracts and stores locally:

| Data | Purpose |
|------|---------|
| Assignment title / URL | Display and link in popup and dashboard |
| Deadline date/time | Deadline display and notifications |
| Submission status text | Determine whether an assignment is submitted |
| Course name / URL | Group assignments by course, link to course |
| Timetable (course, day, period, room) | Show the weekly timetable and link assignments to slots |
| Syllabus text | Display syllabus inside the extension |
| Course-content update markers | Notify when course materials/announcements change |
| Your notes, priorities, and settings | Personal memos, notification timing, theme |

## Data Storage

All data is stored exclusively in **`chrome.storage.local`** — your local browser storage. Data never leaves your device and is never sent to any external server. This version of the extension makes no requests to any first-party or analytics backend.

## Data the Extension Does NOT Access

- Login credentials (username or password)
- Grade data
- Personal profile information beyond registered courses/timetable
- Any site other than `https://letus.ed.tus.ac.jp` and `https://class.admin.tus.ac.jp`

## Data Deletion

You can delete all stored data at any time:

1. Open the extension dashboard
2. Scroll to the **データ管理** (Data Management) section
3. Click **すべての保存データを初期化** (Reset all saved data)

Uninstalling the extension also removes all stored data automatically.

## Permissions

| Permission | Why it is needed |
|------------|-----------------|
| `storage` | Save assignment data, timetable, and settings in `chrome.storage.local` |
| `notifications` | Show deadline reminders, scan-completion, and course-update alerts |
| `alarms` | Run the once-a-day automatic scan on a schedule |
| `host_permissions: https://letus.ed.tus.ac.jp/*` | Read course and assignment pages using your login session |
| `host_permissions: https://class.admin.tus.ac.jp/*` | Read the CLASS timetable and syllabus using your login session |

## Third Parties

The extension does not use analytics, advertising, or any third-party service, and does not sell or share any data. It is an independent project by a student and is not affiliated with Tokyo University of Science, LETUS, or CLASS.

## Changes to This Policy

If this policy changes, the updated version will be committed to this repository with a new **Last updated** date.

## Contact

For questions or concerns, open an issue in the GitHub repository.
