<!--
PROVENANCE (added to repo 2026-09-01)
Inbound Ministry artifact received via Ansari Khan (MoE ICT) → Raj Ramdass → us.
Source: ~/openclaw-agent/inbound-docs/MOE Email AI Assistant Handoff.md (doc dated 2026-08-18).
Verbatim except this header. All credential fields are {{ PLACEHOLDERS }} — no real
secrets in this document (confirmed by scan; see memory: "Ministry endpoints unverifiable").
This is the source packet the unsent reply docs/MINISTRY_REPLY_DRAFT_2026-08-20.md answers.
Do NOT treat any {{ }} value as real; all 20 remain unprovisioned until the Ministry reply is sent.
See also: docs/wiki/LIAISON_LOG.md, docs/GA_EXECUTION_PLAN_2026-09-01.md §1 (Lane C).
-->

**MOE Email AI Assistant**

Infrastructure and Credentials Handoff Document

  ----------------- -----------------------------------------------------
  Prepared by       Ansari Khan, Information Systems Support Specialist

  Date              August 18, 2026

  Audience          Mr. Raj Ramdass; Development team

  Classification    Confidential
  ----------------- -----------------------------------------------------

# 1. Overview

This document hands off the provisioned infrastructure for the Email AI Assistant to the development team. It covers the PostgreSQL database and how it must be accessed, the Azure AI Foundry model endpoint exposed through Azure API Management (APIM), the Entra ID app registration and its granted permissions, a Python test example with the expected response, and the monthly token budget.

## 1.1 Architecture summary

- Model access: Application → Azure API Management gateway → Azure AI Foundry deployment. All model calls go through APIM; nothing calls the Foundry endpoint directly.

- Database access: Application → App server (to be provisioned, see Section 2.2) → PostgreSQL. Developer machines may connect remotely from whitelisted IPs (iGovTT network). End-user machines never connect to the database directly.

- Identity: An Entra ID app registration provides the identity for delegated Microsoft Graph read access to mail, calendar, and profile (see Section 5).

- Caching / pooling: No Redis cache is provisioned at current scale. If connection management becomes an issue, PgBouncer will be enabled to multiplex connections (see Section 3.3).

# 2. PostgreSQL Database

## 2.1 Credentials

  ---------------------------------------------------------------------------------------------------------------------------------
  **Field**                  **Value**                                      **Notes**
  -------------------------- ---------------------------------------------- -------------------------------------------------------
  **Host**                   **{{** **POSTGRES_HOST }}**                    Private hostname, resolvable from the app server only

  **Port**                   **{{ POSTGRES_PORT }}**                        Default 5432 or 6432 with PgBouncer

  **Database name**          **{{ POSTGRES_DB }}**                          

  **Application username**   **{{ POSTGRES_APP_USER }}**                    

  **Application password**   **{{ POSTGRES_APP_PASSWORD }}**                
  ---------------------------------------------------------------------------------------------------------------------------------

**Notes:** Database connections do not require SSL. Traffic stays on the internal network path behind the whitelisted app server and is not exposed publicly. No admin or migration credential is provided with this handoff. If schema migrations require elevated privileges, request them through the infrastructure owner.

## 2.2 Network access model

The database firewall is **not open to the internet** and will stay closed. An openly reachable database is an unacceptable risk. Access is limited to an explicit whitelist:

- **Application traffic:** proxied through an app server whose static IP is whitelisted (to be provisioned, see below).

- **Developer machines:** remote connections are permitted from developer machines on the iGovTT network, or from another IP submitted for whitelisting. Send the IPs or network ranges to be whitelisted before attempting to connect.

- **End-user machines:** never connect to the database directly. All user-facing traffic goes through the application.

Any host not on the whitelist is refused.

**App server (to be provisioned):** no app server exists yet, because the original request did not specify how the application would connect to the database. The development team should decide on a deployment approach and send it to us for provisioning. Two options, in order of preference:

- **Docker image (preferred):** provide a Docker image or docker-compose definition and we will deploy and operate it on infrastructure whose IP we whitelist.

- **Virtual Machine:** if a container image is not practical, we will provision a small VM and grant the team access to deploy onto it. Its static IP will be whitelisted on the database firewall.

Do not build around a direct database connection from any other host, and do not request a broader firewall opening. Send the provisioning request to the infrastructure owner; the whitelist will be updated for the provisioned host only.

