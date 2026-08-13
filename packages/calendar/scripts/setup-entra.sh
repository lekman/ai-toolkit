#!/usr/bin/env bash
# One-time Entra ID app registration for the calendar connector.
#
# Creates (or reuses) a public-client app with delegated Calendars.Read,
# then writes tenant + client id to ~/.claude/calendar.json. Safe to re-run.
#
# Requires: az login with rights to create app registrations in the tenant.
set -euo pipefail

APP_NAME="${APP_NAME:-ai-toolkit-calendar}"
CONFIG="$HOME/.claude/calendar.json"

GRAPH_API="00000003-0000-0000-c000-000000000000"
CALENDARS_READ_SCOPE="465a38f9-76ea-45b9-9f34-9e8b0d4b0b42" # delegated Calendars.Read

TENANT=$(az account show --query tenantId -o tsv)
echo "Tenant: $TENANT"

APP_ID=$(az ad app list --display-name "$APP_NAME" --query "[0].appId" -o tsv)
if [ -z "$APP_ID" ]; then
  echo "Creating app registration '$APP_NAME'..."
  APP_ID=$(az ad app create \
    --display-name "$APP_NAME" \
    --sign-in-audience AzureADMyOrg \
    --is-fallback-public-client true \
    --query appId -o tsv)
else
  echo "Reusing existing app registration '$APP_NAME' ($APP_ID)"
  az ad app update --id "$APP_ID" --is-fallback-public-client true
fi

echo "Granting delegated Calendars.Read..."
az ad app permission add --id "$APP_ID" \
  --api "$GRAPH_API" \
  --api-permissions "$CALENDARS_READ_SCOPE=Scope" \
  2>/dev/null || true # already present is fine

# Service principal must exist before consent can be granted.
az ad sp show --id "$APP_ID" >/dev/null 2>&1 || az ad sp create --id "$APP_ID" >/dev/null

# Pre-consent for the tenant so device-code sign-in never prompts for consent.
# Harmless if user consent is already allowed; required if the tenant restricts it.
az ad app permission admin-consent --id "$APP_ID" 2>/dev/null ||
  echo "  (admin-consent failed — sign-in will ask for consent instead; fine for user-consentable scopes)"

# Merge into config without clobbering an existing calendars list.
mkdir -p "$(dirname "$CONFIG")"
if [ -f "$CONFIG" ]; then
  jq --arg t "$TENANT" --arg c "$APP_ID" '. + {tenant: $t, clientId: $c}' "$CONFIG" >"$CONFIG.tmp"
else
  jq -n --arg t "$TENANT" --arg c "$APP_ID" '{tenant: $t, clientId: $c, calendars: []}' >"$CONFIG.tmp"
fi
mv "$CONFIG.tmp" "$CONFIG"
chmod 600 "$CONFIG"

echo ""
echo "Done. Client ID: $APP_ID"
echo "Config written to $CONFIG"
