<!-- Effective date is the published ToS/Privacy date. Bump on every material change AND announce via in-app banner 30 days prior. -->

# ClankyBuddy Privacy Policy

**Effective date:** 2026-04-30

> **STUB.** This policy is a working draft for the operator and counsel to iterate on. Bracketed `[TODO: …]` markers indicate items that require legal review before public launch.

## 1. What we collect

We minimize data collection. We do **not** ask for your email address, real name, phone number, date of birth, or any other directly identifying information. The data we do collect is:

- **Bearer access token**, issued at sign-up, stored in your browser/CLI, used to authenticate requests. Treated as personal data because it identifies your pseudonymous account.
- **Refresh token**, issued at sign-up, used to mint new access tokens without re-authenticating.
- **IP address (at edge)**, logged by Cloudflare's edge logs for ≤ 30 days for rate-limit forensics.
- **Chat content**, messages you post are stored in room history (limited rolling buffer) and pushed via Cloudflare Logpush to encrypted R2 storage for ≤ 90 days for abuse investigation.
- **User-Agent string**, captured in connection logs for ≤ 30 days.
- **Salted, truncated fingerprint hash for moderation**, see below.

### Fingerprint hash, honest framing

> "For abuse prevention we retain a salted, truncated hash derived from connection metadata; it allows us to recognize returning suspended accounts. Retained ≤ 30 days. Legal basis: legitimate interest in service safety."

We treat this hash as **personal data** under GDPR's singling-out test. We do not claim otherwise. It exists to enforce repeat-infringer termination under DMCA § 512(i) and to defend against ban evasion.

## 2. Purposes and legal basis

| Purpose | Legal basis (GDPR / UK-GDPR) |
|---|---|
| Operating the chat service (auth, message delivery) | Contract performance (Article 6(1)(b)) |
| Moderation and abuse prevention | Legitimate interest (Article 6(1)(f)) |
| Rate-limit forensics (IP/UA logs) | Legitimate interest (Article 6(1)(f)) |
| Repeat-infringer termination (fingerprint hash) | Legitimate interest (Article 6(1)(f)) |
| Cookies (only essential session cookies, if any) | Strictly necessary; consent for any non-essential cookies |

<!-- TODO: confirm cookie inventory before launch, currently we use bearer tokens in localStorage, not cookies. If that changes, update this row and add a cookie banner. -->

We currently geofence EU and UK users (see § 9 below), so GDPR/UK-GDPR rights are listed for transparency and apply once geofencing is lifted; CCPA applies to Californians today.

## 3. Retention table

| Data class | Retention | Why |
|---|---|---|
| Chat content (Logpush to R2) | **90 days** | Abuse investigation; longer = liability |
| Connection logs (IP × user_id × ts) | **30 days** | Rate-limit forensics |
| Auth events | **30 days** | Same |
| Moderation incident records | **1 year** | Repeat-offender detection |
| Account records | until erasure | Identity continuity |
| Tombstone rows | indefinite | Prevent handle re-collision; no PII |
| LE preservation holds | 90 days (renewable) | Statutory under § 2703(f) |
| Fingerprint shadow hashes | **≤ 30 days** | Treated as personal data; legitimate interest |

## 4. Sub-processors

We use the following third parties to operate the Service:

- **Cloudflare, Inc.**, CDN, Workers compute, Durable Objects, KV namespaces, R2 (Logpush destinations), Workers AI (moderation), Turnstile (anti-abuse).

<!-- TODO: add any payment processor, analytics vendor, or email-relay vendor here once selected. As of 2026-04-30 we use no such vendors. -->

## 5. Your GDPR / UK-GDPR rights

You have the rights of access, rectification, erasure ("right to be forgotten"), restriction, portability, and objection. To exercise them while authenticated:

- **Erasure:** call `POST /me/erase` with your bearer token. We return a job ID and complete the erasure asynchronously within 30 days. Authored messages are scrubbed across visited rooms; see § 7 below for the CSAM carve-out.
- **Token revoke:** call `POST /me/revoke` to invalidate your access and refresh tokens.

If you have lost your token, email `privacy@clankybuddy.com` with as much identifying information as you can supply (approximate sign-up date, handle if you remember it, IP range you used). We will honor verified requests within 30 days, but the absence of an email-tied identity means we cannot always confirm ownership; in that case we will explain the limitation.

You may also lodge a complaint with your local supervisory authority.

<!-- TODO: once geofencing is lifted, replace this section with the standard EU/UK rights list and identify the lead supervisory authority based on operator's establishment. -->

## 6. CCPA (Californians)

Under the California Consumer Privacy Act, California residents have the rights of access, deletion, and opt-out from sale. We do **not sell or share** personal information for cross-context behavioral advertising. The same `/me/erase` endpoint and `privacy@clankybuddy.com` fallback honor CCPA deletion requests. We respond within 45 days.

<!-- TODO: review against CPRA amendments and confirm Notice-at-Collection placement at sign-up. -->

## 7. Children's privacy

ClankyBuddy is **not directed at children under 13**. We display a 13+ attestation at first run and do not knowingly collect data from children under 13. If you believe we have, contact `privacy@clankybuddy.com` and we will delete the data promptly.

## 8. CSAM carve-out (GDPR Article 17(3)(b))

We are required by 18 U.S.C. § 2258A to report suspected child sexual abuse material to the National Center for Missing & Exploited Children (NCMEC). When content is flagged as suspected CSAM, we **preserve the artifact and associated metadata for 90 days** for law-enforcement preservation orders, **even if you request erasure during that period**. This carve-out is permitted under GDPR Article 17(3)(b) (compliance with legal obligation).

## 9. Geofence

ClankyBuddy is currently **not available in the following jurisdictions**. Connections from these regions receive an HTTP 451 response.

- **European Union (27 member states):** Austria, Belgium, Bulgaria, Croatia, Cyprus, Czechia, Denmark, Estonia, Finland, France, Germany, Greece, Hungary, Ireland, Italy, Latvia, Lithuania, Luxembourg, Malta, Netherlands, Poland, Portugal, Romania, Slovakia, Slovenia, Spain, Sweden.
- **EEA non-EU (DSA-aligned):** Iceland, Liechtenstein, Norway.
- **United Kingdom.**

We expect to lift the EU/EEA geofence once we have built the DSA Statement-of-Reasons pipeline, and the UK geofence once we have built Online Safety Act age-estimation infrastructure.

## 10. Honest framing

We don't ask for your email or name. Connection metadata is retained briefly to keep the service safe; see the retention table above. **We do not market ClankyBuddy as "fully anonymous, no logs."** A § 2703(f) preservation order from US law enforcement can require us to preserve the listed data classes for a renewable 90-day period.

## 11. Changes to this policy

We may update this policy from time to time. Material changes will be announced via an in-app banner at least 30 days before they take effect.

## 12. Contact

- Privacy: `privacy@clankybuddy.com`
- Abuse: `abuse@clankybuddy.com`
- Legal: `legal@clankybuddy.com`
