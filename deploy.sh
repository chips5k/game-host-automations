#!/usr/bin/env bash
# kill aws pager
PAGER="";
die() { echo "$*" 1>&2 ; exit 1; }
hash aws || die "Missing aws"
hash sam || die "Missing sam"

account=$(aws sts get-caller-identity --query="Account" --output text) || die "Not authenticated with aws"
echo "Deploying to AWS Account: $account"

SSM_PREFIX=${SSM_PREFIX:-"/game-host-automations"}
AWS_REGION=${AWS_REGION:-"ap-southeast-2"}
STACK_NAME=${STACK_NAME:-"game-host-automations"}

SLACK_BOT_TOKEN=$(aws ssm get-parameter --name "${SSM_PREFIX}/slack-bot-token" --with-decryption --query "Parameter.Value" --output text 2>/dev/null || echo "")
SLACK_SIGNING_SECRET=$(aws ssm get-parameter --name "${SSM_PREFIX}/slack-signing-secret" --with-decryption --query "Parameter.Value" --output text 2>/dev/null || echo "")
DISCORD_WEBHOOK=$(aws ssm get-parameter --name "${SSM_PREFIX}/discord-webhook" --with-decryption --query "Parameter.Value" --output text 2>/dev/null || echo "")
SLACK_WEBHOOK=$(aws ssm get-parameter --name "${SSM_PREFIX}/slack-webhook" --with-decryption --query "Parameter.Value" --output text 2>/dev/null || echo "")
SLACK_PRIVATE_CHANNEL_ID=$(aws ssm get-parameter --name "${SSM_PREFIX}/slack-private-channel-id" --query "Parameter.Value" --output text 2>/dev/null || echo "")

[[ -z "$SLACK_BOT_TOKEN" ]] && die "Missing slack bot token in SSM (${SSM_PREFIX}/slack-bot-token)"
[[ -z "$SLACK_SIGNING_SECRET" ]] && die "Missing slack signing secret in SSM (${SSM_PREFIX}/slack-signing-secret)"
[[ -z "$DISCORD_WEBHOOK" ]] && die "Missing discord webhook in SSM (${SSM_PREFIX}/discord-webhook)"
[[ -z "$SLACK_WEBHOOK" ]] && die "Missing slack webhook in SSM (${SSM_PREFIX}/slack-webhook)"
[[ -z "$SLACK_PRIVATE_CHANNEL_ID" ]] && die "Missing slack private channel id in SSM (${SSM_PREFIX}/slack-private-channel-id)"

sam build || die "Failed to build"
sam deploy \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --no-confirm-changeset \
  --parameter-overrides \
    "SlackBotToken=$SLACK_BOT_TOKEN SlackSigningSecret=$SLACK_SIGNING_SECRET SlackPrivateChannelId=$SLACK_PRIVATE_CHANNEL_ID SlackWebhook=$SLACK_WEBHOOK DiscordWebhook=$DISCORD_WEBHOOK" || die "Failed to deploy"
