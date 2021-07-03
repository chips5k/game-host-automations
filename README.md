# Game Host Automations

On-demand cloud game server management using AWS EC2, AWS Systems Manager (SSM), and AWS SAM with Slack & Discord chatops.

This project allows players in a community to start, stop, monitor, and query status of dedicated game servers (Valheim, Don't Starve Together, Barotrauma) directly via Slack slash commands and receive live status updates in Slack and Discord channels, while keeping cloud costs minimal by only running instances on demand.

## Architecture & Design Notes

Dedicated game servers can get expensive if left running 24/7. This solution hosts multiple game servers on a single EC2 instance using [Linux Game Server Managers (LinuxGSM)](https://linuxgsm.com/), controlled remotely through serverless automation:

- **API Gateway + Slack Responder Lambda (`slack-responder/`)**:
  Receives slash commands (e.g., `/gameserver`). In FaaS environments, Slack slash commands require an immediate HTTP 200 acknowledgment within 3 seconds, but EC2 startups and SSM executions take tens of seconds. The responder validates channel authorization, acknowledges Slack immediately (`processBeforeResponse`), and asynchronously invokes the `server-manager` Lambda.
- **Server Manager Lambda (`server-manager/`)**:
  Orchestrates EC2 lifecycle (`ec2:startInstances`, `ec2:stopInstances`) and executes remote LinuxGSM commands on the instance using AWS Systems Manager Run Command (`ssm:sendCommand` with `AWS-RunShellScript`). It reports live progress and server status to Slack and Discord via incoming webhooks.
- **Automated Cost Control**:
  A scheduled early-morning cron job runs on the EC2 instance to gracefully shut down any active game servers and stop the instance in case users forget to turn it off.

## Supported Game Servers

- **Valheim (`vhserver`)**
- **Don't Starve Together (`dstserver`)** - Master and Caves cluster setup (see [DST Server Guide](./DSTServer.md))
- **Barotrauma (`btserver`)**

## EC2 & Server Setup

### 1. AWS EC2 Configuration
- **Base OS**: Ubuntu 20.04 LTS
- **Instance Type**: `t2.medium` (or `t3.medium` / `t3.large` depending on player count)
- **VPC & Subnet**: Default VPC with public subnet and auto-assigned public IP
- **IAM Role**: Attach role with `AmazonSSMManagedInstanceCore` managed policy so Session Manager and SSM Run Command can execute on the instance without requiring open SSH ports
- **Tag**: Tag instance with `Name: game-server-dedicated` (used by the Lambda to locate the instance)
- **Security Group**: Open incoming UDP ports for your desired games:
  - Barotrauma: `27015-27016` UDP
  - Don't Starve Together: `11000-11001` UDP
  - Valheim: `2456-2457` UDP

### 2. Ubuntu & LinuxGSM Setup
1. Enable `ufw` firewall and allow the game ports listed above (`sudo ufw allow <port>/udp`).
2. Install LinuxGSM following recommendations (one system user per game server):
   - **Valheim**: Follow [LinuxGSM vhserver setup](https://linuxgsm.com/lgsm/vhserver/) under user `vhserver`.
   - **Barotrauma**: Follow [LinuxGSM btserver setup](https://linuxgsm.com/lgsm/btserver/) under user `btserver`.
   - **Don't Starve Together**: Follow multi-shard configuration in [DST Server Guide](./DSTServer.md) under user `dstserver`.
3. Set system timezone:
   ```bash
   sudo timedatectl set-timezone Australia/Melbourne
   ```
4. Configure auto-shutdown script in `/home/ssm-user/shutdown.sh`:
   ```bash
   #!/usr/bin/env bash
   sudo -H -u vhserver bash -c '/home/vhserver/vhserver stop'
   sudo -H -u dstserver bash -c '/home/dstserver/dstserver-2 stop'
   sudo -H -u dstserver bash -c '/home/dstserver/dstserver stop'
   sudo -H -u btserver bash -c '/home/btserver/btserver stop'
   sudo shutdown -h now
   ```
5. Register daily 3:30 AM cron job:
   ```bash
   crontab -e
   30 03 * * * /home/ssm-user/shutdown.sh
   ```

## Slack & SSM Configuration

### Slack App Setup
1. Create a custom Slack app and install it to your workspace.
2. Under **OAuth & Permissions**, add `chat:write` bot scope.
3. Under **Slash Commands**, register `/gameserver` (pointing to the deployed API Gateway endpoint).
4. Save the Bot User OAuth Token and Signing Secret.

### AWS Systems Manager Parameter Store
Store the integration secrets in SSM Parameter Store (default prefix: `/game-host-automations`):
- `/game-host-automations/slack-bot-token` (SecureString)
- `/game-host-automations/slack-signing-secret` (SecureString)
- `/game-host-automations/discord-webhook` (SecureString)
- `/game-host-automations/slack-webhook` (SecureString)
- `/game-host-automations/slack-private-channel-id` (String)

## Deployment

Deploy using AWS SAM CLI:

```bash
# Automated deployment using SSM parameters
chmod +x deploy.sh
./deploy.sh

# Or manual guided deployment
sam build
sam deploy --guided
```

## Chatops Usage

Commands sent via Slack slash command (e.g. `/gameserver`):

| Command | Description |
| :--- | :--- |
| `/gameserver status` | Report current EC2 instance state, public IP, and game server statuses |
| `/gameserver start` | Start the EC2 instance if stopped |
| `/gameserver start <game>` | Start the EC2 instance (if not running), update, and launch `<game>` |
| `/gameserver stop <game>` | Stop a specific game server |
| `/gameserver shutdown` | Gracefully stop all active game servers and shut down the EC2 instance |
| `/gameserver help` | Show available commands and instructions |

Supported game identifiers: `vhserver`, `dstserver`, `btserver`.
