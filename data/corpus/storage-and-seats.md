---
id: storage-and-seats
title: Storage and Seats
doc_type: guide
tiers: [all]
effective_date: 2026-09-01
---

# Storage and Seats

Each Northstar plan includes a storage quota, a maximum file size, and a number of seats. This guide explains the limits and what happens when you reach them.

## Limits by plan

| Plan | Storage quota | Maximum file size | Seats |
| --- | --- | --- | --- |
| Starter | Starter includes 100 GB of storage per workspace. | Starter allows files up to 2 GB each. | Starter allows up to 5 seats. |
| Pro | Pro includes 1 TB of storage per workspace. | Pro allows files up to 15 GB each. | Pro allows up to 50 seats. |
| Enterprise | Enterprise includes unlimited storage. | Enterprise allows files up to 50 GB each. | Enterprise allows unlimited seats. |

## How storage is counted

Storage is shared by the whole workspace: every member's files count toward the same workspace quota. The workspace owner can see current usage under Settings → Billing.

## When you reach your storage limit

When a workspace reaches its storage quota, new and changed files stop uploading and syncing, and the desktop app shows sync error E-1042. Files already stored stay available to view and download. To start syncing again, delete or move files you no longer need, or have the workspace owner upgrade to a plan with more storage (Starter 100 GB, Pro 1 TB, Enterprise unlimited). Upgrades apply immediately.

## Files larger than your plan's limit

A single file larger than your plan's maximum file size cannot be uploaded, and the desktop app shows sync error E-4410 for that file. The maximum file size is 2 GB on Starter, 15 GB on Pro, and 50 GB on Enterprise. Compress or split the file, or upgrade to a plan with a higher limit. Other files keep syncing normally.

## Seats and members

Each member of a workspace uses one seat. Starter allows up to 5 seats, Pro up to 50 seats, and Enterprise unlimited seats. Seats are included in your plan price, so there is no separate per-seat charge on Starter or Pro. The workspace owner invites members under Settings → Members.

## Adding more members than your plan allows

When every seat is in use, you can't invite another member until a seat is free. Remove a member who no longer needs access to free their seat, or have the workspace owner upgrade the plan. A Starter workspace that needs a sixth member must move to Pro; a Pro workspace that needs more than 50 members must move to Enterprise.

## Removing members

When the owner removes a member, their seat is freed immediately. Files the member added to shared folders stay in the workspace and keep counting toward the workspace's storage quota.

## Version history

Northstar keeps earlier versions of your files for 30 days on Starter, 180 days on Pro, and without a time limit on Enterprise. You can restore an earlier version from the file's version history.