## 2.3 Connection management (Redis / PgBouncer)

A Redis cache was not provisioned. At the current scale it is unnecessary and would add cost and operational surface. If connection-management issues appear (connection exhaustion, too many idle connections from application workers), the suggested mitigation is to enable **PgBouncer** in front of PostgreSQL to multiplex connections. Transaction pooling mode is the expected configuration.

# 3. Azure AI Foundry (via Azure API Management)

Model inference is served by an Azure AI Foundry deployment fronted by an Azure API Management gateway. The APIM subscription key is the only credential the application needs for inference. The backend Foundry key is held by APIM and is not distributed.

## 3.1 Credentials

  -----------------------------------------------------------------------------------------------------------------------
  **Field**                   **Value**                         **Notes**
  --------------------------- --------------------------------- ---------------------------------------------------------
  **APIM gateway base URL**   **{{ APIM_GATEWAY_URL }}**        e.g. https://{{apim-name}}.azure-api.net/{{api-suffix}}

  **APIM subscription key**   **{{ APIM_SUBSCRIPTION_KEY }}**   Sent as the Ocp-Apim-Subscription-Key header.

  **Model deployment name**   **{{ DEPLOYMENT_NAME }}**         Foundry deployment referenced in the URL path

  **API version**             **{{ API_VERSION }}**             e.g. 2024-10-21
  -----------------------------------------------------------------------------------------------------------------------

## 3.2 Token budget: 100M tokens per month

The subscription is allocated **100,000,000 (100M) tokens per calendar month**, enforced at the APIM gateway by its token-limit policy. This is a starting allocation; it will be reviewed and can be increased later if usage justifies it. Usage counts prompt plus completion tokens. When the budget is exhausted, the gateway returns HTTP 429 until the window resets.

Each response includes a header with the token cost of that individual request (see Section 4.2). The gateway does not return a remaining-budget figure; overall consumption against the monthly budget is monitored on the infrastructure side. The application should still log the per-request header for its own visibility.

## 3.3 Per-user usage metrics (Application Insights)

Usage and token metrics are collected in Application Insights and need to be grouped by user. On every authenticated request to the gateway, pass a custom header named UserId containing the identifier of the signed-in user. Requests without it cannot be attributed to a user in the metrics. The Python example in Section 4.1 shows where to set it.

# 4. API Test Example (Python)

## 4.1 Example request

Smoke test using the official openai Python package (pip install openai). Set the two environment variables before running. Do not hardcode the key.

