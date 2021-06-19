const AWS = require("aws-sdk");
const { default: axios } = require("axios");
const strip = require("strip-color");

const ssmService = new AWS.SSM({
  region: "ap-southeast-2",
  apiVersion: "2016-11-15",
});

const ec2Service = new AWS.EC2({
  region: "ap-southeast-2",
  apiVersion: "2016-11-15",
});

const GAME_SERVERS = ["vhserver", "dstserver", "btserver"];
const SERVER_NAME_TAG = process.env.SERVER_NAME_TAG || "game-server-dedicated";
const SLASH_COMMAND = process.env.SLASH_COMMAND || "/gameserver";

const markPreformattedText = (text) => `\`\`\`${text}\`\`\``;
const highlightText = (text) => `\`${text}\``;

const getInstance = async (ec2) => {
  // find our ec2 instance
  const result = await ec2
    .describeInstances({
      Filters: [
        {
          Name: "tag:Name",
          Values: [SERVER_NAME_TAG],
        },
      ],
    })
    .promise();

  const instance = result.Reservations?.[0]?.Instances?.[0];
  if (!instance) {
    throw new Error(`No EC2 instance found with tag:Name=${SERVER_NAME_TAG}`);
  }
  return {
    id: instance.InstanceId,
    address: instance.PublicIpAddress,
    status: instance.State.Name,
  };
};

const startInstance = async (instanceId, ec2, messagePoster) => {
  await ec2.startInstances({ InstanceIds: [instanceId] }).promise();
  await ec2
    .waitFor("instanceRunning", {
      InstanceIds: [instanceId],
    })
    .promise();
  await messagePoster("Instance started, waiting for ok status");
  await ec2
    .waitFor("instanceStatusOk", {
      InstanceIds: [instanceId],
    })
    .promise();
};

const stopInstance = async (instanceId, ec2) => {
  await ec2.stopInstances({ InstanceIds: [instanceId] }).promise();
  await ec2.waitFor("instanceStopped", { InstanceIds: [instanceId] });
};

const stopServers = async (commandRunner, servers) => {
  await Promise.all(
    servers.map(async (server) => {
      switch (server) {
        case "vhserver":
        case "btserver":
          await commandRunner([
            `sudo -H -u ${server} bash -c '/home/${server}/${server} stop 2>&1 || echo "failed"'`,
          ]);
          break;
        case "dstserver":
          await commandRunner([
            `sudo -H -u ${server} bash -c '/home/${server}/dstserver-2 stop 2>&1 || echo "failed"'`,
            `sudo -H -u ${server} bash -c '/home/${server}/dstserver stop 2>&1 || echo "failed"'`,
          ]);
          break;
      }
    })
  );
};

const startServers = async (commandRunner, servers) => {
  await Promise.all(
    servers.map(async (server) => {
      switch (server) {
        case "vhserver":
        case "btserver":
          await commandRunner([
            `sudo -H -u ${server} bash -c '/home/${server}/${server} update 2>&1 || echo "failed"'`,
            `sudo -H -u ${server} bash -c '/home/${server}/${server} start 2>&1 || echo "failed"'`,
          ]);
          break;

        case "dstserver":
          await commandRunner([
            `sudo -H -u ${server} bash -c '/home/${server}/dstserver update 2>&1 || echo "failed"'`,
            `sudo -H -u ${server} bash -c '/home/${server}/dstserver start 2>&1 || echo "failed"'`,
            `sudo -H -u ${server} bash -c '/home/${server}/dstserver-2 start 2>&1 || echo "failed"'`,
          ]);
          break;
      }
    })
  );
};

const runCommand = async (ssm, instanceId, commands) => {
  const results = [];
  for (const command of commands) {
    const {
      Command: { CommandId },
    } = await ssm
      .sendCommand({
        InstanceIds: [instanceId],
        DocumentName: "AWS-RunShellScript",
        Parameters: {
          commands: [command],
        },
      })
      .promise();

    // Sleep to ensure the command is actually present in aws...
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const result = await ssm
      .waitFor("commandExecuted", {
        InstanceId: instanceId,
        CommandId,
      })
      .promise();

    results.push(result);
  }
  return results;
};

const parseServerstatus = (output, server) => {
  const nameMap = {
    vhserver: "Valheim",
    dstserver: "Don't Starve Together",
    btserver: "Barotrauma",
  };

  const fullname = nameMap[server];
  if (fullname) {
    const rx = new RegExp(
      `^(${fullname} Server Details.*\n\n)(?:${server})`,
      "gsm"
    );
    const details = strip(output).match(rx)[0].replace(`\n\n${server}`, "");

    return details;
  }

  return "unknown server";
};

