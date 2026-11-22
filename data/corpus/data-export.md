---
id: data-export
title: Exporting Your Data
doc_type: guide
tiers: [all]
effective_date: 2026-09-01
---

# Exporting Your Data

You can download a full copy of your Northstar workspace at any time, on every plan. Exporting is especially important before you close your account.

## What a workspace export contains

A workspace export is delivered as one or more ZIP archives. It contains:

- Every file and folder in the workspace, in its original file format, with the folder structure preserved.
- The current version of each file (earlier versions in version history are not included).
- A CSV file listing workspace members and their roles.
- A CSV file listing shared folders and who they are shared with.

## Exporting your whole workspace

1. Sign in as the workspace owner.
2. Go to Settings → Data → Export workspace.
3. Click **Start export**.
4. Northstar prepares the ZIP archive in the background. Large workspaces are split into several ZIP parts.
5. When the export is ready, the workspace owner receives an email with a download link. The link is also shown on the Export workspace page.

Only the workspace owner can export the whole workspace. Other members can download the files and folders they have access to.

## Downloading individual files and folders

Any member can download files and folders they have access to. Select them in the web app and choose **Download**. A single file downloads in its original format; a folder or multiple files download as a ZIP archive.

## Exporting before you close your account

Cancellation takes effect at the end of your current billing period. After the account closes, Northstar keeps your data for 30 days and then permanently deletes it, and deleted data cannot be recovered. Run a full workspace export and check that the download is complete before the account closes. See Cancellation and Data Retention for details.

## Exporting audit logs
<!-- tiers: enterprise -->

Enterprise workspace admins can export audit logs as a CSV file from Settings → Security → Audit logs. Choose a date range and click **Export CSV**. Audit logs are an Enterprise-only feature.

## Exporting with the API

Developers can also copy data out of Northstar with the API, which is available on every plan. Large API exports should be paced to stay within your plan's per-minute rate limit; see API Rate Limits.

## Troubleshooting exports

- **The export is taking a long time.** Large workspaces take longer to prepare. You can close the page; the owner gets an email when it's ready.
- **A download stopped partway.** Download that ZIP part again from the Export workspace page.
- **Files are missing from the export.** Check that you exported as the workspace owner; member downloads only include files that member can access.
