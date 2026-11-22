---
id: sync-troubleshooting
title: Sync Troubleshooting and Error Codes
doc_type: troubleshooting
tiers: [all]
effective_date: 2026-09-01
---

# Sync Troubleshooting and Error Codes

The Northstar desktop app keeps your files in sync with the cloud. When something goes wrong, the app shows an error code. Use this page to find out what the code means and how to fix it.

## Sync error codes

| Error code | What it means | How to fix it |
| --- | --- | --- |
| E-1042 | Sync error E-1042 means your workspace's storage quota is exceeded. | Delete or move files to free up space, or have the workspace owner upgrade to a plan with more storage. |
| E-2210 | Sync error E-2210 means your session or sign-in token has expired. | Sign out of the Northstar desktop app and sign back in. |
| E-3307 | Sync error E-3307 means a conflict copy was created because two people edited the same file while offline. | Compare the original file with the conflict copy, keep the changes you want, and delete the extra copy. |
| E-4410 | Sync error E-4410 means the file exceeds the maximum file size for your plan (2 GB on Starter, 15 GB on Pro, 50 GB on Enterprise). | Compress or split the file, or upgrade to a plan with a larger file size limit. |
| E-5001 | Sync error E-5001 means there is a server-side sync outage on Northstar's side. | Check status.northstar.example for updates; nothing is wrong on your computer. |

## First steps for any sync problem

1. Check status.northstar.example to see whether there is a known incident.
2. Make sure your computer is online and the Northstar desktop app is running.
3. Pause sync and resume it from the app's menu.
4. Quit and reopen the desktop app.
5. If the problem continues, note the error code and contact support.

## Conflict copies (E-3307)

A conflict copy appears when two people edit the same file while offline, or when the same file changes on two devices before either has synced. Northstar never overwrites anyone's work in that case. It keeps the original file and saves the other version next to it as a conflict copy, labelled with the editor's name and the date. Open both versions, merge the changes into one file, and delete the copy you no longer need.

## Expired session (E-2210)

Error E-2210 means the desktop app's sign-in session has expired, for example after a password change. Sign out of the desktop app and sign back in. Your files stay on your computer and sync resumes after you sign in again.

## Storage and file size errors (E-1042 and E-4410)

E-1042 stops new files from syncing until the workspace is back under its storage quota. E-4410 affects only the file that is too large; other files keep syncing. See Storage and Seats for the limits on each plan.

## Service outages (E-5001)

E-5001 means the problem is on Northstar's side, not yours. You don't need to reinstall the app or change any settings. Follow the incident on status.northstar.example; sync resumes automatically once the incident is resolved.

## Contacting support about sync

Include the error code, the name of the affected file or folder, and roughly when the problem started. This lets support find the issue much faster.
