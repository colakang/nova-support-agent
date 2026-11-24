# Agent eval report

2026-11-24 00:34 UTC · model `gpt-6.1-terra` (default tier, fallback `gpt-6-luna`, judge `gpt-6-luna`) · τ_low 0.5 / τ_high 0.63 · 80 cases, 135 turns · wall 70s

| metric | value |
|---|---|
| **cases passed** | **80/80 (100%)** |
| escalation precision / recall | 100% / 100% (tp 11, fp 0, fn 0) |
| out-of-scope answered anyway (hallucination proxy) | 0/10 |
| refunds issued that policy didn't allow | 0 |
| turns where a guardrail rejected a draft (then repaired or fell back) | 18/135 |
| turn latency p50 / p95 | 3.3s / 7.8s |
| time to first status p50 | 1ms |
| LLM calls served from the eval cache | 0/282 |
| LLM calls per turn (mean) | 2.1 |
| cost per turn (mean, default) / total | $0.0018 / $0.249 (cached calls count $0) |

| category | passed |
|---|---|
| policy_qa | 16/16 |
| tier_qa | 7/7 |
| out_of_scope | 10/10 |
| action | 16/16 |
| adversarial | 22/22 |
| escalation | 5/5 |
| multi_turn | 4/4 |

## Failures

None.
