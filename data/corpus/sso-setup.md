---
id: sso-setup
title: Setting Up Single Sign-On (SSO)
doc_type: guide
tiers: [enterprise]
effective_date: 2026-09-01
---

# Setting Up Single Sign-On (SSO)

Single sign-on lets your team sign in to Northstar with your company's identity provider (IdP) instead of separate Northstar passwords. This guide walks Enterprise admins through setup.

## Availability

SSO is available on the Enterprise plan only. Northstar supports two protocols: SAML 2.0 and OpenID Connect (OIDC). You can configure one of them per workspace. Starter and Pro workspaces do not have access to SSO.

## Before you begin

- You need to be the workspace owner or an admin of the Enterprise workspace.
- You need admin access to your identity provider so you can create a new application.
- Make sure every member's Northstar email matches the email address in your identity provider; SSO matches users by email.

## Configuring SAML 2.0

1. In Northstar, go to Settings → Security → Single sign-on and choose **SAML 2.0**.
2. Copy the **ACS URL** (Assertion Consumer Service URL) and the **Entity ID** shown on that page.
3. In your identity provider, create a new SAML application and paste in the ACS URL and Entity ID.
4. Configure the identity provider to send the user's email address as the NameID or as an `email` attribute.
5. Download the identity provider's **metadata XML** and upload it in Northstar, or paste the SSO URL and signing certificate manually.
6. Click **Test connection** and sign in with a test account.

## Configuring OIDC

1. In Northstar, go to Settings → Security → Single sign-on and choose **OIDC**.
2. Copy the **redirect URI** shown on that page.
3. In your identity provider, create a new OIDC application and add the redirect URI.
4. Paste the **issuer URL**, **client ID**, and **client secret** from your identity provider into Northstar.
5. Click **Test connection** and sign in with a test account.

## Requiring SSO for everyone

After a successful test, you can turn on **Require SSO** so members can only sign in through your identity provider. We recommend testing with one or two accounts first, and keeping the workspace owner able to sign in while you roll out.

## Troubleshooting SSO sign-in

- **"User not found"** — the email sent by your identity provider doesn't match a Northstar member. Check the email attribute mapping.
- **"Invalid signature"** — the signing certificate in Northstar is out of date. Upload the current metadata XML again.
- **Redirect loop after sign-in** — check that the ACS URL (SAML) or redirect URI (OIDC) was copied exactly.

Enterprise customers can reach support 24/7 by phone or chat for help with SSO.

## SSO and audit logs

Every SSO sign-in, configuration change, and enforcement change is recorded in your workspace audit logs, which are also an Enterprise feature. Admins can review them under Settings → Security → Audit logs.
