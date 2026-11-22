---
id: api-rate-limits
title: API Rate Limits
doc_type: guide
tiers: [all]
effective_date: 2026-09-01
---

# API Rate Limits

The Northstar API is available on every plan. To keep the service fast for everyone, each workspace can make a limited number of API requests per minute, and that limit depends on your plan.

## Rate limits by plan

| Plan | API rate limit |
| --- | --- |
| Starter | Starter workspaces can make up to 60 API requests per minute. |
| Pro | Pro workspaces can make up to 600 API requests per minute. |
| Enterprise | Enterprise workspaces can make up to 3,000 API requests per minute. |

## How the limit is counted

Requests are counted per workspace over a rolling one-minute window, across all API keys created in that workspace. Every API request counts toward the limit, including requests that return an error.

## What happens when you exceed the limit

When your workspace goes over its per-minute limit, the API responds with HTTP status **429 Too Many Requests**. The response includes a `Retry-After` header that tells you how many seconds to wait before sending more requests. Requests are not queued; a request that receives a 429 was not processed and should be retried after the wait.

## Handling 429 errors in your code

- Read the `Retry-After` header and wait at least that long before retrying.
- Use exponential backoff with a little random jitter if you keep receiving 429 responses.
- Avoid tight retry loops: retrying immediately makes the problem worse and keeps you over the limit.

## Staying under the limit

- **Batch your work.** Fetch folder listings once instead of requesting each file's details individually.
- **Cache results** that don't change often, such as member lists and folder structures.
- **Avoid polling.** Check for changes on a sensible schedule instead of every few seconds.
- **Spread large jobs out.** Long-running exports or migrations should pace themselves to stay below your plan's limit.

## Getting a higher limit

Rate limits are tied to your plan. Moving from Starter to Pro raises your limit from 60 to 600 requests per minute, and Enterprise allows 3,000 requests per minute. Only the workspace owner can change the plan, under Settings → Billing. Support cannot raise a workspace's rate limit above the limit for its plan.
