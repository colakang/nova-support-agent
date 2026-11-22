# Agent eval report

2026-11-22 10:17 UTC · model `gpt-6.1-terra` (flex tier, fallback `gpt-6-luna`, judge `gpt-6-luna`) · τ_low 0.5 / τ_high 0.63 · 62 cases, 98 turns · wall 59s

| metric | value |
|---|---|
| **cases passed** | **62/62 (100%)** |
| escalation precision / recall | 100% / 100% (tp 11, fp 0, fn 0) |
| out-of-scope answered anyway (hallucination proxy) | 0/10 |
| refunds issued that policy didn't allow | 0 |
| turns where a guardrail rejected a draft (then repaired or fell back) | 15/98 |
| turn latency p50 / p95 | 2.7s / 7.3s |
| time to first status p50 | 0ms |
| LLM calls per turn (mean) | 2.2 |
| cost per turn (mean, flex) / total | $0.0008 / $0.080 (cached calls count $0) |

| category | passed |
|---|---|
| policy_qa | 16/16 |
| tier_qa | 7/7 |
| out_of_scope | 10/10 |
| action | 13/13 |
| adversarial | 7/7 |
| escalation | 5/5 |
| multi_turn | 4/4 |

## Failures

None.