> import os
>
> from openai import AzureOpenAI
>
> endpoint = os.environ\[\"APIM_GATEWAY_URL\"\] \# {{ APIM_GATEWAY_URL }}
>
> api_key = os.environ\[\"APIM_SUBSCRIPTION_KEY\"\] \# sent as the api-key header
>
> deployment_name = \"{{ DEPLOYMENT_NAME }}\"
>
> api_version = \"{{ API_VERSION }}\"
>
> client = AzureOpenAI(
>
> azure_endpoint=endpoint,
>
> azure_deployment=deployment_name,
>
> api_version=api_version,
>
> api_key=api_key,
>
> )
>
> \# with_raw_response exposes the HTTP response so the per-request
>
> \# token header set by APIM can be read
>
> response = client.chat.completions.with_raw_response.create(
>
> model=deployment_name,
>
> messages=\[{\"role\": \"user\", \"content\": \"What is the capital of France?\"}\],
>
> max_tokens=100,
>
> \# required on authenticated requests: groups usage metrics by user
>
> \# in Application Insights (see Section 3.3)
>
> extra_headers={\"UserId\": \"{{ id of the signed-in user }}\"},
>
> )
>
> completion = response.parse()
>
> print(\"answer:\", completion.choices\[0\].message.content)
>
> print(\"tokens consumed (this request):\", response.headers.get(\"consumed-tokens\"))
>
> print(\"total tokens (body usage):\", completion.usage.total_tokens)

If the header is not needed, a plain client.chat.completions.create(\...) call works the same way; the usage object in the body still reports the request's token counts. The UserId header is still required on authenticated requests.

API reference for the underlying Azure OpenAI chat completions endpoint: https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/azureopenai/chat. The APIM gateway exposes the same request and response shapes; only the base URL and the subscription key header differ.

## 4.2 Expected response

A successful call returns HTTP 200. The token cost of the request appears in two places: an APIM-injected response header with the tokens consumed by that individual request, and the usage object of the JSON body. Neither reports the overall monthly budget; that is monitored on the infrastructure side (see Section 3.2).

**Response headers (abridged):**

> HTTP/1.1 200 OK
>
> Content-Type: application/json
>
> consumed-tokens: {{ e.g. 22 }} \# tokens used by this request only
>
> x-request-id: {{ \... }}

**Response body (abridged):**

> {
>
> \"id\": \"chatcmpl-\...\",
>
> \"object\": \"chat.completion\",
>
> \"model\": \"{{ MODEL_NAME }}\",
>
> \"choices\": \[
>
> {
>
> \"index\": 0,
>
> \"message\": { \"role\": \"assistant\", \"content\": \"The capital of France is Paris.\" },
>
> \"finish_reason\": \"stop\"
>
> }
>
> \],
>
> \"usage\": {
>
> \"prompt_tokens\": 14,
>
> \"completion_tokens\": 8,
>
> \"total_tokens\": 22
>
> }
>
> }

**Note:** A 401 or 403 means a missing or wrong subscription key. A 429 means rate limiting or an exhausted token budget.

# 5. Entra ID App Registration

An app registration was set up as the identity for the assistant. It holds delegated Microsoft Graph permissions, consented tenant-wide. Because the permissions are delegated, every request runs in the context of a signed-in user and can only reach data that user can already access. All grants are read-only; the assistant cannot send, delete, or modify anything through Graph.

## 5.1 Credentials

  ----------------------------------------------------------------------------------------------------
  **Field**                     **Value**                       **Notes**
  ----------------------------- ------------------------------- --------------------------------------
  **Application (client) ID**   **{{ AZURE_CLIENT_ID }}**       

  **Directory (tenant) ID**     **{{ AZURE_TENANT_ID }}**       

  **Client secret**             **{{ AZURE_CLIENT_SECRET }}**   

  **Redirect URI**              **{{ AZURE_REDIRECT_URI }}**    

  **Client secret expiry**      **{{ SECRET_EXPIRY_DATE }}**    Calendar a rotation before this date
  ----------------------------------------------------------------------------------------------------

## 5.2 Granted permissions and what they allow

  --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **API / Permission**              **Type**     **What it allows**
  --------------------------------- ------------ ---------------------------------------------------------------------------------------------------------------------------------------
  Microsoft Graph: Mail.Read        Delegated    Read the signed-in user's mailbox. Used to ingest and classify the user's email. Does not allow sending, deleting, or modifying mail.

  Microsoft Graph: Calendars.Read   Delegated    Read the signed-in user's calendars and events. Used for scheduling context when processing email.

  Microsoft Graph: User.Read        Delegated    Sign the user in and read their basic profile (name, email address).
  --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

These three are the only permissions assigned. Do not build against any Graph capability outside them without requesting the grant first.

## 5.3 Contacts.Read: considered and not granted

**Contacts.Read** was discussed during setup and deliberately not granted. It was identified as a security risk for organization crawling. Contact lists aggregate names, job titles, email addresses, phone numbers, and working relationships across the organization. An attacker who obtained a token for the assistant, or who steered the assistant through a crafted email (prompt injection), could use contacts access to enumerate those lists user by user and assemble a map of the organization's people and reporting structure. That map is the reconnaissance material for targeted phishing and social engineering campaigns, and the assistant processes untrusted inbound email as its core function, which makes this attack path realistic rather than theoretical.

The assistant does not need contact data for its current scope of reading and classifying mail. If a concrete feature requires it later, request the grant through the infrastructure owner. It can be added at that point with the scope reviewed against the feature that needs it.

# 6. Action Required from the Development Team

- Decide on the app-server deployment approach (Docker image preferred, small VM otherwise) and send the provisioning request to the infrastructure owner. Database access is blocked until this exists (Section 2.2).

- Submit developer machine IPs for database whitelisting (Section 2.2).

- Move all credentials in this document into the team's secret manager and confirm no plaintext copies remain in code, config, or chat.

- Run the Python smoke test (Section 4) once credentials are in hand and confirm the per-request token header appears as documented.

- Include the UserId header on all authenticated gateway requests so usage metrics can be grouped by user (Section 3.3).
