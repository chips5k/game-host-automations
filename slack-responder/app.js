const { App, AwsLambdaReceiver } = require("@slack/bolt");
const AWS = require("aws-sdk");

const lambda = new AWS.Lambda({ apiVersion: "2015-03-31" });

const awsLambdaReceiver = new AwsLambdaReceiver({
  // eslint-disable-next-line no-undef
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const app = new App({
  // eslint-disable-next-line no-undef
  token: process.env.SLACK_BOT_TOKEN,
  receiver: awsLambdaReceiver,
  // The `processBeforeResponse` option is required for all FaaS environments.
  // It allows Bolt methods (e.g. `app.message`) to handle a Slack request
  // before the Bolt framework responds to the request (e.g. `ack()`). This is
  // important because FaaS immediately terminate handlers after the response.
  processBeforeResponse: true,
});

const SLASH_COMMAND = process.env.SLASH_COMMAND || "/gameserver";

app.command(SLASH_COMMAND, async ({ command, ack }) => {
  // eslint-disable-next-line no-undef
  if (
    !process.env.SLACK_PRIVATE_CHANNEL_ID ||
    command.channel_id === process.env.SLACK_PRIVATE_CHANNEL_ID
  ) {
    await lambda
      .invokeAsync({
        // eslint-disable-next-line no-undef
        FunctionName: process.env.SERVER_MANAGER_LAMBDA,
        InvokeArgs: JSON.stringify(command),
      })
      .promise();
    await ack("👌🏽 Command acknowledged, invoking handler....");
  } else {
    await ack(
      "🙅🏻‍♀️ You do not have permission to execute this command from this channel. Please ask in #game-servers for more details."
    );
  }
});

module.exports.handler = async (event, context, callback) => {
  const handler = await app.start();
  return handler(event, context, callback);
};