const getServerStatuses = async (commandRunner, servers = []) =>
  await Promise.all(
    servers
      .filter((s) => s)
      .map(async (server) => {
        const results = await commandRunner([
          `sudo -H -u ${server} bash -c '/home/${server}/${server} details'`,
        ]);
        return {
          name: server,
          status: parseServerstatus(results[0].StandardOutputContent, server),
        };
      })
  );

const getStatusMessage = async (instanceState, serverStates = []) => {
  let instanceMessage = [
    "*Server Instance status*",
    markPreformattedText(`
      Instance: ${instanceState.id}
      Address: ${instanceState.address || "Not set"}
      Status: ${instanceState.status}`).replace(/ {2}/gms, ""),
  ].join("");

  let serverMessages = serverStates
    .map((s) => `*${s.name}*\n${markPreformattedText(s.status)}`)
    .join("\n\n");

  return instanceMessage + "\n\n" + serverMessages;
};

const postToDiscord = async (webhookUrl, message) => {
  await axios.post(webhookUrl, {
    content: message,
  });
};

const postToSlack = async (webhookUrl, message) => {
  await axios.post(
    webhookUrl,
    {
      text: message,
    },
    {
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
};

module.exports.handler = async (event) => {
  const { text: args } = event;

  const messagePoster = async (message) => {
    await Promise.all([
      // eslint-disable-next-line no-undef
      postToSlack(process.env.SLACK_WEBHOOK, message),
      // eslint-disable-next-line no-undef
      postToDiscord(process.env.DISCORD_WEBHOOK, message),
    ]);
  };

  const commandString = args || "help";

  await messagePoster(`🧠 Processing command: ${highlightText(commandString)}`);
  try {
    const instance = await getInstance(ec2Service);

    const commandRunner = runCommand.bind(null, ssmService, instance.id);

    const statusPoster = async (servers = []) => {
      const instanceState = await getInstance(ec2Service);

      const serverStates =
        instanceState.status === "running"
          ? await getServerStatuses(commandRunner, servers)
          : [];

      const message = await getStatusMessage(instanceState, serverStates);
      await messagePoster(message);
    };

    const instanceStarter = startInstance.bind(
      null,
      instance.id,
      ec2Service,
      messagePoster
    );
    const instanceStopper = stopInstance.bind(null, instance.id, ec2Service);

    const serverStarter = startServers.bind(null, commandRunner);

    const serverStopper = stopServers.bind(null, commandRunner);

    const [subCommand, server] = commandString.split(" ");

    if (server && !GAME_SERVERS.includes(server)) {
      throw new Error(`Unknown server: ${server}`);
    }

    switch (subCommand) {
      case "status":
        await statusPoster(server ? [server] : GAME_SERVERS);
        break;

      case "start":
        if (instance.status !== "running") {
          await messagePoster(
            `Attempting to start instance (this might take a while)...`
          );
          await instanceStarter();
        }
        if (server) {
          await messagePoster(
            `Attempting to update and start ${highlightText(server)}...`
          );
          await serverStarter([server]);
        }
        await statusPoster(server ? [server] : GAME_SERVERS);
        await messagePoster(
          ":angry::moneybag: *DON'T FORGET TO SHUT ME DOWN WHEN YOU ARE FINISHED!* :moneybag::angry:"
        );
        break;

      case "stop":
        await messagePoster(`Attempting to stop ${highlightText(server)}...`);
        await serverStopper([server]);
        await statusPoster([server]);
        break;

      case "shutdown":
        if (instance.status === "running") {
          await messagePoster(`Attempting to stop servers...`);
          await serverStopper(GAME_SERVERS);
          await messagePoster(`Attempting to shutdown instance...`);
          await instanceStopper(instance);
        }
        await statusPoster();
        break;

      case "help":
        await messagePoster(
          `
        *Available Commands*
        ${highlightText(
          `${SLASH_COMMAND} status`
        )} (report status of instance/ip, servers)
        ${highlightText(`${SLASH_COMMAND} start`)} (start the ec2 instance)
        ${highlightText(
          `${SLASH_COMMAND} start <game>`
        )} start ec2 (if not already) and game server
        ${highlightText(`${SLASH_COMMAND} stop <game>`)} stop game server
        ${highlightText(`${SLASH_COMMAND} shutdown`)} shut the ec2 down gracefully
        Supported ${highlightText("<game>")} values: ${highlightText(
            "dstserver, btserver, vhserver"
          )}

        *NOTE:* Server shuts down (gracefully) every morning at 3:30am
        Ideally don't run more than one game server at a time... 
      `.replace(/ {3}/gms, "")
        );
        break;
    }
  } catch (e) {
    console.log(e);
    await messagePoster(
      `Failed to process command ${highlightText(
        commandString
      )} with error: ${markPreformattedText(e.message)}`
    );
  }
};
