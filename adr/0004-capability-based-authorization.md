# 4. Capability-based authorization: roles map to capabilities, and a write is allowed, simulated or denied

Date: 2026-10-06

## Status

Accepted. Supersedes decision 6 of `adr/0002-demo-mode.md` (the blanket "demo tokens may only `GET`" middleware); the rest of 0002 stands.

## Context

Authorization today is three unrelated checks, and none of them is a role:

- **Membership** — `requireHouseholdMember` / `requireAccountAccess` only ask whether a `household_members` row exists. Anyone in a household can rename it, add or delete cards and trigger a refresh.
- **Calendar ownership** — `requireConnectedUser` compares `calendar_links.connected_user_id` to the caller.
- **Demo** — a `demo: true` claim in the JWT, enforced by one global `demoReadOnly` middleware that 403s every non-`GET`.

`household_members.role` is a free-form string that every write path sets to `'owner'` and that nothing reads except `GET /me`, which returns it to the client. It describes a distinction the system does not yet make.

Demo mode is what exposed the gap. ADR 0002 chose a read-only demo, and the frontend made it work by hiding controls (`readOnly` props, `data.session.demo` checks). That means the demo cannot show what a live account shows: the Re-stamp button, the add-card form, the calendar settings. Showing them is a product goal, so the demo must be able to *appear* to do things while being unable to do any of them.

This is the driver, but it is not the whole point. The same question — "what is this caller allowed to do here?" — will come up again for real members, and today there is nowhere to put the answer except another inline check in another route.

## Decision

1. **Authorization is expressed as capabilities.** A capability is a named action (`account.refresh`, `account.create`, `account.delete`, `household.rename`, `calendar.update`, `calendar.disconnect`, `calendar.connect`, `identity.link-google`, …). Each write route maps to one capability, in a single table. Route handlers do not test `req.demo`, membership rows or role strings themselves. Reads (`GET`) are not capabilities; they stay open to any member, as before.

2. **A role maps each capability to one of three policies:**
   - **`allow`** — run the real handler.
   - **`simulate`** — run a stand-in handler that returns the response shape the real one would, without performing the side effect.
   - **`deny`** — 403 with a message saying why.

   Two roles exist for now. `member` is `allow` for everything, so behavior for real accounts does not change. `demo` is derived from the existing `demo` token claim (tokens already issued stay valid; no new claim is required) and is defined in the table below.

3. **The mapping lives in one module (`api/src/auth/capabilities.js`)**: the route-to-capability table and each role's policies, so the whole policy for a role can be read, reviewed and diffed in one place. One middleware, mounted once ahead of every protected route in place of `demoReadOnly`, resolves the caller's policy for the request. `GET /me` returns the caller's resolved capabilities, and the frontend renders from them instead of from `isDemo` / `readOnly`. Real routes are untouched: they run only when the policy is `allow`.

4. **A role has a default policy, and the demo role's default is `deny`.** A write route with no entry in the table resolves to its role's default, so a new mutating route is unreachable for demo tokens until someone deliberately maps it to a capability and chooses a policy. This keeps the guarantee decision 6 of ADR 0002 gave. A `simulate` policy with no simulation registered also fails closed to `deny`.

5. **Simulations are held to the real handler's contract.** A simulated handler runs the same input validation as the real one and returns the same response shape, so a bad request fails the same way in the demo. To keep them from drifting, the real and simulated handlers share the same parsing and validation functions rather than copying them. A simulation may read the database (to authorize the caller, load a library, or show current settings) but must not write rows, enqueue a job, call Google, encrypt or store submitted credentials, or touch any other external system. Each simulation has a test asserting that, and a test that its response shape matches the real handler's.

6. **The demo role's policy:**

   | Capability | Policy | Notes |
   |---|---|---|
   | `account.refresh` | simulate | 202 with the id and status of the account's latest seeded run, which is already settled, so the frontend's poll finishes. No run row is created and nothing is enqueued |
   | `account.create` | simulate | validates, returns a synthetic account; credentials are never stored |
   | `account.delete` | simulate | 204, nothing changes |
   | `household.rename` | simulate | echoes the name, nothing persisted |
   | `calendar.update` | simulate | validates, echoes the merged settings, no sync queued |
   | `calendar.disconnect` | simulate | 204, nothing changes, no revocation queued |
   | `calendar.connect` (`connect/start`, `connect/finish`) | **deny** | see Consequences |
   | `identity.link-google` / `identity.unlink-google` | **deny** | the demo user is shared; linking an identity to it would hand every visitor someone else's sign-in |

7. **Simulated writes do not persist, and the demo says so.** The frontend shows a persistent banner for demo sessions ("Demo — changes aren't saved"). It does not keep a client-side overlay of simulated changes; a reload shows the seeded data. This is deliberately the cheaper and more honest option: it spends no frontend effort on state that exists only for the demo.

## Consequences

- **The demo can show everything a live account shows**, and the frontend can drop its demo-specific hiding in favor of one banner. The cost is a stand-in handler per simulated capability, which must be kept in step with the real one — hence the contract tests in decision 5.
- **The shared queue and Google are still unreachable from a demo token.** ADR 0002's core constraint is preserved: a simulation never enqueues and never calls out. Enforcement moves from "reject all writes" to "reject unless declared, and declared handlers are tested not to have side effects."
- **Connecting a calendar is denied rather than simulated.** The real flow is a PKCE redirect to Google and back; simulating it needs a fake callback path, which is a second implementation of a security-sensitive flow that could drift from the real one and is a possible vector for side effects. The demo instead shows the seeded "connected" state and its settings.
- **The demo household is still shared by every visitor.** Because simulations persist nothing, concurrent visitors cannot see each other's "changes", and the shared-state limitation recorded in ADR 0002 does not get worse.
- **A capability layer is where real role-based features would plug in later**, which is a benefit of this decision but not part of it. Today `household_members.role` is unenforced; this ADR does not use it. When the product wants it — a `viewer` who can look but not act, a `member` who cannot delete cards or rename the household, restricting who may trigger a sync — the work is to add a role to the capability map and start populating the column, rather than adding a check to each route and a branch to each component. Because `GET /me` already returns capabilities, the frontend follows without per-component changes. Two things need doing first: `role` should become an enum or be validated, since it is free text now; and `demo` should stay a session/household property rather than a membership role, because it describes how someone got in, not their standing in a household.
- **The mapping is code, not data.** Changing a role's policy is a deploy, which is the right size for two roles. If roles later need to differ per household or be edited at runtime, the map can move into the database behind the same lookup; callers would not change.
- `DEMO_MODE_ENABLED=false` still disables the whole demo with one env flip.
